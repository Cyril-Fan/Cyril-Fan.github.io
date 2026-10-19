-- Local PGlite only: create real 001/002 data before applying migration 003.
create schema comment_upgrade_test;
create table comment_upgrade_test.ids (label text primary key, id uuid, request_id uuid);
grant usage on schema comment_upgrade_test to authenticated;
grant select, insert on comment_upgrade_test.ids to authenticated;
insert into auth.users (id,email,email_confirmed_at) values
  ('10000000-0000-0000-0000-000000000090','upgrade-owner@example.invalid',now()),
  ('10000000-0000-0000-0000-000000000091','upgrade-visitor@example.invalid',now());
insert into auth.sessions (id,user_id) values
  ('20000000-0000-0000-0000-000000000090','10000000-0000-0000-0000-000000000090'),
  ('20000000-0000-0000-0000-000000000091','10000000-0000-0000-0000-000000000091');
insert into comment_private.admins values ('10000000-0000-0000-0000-000000000090');
set role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000090","session_id":"20000000-0000-0000-0000-000000000090"}',false);
insert into comment_upgrade_test.ids select 'owner',
  (public.comment_create('/blog/upgrade-owner','Original owner body','1',null,'30000000-0000-0000-0000-000000000090')->>'id')::uuid,
  '30000000-0000-0000-0000-000000000090'::uuid;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000091","session_id":"20000000-0000-0000-0000-000000000091"}',false);
insert into comment_upgrade_test.ids select 'visitor',
  (public.comment_create('/blog/upgrade-visitor','Erased original body','Visitor Before',null,'30000000-0000-0000-0000-000000000091')->>'id')::uuid,
  '30000000-0000-0000-0000-000000000091'::uuid;
select public.comment_delete((select id from comment_upgrade_test.ids where label='visitor'));
reset role;
