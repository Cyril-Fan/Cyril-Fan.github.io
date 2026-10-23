-- Verify that adding readers has not rewritten existing records or privileges.
do $$
begin
  if (select jsonb_agg(to_jsonb(c) order by c.id) from comment_private.comments c where thread='/blog/thread-upgrade')
    is distinct from (select value from thread_upgrade_test.snapshots where label='private') then
    raise exception '006 changed pre-existing comment records';
  end if;
  if not exists(select 1 from comment_private.admins where user_id='70000000-0000-0000-0000-000000000001') then
    raise exception '006 changed pre-existing administrator';
  end if;
  if (select jsonb_agg(to_jsonb(c) order by c.id) from public.comment_list('/blog/thread-upgrade',null,null,100) c)
    is distinct from (select value from thread_upgrade_test.snapshots where label='legacy') then
    raise exception '006 changed legacy reader behavior';
  end if;
  if (select array_agg(right(r->>'id',12)::integer order by ord) from
    jsonb_array_elements(public.comment_thread_list('/blog/thread-upgrade')) with ordinality a(r,ord))
    is distinct from array[4,5,1,2,3] then
    raise exception '006 failed to group pre-existing roots/replies or leaked pending/hidden rows';
  end if;
  if exists(select 1 from jsonb_array_elements(public.comment_thread_list('/blog/thread-upgrade')) r
    where r ?| array['email','author_email','author_id','user_id']) then
    raise exception '006 leaked private author information';
  end if;
end;
$$;
delete from comment_private.comments where thread='/blog/thread-upgrade';
delete from auth.users where id in ('70000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000002');
drop schema thread_upgrade_test cascade;
select 5 as thread_upgrade_assertions_passed;
