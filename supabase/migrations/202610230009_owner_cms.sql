begin;
create schema cms_private;
revoke all on schema cms_private from public, anon, authenticated;
create table cms_private.documents (
  id text primary key check (id in ('profile','academic') or id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  kind text not null check (kind in ('post','friend','profile','academic')),
  revision integer not null default 1,
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 300000),
  deleted boolean not null default false,
  published_payload jsonb, published_revision integer, locked_slug text,
  updated_at timestamptz not null default clock_timestamp(),
  check ((kind in ('profile','academic') and id = kind) or (kind in ('post','friend') and id not in ('profile','academic')))
);
create table cms_private.versions (
  document_id text references cms_private.documents(id), revision integer,
  payload jsonb not null, deleted boolean not null, created_at timestamptz not null default clock_timestamp(),
  primary key(document_id,revision)
);
create table cms_private.jobs (
  id uuid primary key, document_id text not null references cms_private.documents(id),
  revision integer not null, action text not null check (action in ('publish','unpublish','trash')),
  state text not null default 'queued' check (state in ('queued','publishing','failed','committed','live','cancelled')),
  base_documents jsonb not null, documents jsonb not null,
  commit_sha text, error text, lease uuid, lease_until timestamptz,
  blobs jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp()
);
create table cms_private.media (
  id uuid primary key, name text not null check (char_length(name) between 1 and 150),
  alt text not null default '' check (char_length(alt) <= 500), deleted boolean not null default false,
  created_at timestamptz not null default clock_timestamp()
);
alter table cms_private.documents enable row level security;
alter table cms_private.versions enable row level security;
alter table cms_private.jobs enable row level security;
alter table cms_private.media enable row level security;
revoke all on all tables in schema cms_private from public, anon, authenticated;

create function cms_private.assert_idle(p_id text) returns void language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from cms_private.jobs where document_id=p_id and state in ('queued','publishing','failed')) then
    raise exception 'cms_publish_pending';
  end if;
end; $$;
create function cms_private.snapshot() returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',kind,'revision',published_revision,'payload',published_payload) order by id), '[]'::jsonb)
  from cms_private.documents where published_payload is not null;
$$;
create function cms_private.validate_draft(p_id text,p_kind text,p_payload jsonb) returns void language plpgsql set search_path='' as $$
begin
  if p_id is null or p_kind is null or p_payload is null or jsonb_typeof(p_payload) <> 'object' or octet_length(p_payload::text)>300000 then raise exception 'cms_invalid_document'; end if;
  if p_kind='post' and coalesce(p_payload->>'slug','')<>'' and (length(p_payload->>'slug')>80 or p_payload->>'slug' !~ '^[a-z0-9]+(-[a-z0-9]+)*$') then raise exception 'cms_invalid_slug'; end if;
end; $$;

create function public.cms_initialize(p_documents jsonb) returns void language plpgsql security definer set search_path='' as $$
declare d jsonb;
begin
  perform comment_private.require_actor(true);
  perform pg_advisory_xact_lock(230009);
  if exists(select 1 from cms_private.documents) then return; end if;
  if jsonb_typeof(p_documents)<>'array' or jsonb_array_length(p_documents)>500 or jsonb_array_length(p_documents)<2 then raise exception 'cms_invalid_seed'; end if;
  for d in select value from jsonb_array_elements(p_documents) loop
    perform cms_private.validate_draft(d->>'id',d->>'kind',d->'payload');
    insert into cms_private.documents(id,kind,payload,published_payload,published_revision,locked_slug) values
      (d->>'id',d->>'kind',d->'payload',d->'payload',1,case when d->>'kind'='post' then d->'payload'->>'slug' end);
    insert into cms_private.versions(document_id,revision,payload,deleted) values(d->>'id',1,d->'payload',false);
  end loop;
  if not exists(select 1 from cms_private.documents where id='profile') or not exists(select 1 from cms_private.documents where id='academic') then raise exception 'cms_invalid_seed'; end if;
end; $$;

create function public.cms_list() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform comment_private.require_actor(true);
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',kind,'revision',revision,'deleted',deleted,'published_revision',published_revision,'published',published_payload is not null,
    'changed',published_payload is distinct from payload,'title',coalesce(payload->'zh'->>'title',payload->>'name',kind),'updated_at',updated_at) order by updated_at desc,id),'[]'::jsonb) into result from cms_private.documents;
  return result;
