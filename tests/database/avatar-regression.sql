-- Local metadata/RLS regression only. No real JPEG or Storage HTTP upload.
begin;
create schema avatar_test;
create table avatar_test.results (label text primary key);
create table avatar_test.keys (user_number integer primary key, avatar_key uuid);
create table avatar_test.comments (label text primary key, id uuid);
create table avatar_test.snapshots (label text primary key, value text);
grant usage on schema avatar_test to anon, authenticated;
grant select, insert on all tables in schema avatar_test to anon, authenticated;
create function avatar_test.assert(ok boolean, label text) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'AVATAR ASSERTION FAILED: %', label; end if;
  insert into avatar_test.results values (label);
end;
$$;
create function avatar_test.expect_error(command text, label text, state text default '42501')
returns void language plpgsql as $$
declare caught boolean := false;
begin
  begin
    execute command;
  exception when others then
    caught := true;
    if sqlstate <> state then
      raise exception 'AVATAR ASSERTION FAILED: %, expected %, got %/%', label, state, sqlstate, sqlerrm;
    end if;
  end;
  perform avatar_test.assert(caught, label);
end;
$$;
create function avatar_test.affected(command text, expected integer, label text)
returns void language plpgsql as $$
declare affected_rows integer;
begin
  execute command;
  get diagnostics affected_rows = row_count;
  perform avatar_test.assert(affected_rows=expected, label);
end;
$$;
create function avatar_test.claims(user_number integer, session_number integer default null)
returns text language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object(
    'sub', '40000000-0000-0000-0000-' || lpad(user_number::text, 12, '0'),
    'session_id', '50000000-0000-0000-0000-' || lpad(coalesce(session_number, user_number)::text, 12, '0')
  )::text, true);
$$;
create function avatar_test.key(user_number integer) returns text language sql stable as $$
  select k.avatar_key::text || '.jpg' from avatar_test.keys k where k.user_number=$1;
