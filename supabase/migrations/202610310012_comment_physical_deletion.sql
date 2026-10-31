-- Replace retention-based deletion. No new ledger, rate-limit or retry records.
-- This migration installs behavior only; it does not sweep historical user data.
begin;
alter table comment_private.comments alter column request_id drop not null;

create or replace function public.comment_delete(p_id uuid, p_branch boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor record; v_target record; v_parent uuid; v_next uuid;
begin
  select * into v_actor from comment_private.require_actor(false, true);
  if p_branch is null then raise exception using errcode = 'P0001', message = 'forbidden'; end if;
  if p_branch and not v_actor.is_admin then
    raise exception using errcode = 'P0001', message = 'admin_required';
  end if;
  select c.* into v_target from comment_private.comments c where c.id = p_id;
  -- Repeated deletion is a no-op; no retained record is needed for it.
  if not found then return; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('comment:thread:' || v_target.thread, 0));
  -- A concurrent create/delete uses the same thread lock. Re-read after waiting.
  select c.* into v_target from comment_private.comments c where c.id = p_id;
  if not found then return; end if;
  if not v_actor.is_admin and v_target.author_id is distinct from v_actor.user_id then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  v_parent := v_target.parent_id;
  if p_branch then
    with recursive branch as (
      select c.id from comment_private.comments c where c.id = p_id and c.thread = v_target.thread
      union
      select c.id from comment_private.comments c join branch b on c.parent_id = b.id
        where c.thread = v_target.thread
    )
    delete from comment_private.comments c where c.id in (select b.id from branch b);
  elsif exists (select 1 from comment_private.comments c where c.parent_id = p_id) then
    update comment_private.comments set body = '', author_id = null, nickname = 'Deleted comment',
      body_hash = '', request_id = null, request_hash = '', deleted_at = coalesce(deleted_at, clock_timestamp())
      where id = p_id;
  else
    delete from comment_private.comments where id = p_id;
  end if;
  -- Remove only already-erased ancestors that no longer connect any replies.
  -- Pending replies count too, so another person's non-public content is preserved.
  while v_parent is not null loop
    select c.parent_id into v_next from comment_private.comments c
      where c.id = v_parent and c.deleted_at is not null
        and not exists (select 1 from comment_private.comments d where d.parent_id = c.id);
    exit when not found;
    delete from comment_private.comments where id = v_parent;
    v_parent := v_next;
  end loop;
end;
$$;

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
        'nickname', case when c.deleted_at is not null then 'Deleted comment' when ca.user_id is not null then 'Cyril Fan' else coalesce(cp.nickname, c.nickname) end,
        'body', case when c.deleted_at is not null then '' else c.body end, 'created_at', c.created_at,
        'deleted', c.deleted_at is not null,
        'can_delete', coalesce(v_uid is not null and (v_admin or (c.author_id = v_uid and c.deleted_at is null)), false),
        'is_admin_author', c.deleted_at is null and ca.user_id is not null,
        'parent_nickname', case when p.hidden_at is null and (p.status = 'published' or v_admin or p.author_id = v_uid)
          then case when p.deleted_at is not null then null when pa.user_id is not null then 'Cyril Fan' else coalesce(pp.nickname, p.nickname) end else null end,
        'parent_deleted', case when p.id is not null and p.hidden_at is null
          and (p.status = 'published' or v_admin or p.author_id = v_uid) then p.deleted_at is not null else null end,
        'is_pending', c.status = 'pending',
        'author_banned', case when v_admin and c.deleted_at is null then (
          exists (select 1 from comment_private.bans b where b.user_id = c.author_id)
          or exists (select 1 from auth.users u where u.id = c.author_id and u.banned_until > statement_timestamp())
        ) else null end,
        'avatar_path', case when c.deleted_at is null and ca.user_id is null and av.id is not null
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

