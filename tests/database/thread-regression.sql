-- Disposable local PostgreSQL only; all records and grants below roll back.
begin;
create schema thread_test;
create table thread_test.results(label text primary key);
create table thread_test.snapshots(label text primary key, value jsonb);
grant usage on schema thread_test to anon, authenticated;
grant select, insert on all tables in schema thread_test to anon, authenticated;
create function thread_test.assert(ok boolean, label text) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'THREAD ASSERTION FAILED: %', label; end if;
  insert into thread_test.results values(label);
end;
$$;
create function thread_test.expect_error(command text, expected text, label text, state text default 'P0001')
returns void language plpgsql as $$
declare caught boolean := false;
begin
  begin execute command;
  exception when others then
    caught := true;
    if sqlstate <> state or (expected is not null and sqlerrm <> expected) then
      raise exception 'THREAD ASSERTION FAILED: %, expected %/%, got %/%', label, state, expected, sqlstate, sqlerrm;
    end if;
  end;
  perform thread_test.assert(caught, label);
end;
$$;
create function thread_test.id(n integer) returns uuid language sql immutable as $$
  select ('60000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid;
$$;
create function thread_test.claims(n integer, session_n integer default null) returns text language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object('sub',thread_test.id(n),
    'session_id',thread_test.id(1000+coalesce(session_n,n)))::text,true);
$$;
create function thread_test.add_comment(n integer, parent integer, stamp timestamptz,
  author integer default 2, status text default 'published', thread text default '/blog/conversation')
returns void language plpgsql as $$
begin
  insert into comment_private.comments(id,thread,parent_id,author_id,nickname,body,body_hash,
    created_at,status,depth,request_id,request_hash,request_hash_version)
  values(thread_test.id(n),thread,case when parent is null then null else thread_test.id(parent) end,
    thread_test.id(author),'Name '||n,'Body '||n,'hash '||n,stamp,status,
    case when parent is null then 0 else (select c.depth+1 from comment_private.comments c where c.id=thread_test.id(parent)) end,
    gen_random_uuid(),'request '||n,2);
end;
$$;
insert into auth.users(id,email,email_confirmed_at,banned_until)
select thread_test.id(n),'thread'||n||'@example.invalid',case when n=4 then null else now() end,
  case when n=6 then now()+interval '1 day' else null end from generate_series(1,9) n;
insert into auth.sessions(id,user_id,not_after)
select thread_test.id(1000+n),thread_test.id(n),case when n=5 then now()-interval '1 day' else null end
from generate_series(1,9) n;
insert into comment_private.admins values(thread_test.id(1));
insert into comment_private.bans(user_id) values(thread_test.id(7));
delete from auth.sessions where user_id=thread_test.id(8);
update auth.users set deleted_at=now() where id=thread_test.id(9);
select thread_test.add_comment(10,null,'2026-01-01 00:00Z');
select thread_test.add_comment(11,10,'2026-01-03 00:00Z');
select thread_test.add_comment(12,11,'2026-01-04 00:00Z',3);
select thread_test.add_comment(13,10,'2026-01-03 00:00Z');
select thread_test.add_comment(20,null,'2026-01-02 00:00Z',3);
select thread_test.add_comment(21,20,'2026-01-05 00:00Z',1);
select thread_test.add_comment(n,10,'2026-01-10 00:00Z'::timestamptz+n*interval '1 minute') from generate_series(30,64) n;
select thread_test.add_comment(100,null,'1990-01-01 00:00Z',3,'pending','/blog/private-root');
select thread_test.add_comment(101,100,'2026-01-20 00:00Z',2,'pending','/blog/private-root');
select thread_test.add_comment(102,101,'2026-01-21 00:00Z',2,'pending','/blog/private-root');
select thread_test.add_comment(103,100,'2026-01-22 00:00Z',1,'pending','/blog/private-root');

