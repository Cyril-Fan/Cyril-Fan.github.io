-- One public JPEG avatar per ordinary comment profile. Object names are random
-- profile tokens, never account UUIDs or email hashes. Apply after 004.
begin;

alter table comment_private.profiles
  add column avatar_key uuid not null default gen_random_uuid(),
  add constraint profiles_avatar_key_unique unique (avatar_key);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comment-avatars', 'comment-avatars', true, 131072, array['image/jpeg']);

-- Storage policies cannot read the private schema as a browser role. This
-- deliberately narrow helper reveals only whether the caller owns this key.
-- All identity checks are shared with comment posting, including session_id.
create function public.comment_avatar_is_owner(p_name text, p_allow_banned boolean default false)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_actor record;
begin
  begin
    select * into v_actor from comment_private.require_actor(false, p_allow_banned);
  exception when sqlstate 'P0001' then
    return false;
  end;
  -- A banned administrator's effective privileges are false, but their fixed
  -- site avatar must still not become a visitor-uploadable profile.
  if exists (select 1 from comment_private.admins a where a.user_id = v_actor.user_id) then
    return false;
  end if;
  return exists (
    select 1 from comment_private.profiles p
    where p.user_id = v_actor.user_id and p_name = p.avatar_key::text || '.jpg'
  );
end;
$$;
revoke all on function public.comment_avatar_is_owner(text, boolean) from public, anon, authenticated;
grant execute on function public.comment_avatar_is_owner(text, boolean) to authenticated;

create policy comment_avatars_select_own on storage.objects for select to authenticated
  using (bucket_id = 'comment-avatars' and public.comment_avatar_is_owner(name, true));
create policy comment_avatars_insert_own on storage.objects for insert to authenticated
  with check (bucket_id = 'comment-avatars' and public.comment_avatar_is_owner(name));
create policy comment_avatars_update_own on storage.objects for update to authenticated
  using (bucket_id = 'comment-avatars' and public.comment_avatar_is_owner(name))
  with check (bucket_id = 'comment-avatars' and public.comment_avatar_is_owner(name));
create policy comment_avatars_delete_own on storage.objects for delete to authenticated
  using (bucket_id = 'comment-avatars' and public.comment_avatar_is_owner(name, true));

create or replace function public.comment_me()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor record; v_moderation boolean; v_nickname text;
  v_avatar_key uuid; v_avatar_path text;
begin
  select * into v_actor from comment_private.actor();
  select s.moderation_enabled into v_moderation from comment_private.settings s;
  if v_actor.user_id is not null
    and (v_actor.problem is null or v_actor.problem = 'user_banned') then
    if v_actor.is_admin then
      v_nickname := 'Cyril Fan';
    else
      select p.nickname, p.avatar_key,
        case when o.id is not null then o.name || '?v=' ||
          floor(extract(epoch from coalesce(o.updated_at, o.created_at)) * 1000000)::bigint::text
          else null end
        into v_nickname, v_avatar_key, v_avatar_path
      from comment_private.profiles p
      left join storage.objects o on o.bucket_id = 'comment-avatars'
        and o.name = p.avatar_key::text || '.jpg'
      where p.user_id = v_actor.user_id;
    end if;
  end if;
  return jsonb_build_object(
    'nickname', v_nickname,
    'can_post', v_actor.problem is null,
    'is_admin', v_actor.problem is null and v_actor.is_admin,
    'banned', v_actor.banned,
    'moderation_enabled', v_moderation,
    'avatar_key', v_avatar_key,
    'avatar_path', v_avatar_path
  );
end;
$$;

-- PostgreSQL requires recreation when a table-returning function gains a
-- column. Re-establish the exact grants after the replacement in this transaction.
drop function public.comment_list(text, timestamptz, uuid, integer);
create function public.comment_list(
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
  select c.id, c.parent_id,
    case when ca.user_id is not null then 'Cyril Fan' else coalesce(cp.nickname, c.nickname) end,
    c.body, c.created_at,
    c.deleted_at is not null,
    coalesce(v_uid is not null and (v_admin or (c.author_id = v_uid and c.deleted_at is null)), false),
    ca.user_id is not null,
    case when p.hidden_at is null and (p.status = 'published' or v_admin or p.author_id = v_uid)
      then case when pa.user_id is not null then 'Cyril Fan' else coalesce(pp.nickname, p.nickname) end
      else null end,
    case when p.id is not null and p.hidden_at is null
      and (p.status = 'published' or v_admin or p.author_id = v_uid)
      then p.deleted_at is not null else null end,
    c.status = 'pending',
    case when v_admin then (
      exists (select 1 from comment_private.bans b where b.user_id = c.author_id)
      or exists (select 1 from auth.users u where u.id = c.author_id and u.banned_until > statement_timestamp())
    ) else null end,
    case when ca.user_id is null and av.id is not null
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
    and (c.status = 'published' or v_admin or c.author_id = v_uid)
    and (p_before is null or (c.created_at, c.id) < (p_before, p_before_id))
  order by c.created_at desc, c.id desc limit p_limit;
end;
$$;
revoke all on function public.comment_list(text, timestamptz, uuid, integer) from public, anon, authenticated;
grant execute on function public.comment_list(text, timestamptz, uuid, integer) to anon, authenticated;

notify pgrst, 'reload schema';
commit;
