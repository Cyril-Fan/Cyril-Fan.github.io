-- A profile rename is reflected in every comment and reply label. Comment rows
-- retain their original snapshot only for orphaned accounts and legacy retries.
begin;

alter table comment_private.comments add column request_hash_version smallint not null default 1
  check (request_hash_version in (1, 2));

create or replace function public.comment_me()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_actor record; v_moderation boolean; v_nickname text;
begin
  select * into v_actor from comment_private.actor();
  select s.moderation_enabled into v_moderation from comment_private.settings s;
  if v_actor.user_id is not null then
    if v_actor.is_admin then
      v_nickname := 'Cyril Fan';
    else
      select p.nickname into v_nickname from comment_private.profiles p
        where p.user_id = v_actor.user_id;
    end if;
  end if;
  return jsonb_build_object(
    'nickname', v_nickname,
    'can_post', v_actor.problem is null,
    'is_admin', v_actor.problem is null and v_actor.is_admin,
    'banned', v_actor.banned,
    'moderation_enabled', v_moderation
  );
end;
$$;

create function public.comment_profile_update(p_nickname text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor record; v_nickname text;
begin
  select * into v_actor from comment_private.require_actor();
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('comment:user:' || v_actor.user_id::text, 0));
  -- Use the same account lock as posting/banning and re-check a revoked session
  -- or ban after waiting. The caller cannot choose which profile to update.
  select * into v_actor from comment_private.require_actor();
  v_nickname := case when v_actor.is_admin then 'Cyril Fan' else btrim(p_nickname) end;
  if v_nickname is null or char_length(v_nickname) not between 1 and 40
    or v_nickname !~ '[^[:space:]]' or v_nickname ~ '[[:cntrl:]]' then
    raise exception using errcode = 'P0001', message = 'invalid_nickname';
  end if;
  insert into comment_private.profiles (user_id, nickname) values (v_actor.user_id, v_nickname)
    on conflict (user_id) do update set nickname = excluded.nickname;
  return public.comment_me();
end;
$$;

create or replace function public.comment_list(
  p_thread text, p_before timestamptz default null,
  p_before_id uuid default null, p_limit integer default 30
)
returns table (
  id uuid, parent_id uuid, nickname text, body text, created_at timestamptz,
  deleted boolean, can_delete boolean, is_admin_author boolean,
  parent_nickname text, parent_deleted boolean, is_pending boolean, author_banned boolean
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
    ) else null end
  from comment_private.comments c
  left join comment_private.profiles cp on cp.user_id = c.author_id
  left join comment_private.admins ca on ca.user_id = c.author_id
  left join comment_private.comments p on p.id = c.parent_id and p.thread = c.thread
  left join comment_private.profiles pp on pp.user_id = p.author_id
  left join comment_private.admins pa on pa.user_id = p.author_id
  where c.thread = p_thread and c.hidden_at is null
    and (c.status = 'published' or v_admin or c.author_id = v_uid)
    and (p_before is null or (c.created_at, c.id) < (p_before, p_before_id))
  order by c.created_at desc, c.id desc limit p_limit;
end;
$$;

