-- Optional one-time cleanup, separate from schema deployment.
-- Requires the owner's explicit approval. The observed scope is 19 already-erased
-- records with no surviving descendants. Never run a test fixture on production.
begin;
do $$
declare v_thread text; v_removed integer;
begin
  for v_thread in select distinct thread from comment_private.comments where deleted_at is not null order by thread loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('comment:thread:' || v_thread, 0));
  end loop;
  with recursive keep as (
    select id,parent_id from comment_private.comments where deleted_at is null
    union
    select p.id,p.parent_id from comment_private.comments p join keep k on k.parent_id=p.id
  ), removed as (
    delete from comment_private.comments c where c.deleted_at is not null
      and not exists(select 1 from keep k where k.id=c.id) returning c.id
  ) select count(*) into v_removed from removed;
  if v_removed <> 19 then raise exception 'Scope changed: expected 19 erased records, found %. Rolled back.', v_removed; end if;
end;
$$;
commit;