$$;
insert into auth.users (id,email,email_confirmed_at,banned_until)
select ('40000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
  'avatar' || n || '@example.invalid', case when n=4 then null else now() end,
  case when n=5 then now()+interval '1 day' else null end from generate_series(1,8) n;
insert into auth.sessions (id,user_id,not_after)
select ('50000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
  ('40000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid,
  case when n=6 then now()-interval '1 day' else null end from generate_series(1,8) n where n<>7;
insert into comment_private.admins values ('40000000-0000-0000-0000-000000000001');
insert into comment_private.profiles (user_id,nickname)
select ('40000000-0000-0000-0000-' || lpad(n::text,12,'0'))::uuid, 'Avatar ' || n
from generate_series(1,7) n where n<>2;
insert into storage.buckets (id,name,public) values ('unrelated-private','unrelated-private',false);

select avatar_test.assert((select public and file_size_limit=131072 and allowed_mime_types=array['image/jpeg'] from storage.buckets where id='comment-avatars'), 'bucket declares public JPEG-only maximum 128 KiB');
select avatar_test.assert(not has_function_privilege('anon','public.comment_avatar_is_owner(text,boolean)','EXECUTE')
  and has_function_privilege('authenticated','public.comment_avatar_is_owner(text,boolean)','EXECUTE'), 'avatar policy helper has authenticated-only execute grant');
select avatar_test.assert(has_function_privilege('anon','public.comment_list(text,timestamptz,uuid,integer)','EXECUTE')
  and has_function_privilege('authenticated','public.comment_list(text,timestamptz,uuid,integer)','EXECUTE'), 'recreated comment list retains intended read grants');
select avatar_test.assert((select count(*)=4 from pg_policies where schemaname='storage' and tablename='objects' and policyname like 'comment_avatars_%'), 'all four storage object actions have scoped policies');

set local role authenticated;
select avatar_test.claims(2);
select avatar_test.assert(public.comment_me()->'avatar_key'='null'::jsonb and public.comment_me()->'avatar_path'='null'::jsonb, 'profile-free account has no upload key or avatar');
select avatar_test.expect_error($q$insert into storage.objects(bucket_id,name) values('comment-avatars',gen_random_uuid()::text||'.jpg')$q$, 'profile-free account cannot create arbitrary object');
insert into avatar_test.comments values ('first',(public.comment_create('/blog/avatar-history','Before first avatar','Alice Avatar',null,gen_random_uuid())->>'id')::uuid);
select avatar_test.assert((public.comment_me()->>'avatar_key')::uuid is not null and public.comment_me()->'avatar_path'='null'::jsonb, 'first comment initializes opaque profile key without uploaded image');
reset role;
insert into avatar_test.keys
select right(user_id::text,12)::integer, avatar_key from comment_private.profiles;
select avatar_test.assert((select count(*)=7 and count(distinct avatar_key)=7 from comment_private.profiles), 'every profile has unique generated avatar key');
select avatar_test.assert(not exists(select 1 from comment_private.profiles where avatar_key=user_id), 'avatar keys do not encode account UUIDs');
update comment_private.comments set created_at=clock_timestamp()-interval '1 minute';
set local role authenticated;
select avatar_test.claims(2);
insert into avatar_test.comments values ('second',(public.comment_create('/blog/avatar-other','Other historical comment','Alice Avatar',null,gen_random_uuid())->>'id')::uuid);
select avatar_test.assert((select avatar_path is null from public.comment_list('/blog/avatar-history')), 'historical comment defaults to no avatar');
select avatar_test.affected($q$insert into storage.objects(bucket_id,name,owner_id,metadata,updated_at) values('comment-avatars',avatar_test.key(2),auth.uid()::text,'{"mimetype":"image/jpeg","size":1234}','2026-10-19 00:00:00+00')$q$,1,'verified ordinary user can insert their fixed object');
select avatar_test.assert(public.comment_me()->>'avatar_path'=avatar_test.key(2)||'?v=1792368000000000', 'self avatar path includes opaque key and deterministic update version');
select avatar_test.assert((select avatar_path=public.comment_me()->>'avatar_path' from public.comment_list('/blog/avatar-history')), 'new avatar appears on older comment');
select avatar_test.assert((select avatar_path=public.comment_me()->>'avatar_path' from public.comment_list('/blog/avatar-other')), 'new avatar applies across historical threads');
select avatar_test.assert((select count(*)=1 from storage.objects), 'ordinary storage listing shows only own object');
select avatar_test.expect_error($q$insert into storage.objects(bucket_id,name) values('comment-avatars',avatar_test.key(2)||'.jpg')$q$, 'extra objects cannot accumulate under suffix variants');
select avatar_test.expect_error($q$insert into storage.objects(bucket_id,name) values('comment-avatars','nested/'||avatar_test.key(2))$q$, 'upload path cannot add folders');
select avatar_test.expect_error($q$insert into storage.objects(bucket_id,name) values('unrelated-private',avatar_test.key(2))$q$, 'own key grants no access to another bucket');
select avatar_test.expect_error($q$update storage.objects set name=avatar_test.key(3) where name=avatar_test.key(2)$q$, 'own object cannot be renamed to another account key');
select avatar_test.expect_error($q$update storage.objects set bucket_id='unrelated-private' where name=avatar_test.key(2)$q$, 'own object cannot move to another bucket');
select avatar_test.affected($q$insert into storage.objects(bucket_id,name,owner_id,metadata,updated_at) values('comment-avatars',avatar_test.key(2),auth.uid()::text,'{"mimetype":"image/jpeg","size":2345}','2026-10-19 00:00:01+00') on conflict(bucket_id,name) do update set metadata=excluded.metadata,updated_at=excluded.updated_at$q$,1,'own overwrite has insert select and update permission');
select avatar_test.assert(public.comment_me()->>'avatar_path'=avatar_test.key(2)||'?v=1792368001000000', 'avatar overwrite changes cache version without changing key');
select avatar_test.assert((select avatar_path=public.comment_me()->>'avatar_path' from public.comment_list('/blog/avatar-history')), 'historical comment follows replacement version');
insert into avatar_test.snapshots values('alice-key',public.comment_me()->>'avatar_key');
select public.comment_profile_update('Alice Renamed');
select avatar_test.assert(public.comment_me()->>'avatar_key'=(select value from avatar_test.snapshots where label='alice-key'), 'renaming retains avatar ownership key');

select avatar_test.claims(3);
select avatar_test.assert((select count(*)=0 from storage.objects), 'other user cannot list an existing avatar object');
select avatar_test.affected($q$update storage.objects set metadata='{}' where name=avatar_test.key(2)$q$,0,'other user cannot replace avatar');
select avatar_test.affected($q$delete from storage.objects where name=avatar_test.key(2)$q$,0,'other user cannot remove avatar');
select avatar_test.expect_error($q$insert into storage.objects(bucket_id,name,owner_id) values('comment-avatars',avatar_test.key(2),auth.uid()::text)$q$, 'object owner_id cannot override another profile ownership');
select set_config('request.jwt.claims',(auth.jwt()||'{"is_admin":true,"user_metadata":{"avatar_key":"borrowed","is_admin":true},"app_metadata":{"is_admin":true}}'::jsonb)::text,true);
select avatar_test.assert(not public.comment_avatar_is_owner(avatar_test.key(2)), 'metadata claims cannot obtain someone else avatar key');
select avatar_test.affected($q$insert into storage.objects(bucket_id,name,owner_id) values('comment-avatars',avatar_test.key(3),auth.uid()::text)$q$,1,'second user can create only their own avatar');

set local role anon;
select set_config('request.jwt.claims','{}',true);
select avatar_test.assert((select count(*)=0 from storage.objects), 'anonymous bucket listing reveals no objects');
select avatar_test.expect_error($q$select public.comment_avatar_is_owner(avatar_test.key(2))$q$, 'anonymous cannot execute ownership helper');
select avatar_test.expect_error($q$insert into storage.objects(bucket_id,name) values('comment-avatars',gen_random_uuid()::text||'.jpg')$q$, 'anonymous cannot upload');
select avatar_test.affected($q$update storage.objects set metadata='{}'$q$,0,'anonymous cannot update objects');
select avatar_test.affected($q$delete from storage.objects$q$,0,'anonymous cannot remove objects');
select avatar_test.assert((select avatar_path=avatar_test.key(2)||'?v=1792368001000000' from public.comment_list('/blog/avatar-history')), 'public comment exposes current image path without storage listing');
select avatar_test.assert((select not(to_jsonb(c)?'avatar_key' or to_jsonb(c)?'author_id' or to_jsonb(c)?'email' or to_jsonb(c)?'user_id') from public.comment_list('/blog/avatar-history') c), 'public avatar RPC response omits private identity and separate upload key');

set local role authenticated;
select avatar_test.claims(1);
select avatar_test.assert(public.comment_me()->'avatar_key'='null'::jsonb and public.comment_me()->'avatar_path'='null'::jsonb, 'administrator uses fixed site avatar instead of upload key');
select avatar_test.expect_error($q$insert into storage.objects(bucket_id,name) values('comment-avatars',avatar_test.key(1))$q$, 'administrator cannot upload separate profile avatar');
select avatar_test.affected($q$delete from storage.objects where name=avatar_test.key(2)$q$,0,'administrator does not gain unrelated storage deletion rights');
select avatar_test.claims(4);
select avatar_test.assert(public.comment_me()->'avatar_key'='null'::jsonb, 'unverified account cannot obtain upload key');
select avatar_test.expect_error($q$insert into storage.objects(bucket_id,name) values('comment-avatars',avatar_test.key(4))$q$, 'unverified profile cannot upload');
select avatar_test.claims(6);
select avatar_test.expect_error($q$insert into storage.objects(bucket_id,name) values('comment-avatars',avatar_test.key(6))$q$, 'expired session cannot upload');
select avatar_test.claims(7);
select avatar_test.expect_error($q$insert into storage.objects(bucket_id,name) values('comment-avatars',avatar_test.key(7))$q$, 'missing session cannot upload');
select avatar_test.claims(2,3);
select avatar_test.expect_error($q$insert into storage.objects(bucket_id,name) values('comment-avatars',avatar_test.key(2))$q$, 'another account session cannot upload');

-- Banning suppresses public display, but a valid banned author can remove their
-- already-public file. They cannot upload, replace, or create extra objects.
select avatar_test.claims(1);
select public.comment_ban((select id from avatar_test.comments where label='first'),true);
select avatar_test.claims(2);
select avatar_test.assert((public.comment_me()->>'banned')::boolean and public.comment_me()->>'avatar_key'=(select value from avatar_test.snapshots where label='alice-key') and public.comment_me()->>'avatar_path' is not null, 'banned author retains own key and existing avatar for removal');
select avatar_test.assert((select avatar_path is null from public.comment_list('/blog/avatar-history')), 'site ban suppresses avatar in comment list');
select avatar_test.affected($q$update storage.objects set metadata='{}' where name=avatar_test.key(2)$q$,0,'banned author cannot replace existing avatar');
select avatar_test.expect_error($q$insert into storage.objects(bucket_id,name) values('comment-avatars',avatar_test.key(2)) on conflict(bucket_id,name) do update set metadata='{}'$q$, 'banned author cannot upsert avatar');
select avatar_test.affected($q$delete from storage.objects where name=avatar_test.key(2)$q$,1,'banned author can remove own avatar');
select avatar_test.assert(public.comment_me()->'avatar_path'='null'::jsonb, 'banned author sees default after removal');
select avatar_test.expect_error($q$insert into storage.objects(bucket_id,name) values('comment-avatars',avatar_test.key(2))$q$, 'banned author cannot restore removed avatar');
select avatar_test.claims(1);
select public.comment_ban((select id from avatar_test.comments where label='first'),false);
select avatar_test.claims(2);
select avatar_test.affected($q$insert into storage.objects(bucket_id,name,updated_at) values('comment-avatars',avatar_test.key(2),'2026-10-19 00:00:02+00')$q$,1,'unban restores upload for existing profile key');
reset role;
update auth.users set banned_until=clock_timestamp()+interval '1 day' where id='40000000-0000-0000-0000-000000000002';
set local role authenticated;
select avatar_test.assert((select avatar_path is null from public.comment_list('/blog/avatar-history')), 'native Auth ban also suppresses public avatar');
select avatar_test.affected($q$update storage.objects set metadata='{}' where name=avatar_test.key(2)$q$,0,'native Auth ban blocks avatar replacement');
select avatar_test.affected($q$delete from storage.objects where name=avatar_test.key(2)$q$,1,'native Auth banned author retains avatar removal');
reset role;
update auth.users set banned_until=null where id='40000000-0000-0000-0000-000000000002';
set local role authenticated;
select avatar_test.affected($q$insert into storage.objects(bucket_id,name) values('comment-avatars',avatar_test.key(2))$q$,1,'cleared Auth ban restores upload');
reset role;
delete from auth.sessions where id='50000000-0000-0000-0000-000000000002';
set local role authenticated;
select avatar_test.assert(public.comment_me()->'avatar_key'='null'::jsonb and public.comment_me()->'avatar_path'='null'::jsonb, 'revoked session loses avatar identity');
select avatar_test.affected($q$update storage.objects set metadata='{}' where name=avatar_test.key(2)$q$,0,'revoked session cannot replace avatar');
select avatar_test.affected($q$delete from storage.objects where name=avatar_test.key(2)$q$,0,'revoked session cannot remove avatar');
reset role;
insert into auth.sessions(id,user_id) values('50000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000002');
set local role authenticated;
select avatar_test.affected($q$delete from storage.objects where name=avatar_test.key(2)$q$,1,'active ordinary author can remove their avatar');
select avatar_test.assert((select avatar_path is null from public.comment_list('/blog/avatar-history')) and (select avatar_path is null from public.comment_list('/blog/avatar-other')), 'removing avatar updates all historical threads');
select avatar_test.assert(public.comment_me()->>'avatar_key'=(select value from avatar_test.snapshots where label='alice-key'), 'removal preserves the single fixed slot');
select avatar_test.affected($q$insert into storage.objects(bucket_id,name) values('comment-avatars',avatar_test.key(2))$q$,1,'same slot can be used for a future avatar');
reset role;
delete from auth.users where id='40000000-0000-0000-0000-000000000002';
set local role anon;
select set_config('request.jwt.claims','{}',true);
select avatar_test.assert((select avatar_path is null from public.comment_list('/blog/avatar-history')), 'deleted account avatar no longer appears on orphan comments');
reset role;
select avatar_test.assert((select count(*)=1 from storage.objects where name=avatar_test.key(2)), 'account deletion leaves blob metadata for explicit Storage API cleanup');
select avatar_test.assert(not has_schema_privilege('anon','comment_private','USAGE') and not has_schema_privilege('authenticated','comment_private','USAGE'), 'avatar policies do not expose private schema');
select avatar_test.assert((select bool_and(proconfig @> array['search_path=""']) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'comment_%' and p.prosecdef), 'avatar RPCs retain pinned empty search path');
select count(*)::integer as avatar_assertions_passed from avatar_test.results;
rollback;