create or replace function public.comment_create(
  p_thread text, p_body text, p_nickname text,
  p_parent_id uuid default null, p_request_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor record; v_previous record; v_parent record;
  v_body text; v_nickname text; v_hash text; v_body_hash text; v_expected_hash text;
  v_now timestamptz; v_latest timestamptz; v_count bigint; v_links bigint;
  v_moderation boolean; v_pending boolean; v_id uuid; v_depth smallint := 0;
begin
  select * into v_actor from comment_private.require_actor();
  if not comment_private.valid_thread(p_thread) then
    raise exception using errcode = 'P0001', message = 'invalid_thread';
  end if;
  if p_request_id is null then
    raise exception using errcode = 'P0001', message = 'invalid_request_id';
  end if;
  v_body := btrim(replace(replace(p_body, E'\r\n', E'\n'), E'\r', E'\n'));
  if v_body is null or char_length(v_body) not between 1 and 2000 or v_body !~ '[^[:space:]]'
    or regexp_replace(v_body, E'[\t\n]', '', 'g') ~ '[[:cntrl:]]' then
    raise exception using errcode = 'P0001', message = 'invalid_body';
  end if;
  select count(*) into v_links
    from pg_catalog.regexp_matches(v_body, '(https?://|www[.])[^[:space:]]+', 'gi');
  if v_links > 5 then raise exception using errcode = 'P0001', message = 'too_many_links'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('comment:user:' || v_actor.user_id::text, 0));
  select * into v_actor from comment_private.require_actor();
  if exists (select 1 from comment_private.bans b where b.user_id = v_actor.user_id) then
    raise exception using errcode = 'P0001', message = 'user_banned';
  end if;
  -- Nickname is mutable profile metadata, not part of comment identity. A
  -- delayed retry must never reset a later profile rename or duplicate a post.
  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'thread', p_thread, 'body', v_body, 'parent_id', p_parent_id
  )::text, 'UTF8')), 'hex');
  select c.id, c.request_hash, c.request_hash_version, c.nickname, c.status into v_previous
    from comment_private.comments c where c.author_id = v_actor.user_id and c.request_id = p_request_id;
  if found then
    v_expected_hash := case when v_previous.request_hash_version = 1 then
      encode(sha256(convert_to(jsonb_build_object(
        'thread', p_thread, 'body', v_body, 'nickname', v_previous.nickname, 'parent_id', p_parent_id
      )::text, 'UTF8')), 'hex') else v_hash end;
    if v_previous.request_hash <> v_expected_hash then
      raise exception using errcode = 'P0001', message = 'idempotency_conflict';
    end if;
    return jsonb_build_object('id', v_previous.id, 'is_pending', v_previous.status = 'pending');
  end if;

  v_nickname := case when v_actor.is_admin then 'Cyril Fan' else btrim(p_nickname) end;
  if v_nickname is null or char_length(v_nickname) not between 1 and 40
    or v_nickname !~ '[^[:space:]]' or v_nickname ~ '[[:cntrl:]]' then
    raise exception using errcode = 'P0001', message = 'invalid_nickname';
  end if;
  -- Existing profiles win over stale forms. Renaming is an explicit operation;
  -- old clients can still choose their first nickname when making a first post.
  if not v_actor.is_admin then
    select coalesce((select p.nickname from comment_private.profiles p
      where p.user_id = v_actor.user_id), v_nickname) into v_nickname;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('comment:thread:' || p_thread, 0));
  v_now := clock_timestamp();
  v_body_hash := encode(sha256(convert_to(v_body, 'UTF8')), 'hex');
  if exists (select 1 from comment_private.comments c
    where c.author_id = v_actor.user_id and c.thread = p_thread
      and c.body_hash = v_body_hash and c.created_at > v_now - interval '10 minutes') then
    raise exception using errcode = 'P0001', message = 'duplicate_comment';
  end if;
  select max(c.created_at), count(*) into v_latest, v_count from comment_private.comments c
    where c.author_id = v_actor.user_id and c.created_at > v_now - interval '10 minutes';
  if v_count >= 5 or v_latest > v_now - interval '30 seconds' then
    raise exception using errcode = 'P0001', message = 'rate_limited';
  end if;

  select s.moderation_enabled into v_moderation from comment_private.settings s for share;
  v_pending := v_moderation and not v_actor.is_admin;
  if p_parent_id is not null then
    select c.* into v_parent from comment_private.comments c
      where c.id = p_parent_id and c.thread = p_thread and c.hidden_at is null;
    if not found or v_parent.deleted_at is not null
      or (v_parent.status = 'pending' and not v_actor.is_admin and v_parent.author_id is distinct from v_actor.user_id) then
      raise exception using errcode = 'P0001', message = 'invalid_parent';
    end if;
    if v_parent.depth >= 8 then
      raise exception using errcode = 'P0001', message = 'thread_depth_exceeded';
    end if;
    v_depth := v_parent.depth + 1;
    v_pending := v_pending or v_parent.status = 'pending';
  end if;

  insert into comment_private.comments (
    thread, parent_id, author_id, nickname, body, body_hash, created_at,
    status, depth, request_id, request_hash, request_hash_version
  ) values (
    p_thread, p_parent_id, v_actor.user_id, v_nickname, v_body, v_body_hash, v_now,
    case when v_pending then 'pending' else 'published' end, v_depth, p_request_id, v_hash, 2
  ) returning id into v_id;
  insert into comment_private.profiles (user_id, nickname) values (v_actor.user_id, v_nickname)
    on conflict (user_id) do nothing;
  return jsonb_build_object('id', v_id, 'is_pending', v_pending);
end;
$$;

-- Preserve the explicit grants on replaced RPCs; a new function otherwise gets
-- PostgreSQL's default PUBLIC execute privilege unless it is revoked here.
revoke all on function public.comment_profile_update(text) from public, anon, authenticated;
grant execute on function public.comment_profile_update(text) to authenticated;

notify pgrst, 'reload schema';
commit;