end; $$;
create function public.cms_get(p_id text,p_version integer default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare d cms_private.documents; v cms_private.versions;
begin
  perform comment_private.require_actor(true);
  select * into d from cms_private.documents where id=p_id;
  if not found then raise exception 'cms_not_found'; end if;
  if p_version is null then return to_jsonb(d); end if;
  select * into v from cms_private.versions where document_id=p_id and revision=p_version;
  if not found then raise exception 'cms_not_found'; end if;
  return jsonb_build_object('id',d.id,'kind',d.kind,'revision',v.revision,'payload',v.payload,'deleted',v.deleted,'created_at',v.created_at);
end; $$;
create function public.cms_history(p_id text,p_before integer default 2147483647) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform comment_private.require_actor(true);
  select coalesce(jsonb_agg(to_jsonb(v) order by revision desc),'[]'::jsonb) into result from
    (select revision,created_at,deleted from cms_private.versions where document_id=p_id and revision<p_before order by revision desc limit 30) v;
  return result;
end; $$;
create function public.cms_save(p_id text,p_kind text,p_revision integer,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare d cms_private.documents;
begin
  perform comment_private.require_actor(true);
  perform pg_advisory_xact_lock(230009);
  perform cms_private.assert_idle(p_id);
  perform cms_private.validate_draft(p_id,p_kind,p_payload);
  select * into d from cms_private.documents where id=p_id for update;
  if not found then
    if p_revision<>0 or p_revision is null then raise exception 'cms_conflict'; end if;
    if (select count(*) from cms_private.documents)>=500 then raise exception 'cms_limit'; end if;
    insert into cms_private.documents(id,kind,payload) values(p_id,p_kind,p_payload) returning * into d;
  else
    if d.revision is distinct from p_revision or d.kind is distinct from p_kind then raise exception 'cms_conflict'; end if;
    if d.deleted then raise exception 'cms_in_trash'; end if;
    if d.locked_slug is not null and d.locked_slug is distinct from p_payload->>'slug' then raise exception 'cms_slug_locked'; end if;
    if d.payload = p_payload then return to_jsonb(d); end if;
    update cms_private.documents set payload=p_payload,revision=revision+1,updated_at=clock_timestamp() where id=p_id returning * into d;
  end if;
  insert into cms_private.versions(document_id,revision,payload,deleted) values(d.id,d.revision,d.payload,d.deleted);
  return to_jsonb(d);
end; $$;
create function public.cms_trash(p_id text,p_revision integer,p_deleted boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare d cms_private.documents;
begin
  perform comment_private.require_actor(true);
  perform pg_advisory_xact_lock(230009);
  perform cms_private.assert_idle(p_id);
  select * into d from cms_private.documents where id=p_id for update;
  if not found then raise exception 'cms_not_found'; end if;
  if d.revision is distinct from p_revision then raise exception 'cms_conflict'; end if;
  if p_deleted is null or d.kind in ('profile','academic') then raise exception 'cms_fixed_document'; end if;
  if p_deleted and d.published_payload is not null then raise exception 'cms_unpublish_first'; end if;
  if d.deleted=p_deleted then return to_jsonb(d); end if;
  update cms_private.documents set deleted=p_deleted,revision=revision+1,updated_at=clock_timestamp() where id=p_id returning * into d;
  insert into cms_private.versions(document_id,revision,payload,deleted) values(d.id,d.revision,d.payload,d.deleted);
  return to_jsonb(d);
end; $$;
create function public.cms_prepare_publish(p_id text,p_revision integer,p_action text,p_request_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare d cms_private.documents; j cms_private.jobs; base jsonb; target jsonb;
begin
  perform comment_private.require_actor(true);
  perform pg_advisory_xact_lock(230009);
  select * into j from cms_private.jobs where id=p_request_id;
  if found then
    if j.document_id is distinct from p_id or j.revision is distinct from p_revision or j.action is distinct from p_action then raise exception 'cms_request_conflict'; end if;
    return jsonb_build_object('id',j.id,'state',j.state);
  end if;
  if exists(select 1 from cms_private.jobs where state in ('queued','publishing','failed')) then raise exception 'cms_publish_pending'; end if;
  select * into d from cms_private.documents where id=p_id for update;
  if not found then raise exception 'cms_not_found'; end if;
  if d.revision is distinct from p_revision then raise exception 'cms_conflict'; end if;
  if d.deleted then raise exception 'cms_in_trash'; end if;
  if p_action is null or p_action not in ('publish','unpublish','trash') then raise exception 'cms_invalid_action'; end if;
  if d.kind in ('profile','academic') and p_action<>'publish' then raise exception 'cms_fixed_document'; end if;
  if p_action='publish' and d.kind='post' and exists(select 1 from cms_private.documents where id<>p_id and (published_payload->>'slug'=d.payload->>'slug' or locked_slug=d.payload->>'slug')) then raise exception 'cms_slug_taken'; end if;
  base:=cms_private.snapshot();
  select coalesce(jsonb_agg(value order by value->>'id'),'[]'::jsonb) into target from jsonb_array_elements(base) where value->>'id'<>p_id;
  if p_action='publish' then target:=target||jsonb_build_array(jsonb_build_object('id',d.id,'kind',d.kind,'revision',d.revision,'payload',d.payload)); end if;
  insert into cms_private.jobs(id,document_id,revision,action,base_documents,documents) values(p_request_id,p_id,p_revision,p_action,base,target) returning * into j;
  return jsonb_build_object('id',j.id,'state',j.state);
end; $$;
create function public.cms_jobs() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform comment_private.require_actor(true);
  select coalesce(jsonb_agg(to_jsonb(j) order by created_at desc),'[]'::jsonb) into result from
    (select id,document_id,revision,action,state,commit_sha,error,created_at,updated_at from cms_private.jobs order by created_at desc limit 20) j;
  return result;
end; $$;

-- These three functions are callable only by the publishing service. The Edge
-- handler first checks the caller's real session with comment_me.
create function public.cms_service_claim(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j cms_private.jobs;
begin
  select * into j from cms_private.jobs where id=p_id for update;
  if not found then raise exception 'cms_not_found'; end if;
  if j.state='publishing' and j.lease_until>clock_timestamp() then raise exception 'cms_publish_busy'; end if;
  if j.state in ('queued','failed','publishing') then
    update cms_private.jobs set state='publishing',lease=gen_random_uuid(),lease_until=clock_timestamp()+interval '10 minutes',error=null,updated_at=clock_timestamp() where id=p_id returning * into j;
  end if;
  return to_jsonb(j);
end; $$;

create function public.cms_service_stage(p_id uuid,p_lease uuid,p_blobs jsonb) returns void language plpgsql security definer set search_path='' as $$
declare j cms_private.jobs; item record;
begin
  select * into j from cms_private.jobs where id=p_id for update;
  if not found or j.state<>'publishing' or j.lease is distinct from p_lease then raise exception 'cms_lease_lost'; end if;
  if jsonb_typeof(p_blobs)<>'object' or octet_length(p_blobs::text)>50000 then raise exception 'cms_invalid_media'; end if;
  for item in select * from jsonb_each_text(p_blobs) loop
    if item.key !~ '^[0-9a-f-]{36}$' or item.value !~ '^[0-9a-f]{40}$' then raise exception 'cms_invalid_media'; end if;
  end loop;
  update cms_private.jobs set blobs=blobs||p_blobs,state='queued',lease=null,lease_until=null,updated_at=clock_timestamp() where id=p_id;
end; $$;
create function public.cms_service_redeploy(p_id uuid,p_sha text) returns void language plpgsql security definer set search_path='' as $$
begin
  if p_sha !~ '^[0-9a-f]{40}$' or p_sha is null then raise exception 'cms_invalid_commit'; end if;
  update cms_private.jobs set commit_sha=p_sha,updated_at=clock_timestamp() where id=p_id and state='committed';
  if not found then raise exception 'cms_invalid_state'; end if;
end; $$;
create function public.cms_service_finish(p_id uuid,p_lease uuid,p_state text,p_sha text default null,p_error text default null) returns void language plpgsql security definer set search_path='' as $$
declare j cms_private.jobs; d cms_private.documents; item jsonb;
begin
  perform pg_advisory_xact_lock(230009);
  select * into j from cms_private.jobs where id=p_id for update;
  if not found then raise exception 'cms_not_found'; end if;
  if p_state='live' and j.state in ('committed','live') then
    update cms_private.jobs set state='live',updated_at=clock_timestamp(),error=null where id=p_id; return;
  end if;
  if j.state<>'publishing' or j.lease is distinct from p_lease then raise exception 'cms_lease_lost'; end if;
  if p_state not in ('committed','failed','cancelled') or p_state is null then raise exception 'cms_invalid_state'; end if;
  if p_state='committed' then
    if p_sha is null or p_sha !~ '^[0-9a-f]{40}$' then raise exception 'cms_invalid_commit'; end if;
    select * into d from cms_private.documents where id=j.document_id for update;
    select value into item from jsonb_array_elements(j.documents) where value->>'id'=d.id;
    update cms_private.documents set published_payload=item->'payload',published_revision=(item->>'revision')::integer,
      locked_slug=case when d.kind='post' and j.action='publish' then d.payload->>'slug' else d.locked_slug end,
      deleted=case when j.action='trash' then true else deleted end,
      revision=revision+case when j.action='trash' then 1 else 0 end,updated_at=clock_timestamp() where id=d.id returning * into d;
    if j.action='trash' then insert into cms_private.versions(document_id,revision,payload,deleted) values(d.id,d.revision,d.payload,d.deleted); end if;
  end if;
  update cms_private.jobs set state=p_state,commit_sha=coalesce(p_sha,commit_sha),error=left(p_error,500),lease_until=null,updated_at=clock_timestamp() where id=p_id;
end; $$;

create function public.cms_media_list() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  perform comment_private.require_actor(true);
  select coalesce(jsonb_agg(to_jsonb(m) order by created_at desc),'[]'::jsonb) into result from cms_private.media m;
  return result;
end; $$;
create function public.cms_media_save(p_id uuid,p_name text,p_alt text,p_deleted boolean default false) returns void language plpgsql security definer set search_path='' as $$
begin
  perform comment_private.require_actor(true);
  if p_name is null or p_alt is null or p_deleted is null then raise exception 'cms_invalid_media'; end if;
  if not exists(select 1 from cms_private.media where id=p_id) and (select count(*) from cms_private.media)>=1000 then raise exception 'cms_limit'; end if;
  if p_deleted and (exists(select 1 from cms_private.documents where not deleted and payload::text like '%'||p_id::text||'%' or published_payload::text like '%'||p_id::text||'%') or exists(select 1 from cms_private.jobs where state in ('queued','publishing','failed') and documents::text like '%'||p_id::text||'%')) then raise exception 'cms_media_in_use'; end if;
  insert into cms_private.media(id,name,alt,deleted) values(p_id,btrim(p_name),p_alt,p_deleted) on conflict(id) do update set name=excluded.name,alt=excluded.alt,deleted=excluded.deleted;
end; $$;
create function cms_private.media_access(p_name text,p_upload boolean) returns boolean language plpgsql stable security definer set search_path='' as $$
declare a record;
begin
  select * into a from comment_private.actor();
  if a.problem is not null or not a.is_admin then return false; end if;
  return exists(select 1 from cms_private.media m where p_name=m.id::text||'.webp' and (not p_upload or not m.deleted));
end; $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('cms-media','cms-media',false,4194304,array['image/webp']);
create policy cms_media_read on storage.objects for select to authenticated using(bucket_id='cms-media' and cms_private.media_access(name,false));
create policy cms_media_insert on storage.objects for insert to authenticated with check(bucket_id='cms-media' and cms_private.media_access(name,true));
-- Immutable objects: no overwrite/delete policy. Recycling only changes metadata,
-- retaining the file needed by historical versions and published Git content.
grant usage on schema cms_private to authenticated;
revoke all on all functions in schema cms_private from public,anon,authenticated;
grant execute on function cms_private.media_access(text,boolean) to authenticated;
revoke all on function public.cms_initialize(jsonb),public.cms_list(),public.cms_get(text,integer),public.cms_history(text,integer),public.cms_save(text,text,integer,jsonb),public.cms_trash(text,integer,boolean),public.cms_prepare_publish(text,integer,text,uuid),public.cms_jobs(),public.cms_media_list(),public.cms_media_save(uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.cms_initialize(jsonb),public.cms_list(),public.cms_get(text,integer),public.cms_history(text,integer),public.cms_save(text,text,integer,jsonb),public.cms_trash(text,integer,boolean),public.cms_prepare_publish(text,integer,text,uuid),public.cms_jobs(),public.cms_media_list(),public.cms_media_save(uuid,text,text,boolean) to authenticated;
revoke all on function public.cms_service_claim(uuid),public.cms_service_finish(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.cms_service_claim(uuid),public.cms_service_finish(uuid,uuid,text,text,text) to service_role;
revoke all on function public.cms_service_stage(uuid,uuid,jsonb),public.cms_service_redeploy(uuid,text) from public,anon,authenticated;
grant execute on function public.cms_service_stage(uuid,uuid,jsonb),public.cms_service_redeploy(uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
