-- Run after bootstrap.sql and the migration in an EMPTY, disposable database.
-- All fixtures/helpers are rolled back. Role changes exercise actual grants.
begin;
create schema comment_test;
create table comment_test.results (label text primary key);
create table comment_test.ids (label text primary key, id uuid, request_id uuid, pending boolean);
grant usage on schema comment_test to anon, authenticated;
grant select, insert on all tables in schema comment_test to anon, authenticated;
create function comment_test.assert(ok boolean, label text) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'ASSERTION FAILED: %', label; end if;
  insert into comment_test.results values (label);
end;
$$;
create function comment_test.expect_error(command text, expected text, label text, state text default 'P0001')
returns void language plpgsql as $$
declare caught boolean := false;
begin
  begin
    execute command;
  exception when others then
    caught := true;
    if sqlstate <> state or (expected is not null and sqlerrm <> expected) then
      raise exception 'ASSERTION FAILED: %, expected %/%, got %/%', label, state, expected, sqlstate, sqlerrm;
    end if;
  end;
  perform comment_test.assert(caught, label);
end;
$$;
create function comment_test.create_comment(
  label text, thread text, body text, nickname text, parent uuid default null,
  request uuid default gen_random_uuid()
) returns uuid language plpgsql as $$
declare result jsonb; new_id uuid;
begin
  result := public.comment_create(thread, body, nickname, parent, request);
  new_id := (result ->> 'id')::uuid;
  insert into comment_test.ids values (label, new_id, request, (result ->> 'is_pending')::boolean);
  return new_id;
end;
$$;
create function comment_test.id(label text) returns uuid language sql stable as $$
  select i.id from comment_test.ids i where i.label = $1;
$$;
create function comment_test.claims(user_number integer, session_number integer default null)
returns text language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object(
    'sub', '10000000-0000-0000-0000-' || lpad(user_number::text, 12, '0'),
    'session_id', '20000000-0000-0000-0000-' || lpad(coalesce(session_number, user_number)::text, 12, '0')
  )::text, true);
$$;

