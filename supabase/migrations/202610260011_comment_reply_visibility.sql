-- Do not physically delete comments: retain erased records for retry protection.
-- The existing comment_delete/comment_create transaction lock keeps writes safe.
-- This reader-only upgrade makes leaf tombstones invisible, retains parents of
-- visible replies, and reports reply availability independently of pagination.
begin;
create or replace function public.comment_thread_list(
  p_thread text, p_after_id uuid default null, p_limit integer default 30,
  p_focus_id uuid default null
)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor record; v_uid uuid; v_admin boolean; v_rows jsonb; v_cursor_valid boolean; v_focus_valid boolean;
begin
  if not comment_private.valid_thread(p_thread) then
    raise exception using errcode = 'P0001', message = 'invalid_thread';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using errcode = 'P0001', message = 'invalid_limit';
  end if;
  if p_focus_id is not null and p_limit < 2 then
    raise exception using errcode = 'P0001', message = 'invalid_limit';
  end if;
  select * into v_actor from comment_private.actor();
  v_uid := case when v_actor.problem is null or v_actor.problem = 'user_banned' then v_actor.user_id else null end;
  v_admin := v_actor.problem is null and v_actor.is_admin;

  with recursive tree as (
    select c.id, c.id as actual_root, array[c.id] as ancestors, 0 as level
    from comment_private.comments c where c.thread = p_thread and c.parent_id is null
    union all
    select c.id, t.actual_root, t.ancestors || c.id, t.level + 1
    from comment_private.comments c join tree t on c.parent_id = t.id
    where c.thread = p_thread and t.level < 8
  ), visible_base as materialized (
    select c.id, c.parent_id, c.created_at, c.deleted_at, t.actual_root, t.ancestors,
      jsonb_build_object(
        'id', c.id, 'parent_id', case when p.hidden_at is null
          and (p.status = 'published' or v_admin or p.author_id = v_uid) then c.parent_id else null end,
        'nickname', case when ca.user_id is not null then 'Cyril Fan' else coalesce(cp.nickname, c.nickname) end,
        'body', c.body, 'created_at', c.created_at,
        'deleted', c.deleted_at is not null,
        'can_delete', coalesce(v_uid is not null and (v_admin or (c.author_id = v_uid and c.deleted_at is null)), false),
        'is_admin_author', ca.user_id is not null,
        'parent_nickname', case when p.hidden_at is null and (p.status = 'published' or v_admin or p.author_id = v_uid)
          then case when pa.user_id is not null then 'Cyril Fan' else coalesce(pp.nickname, p.nickname) end else null end,
        'parent_deleted', case when p.id is not null and p.hidden_at is null
          and (p.status = 'published' or v_admin or p.author_id = v_uid) then p.deleted_at is not null else null end,
        'is_pending', c.status = 'pending',
        'author_banned', case when v_admin then (
          exists (select 1 from comment_private.bans b where b.user_id = c.author_id)
          or exists (select 1 from auth.users u where u.id = c.author_id and u.banned_until > statement_timestamp())
        ) else null end,
        'avatar_path', case when ca.user_id is null and av.id is not null
          and not exists (select 1 from comment_private.bans b where b.user_id = c.author_id)
          and not exists (select 1 from auth.users u where u.id = c.author_id and u.banned_until > statement_timestamp())
          then av.name || '?v=' || floor(extract(epoch from coalesce(av.updated_at, av.created_at)) * 1000000)::bigint::text else null end
      ) as payload
    from comment_private.comments c join tree t on t.id = c.id
    left join comment_private.profiles cp on cp.user_id = c.author_id
    left join comment_private.admins ca on ca.user_id = c.author_id
    left join storage.objects av on av.bucket_id = 'comment-avatars' and av.name = cp.avatar_key::text || '.jpg' and ca.user_id is null
    left join comment_private.comments p on p.id = c.parent_id and p.thread = c.thread
    left join comment_private.profiles pp on pp.user_id = p.author_id
    left join comment_private.admins pa on pa.user_id = p.author_id
    where c.thread = p_thread and c.hidden_at is null
      and (c.status = 'published' or v_admin or c.author_id = v_uid)
  ), visible as materialized (
    -- Keep an erased node only while it connects a visible surviving reply.
    -- This is computed across the whole conversation, before pagination; private
    -- pending replies must not leak their existence to other readers.
    select c.id, c.parent_id, c.created_at, c.actual_root,
      c.payload || jsonb_build_object('has_replies', exists (
        select 1 from visible_base d where d.id <> c.id
          and d.deleted_at is null and c.id = any(d.ancestors)
      )) as payload
    from visible_base c
    where c.deleted_at is null or exists (
      select 1 from visible_base d where d.id <> c.id
        and d.deleted_at is null and c.id = any(d.ancestors)
    )
  ), anchors as (
    -- A former administrator may own a pending reply beneath an invisible root.
    -- Use only visible data for its group identity, ordering, and cursor. Never
    -- return that root's ID, timestamp, name, body, or hidden descendant count.
    select distinct on (v.actual_root) v.actual_root, v.id as root_id,
      v.created_at as root_created_at, v.parent_id is not null as root_unavailable
    from visible v
    order by v.actual_root, (v.parent_id is not null), v.created_at, v.id
  ), ordered as materialized (
    select v.id, v.created_at, a.root_id, a.root_created_at,
      case when v.id = a.root_id then 0 else 1 end as member_order,
      v.payload || jsonb_build_object('root_id', a.root_id,
        'root_created_at', a.root_created_at, 'root_unavailable', a.root_unavailable) as payload
    from visible v join anchors a on a.actual_root = v.actual_root
  ), cursor_row as (
    select o.* from ordered o where o.id = p_after_id
  ), focus_row as (
    select o.* from ordered o where o.id = p_focus_id
  ), normal_page as (
    select o.* from ordered o
    where p_focus_id is null and (p_after_id is null or exists (
      select 1 from cursor_row k where
        (o.root_created_at, o.root_id) < (k.root_created_at, k.root_id)
        or ((o.root_created_at, o.root_id) = (k.root_created_at, k.root_id)
          and (o.member_order, o.created_at, o.id) > (k.member_order, k.created_at, k.id))
    ))
    order by o.root_created_at desc, o.root_id desc, o.member_order, o.created_at, o.id
    limit p_limit
  ), page as (
    select n.* from normal_page n
    union all
    -- One bounded post-confirmation lookup: just the visible original/anchor
    -- and the requested visible comment. It never advances the normal cursor.
    select o.id, o.created_at, o.root_id, o.root_created_at, o.member_order,
      o.payload || jsonb_build_object('gap_before', o.id <> o.root_id and exists (
        select 1 from ordered middle where middle.root_id = o.root_id and middle.id <> o.root_id
          and (middle.member_order, middle.created_at, middle.id) < (o.member_order, o.created_at, o.id)
          and not exists (select 1 from cursor_row k where k.root_id = middle.root_id
            and (middle.member_order, middle.created_at, middle.id) <= (k.member_order, k.created_at, k.id))
      ))
    from ordered o join focus_row f on o.id = f.root_id or o.id = f.id
  )
  select coalesce(jsonb_agg(p.payload order by p.root_created_at desc, p.root_id desc, p.member_order, p.created_at, p.id), '[]'::jsonb),
    p_after_id is null or exists (select 1 from cursor_row),
    p_focus_id is null or exists (select 1 from focus_row)
  into v_rows, v_cursor_valid, v_focus_valid from page p;
  if not v_cursor_valid then
    raise exception using errcode = 'P0001', message = 'invalid_cursor';
  end if;
  if not v_focus_valid then
    raise exception using errcode = 'P0001', message = 'comment_not_found';
  end if;
  return v_rows;
end;
$$;

revoke all on function public.comment_thread_list(text, uuid, integer, uuid) from public, anon, authenticated;
grant execute on function public.comment_thread_list(text, uuid, integer, uuid) to anon, authenticated;
notify pgrst, 'reload schema';
commit;

