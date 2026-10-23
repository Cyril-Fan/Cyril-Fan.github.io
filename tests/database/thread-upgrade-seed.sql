-- Local-only 005 records, created before migration 006 is applied.
create schema thread_upgrade_test;
create table thread_upgrade_test.snapshots(label text primary key, value jsonb);
insert into auth.users(id,email,email_confirmed_at) values
  ('70000000-0000-0000-0000-000000000001','upgrade-owner@example.invalid',now()),
  ('70000000-0000-0000-0000-000000000002','upgrade-reader@example.invalid',now());
insert into comment_private.admins values('70000000-0000-0000-0000-000000000001');
insert into comment_private.comments(id,thread,parent_id,author_id,nickname,body,body_hash,created_at,
  deleted_at,hidden_at,status,depth,request_id,request_hash,request_hash_version)
select ('71000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'/blog/thread-upgrade',
  case when n in (2,3,5,7,9) then ('71000000-0000-0000-0000-'||lpad((n-1)::text,12,'0'))::uuid else null end,
  case when n%2=1 then '70000000-0000-0000-0000-000000000001'::uuid else '70000000-0000-0000-0000-000000000002'::uuid end,
  'Original name '||n,case when n in (4,8,9) then '' else 'Original body '||n end,
  'old hash '||n,'2026-10-01 00:00Z'::timestamptz+n*interval '1 minute',
  case when n in (4,8,9) then now() else null end,case when n in (8,9) then now() else null end,
  case when n in (6,7) then 'pending' else 'published' end,
  case when n=3 then 2 when n in (2,5,7,9) then 1 else 0 end,gen_random_uuid(),'old request '||n,2
from generate_series(1,9) n;
insert into thread_upgrade_test.snapshots values('private',(
  select jsonb_agg(to_jsonb(c) order by c.id) from comment_private.comments c where thread='/blog/thread-upgrade'));
select set_config('request.jwt.claims','{}',false);
insert into thread_upgrade_test.snapshots values('legacy',(
  select jsonb_agg(to_jsonb(c) order by c.id) from public.comment_list('/blog/thread-upgrade',null,null,100) c));