create or replace function public.comment_list(
  p_thread text, p_before timestamptz default null,
  p_before_id uuid default null, p_limit integer default 30
)
returns table (
  id uuid, parent_id uuid, nickname text, body text, created_at timestamptz,
  deleted boolean, can_delete boolean, is_admin_author boolean,
  parent_nickname text, parent_deleted boolean, is_pending boolean, author_banned boolean,
  avatar_path text
)
language plpgsql stable security definer set search_path = '' as $$
declare v_actor record; v_uid uuid; v_admin boolean;
begin
  if not comment_private.valid_thread(p_thread) then
    raise exception using errcode = 'P0001', message = 'invalid_thread';
  end if;
  if (p_before is null) <> (p_before_id is null) then
    raise exception using errcode = 'P0001', message = 'invalid_cursor';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception using errcode = 'P0001', message = 'invalid_limit';
  end if;
  select * into v_actor from comment_private.actor();
  v_uid := case when v_actor.problem is null or v_actor.problem = 'user_banned' then v_actor.user_id else null end;
  v_admin := v_actor.problem is null and v_actor.is_admin;
  return query
  with recursive survivors as (
    select c.id, c.parent_id from comment_private.comments c
    where c.thread=p_thread and c.deleted_at is null and c.hidden_at is null
      and (c.status='published' or v_admin or c.author_id=v_uid)
    union
    select p.id,p.parent_id from comment_private.comments p join survivors s on s.parent_id=p.id
    where p.thread=p_thread and p.hidden_at is null
      and (p.status='published' or v_admin or p.author_id=v_uid)
  )
  select c.id, c.parent_id,
    case when c.deleted_at is not null then 'Deleted comment' when ca.user_id is not null then 'Cyril Fan' else coalesce(cp.nickname, c.nickname) end,
    case when c.deleted_at is not null then '' else c.body end, c.created_at,
    c.deleted_at is not null,
    coalesce(v_uid is not null and (v_admin or (c.author_id = v_uid and c.deleted_at is null)), false),
    c.deleted_at is null and ca.user_id is not null,
    case when p.hidden_at is null and (p.status = 'published' or v_admin or p.author_id = v_uid)
      then case when p.deleted_at is not null then null when pa.user_id is not null then 'Cyril Fan' else coalesce(pp.nickname, p.nickname) end
      else null end,
    case when p.id is not null and p.hidden_at is null
      and (p.status = 'published' or v_admin or p.author_id = v_uid)
      then p.deleted_at is not null else null end,
    c.status = 'pending',
    case when v_admin and c.deleted_at is null then (
      exists (select 1 from comment_private.bans b where b.user_id = c.author_id)
      or exists (select 1 from auth.users u where u.id = c.author_id and u.banned_until > statement_timestamp())
    ) else null end,
    case when c.deleted_at is null and ca.user_id is null and av.id is not null
      and not exists (select 1 from comment_private.bans b where b.user_id = c.author_id)
      and not exists (select 1 from auth.users u where u.id = c.author_id and u.banned_until > statement_timestamp())
      then av.name || '?v=' ||
      floor(extract(epoch from coalesce(av.updated_at, av.created_at)) * 1000000)::bigint::text
      else null end
  from comment_private.comments c
  left join comment_private.profiles cp on cp.user_id = c.author_id
  left join comment_private.admins ca on ca.user_id = c.author_id
  left join storage.objects av on av.bucket_id = 'comment-avatars'
    and av.name = cp.avatar_key::text || '.jpg' and ca.user_id is null
  left join comment_private.comments p on p.id = c.parent_id and p.thread = c.thread
  left join comment_private.profiles pp on pp.user_id = p.author_id
  left join comment_private.admins pa on pa.user_id = p.author_id
  where c.thread = p_thread and c.hidden_at is null
    and c.id in (select s.id from survivors s)
    and (c.status = 'published' or v_admin or c.author_id = v_uid)
    and (p_before is null or (c.created_at, c.id) < (p_before, p_before_id))
  order by c.created_at desc, c.id desc limit p_limit;
end;
$$;
revoke all on function public.comment_list(text, timestamptz, uuid, integer) from public, anon, authenticated;
grant execute on function public.comment_list(text, timestamptz, uuid, integer) to anon, authenticated;


create or replace function public.comment_author_email(p_thread text, p_comment_id uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare v_email text;
begin
  -- Check authority before looking up a target, including guessed comment IDs.
  perform comment_private.require_actor(true);
  if not comment_private.valid_thread(p_thread) then
    raise exception using errcode = 'P0001', message = 'invalid_thread';
  end if;
  select case when u.deleted_at is null then u.email else null end into v_email
  from comment_private.comments c left join auth.users u on u.id = c.author_id
  where c.id = p_comment_id and c.thread = p_thread and c.hidden_at is null and c.deleted_at is null;
  if not found then
    raise exception using errcode = 'P0001', message = 'comment_not_found';
  end if;
  return v_email;
end;
$$;

revoke all on function public.comment_delete(uuid, boolean) from public, anon, authenticated;
grant execute on function public.comment_delete(uuid, boolean) to authenticated;
revoke all on function public.comment_author_email(text, uuid) from public, anon, authenticated;
grant execute on function public.comment_author_email(text, uuid) to authenticated;
notify pgrst, 'reload schema';
commit;
