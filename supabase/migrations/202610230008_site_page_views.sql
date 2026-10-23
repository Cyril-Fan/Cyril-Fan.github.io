-- Anonymous page-view totals, separate from accounts and comments.
begin;
create schema if not exists site_private;
revoke all on schema site_private from public, anon, authenticated;
alter default privileges in schema site_private revoke execute on functions from public;
alter default privileges in schema site_private revoke all on tables from public;

create table if not exists site_private.traffic (
  singleton boolean primary key default true check (singleton),
  total bigint not null default 0 check (total >= 0),
  started_at timestamptz not null default clock_timestamp(),
  minute_start timestamptz not null default date_trunc('minute', clock_timestamp()),
  minute_views integer not null default 0 check (minute_views between 0 and 300),
  day_start date not null default (clock_timestamp() at time zone 'UTC')::date,
  day_views integer not null default 0 check (day_views between 0 and 50000),
  cleaned_at timestamptz not null default clock_timestamp()
);
insert into site_private.traffic (singleton) values (true) on conflict do nothing;
create table if not exists site_private.view_receipts (
  request_id uuid primary key,
  created_at timestamptz not null default clock_timestamp()
);
create index if not exists view_receipts_expiry on site_private.view_receipts(created_at);
alter table site_private.traffic enable row level security;
alter table site_private.view_receipts enable row level security;
revoke all on all tables in schema site_private from public, anon, authenticated;

create or replace function public.read_site_stats()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('total', t.total::text, 'started_at', t.started_at)
  from site_private.traffic t where t.singleton;
$$;

create or replace function public.record_page_view(p_request_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
  v_minute timestamptz := date_trunc('minute', v_now);
  v_day date := (v_now at time zone 'UTC')::date;
  v_state site_private.traffic%rowtype;
begin
  if p_request_id is null then raise exception using errcode='22023', message='invalid_request_id'; end if;
  -- This single row lock serializes increments and retries across connections.
  select * into strict v_state from site_private.traffic where singleton for update;
  if v_state.cleaned_at < v_now - interval '1 hour' then
    delete from site_private.view_receipts where created_at < v_now - interval '1 day';
    update site_private.traffic set cleaned_at=v_now where singleton;
  end if;
  if exists (select 1 from site_private.view_receipts where request_id=p_request_id) then
    return public.read_site_stats() || jsonb_build_object('recorded', false);
  end if;
  -- Bound anonymous write volume without tracking IPs, accounts or devices.
  if (v_state.minute_start = v_minute and v_state.minute_views >= 300)
    or (v_state.day_start = v_day and v_state.day_views >= 50000) then
    return public.read_site_stats() || jsonb_build_object('recorded', false, 'limited', true);
  end if;
  insert into site_private.view_receipts(request_id,created_at) values(p_request_id,v_now);
  update site_private.traffic set
    total=total+1,
    minute_start=v_minute,
    minute_views=case when minute_start=v_minute then minute_views+1 else 1 end,
    day_start=v_day,
    day_views=case when day_start=v_day then day_views+1 else 1 end
  where singleton;
  return public.read_site_stats() || jsonb_build_object('recorded', true);
end;
$$;

revoke all on function public.read_site_stats(), public.record_page_view(uuid) from public, anon, authenticated;
grant execute on function public.read_site_stats(), public.record_page_view(uuid) to anon, authenticated;
notify pgrst, 'reload schema';
commit;