insert into auth.users (id,email,email_confirmed_at,banned_until)
select ('10000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
  'test' || n || '@example.invalid', case when n = 4 then null else now() end,
  case when n = 5 then now() + interval '1 day' else null end
from generate_series(1,8) n;
insert into auth.sessions (id,user_id,not_after)
select ('20000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
  ('10000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
  case when n = 6 then now() - interval '1 day' else null end
from generate_series(1,6) n;
insert into auth.sessions (id,user_id)
values ('20000000-0000-0000-0000-000000000008','10000000-0000-0000-0000-000000000008');
insert into comment_private.admins values ('10000000-0000-0000-0000-000000000001');

set local role anon;
select set_config('request.jwt.claims','{}',true);
select comment_test.assert(public.comment_me() = '{"nickname":null,"can_post":false,"is_admin":false,"banned":false,"moderation_enabled":false,"avatar_key":null,"avatar_path":null}'::jsonb, 'anonymous me is safe');
select comment_test.assert((select count(*) from public.comment_list('/about')) = 0, 'anonymous can read empty thread');
select comment_test.assert(public.comment_thread_list('/links') = '[]'::jsonb, 'anonymous can read links discussion');
select comment_test.expect_error($q$select public.comment_create('/links','x','x',null,gen_random_uuid())$q$, null, 'links anonymous write denied', '42501');
select comment_test.expect_error($q$select public.comment_thread_list('/en/links')$q$, 'invalid_thread', 'links discussion requires canonical locale');
select comment_test.expect_error('select * from comment_private.comments', null, 'anon private table denied', '42501');
select comment_test.expect_error('select * from comment_private.actor()', null, 'anon helper denied', '42501');
select comment_test.expect_error($q$select public.comment_create('/about','x','x',null,gen_random_uuid())$q$, null, 'anon write denied by grant', '42501');
select comment_test.expect_error($q$select * from public.comment_list('/en/about')$q$, 'invalid_thread', 'localized thread rejected');
select comment_test.expect_error($q$select * from public.comment_list('/blog/../x')$q$, 'invalid_thread', 'parent path segment rejected');
select comment_test.expect_error($q$select * from public.comment_list('/blog/./x')$q$, 'invalid_thread', 'dot segment rejected');
select comment_test.expect_error($q$select * from public.comment_list('/blog//x')$q$, 'invalid_thread', 'double separator rejected');
select comment_test.expect_error($q$select * from public.comment_list('/blog/x?x')$q$, 'invalid_thread', 'query rejected');
select comment_test.expect_error($q$select * from public.comment_list('/blog/x#x')$q$, 'invalid_thread', 'fragment rejected');
select comment_test.expect_error($q$select * from public.comment_list('/blog/x y')$q$, 'invalid_thread', 'space rejected');
select comment_test.expect_error($q$select * from public.comment_list('/blog/a' || chr(92) || 'b')$q$, 'invalid_thread', 'backslash rejected');
select comment_test.expect_error($q$select * from public.comment_list('/blog/a' || chr(9) || 'b')$q$, 'invalid_thread', 'thread control rejected');
select comment_test.expect_error($q$select * from public.comment_list('/blog/x/')$q$, 'invalid_thread', 'trailing slash rejected');
select comment_test.expect_error($q$select * from public.comment_list('/blog/' || repeat('a',295))$q$, 'invalid_thread', 'overlong thread rejected');
select comment_test.assert((select count(*) from public.comment_list('/blog/我的笔记.v2')) = 0, 'unicode and dots accepted');
select comment_test.expect_error($q$select * from public.comment_list('/about',now(),null)$q$, 'invalid_cursor', 'cursor requires tuple');
select comment_test.expect_error($q$select * from public.comment_list('/about',null,null,101)$q$, 'invalid_limit', 'page size cap');

set local role authenticated;
select set_config('request.jwt.claims','{}',true);
select comment_test.expect_error($q$select public.comment_create('/about','x','x',null,gen_random_uuid())$q$, 'authentication_required', 'authenticated role alone is insufficient');
select comment_test.claims(4);
select comment_test.expect_error($q$select public.comment_create('/links','x','x',null,gen_random_uuid())$q$, 'email_verification_required', 'links requires verified email');
select comment_test.expect_error($q$select public.comment_create('/about','x','x',null,gen_random_uuid())$q$, 'email_verification_required', 'unverified email cannot post');
select comment_test.assert((public.comment_me()->>'can_post')::boolean = false, 'unverified me cannot post');
select comment_test.claims(6);
select comment_test.expect_error($q$select public.comment_create('/about','x','x',null,gen_random_uuid())$q$, 'session_expired', 'expired session cannot post');
select comment_test.claims(7);
select comment_test.expect_error($q$select public.comment_create('/about','x','x',null,gen_random_uuid())$q$, 'session_expired', 'missing session cannot post');
select comment_test.claims(2,3);
select comment_test.expect_error($q$select public.comment_create('/about','x','x',null,gen_random_uuid())$q$, 'session_expired', 'session belongs to claimed user');
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000002","session_id":"malformed"}',true);
select comment_test.expect_error($q$select public.comment_create('/about','x','x',null,gen_random_uuid())$q$, 'session_expired', 'malformed session fails closed');
select comment_test.claims(5);
select comment_test.expect_error($q$select public.comment_create('/about','x','x',null,gen_random_uuid())$q$, 'user_banned', 'native auth ban enforced');
select comment_test.claims(2);
select comment_test.expect_error('select * from comment_private.admins', null, 'authenticated admin table denied', '42501');
select comment_test.expect_error('insert into comment_private.admins values (auth.uid())', null, 'cannot self promote', '42501');
select comment_test.expect_error('select * from comment_private.require_actor(true)', null, 'cannot call private auth helper', '42501');
select comment_test.expect_error($q$select public.comment_moderation(true)$q$, 'admin_required', 'moderation requires admin');
select comment_test.expect_error($q$select public.comment_review(gen_random_uuid(),true)$q$, 'admin_required', 'review requires admin');
select comment_test.expect_error($q$select public.comment_ban(gen_random_uuid(),true)$q$, 'admin_required', 'ban requires admin');
select comment_test.expect_error($q$select public.comment_delete(gen_random_uuid(),true)$q$, 'admin_required', 'branch deletion requires admin');
select comment_test.expect_error($q$select public.comment_create('/about','x','x')$q$, 'invalid_request_id', 'request id required');
select comment_test.expect_error($q$select public.comment_create('/about',' ','x',null,gen_random_uuid())$q$, 'invalid_body', 'blank body rejected');
select comment_test.expect_error($q$select public.comment_create('/about',chr(10)||chr(9),'x',null,gen_random_uuid())$q$, 'invalid_body', 'whitespace-only body rejected');
select comment_test.expect_error($q$select public.comment_create('/about',repeat('x',2001),'x',null,gen_random_uuid())$q$, 'invalid_body', 'body cap enforced');
select comment_test.expect_error($q$select public.comment_create('/about','x'||chr(1),'x',null,gen_random_uuid())$q$, 'invalid_body', 'body control rejected');
select comment_test.expect_error($q$select public.comment_create('/about','x',repeat('x',41),null,gen_random_uuid())$q$, 'invalid_nickname', 'nickname cap enforced');
select comment_test.expect_error($q$select public.comment_create('/about','x','name'||chr(10),null,gen_random_uuid())$q$, 'invalid_nickname', 'nickname newline rejected');
select comment_test.expect_error($q$select public.comment_create('/about',repeat('https://example.invalid ',6),'Alice',null,gen_random_uuid())$q$, 'too_many_links', 'more than five links rejected');
select comment_test.create_comment('root','/about',E'  Hello\r\n\tWorld  ',' Alice ');
select comment_test.assert((select body = E'Hello\n\tWorld' and nickname = 'Alice' and can_delete and not is_pending from public.comment_list('/about')), 'verified create normalization and ownership');
select comment_test.assert(public.comment_me()->>'nickname' = 'Alice', 'profile returns own nickname');
select comment_test.assert((select (public.comment_create('/about',E'Hello\n\tWorld','Alice',null,i.request_id)->>'id')::uuid = i.id from comment_test.ids i where label='root'), 'same request retry returns same id');
select comment_test.expect_error($q$select public.comment_create('/about','different','Alice',null,(select request_id from comment_test.ids where label='root'))$q$, 'idempotency_conflict', 'request id cannot change payload');
select comment_test.expect_error($q$select public.comment_create('/about',E'Hello\n\tWorld','Alice',null,gen_random_uuid())$q$, 'duplicate_comment', 'duplicate text rejected');
select comment_test.expect_error($q$select public.comment_create('/about','next','Alice',null,gen_random_uuid())$q$, 'rate_limited', 'cooldown enforced');
select comment_test.assert((select author_banned is null from public.comment_list('/about') limit 1), 'ordinary user cannot see ban metadata');

select comment_test.claims(3);
select comment_test.create_comment('reply','/about','Bob reply','Bob',comment_test.id('root'));
select comment_test.assert((select parent_nickname='Alice' and not parent_deleted and can_delete from public.comment_list('/about') where id=comment_test.id('reply')), 'reply includes parent context');
select comment_test.expect_error($q$select public.comment_delete(comment_test.id('root'))$q$, 'forbidden', 'cannot delete another author');
select comment_test.claims(2);
select public.comment_delete(comment_test.id('root'));
select comment_test.assert((select deleted and body='' and not can_delete from public.comment_list('/about') where id=comment_test.id('root')), 'owner deletion is tombstone');
select comment_test.assert((select body='Bob reply' and parent_deleted from public.comment_list('/about') where id=comment_test.id('reply')), 'owner deletion preserves another author reply');
select comment_test.assert((select (public.comment_create('/about',E'Hello\n\tWorld','Alice',null,i.request_id)->>'id')::uuid = i.id from comment_test.ids i where label='root'), 'retry after deletion does not duplicate');
select comment_test.assert((select body='' and deleted from public.comment_list('/about') where id=comment_test.id('root')), 'retry cannot restore deleted body');

reset role;
update comment_private.comments set created_at=clock_timestamp()-interval '11 minutes';
set local role authenticated;
select comment_test.claims(3);
select comment_test.expect_error($q$select public.comment_create('/about','new reply','Bob',comment_test.id('root'),gen_random_uuid())$q$, 'invalid_parent', 'cannot reply to tombstone');
select comment_test.expect_error($q$select public.comment_create('/blog/different','new reply','Bob',comment_test.id('reply'),gen_random_uuid())$q$, 'invalid_parent', 'parent must belong to same thread');
select comment_test.create_comment('other-thread','/blog/中文.v2','Separate thread','Bob');
select comment_test.claims(1);
select comment_test.create_comment('admin-root','/about','Admin message','Admin');
select comment_test.assert((select is_admin_author from public.comment_list('/about') where id=comment_test.id('admin-root')), 'admin author badge comes from private membership');
select comment_test.expect_error($q$select public.comment_ban(comment_test.id('admin-root'),true)$q$, 'cannot_ban_admin', 'admin cannot ban admin');
select public.comment_delete(comment_test.id('root'),true);
select comment_test.assert(not exists(select 1 from public.comment_list('/about') where id in (comment_test.id('root'),comment_test.id('reply'))), 'admin hides entire selected branch');
select comment_test.assert(exists(select 1 from public.comment_list('/blog/中文.v2') where id=comment_test.id('other-thread')), 'branch deletion preserves unrelated thread');
select comment_test.assert(exists(select 1 from public.comment_list('/about') where id=comment_test.id('admin-root')), 'branch deletion preserves sibling root');
reset role;
select comment_test.assert((select bool_and(body='' and deleted_at is not null and hidden_at is not null) from comment_private.comments where id in (comment_test.id('root'),comment_test.id('reply'))), 'branch erase clears stored bodies');

-- Ban uses a comment id: no public user ids or emails are necessary.
update comment_private.comments set created_at=clock_timestamp()-interval '11 minutes';
set local role authenticated;
select comment_test.claims(2);
select comment_test.create_comment('ban-target','/about','Still deletable after ban','Alice');
select comment_test.claims(1);
select public.comment_ban(comment_test.id('ban-target'),true);
select comment_test.assert((select author_banned from public.comment_list('/about') where id=comment_test.id('ban-target')), 'admin sees ban state');
select comment_test.claims(2);
select comment_test.assert((public.comment_me()->>'banned')::boolean and not (public.comment_me()->>'can_post')::boolean, 'ban immediately affects existing login');
select comment_test.assert((select can_delete from public.comment_list('/about') where id=comment_test.id('ban-target')), 'banned owner retains delete permission');
select comment_test.expect_error($q$select public.comment_create('/about','banned post','Alice',null,gen_random_uuid())$q$, 'user_banned', 'banned user cannot create');
select public.comment_delete(comment_test.id('ban-target'));
select comment_test.assert((select deleted and body='' from public.comment_list('/about') where id=comment_test.id('ban-target')), 'banned owner can erase own body');
select comment_test.claims(1);
select public.comment_ban(comment_test.id('ban-target'),false);
select comment_test.claims(2);
select comment_test.assert((public.comment_me()->>'can_post')::boolean and not (public.comment_me()->>'banned')::boolean, 'unban restores posting permission');
reset role;
delete from auth.sessions where id='20000000-0000-0000-0000-000000000002';
set local role authenticated;
select comment_test.claims(2);
select comment_test.assert(public.comment_me() = '{"nickname":null,"can_post":false,"is_admin":false,"banned":false,"moderation_enabled":false,"avatar_key":null,"avatar_path":null}'::jsonb, 'revoked session me degrades to anonymous');
select comment_test.assert(not exists(select 1 from public.comment_list('/about') where can_delete), 'revoked session has no deletion privilege');
select comment_test.expect_error($q$select public.comment_delete(comment_test.id('ban-target'))$q$, 'session_expired', 'logout revocation enforced server side');
reset role;
insert into auth.sessions(id,user_id) values('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002');
update comment_private.comments set created_at=clock_timestamp()-interval '11 minutes';

-- Pending records are visible only to their author and active admins.
set local role authenticated;
select comment_test.claims(1);
select public.comment_moderation(true);
select comment_test.claims(2);
select comment_test.assert((public.comment_me()->>'moderation_enabled')::boolean, 'moderation state exposed');
select comment_test.create_comment('pending-root','/blog/moderation','Awaiting review','Alice');
select comment_test.assert((select pending from comment_test.ids where label='pending-root'), 'create reports pending state');
select comment_test.assert((select is_pending and can_delete from public.comment_list('/blog/moderation') where id=comment_test.id('pending-root')), 'author sees own pending record');
select comment_test.claims(3);
select comment_test.assert(not exists(select 1 from public.comment_list('/blog/moderation')), 'other user cannot see pending record');
reset role;
update comment_private.comments set created_at=clock_timestamp()-interval '11 minutes';
set local role authenticated;
select comment_test.claims(3);
select comment_test.expect_error($q$select public.comment_create('/blog/moderation','guess','Bob',comment_test.id('pending-root'),gen_random_uuid())$q$, 'invalid_parent', 'cannot reply to another user pending parent');
select comment_test.claims(2);
select comment_test.create_comment('pending-child','/blog/moderation','Pending child','Alice',comment_test.id('pending-root'));
select comment_test.claims(1);
select comment_test.assert((select count(*) from public.comment_list('/blog/moderation'))=2, 'admin sees pending queue');
select comment_test.expect_error($q$select public.comment_review(comment_test.id('pending-child'),true)$q$, 'parent_pending', 'review cannot publish child before parent');
select public.comment_moderation(false);
select comment_test.assert((select count(*) from public.comment_list('/blog/moderation') where is_pending)=2, 'disabling moderation leaves pending queue intact');
select public.comment_review(comment_test.id('pending-root'),true);
select public.comment_review(comment_test.id('pending-child'),true);
set local role anon;
select set_config('request.jwt.claims','{}',true);
select comment_test.assert((select count(*) from public.comment_list('/blog/moderation') where not is_pending)=2, 'approved parent and reply visible publicly');
select comment_test.assert(not exists(select 1 from public.comment_list('/blog/moderation') where author_banned is not null or can_delete), 'public metadata grants no privileges');
select comment_test.assert((select to_jsonb(c) ? 'email' or to_jsonb(c) ? 'author_id' or to_jsonb(c) ? 'user_id' from public.comment_list('/blog/moderation') c limit 1)=false, 'list excludes private identity');

reset role;
update comment_private.comments set created_at=clock_timestamp()-interval '11 minutes';
set local role authenticated;
select comment_test.claims(1);
select public.comment_moderation(true);
select comment_test.claims(3);
select comment_test.create_comment('rejected','/blog/moderation','Reject this','Bob');
select comment_test.claims(1);
select public.comment_review(comment_test.id('rejected'),false);
select comment_test.expect_error($q$select public.comment_review(comment_test.id('rejected'),true)$q$, 'comment_hidden', 'rejection cannot restore erased content');
select comment_test.assert(not exists(select 1 from public.comment_list('/blog/moderation') where id=comment_test.id('rejected')), 'rejected record hidden even from list admin');
reset role;
select comment_test.assert((select body='' from comment_private.comments where id=comment_test.id('rejected')), 'rejection clears stored content');

-- Regression: ON DELETE SET NULL must not bypass the pending-parent ownership gate.
update comment_private.comments set created_at=clock_timestamp()-interval '11 minutes';
set local role authenticated;
select comment_test.claims(8);
select comment_test.create_comment('orphan-pending','/blog/orphan','Pending former account','Former author');
reset role;
delete from auth.users where id='10000000-0000-0000-0000-000000000008';
set local role authenticated;
select comment_test.claims(2);
select comment_test.assert(not exists(select 1 from public.comment_list('/blog/orphan')), 'orphan pending record remains private');
select comment_test.expect_error($q$select public.comment_create('/blog/orphan','Cannot attach to invisible pending parent','Alice',comment_test.id('orphan-pending'),gen_random_uuid())$q$, 'invalid_parent', 'null pending author does not bypass ownership');
select comment_test.claims(1);
select comment_test.create_comment('orphan-admin-reply','/blog/orphan','Admin can reply while pending','Admin',comment_test.id('orphan-pending'));
select comment_test.assert((select pending from comment_test.ids where label='orphan-admin-reply'), 'admin reply to orphan pending parent remains pending');
select public.comment_review(comment_test.id('orphan-pending'),true);
select comment_test.claims(2);
select comment_test.create_comment('orphan-published-reply','/blog/orphan','Public parent remains replyable','Alice',comment_test.id('orphan-pending'));
select comment_test.assert(exists(select 1 from public.comment_list('/blog/orphan') where id=comment_test.id('orphan-published-reply')), 'published orphan parent remains replyable');
select comment_test.claims(8);
select comment_test.assert(not (public.comment_me()->>'can_post')::boolean, 'deleted account session grants no identity');
select comment_test.expect_error($q$select public.comment_delete(comment_test.id('orphan-pending'))$q$, 'authentication_required', 'deleted account cannot retain author rights');
reset role;

-- Five per ten minutes is independent of the thirty second cooldown.
update comment_private.comments set created_at=clock_timestamp()-interval '11 minutes';
set local role authenticated;
select comment_test.claims(1);
select public.comment_moderation(false);
select comment_test.claims(2);
select comment_test.create_comment('window1','/blog/rate','window one','Alice');
reset role;
update comment_private.comments set created_at=clock_timestamp()-interval '1 minute' where id=comment_test.id('window1');
set local role authenticated;
select comment_test.claims(2);
select comment_test.create_comment('window2','/blog/rate','window two','Alice');
reset role;
update comment_private.comments set created_at=clock_timestamp()-interval '1 minute' where id=comment_test.id('window2');
set local role authenticated;
select comment_test.claims(2);
select comment_test.create_comment('window3','/blog/rate','window three','Alice');
reset role;
update comment_private.comments set created_at=clock_timestamp()-interval '1 minute' where id=comment_test.id('window3');
set local role authenticated;
select comment_test.claims(2);
select comment_test.create_comment('window4','/blog/rate','window four','Alice');
reset role;
update comment_private.comments set created_at=clock_timestamp()-interval '1 minute' where id=comment_test.id('window4');
set local role authenticated;
select comment_test.claims(2);
select comment_test.create_comment('window5','/blog/rate','window five','Alice');
reset role;
update comment_private.comments set created_at=clock_timestamp()-interval '1 minute' where id=comment_test.id('window5');
set local role authenticated;
select comment_test.claims(2);
select comment_test.expect_error($q$select public.comment_create('/blog/rate','window six','Alice',null,gen_random_uuid())$q$, 'rate_limited', 'five per ten minutes enforced');
select public.comment_delete(comment_test.id('window1'));
select comment_test.expect_error($q$select public.comment_create('/blog/rate','window one','Alice',null,gen_random_uuid())$q$, 'duplicate_comment', 'deletion does not bypass duplicate detection');

-- Identical timestamps still page without omissions because id is a tie-breaker.
reset role;
update comment_private.comments set created_at='2026-01-01 00:00:00+00' where thread='/blog/rate';
-- clock_timestamp() need not be unique (PGlite's clock has millisecond resolution).
-- Give the context fixture an explicit order so a random UUID cannot choose the root.
update comment_private.comments set created_at='2026-01-01 00:00:00+00' where id=comment_test.id('pending-root');
update comment_private.comments set created_at='2026-01-02 00:00:00+00' where id=comment_test.id('pending-child');
set local role anon;
select set_config('request.jwt.claims','{}',true);
select comment_test.assert((select count(*)=5 and count(distinct c.id)=5 from (
  select id from public.comment_list('/blog/rate',null,null,2)
  union all
  select id from public.comment_list('/blog/rate','2026-01-01 00:00:00+00',
    (select id from public.comment_list('/blog/rate',null,null,2) offset 1 limit 1),2)
  union all
  select id from public.comment_list('/blog/rate','2026-01-01 00:00:00+00',
    (select id from public.comment_list('/blog/rate',null,null,4) offset 3 limit 1),2)
) c), 'stable cursor returns all five distinct records');
select comment_test.assert((select count(*)=1 from public.comment_list('/blog/moderation',null,null,1)
  where id=comment_test.id('pending-child') and parent_id=comment_test.id('pending-root')
    and parent_nickname='Alice'), 'parent context survives one-row page');
reset role;
update comment_private.comments set created_at=clock_timestamp()-interval '11 minutes';
set local role authenticated;
select comment_test.claims(2);
select comment_test.create_comment('links-ok','/blog/limits',repeat('https://example.invalid ',5),'Alice');
select comment_test.assert(exists(select 1 from public.comment_list('/blog/limits') where id=comment_test.id('links-ok')), 'five links permitted');
reset role;
-- A fixture at the supported depth tests the boundary without bypassing RPC validation.
update comment_private.comments set depth=8, created_at=clock_timestamp()-interval '11 minutes' where id=comment_test.id('links-ok');
set local role authenticated;
select comment_test.claims(2);
select comment_test.expect_error($q$select public.comment_create('/blog/limits','too deep','Alice',comment_test.id('links-ok'),gen_random_uuid())$q$, 'thread_depth_exceeded', 'reply depth is bounded');
reset role;
update auth.users set banned_until=clock_timestamp()+interval '1 day' where id='10000000-0000-0000-0000-000000000001';
set local role authenticated;
select comment_test.claims(1);
select comment_test.assert(not (public.comment_me()->>'is_admin')::boolean, 'native banned admin loses admin privilege');
select comment_test.assert(not exists(select 1 from public.comment_list('/about') where id=comment_test.id('ban-target') and can_delete), 'banned admin cannot delete others');
select comment_test.expect_error($q$select public.comment_delete(comment_test.id('ban-target'))$q$, 'forbidden', 'banned admin deletion is limited to own content');
select comment_test.assert((select can_delete from public.comment_list('/about') where id=comment_test.id('admin-root')), 'native banned admin may delete own content');
select public.comment_delete(comment_test.id('admin-root'));
select comment_test.assert((select deleted and body='' from public.comment_list('/about') where id=comment_test.id('admin-root')), 'native banned author body erasure succeeds');
reset role;
-- FK nulling preserves published discussion when an auth account is removed.
delete from auth.users where id='10000000-0000-0000-0000-000000000003';
set local role authenticated;
select comment_test.claims(2);
select comment_test.assert((select can_delete=false from public.comment_list('/blog/中文.v2') where id=comment_test.id('other-thread')), 'orphaned author never produces null delete permission');
reset role;

-- Profiles are shared identity metadata, not a per-comment name snapshot.
insert into auth.users (id,email,email_confirmed_at)
select ('10000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
  'test' || n || '@example.invalid', now() from generate_series(9,10) n;
insert into auth.sessions (id,user_id)
select ('20000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
  ('10000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid from generate_series(9,10) n;
update auth.users set banned_until=null where id='10000000-0000-0000-0000-000000000001';
update comment_private.comments set created_at=clock_timestamp()-interval '11 minutes';
select comment_test.assert(not has_function_privilege('anon','public.comment_profile_update(text)','EXECUTE')
  and has_function_privilege('authenticated','public.comment_profile_update(text)','EXECUTE'), 'profile RPC has authenticated-only grant');
set local role anon;
select set_config('request.jwt.claims','{}',true);
select comment_test.expect_error($q$select public.comment_profile_update('Anonymous')$q$, null, 'anonymous cannot update profile', '42501');
set local role authenticated;
select comment_test.expect_error($q$select public.comment_profile_update('Anonymous')$q$, 'authentication_required', 'profile requires actual authenticated actor');
select comment_test.claims(4);
select comment_test.expect_error($q$select public.comment_profile_update('Unverified')$q$, 'email_verification_required', 'unverified cannot update profile');
select comment_test.claims(5);
select comment_test.expect_error($q$select public.comment_profile_update('Banned')$q$, 'user_banned', 'native banned cannot update profile');
select comment_test.claims(6);
select comment_test.expect_error($q$select public.comment_profile_update('Expired')$q$, 'session_expired', 'expired session cannot update profile');
select comment_test.claims(9,10);
select comment_test.expect_error($q$select public.comment_profile_update('Wrong session')$q$, 'session_expired', 'profile cannot use another account session');
select comment_test.claims(9);
select comment_test.expect_error($q$select public.comment_profile_update(null)$q$, 'invalid_nickname', 'profile null nickname rejected');
select comment_test.expect_error($q$select public.comment_profile_update('   ')$q$, 'invalid_nickname', 'profile blank nickname rejected');
select comment_test.expect_error($q$select public.comment_profile_update(repeat('x',41))$q$, 'invalid_nickname', 'profile name length cap');
select comment_test.expect_error($q$select public.comment_profile_update('Name'||chr(10))$q$, 'invalid_nickname', 'profile name controls rejected');
select comment_test.assert(public.comment_profile_update(repeat('星',40))->>'nickname'=repeat('星',40), 'profile allows forty Unicode characters');
select comment_test.assert(public.comment_profile_update('  Alice Nine  ') - 'avatar_key' =
  '{"nickname":"Alice Nine","can_post":true,"is_admin":false,"banned":false,"moderation_enabled":false,"avatar_path":null}'::jsonb,
  'profile update returns sanitized own public status only');
select comment_test.create_comment('profile-root','/blog/profile','Profile root','Stale first form');
select comment_test.assert((select nickname='Alice Nine' from public.comment_list('/blog/profile') where id=comment_test.id('profile-root')), 'create preserves an explicitly saved profile');
select comment_test.claims(10);
select comment_test.create_comment('profile-child','/blog/profile','Profile reply','Bob Ten',comment_test.id('profile-root'));
select comment_test.assert(public.comment_me()->>'nickname'='Bob Ten', 'legacy create still initializes missing profile');
reset role;
update comment_private.comments set created_at=clock_timestamp()-interval '11 minutes';
set local role authenticated;
select comment_test.claims(9);
select comment_test.create_comment('profile-other','/blog/profile-other','Elsewhere','Stale nickname');
select public.comment_profile_update('Alice Renamed');
select comment_test.assert((select nickname='Bob Ten' from public.comment_list('/blog/profile') where id=comment_test.id('profile-child')), 'profile update does not rename another account');
select comment_test.assert((select (public.comment_create('/blog/profile','Profile root','Alice Nine',null,i.request_id)->>'id')::uuid=i.id from comment_test.ids i where label='profile-root'), 'old-name retry returns existing new-version comment');
select comment_test.assert((select (public.comment_create('/blog/profile','Profile root','Alice Renamed',null,i.request_id)->>'id')::uuid=i.id from comment_test.ids i where label='profile-root'), 'current-name retry returns same comment');
select comment_test.assert(public.comment_me()->>'nickname'='Alice Renamed', 'retries cannot undo a rename');
select comment_test.expect_error($q$select public.comment_create('/blog/profile-other','Different body','Alice Nine',null,gen_random_uuid())$q$, 'rate_limited', 'profile rename cannot reset comment cooldown');
select comment_test.expect_error($q$select public.comment_create('/blog/profile-other','Elsewhere','Alice Nine',null,gen_random_uuid())$q$, 'duplicate_comment', 'profile rename cannot bypass duplicate detection');
select comment_test.expect_error($q$select public.comment_create('/blog/profile','Changed body','Alice Renamed',null,(select request_id from comment_test.ids where label='profile-root'))$q$, 'idempotency_conflict', 'rename retry still rejects changed body');
select comment_test.expect_error($q$select public.comment_create('/blog/profile-other','Profile root','Alice Renamed',null,(select request_id from comment_test.ids where label='profile-root'))$q$, 'idempotency_conflict', 'rename retry still rejects changed thread');
select comment_test.expect_error($q$select public.comment_create('/blog/profile','Profile root','Alice Renamed',comment_test.id('profile-child'),(select request_id from comment_test.ids where label='profile-root'))$q$, 'idempotency_conflict', 'rename retry still rejects changed parent');
set local role anon;
select set_config('request.jwt.claims','{}',true);
select comment_test.assert((select nickname='Alice Renamed' from public.comment_list('/blog/profile') where id=comment_test.id('profile-root')), 'public reader sees current name on historical root');
select comment_test.assert((select nickname='Alice Renamed' from public.comment_list('/blog/profile-other') where id=comment_test.id('profile-other')), 'profile rename applies across threads');
select comment_test.assert((select parent_nickname='Alice Renamed' from public.comment_list('/blog/profile') where id=comment_test.id('profile-child')), 'reply label follows parent author profile');
set local role authenticated;
select comment_test.claims(9);
select public.comment_delete(comment_test.id('profile-root'));
select public.comment_profile_update('Alice Final');
select comment_test.assert((select nickname='Alice Final' and deleted and body='' from public.comment_list('/blog/profile') where id=comment_test.id('profile-root')), 'deleted tombstone follows current profile without restoring body');
select comment_test.assert((select parent_nickname='Alice Final' and parent_deleted from public.comment_list('/blog/profile') where id=comment_test.id('profile-child')), 'deleted parent reply label follows current profile');
select comment_test.assert((select (public.comment_create('/blog/profile','Profile root','Old forgotten nickname',null,i.request_id)->>'id')::uuid=i.id from comment_test.ids i where label='profile-root'), 'deleted new-version comment retries independently of nickname');
reset role;
select comment_test.assert((select nickname='Alice Nine' and request_hash_version=2 from comment_private.comments where id=comment_test.id('profile-root')), 'profile rename preserves original snapshot and new hash version');
update comment_private.comments set created_at=clock_timestamp()-interval '11 minutes';
set local role authenticated;
select comment_test.claims(9);
select comment_test.create_comment('profile-legacy','/blog/profile-legacy','Legacy body','Stale first name');
reset role;
-- Model an existing 001/002 row, including its original nickname in the hash.
update comment_private.comments set request_hash_version=1,
  request_hash=encode(sha256(convert_to(jsonb_build_object(
    'thread',thread,'body',body,'nickname',nickname,'parent_id',parent_id
  )::text,'UTF8')),'hex') where id=comment_test.id('profile-legacy');
set local role authenticated;
select comment_test.claims(9);
select public.comment_profile_update('Alice After Upgrade');
select public.comment_delete(comment_test.id('profile-legacy'));
select comment_test.assert((select (public.comment_create('/blog/profile-legacy','Legacy body','Alice After Upgrade',null,i.request_id)->>'id')::uuid=i.id from comment_test.ids i where label='profile-legacy'), 'legacy deleted comment retries after profile rename');
select comment_test.assert(public.comment_me()->>'nickname'='Alice After Upgrade', 'legacy retry does not restore old profile');
select comment_test.expect_error($q$select public.comment_create('/blog/profile-legacy','Changed legacy body','Alice After Upgrade',null,(select request_id from comment_test.ids where label='profile-legacy'))$q$, 'idempotency_conflict', 'legacy request still protects immutable payload');
select comment_test.claims(1);
select comment_test.assert(public.comment_me()->>'nickname'='Cyril Fan', 'admin nickname exists before profile initialization');
select comment_test.assert((select nickname='Cyril Fan' and is_admin_author from public.comment_list('/about') where id=comment_test.id('admin-root')), 'old admin comments use fixed display name');
select comment_test.assert(public.comment_profile_update('Attempted other admin name')->>'nickname'='Cyril Fan', 'admin profile update cannot change fixed name');
select comment_test.create_comment('profile-admin','/blog/profile-admin','Owner post without nickname',null);
select comment_test.assert((select nickname='Cyril Fan' and is_admin_author from public.comment_list('/blog/profile-admin') where id=comment_test.id('profile-admin')), 'admin creates without entering nickname');
select comment_test.claims(10);
select comment_test.create_comment('profile-admin-reply','/blog/profile-admin','Reply to owner','Bob Ten',comment_test.id('profile-admin'));
select comment_test.assert((select parent_nickname='Cyril Fan' from public.comment_list('/blog/profile-admin') where id=comment_test.id('profile-admin-reply')), 'parent label uses fixed admin nickname');
select comment_test.claims(9);
select public.comment_profile_update('Cyril Fan');
select comment_test.assert(not (public.comment_me()->>'is_admin')::boolean, 'copying admin text does not grant admin role');
select comment_test.assert((select nickname='Cyril Fan' and not is_admin_author from public.comment_list('/blog/profile-other') where id=comment_test.id('profile-other')), 'copying admin text never grants owner badge');
select public.comment_profile_update('Alice Public');
select comment_test.claims(1);
select public.comment_ban(comment_test.id('profile-root'),true);
select comment_test.claims(9);
select comment_test.expect_error($q$select public.comment_profile_update('Banned rename')$q$, 'user_banned', 'comment banned cannot update profile');
select comment_test.assert(public.comment_me()->>'nickname'='Alice Public', 'denied rename leaves profile unchanged');
select comment_test.claims(10);
select public.comment_profile_update('Bob Final');
select comment_test.assert((select nickname='Bob Final' from public.comment_list('/blog/profile') where id=comment_test.id('profile-child')), 'reply author rename updates their historical replies');
select comment_test.assert((select nickname='Alice Public' from public.comment_list('/blog/profile') where id=comment_test.id('profile-root')), 'another profile update preserves first user identity');
reset role;
delete from auth.users where id='10000000-0000-0000-0000-000000000010';
set local role authenticated;
select comment_test.claims(10);
select comment_test.expect_error($q$select public.comment_profile_update('Deleted account')$q$, 'authentication_required', 'removed account cannot update a profile');
set local role anon;
select set_config('request.jwt.claims','{}',true);
select comment_test.assert((select nickname='Bob Ten' and not is_admin_author and not can_delete from public.comment_list('/blog/profile') where id=comment_test.id('profile-child')), 'orphaned comment safely falls back to stored name');
reset role;

-- 004 exempts only an actual administrator from posting frequency limits.
-- Do not age the owner's consecutive posts: both burst limits must be bypassed.
update comment_private.comments set created_at=clock_timestamp()-interval '11 minutes';
set local role authenticated;
select comment_test.claims(1);
select comment_test.create_comment('owner-burst-1','/blog/owner-burst','Owner first',null);
select comment_test.create_comment('owner-burst-2','/blog/owner-burst','Owner second',null,comment_test.id('owner-burst-1'));
select comment_test.create_comment('owner-burst-3','/blog/owner-burst','Owner third',null);
select comment_test.create_comment('owner-burst-4','/blog/owner-burst','Owner fourth',null);
select comment_test.create_comment('owner-burst-5','/blog/owner-burst','Owner fifth',null);
select comment_test.create_comment('owner-burst-6','/blog/owner-burst-other','Owner sixth',null);
select comment_test.create_comment('owner-burst-7','/blog/owner-burst','Owner seventh',null);
select comment_test.assert((select count(*) from comment_test.ids where label like 'owner-burst-%')=7, 'owner can post seven consecutive distinct comments including replies and another thread');
select comment_test.assert((select bool_and(nickname='Cyril Fan' and is_admin_author) from public.comment_list('/blog/owner-burst')), 'owner burst keeps authoritative nickname and badge');
select comment_test.assert((select (public.comment_create('/blog/owner-burst','Owner first',null,null,i.request_id)->>'id')::uuid=i.id from comment_test.ids i where label='owner-burst-1'), 'owner retry after burst returns original comment');
select comment_test.assert((select count(*) from public.comment_list('/blog/owner-burst'))=6, 'owner retry after burst creates no extra row');
select comment_test.expect_error($q$select public.comment_create('/blog/owner-burst','Changed owner body',null,null,(select request_id from comment_test.ids where label='owner-burst-1'))$q$, 'idempotency_conflict', 'owner frequency exemption does not bypass request payload integrity');
select comment_test.expect_error($q$select public.comment_create('/blog/owner-burst','  Owner first  ',null,null,gen_random_uuid())$q$, 'duplicate_comment', 'owner frequency exemption keeps normalized duplicate detection');
select public.comment_delete(comment_test.id('owner-burst-1'));
select comment_test.expect_error($q$select public.comment_create('/blog/owner-burst','Owner first',null,null,gen_random_uuid())$q$, 'duplicate_comment', 'owner deletion still cannot bypass duplicate detection');
select comment_test.assert((select (public.comment_create('/blog/owner-burst','Owner first',null,null,i.request_id)->>'id')::uuid=i.id from comment_test.ids i where label='owner-burst-1'), 'owner deleted burst comment remains safely idempotent');
select comment_test.assert((select deleted and body='' from public.comment_list('/blog/owner-burst') where id=comment_test.id('owner-burst-1')), 'owner retry never restores erased burst content');
select comment_test.expect_error($q$select public.comment_create('/blog/owner-burst',repeat('x',2001),null,null,gen_random_uuid())$q$, 'invalid_body', 'owner frequency exemption keeps body validation');
select comment_test.expect_error($q$select public.comment_create('/blog/owner-burst',repeat('https://example.invalid ',6),null,null,gen_random_uuid())$q$, 'too_many_links', 'owner frequency exemption keeps link limit');

-- Ordinary users cannot claim the exemption through names or signed metadata.
select comment_test.claims(2);
select public.comment_profile_update('Cyril Fan');
select set_config('request.jwt.claims', (auth.jwt() || '{"is_admin":true,"role":"authenticated","user_metadata":{"is_admin":true,"role":"admin","nickname":"Cyril Fan"},"app_metadata":{"is_admin":true,"role":"admin"}}'::jsonb)::text, true);
select comment_test.assert(not (public.comment_me()->>'is_admin')::boolean, 'matching owner name and admin metadata cannot obtain frequency exemption');
select comment_test.create_comment('impostor-burst','/blog/owner-burst-impostor','Ordinary first','Cyril Fan');
select comment_test.assert((select nickname='Cyril Fan' and not is_admin_author from public.comment_list('/blog/owner-burst-impostor')), 'admin metadata cannot add owner badge');
select comment_test.expect_error($q$select public.comment_create('/blog/owner-burst-impostor','Ordinary second','Cyril Fan',null,gen_random_uuid())$q$, 'rate_limited', 'matching owner name and admin metadata retain thirty second limit');
reset role;
update comment_private.comments set created_at=clock_timestamp()-interval '1 minute' where id=comment_test.id('impostor-burst');
-- Existing valid visitor posts count across threads, including deleted content.
update comment_private.comments set created_at=clock_timestamp()-interval '1 minute' where id in (
  comment_test.id('window1'),comment_test.id('window2'),comment_test.id('window3'),comment_test.id('window4')
);
set local role authenticated;
select comment_test.expect_error($q$select public.comment_create('/blog/owner-burst-impostor','Ordinary sixth','Cyril Fan',null,gen_random_uuid())$q$, 'rate_limited', 'matching owner name and admin metadata retain five per ten minutes across threads');

-- The exemption does not grant posting to a stale, unverified or banned owner.
reset role;
update auth.users set email_confirmed_at=null where id='10000000-0000-0000-0000-000000000001';
set local role authenticated;
select comment_test.claims(1);
select comment_test.expect_error($q$select public.comment_create('/blog/owner-burst','Unverified owner',null,null,gen_random_uuid())$q$, 'email_verification_required', 'owner frequency exemption still requires verified email');
reset role;
update auth.users set email_confirmed_at=now() where id='10000000-0000-0000-0000-000000000001';
update auth.sessions set not_after=clock_timestamp()-interval '1 minute' where id='20000000-0000-0000-0000-000000000001';
set local role authenticated;
select comment_test.expect_error($q$select public.comment_create('/blog/owner-burst','Expired owner',null,null,gen_random_uuid())$q$, 'session_expired', 'owner frequency exemption still requires live session');
reset role;
update auth.sessions set not_after=null where id='20000000-0000-0000-0000-000000000001';
update auth.users set banned_until=clock_timestamp()+interval '1 day' where id='10000000-0000-0000-0000-000000000001';
set local role authenticated;
select comment_test.expect_error($q$select public.comment_create('/blog/owner-burst','Banned owner',null,null,gen_random_uuid())$q$, 'user_banned', 'owner frequency exemption still requires unbanned account');
reset role;
update auth.users set banned_until=null where id='10000000-0000-0000-0000-000000000001';
set local role authenticated;
select comment_test.claims(1);
select comment_test.create_comment('links-owner','/links','A link exchange request',null);
select comment_test.assert(jsonb_array_length(public.comment_thread_list('/links'))=1, 'verified owner can publish in links discussion');
select comment_test.assert(not exists(select 1 from jsonb_array_elements(public.comment_thread_list('/links')) r where r ? 'email'), 'links public list does not expose email');
select public.comment_delete(comment_test.id('links-owner'),false);
select comment_test.assert(public.comment_thread_list('/links')='[]'::jsonb, 'deleting an unreplied links comment leaves no visible tombstone');
reset role;
delete from comment_private.admins where user_id='10000000-0000-0000-0000-000000000001';
set local role authenticated;
select comment_test.assert(not (public.comment_me()->>'is_admin')::boolean, 'removed owner membership immediately revokes exemption identity');
select comment_test.expect_error($q$select public.comment_create('/blog/owner-burst','Demoted owner','Cyril Fan',null,gen_random_uuid())$q$, 'rate_limited', 'removed owner membership immediately re-applies posting limits including existing owner posts');
reset role;
select comment_test.assert((select bool_and(proconfig @> array['search_path=""']) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='comment_private' or (n.nspname='public' and p.proname like 'comment_%')) and p.prosecdef), 'all definer functions pin empty search path');
select comment_test.assert(not has_schema_privilege('anon','comment_private','USAGE') and not has_schema_privilege('authenticated','comment_private','USAGE'), 'private schema usage remains denied');
select count(*)::integer as assertions_passed from comment_test.results;
rollback;
