-- Disposable local database only; never adds visits to the live site.
begin;
create schema traffic_test;
create table traffic_test.results(label text primary key);
grant usage on schema traffic_test to anon, authenticated;
grant insert,select on traffic_test.results to anon,authenticated;
create function traffic_test.assert(ok boolean,label text) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'ASSERTION FAILED: %',label; end if;
  insert into traffic_test.results values(label);
end;
$$;
create function traffic_test.denied(command text,label text) returns void language plpgsql as $$
declare caught boolean:=false;
begin
  begin execute command; exception when insufficient_privilege then caught:=true; end;
  perform traffic_test.assert(caught,label);
end;
$$;
set local role anon;
select traffic_test.assert((public.read_site_stats()->>'total')='0','counter starts empty');
select traffic_test.assert((public.record_page_view('00000000-0000-4000-8000-000000000001')->>'total')='1','anonymous visit increments once');
select traffic_test.assert((public.record_page_view('00000000-0000-4000-8000-000000000001')->>'total')='1','lost-response retry is idempotent');
select traffic_test.assert((public.record_page_view('00000000-0000-4000-8000-000000000002')->>'total')='2','new navigation counts separately');
select traffic_test.assert(public.read_site_stats() ? 'started_at','start time is public');
select traffic_test.assert((select count(*) from jsonb_object_keys(public.read_site_stats()))=2,'public stats expose aggregate only');
select traffic_test.denied('select * from site_private.view_receipts','anonymous cannot read receipts');
select traffic_test.denied('update site_private.traffic set total=12345','anonymous cannot set total');
select traffic_test.denied('delete from site_private.traffic','anonymous cannot clear count');
set local role authenticated;
select traffic_test.assert((public.record_page_view('00000000-0000-4000-8000-000000000003')->>'total')='3','authenticated and anonymous share total');
select traffic_test.denied('select * from site_private.traffic','signed-in user cannot read internal counters');
select traffic_test.denied('insert into site_private.view_receipts(request_id) values(gen_random_uuid())','signed-in user cannot insert receipts');
reset role;
select traffic_test.assert((select count(*) from site_private.view_receipts)=3,'retries do not grow receipts');
select traffic_test.assert(not exists(select 1 from information_schema.columns where table_schema='site_private' and column_name in ('ip','email','user_id','user_agent','referrer','path')),'no visitor identity or browsing history stored');
update site_private.traffic set minute_start=date_trunc('minute',clock_timestamp()),minute_views=300;
set local role anon;
select traffic_test.assert((public.record_page_view('00000000-0000-4000-8000-000000000004')->>'limited')::boolean,'burst protection applies anonymously');
select traffic_test.assert((public.read_site_stats()->>'total')='3','limited request cannot change count');
reset role;
update site_private.traffic set minute_start=clock_timestamp()-interval '1 hour',day_start=(clock_timestamp() at time zone 'UTC')::date,day_views=50000;
set local role anon;
select traffic_test.assert((public.record_page_view('00000000-0000-4000-8000-000000000005')->>'limited')::boolean,'daily write budget bounds receipt growth');
reset role;
update site_private.traffic set day_start=(clock_timestamp() at time zone 'UTC')::date-1,cleaned_at=clock_timestamp()-interval '2 hours';
update site_private.view_receipts set created_at=clock_timestamp()-interval '2 days' where request_id='00000000-0000-4000-8000-000000000001';
set local role anon;
select traffic_test.assert((public.record_page_view('00000000-0000-4000-8000-000000000006')->>'total')='4','new time bucket resumes counting');
reset role;
select traffic_test.assert(not exists(select 1 from site_private.view_receipts where request_id='00000000-0000-4000-8000-000000000001'),'expired retry receipts are pruned');
select traffic_test.assert((select minute_views=1 and day_views=1 from site_private.traffic),'time buckets reset independently');
select count(*) as traffic_assertions_passed from traffic_test.results;
rollback;