select thread_test.assert(has_function_privilege('anon','public.comment_thread_list(text,uuid,integer,uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.comment_thread_list(text,uuid,integer,uuid)','EXECUTE'),'thread reader grants');
select thread_test.assert(not has_function_privilege('anon','public.comment_author_email(text,uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.comment_author_email(text,uuid)','EXECUTE'),'email RPC grants');
select thread_test.assert(not has_schema_privilege('anon','comment_private','USAGE')
  and not has_schema_privilege('authenticated','comment_private','USAGE'),'private schema stays inaccessible');
set local role anon;
select set_config('request.jwt.claims','{}',true);
insert into thread_test.snapshots values('page1',public.comment_thread_list('/blog/conversation',null,3));
select thread_test.assert((select array_agg((r->>'id')::uuid order by ord)=array[thread_test.id(20),thread_test.id(21),thread_test.id(10)]
  from jsonb_array_elements(public.comment_thread_list('/blog/conversation',null,3)) with ordinality a(r,ord)), 'roots newest first, root before its later reply');
select thread_test.assert((select array_agg((r->>'id')::uuid order by ord)=array[thread_test.id(11),thread_test.id(13),thread_test.id(12)]
  from jsonb_array_elements(public.comment_thread_list('/blog/conversation',thread_test.id(10),3)) with ordinality a(r,ord)), 'nested replies chronological with stable equal-time IDs');
select thread_test.assert(jsonb_array_length(public.comment_thread_list('/blog/conversation'))=30,'default response bounded to thirty comments');
select thread_test.assert(jsonb_array_length(public.comment_thread_list('/blog/conversation',null,100))=41,'bounded larger page contains complete visible fixture');
select thread_test.assert(jsonb_array_length(public.comment_thread_list('/blog/conversation',thread_test.id(40),30,thread_test.id(64)))=2,'focus read returns only original and requested reply');
select thread_test.assert((public.comment_thread_list('/blog/conversation',thread_test.id(40),30,thread_test.id(64))->1->>'gap_before')::boolean,'focused reply explicitly marks unloaded middle replies');
select thread_test.assert(not (public.comment_thread_list('/blog/conversation',thread_test.id(63),30,thread_test.id(64))->1->>'gap_before')::boolean,'focus does not invent a gap when cursor is immediate predecessor');
select thread_test.assert(jsonb_array_length(public.comment_thread_list('/blog/conversation',null,30,thread_test.id(20)))=1,'focusing an original returns it once');
select thread_test.expect_error($q$select public.comment_thread_list('/blog/conversation',null,1,thread_test.id(64))$q$,'invalid_limit','focus must allow its original and target');
select thread_test.expect_error($q$select public.comment_thread_list('/blog/conversation',null,30,thread_test.id(100))$q$,'comment_not_found','focus cannot disclose private or foreign targets');
select thread_test.assert((select count(distinct r->>'id')=41 from (
  select jsonb_array_elements(public.comment_thread_list('/blog/conversation',null,30)) r
  union all select jsonb_array_elements(public.comment_thread_list('/blog/conversation',
    (public.comment_thread_list('/blog/conversation',null,30)->29->>'id')::uuid,30))
) q),'a large conversation spans pages without omission or duplication');
select thread_test.assert(public.comment_thread_list('/blog/conversation',thread_test.id(64),30)='[]'::jsonb,'last reply exhausts stream');
select thread_test.assert(not exists(select 1 from jsonb_array_elements(public.comment_thread_list('/blog/conversation',null,100)) r
  where r ?| array['email','author_email','user_id','author_id','session_id']),'public stream contains no private identity fields');
select thread_test.assert((select r->>'root_id'=thread_test.id(10)::text from jsonb_array_elements(public.comment_thread_list('/blog/conversation',null,100)) r
  where r->>'id'=thread_test.id(12)::text),'nested reply uses original root');
