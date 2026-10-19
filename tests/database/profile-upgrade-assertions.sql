-- Local PGlite only: assert an actual 001/002 -> 003 upgrade, including an
-- already-erased body whose request hash cannot be recomputed from storage.
create table comment_upgrade_test.results (label text primary key);
grant insert on comment_upgrade_test.results to authenticated;
create function comment_upgrade_test.assert(ok boolean, label text)
returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'UPGRADE ASSERTION FAILED: %', label; end if;
  insert into comment_upgrade_test.results values (label);
end;
$$;
select comment_upgrade_test.assert((select bool_and(request_hash_version=1) from comment_private.comments), 'existing rows retain legacy request version');
set role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000090","session_id":"20000000-0000-0000-0000-000000000090"}',false);
select comment_upgrade_test.assert(public.comment_me()->>'nickname'='Cyril Fan', 'existing owner profile 1 displays fixed owner name');
select comment_upgrade_test.assert((select nickname='Cyril Fan' and is_admin_author from public.comment_list('/blog/upgrade-owner')), 'pre-upgrade owner comment gets fixed public name');
select comment_upgrade_test.assert((public.comment_create('/blog/upgrade-owner','Original owner body',null,null,'30000000-0000-0000-0000-000000000090')->>'id')::uuid=(select id from comment_upgrade_test.ids where label='owner'), 'pre-upgrade admin retry accepts omitted nickname');
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000091","session_id":"20000000-0000-0000-0000-000000000091"}',false);
select public.comment_profile_update('Visitor After');
select comment_upgrade_test.assert((select nickname='Visitor After' and deleted and body='' from public.comment_list('/blog/upgrade-visitor')), 'pre-upgrade erased comment follows new profile');
select comment_upgrade_test.assert((public.comment_create('/blog/upgrade-visitor','Erased original body','Visitor After',null,'30000000-0000-0000-0000-000000000091')->>'id')::uuid=(select id from comment_upgrade_test.ids where label='visitor'), 'pre-upgrade erased body retry remains idempotent after rename');
select comment_upgrade_test.assert(public.comment_me()->>'nickname'='Visitor After', 'legacy request cannot undo renamed profile');
reset role;
select count(*)::integer as upgrade_assertions_passed from comment_upgrade_test.results;
-- This database is disposable. Remove only these fixtures before the main suite.
delete from comment_private.comments where id in (select id from comment_upgrade_test.ids);
delete from auth.users where id in ('10000000-0000-0000-0000-000000000090','10000000-0000-0000-0000-000000000091');
drop schema comment_upgrade_test cascade;
