-- Disposable local database only. Never run against production.
begin;
create schema deletion_test;
create table deletion_test.results(label text primary key);
grant usage on schema deletion_test to anon, authenticated;
grant select, insert on deletion_test.results to anon, authenticated;
create function deletion_test.assert(ok boolean, label text) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'DELETE ASSERTION FAILED: %',label; end if;
  insert into deletion_test.results values(label);
end; $$;
create function deletion_test.id(n integer) returns uuid language sql immutable as $$
  select ('70000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid;
$$;
create function deletion_test.claims(n integer) returns text language sql as $$
  select set_config('request.jwt.claims',jsonb_build_object('sub',deletion_test.id(n),'session_id',deletion_test.id(1000+n))::text,true);
$$;
create function deletion_test.add(n integer,parent integer default null,author integer default 2,status text default 'published',erased boolean default false)
returns void language plpgsql as $$
begin
  insert into comment_private.comments(id,thread,parent_id,author_id,nickname,body,body_hash,created_at,status,depth,request_id,request_hash,request_hash_version,deleted_at)
  values(deletion_test.id(n),'/blog/deletion-test',case when parent is null then null else deletion_test.id(parent) end,
    deletion_test.id(author),'Reader '||author,case when erased then '' else 'Body '||n end,'hash '||n,
    '2026-01-01'::timestamptz+n*interval '1 minute',status,
    case when parent is null then 0 else (select depth+1 from comment_private.comments where id=deletion_test.id(parent)) end,
    gen_random_uuid(),'request '||n,2,case when erased then now() else null end);
end; $$;
create function deletion_test.expect_error(command text,expected text,label text) returns void language plpgsql as $$
declare caught boolean:=false;
begin
  begin execute command;
  exception when others then caught:=true;if sqlerrm<>expected then raise exception 'Unexpected error: %',sqlerrm;end if;
  end;
  perform deletion_test.assert(caught,label);
end; $$;
insert into auth.users(id,email,email_confirmed_at)
select deletion_test.id(n),'delete'||n||'@example.invalid',now() from generate_series(1,3)n;
insert into auth.sessions(id,user_id)select deletion_test.id(1000+n),deletion_test.id(n)from generate_series(1,3)n;
insert into comment_private.admins values(deletion_test.id(1));
select deletion_test.add(10);
select deletion_test.add(20);
select deletion_test.add(21,20);
select deletion_test.add(30,null,2,'published',true);
select deletion_test.add(31,30,2,'published',true);
select deletion_test.add(32,31);
select deletion_test.add(40,null,2,'published',true);
select deletion_test.add(41,40,3,'pending');
select deletion_test.add(50,null,2,'published',true);
select deletion_test.add(60);
select deletion_test.add(70);
select deletion_test.add(71,70,3,'pending');

set local role anon;
select set_config('request.jwt.claims','{}',true);
select deletion_test.assert(not exists(select 1 from jsonb_array_elements(public.comment_thread_list('/blog/deletion-test',null,100))r where r->>'id'=deletion_test.id(50)::text),'old isolated tombstone disappears without deleting stored records');
select deletion_test.assert(not exists(select 1 from jsonb_array_elements(public.comment_thread_list('/blog/deletion-test',null,100))r where r->>'id'=deletion_test.id(40)::text),'unseen pending reply does not reveal deleted parent');
select deletion_test.assert((public.comment_thread_list('/blog/deletion-test',null,1)->0->>'id')=deletion_test.id(70)::text and not (public.comment_thread_list('/blog/deletion-test',null,1)->0->>'has_replies')::boolean,'public parent does not reveal private pending descendants');
select deletion_test.assert((select (r->>'has_replies')::boolean from jsonb_array_elements(public.comment_thread_list('/blog/deletion-test',null,100))r where r->>'id'=deletion_test.id(30)::text),'grandchild retains erased ancestors');
select deletion_test.assert((select (r->>'has_replies')::boolean from jsonb_array_elements(public.comment_thread_list('/blog/deletion-test',null,100))r where r->>'id'=deletion_test.id(31)::text),'erased intermediate ancestor retains its visible reply');
select deletion_test.assert((select not (r->>'has_replies')::boolean from jsonb_array_elements(public.comment_thread_list('/blog/deletion-test',null,100))r where r->>'id'=deletion_test.id(32)::text),'visible leaf has no branch action');

set local role authenticated;
select deletion_test.claims(1);
select deletion_test.assert((public.comment_thread_list('/blog/deletion-test',null,1)->0->>'has_replies')::boolean,'owner reply flag covers pending reply outside current page');
select deletion_test.assert(exists(select 1 from jsonb_array_elements(public.comment_thread_list('/blog/deletion-test',null,100))r where r->>'id'=deletion_test.id(40)::text),'owner keeps parent of pending reply');
select deletion_test.claims(2);
select deletion_test.assert(not exists(select 1 from jsonb_array_elements(public.comment_thread_list('/blog/deletion-test',null,100))r where r->>'id'=deletion_test.id(40)::text),'parent author cannot infer another user pending reply');
select public.comment_delete(deletion_test.id(10),false);
select deletion_test.assert(not exists(select 1 from jsonb_array_elements(public.comment_thread_list('/blog/deletion-test',null,100))r where r->>'id'=deletion_test.id(10)::text),'ordinary leaf deletion leaves no placeholder');
select public.comment_delete(deletion_test.id(20),false);
select deletion_test.assert((select (r->>'deleted')::boolean and (r->>'has_replies')::boolean and r->>'body'='' from jsonb_array_elements(public.comment_thread_list('/blog/deletion-test',null,100))r where r->>'id'=deletion_test.id(20)::text),'deleting parent preserves reply and erased placeholder');
select deletion_test.assert(exists(select 1 from jsonb_array_elements(public.comment_thread_list('/blog/deletion-test',null,100))r where r->>'id'=deletion_test.id(21)::text),'parent deletion preserves child');
select public.comment_delete(deletion_test.id(21),false);
select deletion_test.assert(not exists(select 1 from jsonb_array_elements(public.comment_thread_list('/blog/deletion-test',null,100))r where r->>'id' in(deletion_test.id(20)::text,deletion_test.id(21)::text)),'deleting last reply removes now-unneeded parent placeholder');
select public.comment_delete(deletion_test.id(10),false);
select deletion_test.assert(not exists(select 1 from jsonb_array_elements(public.comment_thread_list('/blog/deletion-test',null,100))r where r->>'id'=deletion_test.id(10)::text),'repeating deletion never restores leaf');
select deletion_test.claims(3);
select deletion_test.expect_error($q$select public.comment_delete(deletion_test.id(60),false)$q$,'forbidden','ordinary reader cannot delete another author');
select deletion_test.expect_error($q$select public.comment_delete(deletion_test.id(30),true)$q$,'admin_required','ordinary reader cannot delete a branch');
select deletion_test.claims(1);
select deletion_test.expect_error($q$select public.comment_create('/blog/deletion-test','Late reply',null,deletion_test.id(10),gen_random_uuid())$q$,'invalid_parent','reply after a leaf was erased cannot resurrect it');
select public.comment_delete(deletion_test.id(31),true);
select deletion_test.assert(not exists(select 1 from jsonb_array_elements(public.comment_thread_list('/blog/deletion-test',null,100))r where r->>'id' in(deletion_test.id(30)::text,deletion_test.id(31)::text,deletion_test.id(32)::text)),'branch erasure also removes obsolete ancestor placeholder');
select deletion_test.assert(exists(select 1 from jsonb_array_elements(public.comment_thread_list('/blog/deletion-test',null,100))r where r->>'id'=deletion_test.id(60)::text),'branch deletion preserves unrelated comments');
reset role;
select deletion_test.assert((select body='' and deleted_at is not null from comment_private.comments where id=deletion_test.id(10)),'leaf body is erased while private retry record remains');
select deletion_test.assert((select count(*)=12 from comment_private.comments where thread='/blog/deletion-test'),'reader upgrade never physically deletes comment records');
select deletion_test.assert((select prosrc like '%pg_advisory_xact_lock%' from pg_proc where oid='public.comment_delete(uuid,boolean)'::regprocedure)
  and (select prosrc like '%pg_advisory_xact_lock%' from pg_proc where oid='public.comment_create(text,text,text,uuid,uuid)'::regprocedure),'create and delete retain their shared transaction locking');
select count(*)::integer as deletion_assertions_passed from deletion_test.results;
rollback;