select thread_test.assert(public.comment_thread_list('/blog/private-root')='[]'::jsonb,'anonymous sees no pending thread');
select thread_test.expect_error($q$select public.comment_thread_list('/blog/conversation',null,101)$q$,'invalid_limit','upper page limit');
select thread_test.expect_error($q$select public.comment_thread_list('/blog/conversation',null,0)$q$,'invalid_limit','lower page limit');
select thread_test.expect_error($q$select public.comment_thread_list('/en/about')$q$,'invalid_thread','canonical route required');
select thread_test.expect_error($q$select public.comment_thread_list('/blog/conversation',thread_test.id(999))$q$,'invalid_cursor','unknown cursor fails closed');
select thread_test.expect_error($q$select public.comment_thread_list('/blog/conversation',thread_test.id(100))$q$,'invalid_cursor','foreign private cursor fails closed');
select thread_test.expect_error($q$select public.comment_author_email('/blog/conversation',thread_test.id(10))$q$,null,'anonymous email execution denied','42501');
select thread_test.assert((select not (to_jsonb(c) ?| array['email','author_email','root_id']) from public.comment_list('/blog/conversation') c limit 1),'legacy reader fields unchanged');
select thread_test.assert((select id=thread_test.id(64) from public.comment_list('/blog/conversation',null,null,1)),'legacy newest-first ordering unchanged');

set local role authenticated;
select thread_test.claims(2);
insert into thread_test.snapshots values('private',public.comment_thread_list('/blog/private-root'));
select thread_test.assert(jsonb_array_length(public.comment_thread_list('/blog/private-root'))=2,'author retains own pending descendants of unavailable root');
select thread_test.assert((select bool_and(r->>'root_id'=thread_test.id(101)::text and (r->>'root_unavailable')::boolean)
  from jsonb_array_elements(public.comment_thread_list('/blog/private-root')) r),'invisible root replaced by visible anchor');
select thread_test.assert((public.comment_thread_list('/blog/private-root')->0->'parent_id')='null'::jsonb,'invisible immediate parent ID is omitted');
select thread_test.assert(jsonb_array_length(public.comment_thread_list('/blog/private-root',null,30,thread_test.id(102)))=2
  and public.comment_thread_list('/blog/private-root',null,30,thread_test.id(102))::text not like '%'||thread_test.id(100)::text||'%','focus preserves unavailable-root privacy for own pending reply');
select thread_test.assert(public.comment_thread_list('/blog/private-root')::text not like '%1990%'
  and public.comment_thread_list('/blog/private-root')::text not like '%Body 100%'
  and public.comment_thread_list('/blog/private-root')::text not like '%Name 100%'
  and public.comment_thread_list('/blog/private-root')::text not like '%'||thread_test.id(100)::text||'%','hidden root metadata never enters response');
select thread_test.assert(jsonb_array_length(public.comment_thread_list('/blog/private-root',thread_test.id(101),1))=1,'private orphan group supports bounded continuation');
select thread_test.expect_error($q$select public.comment_thread_list('/blog/private-root',thread_test.id(100))$q$,'invalid_cursor','hidden root is not a usable cursor');
select thread_test.expect_error($q$select public.comment_author_email('/blog/conversation',thread_test.id(10))$q$,'admin_required','ordinary author cannot read even own email through admin RPC');
select set_config('request.jwt.claims',(auth.jwt()||'{"is_admin":true,"user_metadata":{"role":"admin"},"app_metadata":{"is_admin":true}}'::jsonb)::text,true);
select thread_test.expect_error($q$select public.comment_author_email('/blog/conversation',thread_test.id(10))$q$,'admin_required','spoofed metadata cannot authorize email');
select thread_test.claims(1);
select thread_test.assert(public.comment_author_email('/blog/conversation',thread_test.id(10))='thread2@example.invalid','verified current owner can read author email');
select thread_test.assert(jsonb_array_length(public.comment_thread_list('/blog/private-root'))=4,'owner sees whole pending tree');
select thread_test.assert(public.comment_author_email('/blog/private-root',thread_test.id(100))='thread3@example.invalid','owner can inspect pending author');
select thread_test.assert(not exists(select 1 from jsonb_array_elements(public.comment_thread_list('/blog/conversation')) r where r ? 'email'),'even owner thread list contains no email field');
select thread_test.expect_error($q$select public.comment_author_email('/about',thread_test.id(10))$q$,'comment_not_found','email target must belong to requested article');
select thread_test.expect_error($q$select public.comment_author_email('/blog/conversation',thread_test.id(999))$q$,'comment_not_found','missing email target fails safely');
select public.comment_delete(thread_test.id(10));
select thread_test.assert((select (r->>'deleted')::boolean and r->>'body'='' from jsonb_array_elements(public.comment_thread_list('/blog/conversation',null,100)) r
  where r->>'id'=thread_test.id(10)::text),'deleted original remains a root placeholder');
select thread_test.assert(jsonb_array_length(public.comment_thread_list('/blog/conversation',null,100))=41,'root deletion preserves all replies');
select public.comment_delete(thread_test.id(11),true);
select thread_test.assert(not exists(select 1 from jsonb_array_elements(public.comment_thread_list('/blog/conversation',null,100)) r
  where r->>'id' in (thread_test.id(11)::text,thread_test.id(12)::text)),'branch clearing hides nested descendants');
select thread_test.assert(exists(select 1 from jsonb_array_elements(public.comment_thread_list('/blog/conversation',null,100)) r
  where r->>'id'=thread_test.id(13)::text),'branch clearing preserves sibling reply');
select thread_test.expect_error($q$select public.comment_author_email('/blog/conversation',thread_test.id(11))$q$,'comment_not_found','hidden branch cannot return email');
select thread_test.expect_error($q$select public.comment_thread_list('/blog/conversation',thread_test.id(11))$q$,'invalid_cursor','removed cursor requires refresh');
reset role;
update auth.users set email='changed@example.invalid' where id=thread_test.id(2);
set local role authenticated;
select thread_test.claims(1);
select thread_test.assert(public.comment_author_email('/blog/conversation',thread_test.id(13))='changed@example.invalid','email lookup follows current account rather than snapshot');
reset role;
delete from auth.users where id=thread_test.id(3);
set local role authenticated;
select thread_test.claims(1);
select thread_test.assert(public.comment_author_email('/blog/conversation',thread_test.id(20)) is null,'deleted author account returns no retained email');
reset role;
insert into comment_private.admins select thread_test.id(n) from generate_series(4,9) n;
set local role authenticated;
select thread_test.claims(4);
select thread_test.expect_error($q$select public.comment_author_email('/blog/conversation',thread_test.id(13))$q$,'email_verification_required','unverified administrator denied');
select thread_test.claims(5);
select thread_test.expect_error($q$select public.comment_author_email('/blog/conversation',thread_test.id(13))$q$,'session_expired','expired administrator session denied');
select thread_test.claims(6);
select thread_test.expect_error($q$select public.comment_author_email('/blog/conversation',thread_test.id(13))$q$,'user_banned','native banned administrator denied');
select thread_test.claims(7);
select thread_test.expect_error($q$select public.comment_author_email('/blog/conversation',thread_test.id(13))$q$,'user_banned','comment banned administrator denied');
select thread_test.claims(8);
select thread_test.expect_error($q$select public.comment_author_email('/blog/conversation',thread_test.id(13))$q$,'session_expired','revoked administrator session denied');
select thread_test.claims(9);
select thread_test.expect_error($q$select public.comment_author_email('/blog/conversation',thread_test.id(13))$q$,'authentication_required','deleted administrator denied');
select thread_test.claims(1,2);
select thread_test.expect_error($q$select public.comment_author_email('/blog/conversation',thread_test.id(13))$q$,'session_expired','foreign session cannot grant owner access');
reset role;
delete from comment_private.admins where user_id=thread_test.id(1);
set local role authenticated;
select thread_test.claims(1);
select thread_test.expect_error($q$select public.comment_author_email('/blog/conversation',thread_test.id(13))$q$,'admin_required','removed owner immediately loses email access');
select thread_test.assert(jsonb_array_length(public.comment_thread_list('/blog/private-root'))=1,'former owner still sees only their own pending reply');
select thread_test.assert((public.comment_thread_list('/blog/private-root')->0->>'root_id')=thread_test.id(103)::text,'former owner private anchor contains no unavailable root metadata');
reset role;
select count(*) as thread_assertions_passed from thread_test.results;
rollback;
