-- Verified-email comments. Apply as the Supabase postgres migration owner.
-- No browser role has access to storage tables or authorization helpers.
begin;

create schema if not exists comment_private;
revoke all on schema comment_private from public, anon, authenticated;
alter default privileges in schema comment_private revoke execute on functions from public;
alter default privileges in schema comment_private revoke all on tables from public;

create table comment_private.admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);
create table comment_private.bans (
  user_id uuid primary key references auth.users(id) on delete cascade,
  banned_at timestamptz not null default clock_timestamp(),
  banned_by uuid references auth.users(id) on delete set null
);
create table comment_private.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null check (char_length(nickname) between 1 and 40)
);
create table comment_private.settings (
  singleton boolean primary key default true check (singleton),
  moderation_enabled boolean not null default false
);
insert into comment_private.settings (singleton) values (true);

create table comment_private.comments (
  id uuid primary key default gen_random_uuid(),
  thread text not null check (char_length(thread) between 1 and 300),
  parent_id uuid,
  author_id uuid references auth.users(id) on delete set null,
  nickname text not null check (char_length(nickname) between 1 and 40),
  body text not null,
  body_hash text not null,
  created_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  hidden_at timestamptz,
  status text not null check (status in ('published', 'pending')),
  depth smallint not null check (depth between 0 and 8),
  request_id uuid not null,
  request_hash text not null,
  unique (id, thread),
  unique (author_id, request_id),
  foreign key (parent_id, thread) references comment_private.comments(id, thread),
  check (
    (deleted_at is null and char_length(body) between 1 and 2000)
    or (deleted_at is not null and body = '')
  ),
  check (hidden_at is null or deleted_at is not null)
);
create index comments_page on comment_private.comments (thread, created_at desc, id desc)
  where hidden_at is null;
create index comments_parent on comment_private.comments (parent_id, thread);
create index comments_author_time on comment_private.comments (author_id, created_at desc);

alter table comment_private.admins enable row level security;
alter table comment_private.bans enable row level security;
alter table comment_private.profiles enable row level security;
alter table comment_private.settings enable row level security;
alter table comment_private.comments enable row level security;
revoke all on all tables in schema comment_private from public, anon, authenticated;

-- Exactly one row is returned, including for anonymous/stale sessions. Writes
-- call require_actor; banned actors retain only ownership-based deletion.
create function comment_private.actor()
returns table (user_id uuid, is_admin boolean, banned boolean, problem text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_session text := auth.jwt() ->> 'session_id';
  v_user record;
begin
  user_id := null; is_admin := false; banned := false;
  problem := 'authentication_required';
  if v_uid is null then return next; return; end if;

  select u.email_confirmed_at, u.banned_until, u.deleted_at into v_user
    from auth.users u where u.id = v_uid;
  if not found or v_user.deleted_at is not null then return next; return; end if;
  if v_user.email_confirmed_at is null then
    problem := 'email_verification_required'; return next; return;
  end if;
  if v_session is null or v_session !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    problem := 'session_expired'; return next; return;
  end if;
  if not exists (
    select 1 from auth.sessions s
      where s.id = v_session::uuid and s.user_id = v_uid
        and (s.not_after is null or s.not_after > statement_timestamp())
  ) then problem := 'session_expired'; return next; return; end if;

  user_id := v_uid;
  banned := (v_user.banned_until is not null and v_user.banned_until > statement_timestamp())
    or exists (select 1 from comment_private.bans b where b.user_id = v_uid);
  is_admin := exists (select 1 from comment_private.admins a where a.user_id = v_uid);
  problem := case when banned then 'user_banned' else null end;
  return next;
end;
$$;

create function comment_private.require_actor(p_admin boolean default false, p_allow_banned boolean default false)
returns table (user_id uuid, is_admin boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_actor record;
begin
  select * into v_actor from comment_private.actor();
  if v_actor.problem is not null and not (p_allow_banned and v_actor.problem = 'user_banned') then
    raise exception using errcode = 'P0001', message = v_actor.problem;
  end if;
  if p_admin and (not v_actor.is_admin or v_actor.banned) then
    raise exception using errcode = 'P0001', message = 'admin_required';
  end if;
  return query select v_actor.user_id::uuid, (v_actor.is_admin and not v_actor.banned)::boolean;
end;
$$;

create function comment_private.valid_thread(p_thread text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(
    char_length(p_thread) <= 300
    and p_thread !~ '[[:space:][:cntrl:]?#]'
    and position(chr(92) in p_thread) = 0 and position('//' in p_thread) = 0
    and p_thread !~ '/[.]{1,2}(/|$)' and (
      p_thread = '/about' or (
        left(p_thread, 6) = '/blog/' and char_length(p_thread) > 6
        and right(p_thread, 1) <> '/'
      )
    ), false
  );
$$;

create function public.comment_me()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_actor record; v_moderation boolean; v_nickname text;
begin
  select * into v_actor from comment_private.actor();
  select s.moderation_enabled into v_moderation from comment_private.settings s;
  if v_actor.user_id is not null then
    select p.nickname into v_nickname from comment_private.profiles p
      where p.user_id = v_actor.user_id;
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

create function public.comment_list(
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
  select c.id, c.parent_id, c.nickname, c.body, c.created_at,
    c.deleted_at is not null,
    coalesce(v_uid is not null and (v_admin or (c.author_id = v_uid and c.deleted_at is null)), false),
    exists (select 1 from comment_private.admins a where a.user_id = c.author_id),
    case when p.hidden_at is null and (p.status = 'published' or v_admin or p.author_id = v_uid)
      then p.nickname else null end,
    case when p.id is not null and p.hidden_at is null
      and (p.status = 'published' or v_admin or p.author_id = v_uid)
      then p.deleted_at is not null else null end,
    c.status = 'pending',
    case when v_admin then (
      exists (select 1 from comment_private.bans b where b.user_id = c.author_id)
      or exists (select 1 from auth.users u where u.id = c.author_id and u.banned_until > statement_timestamp())
    ) else null end
  from comment_private.comments c
  left join comment_private.comments p on p.id = c.parent_id and p.thread = c.thread
  where c.thread = p_thread and c.hidden_at is null
    and (c.status = 'published' or v_admin or c.author_id = v_uid)
    and (p_before is null or (c.created_at, c.id) < (p_before, p_before_id))
  order by c.created_at desc, c.id desc limit p_limit;
end;
$$;

create function public.comment_create(
  p_thread text, p_body text, p_nickname text,
  p_parent_id uuid default null, p_request_id uuid default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor record; v_previous record; v_parent record;
  v_body text; v_nickname text; v_hash text; v_body_hash text;
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
  v_nickname := btrim(p_nickname);
  if v_body is null or char_length(v_body) not between 1 and 2000 or v_body !~ '[^[:space:]]'
    or regexp_replace(v_body, E'[\t\n]', '', 'g') ~ '[[:cntrl:]]' then
    raise exception using errcode = 'P0001', message = 'invalid_body';
  end if;
  if v_nickname is null or char_length(v_nickname) not between 1 and 40
    or v_nickname ~ '[[:cntrl:]]' then
    raise exception using errcode = 'P0001', message = 'invalid_nickname';
  end if;
  select count(*) into v_links
    from pg_catalog.regexp_matches(v_body, '(https?://|www[.])[^[:space:]]+', 'gi');
  if v_links > 5 then raise exception using errcode = 'P0001', message = 'too_many_links'; end if;

  -- All requests from one account serialize before idempotency/rate/ban checks.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('comment:user:' || v_actor.user_id::text, 0));
  -- Re-check a session that may have been revoked while this request waited.
  select * into v_actor from comment_private.require_actor();
  if exists (select 1 from comment_private.bans b where b.user_id = v_actor.user_id) then
    raise exception using errcode = 'P0001', message = 'user_banned';
  end if;
  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'thread', p_thread, 'body', v_body, 'nickname', v_nickname, 'parent_id', p_parent_id
  )::text, 'UTF8')), 'hex');
  select c.id, c.request_hash, c.status into v_previous from comment_private.comments c
    where c.author_id = v_actor.user_id and c.request_id = p_request_id;
  if found then
    if v_previous.request_hash <> v_hash then
      raise exception using errcode = 'P0001', message = 'idempotency_conflict';
    end if;
    return jsonb_build_object('id', v_previous.id, 'is_pending', v_previous.status = 'pending');
  end if;

  -- Serialize tree mutations too: a concurrent reply cannot escape an admin's
  -- recursive hide, including a reply to a grandchild of the target comment.
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
      or (v_parent.status = 'pending' and not v_actor.is_admin and v_parent.author_id <> v_actor.user_id) then
      raise exception using errcode = 'P0001', message = 'invalid_parent';
    end if;
    if v_parent.depth >= 8 then
      raise exception using errcode = 'P0001', message = 'thread_depth_exceeded';
    end if;
    v_depth := v_parent.depth + 1;
    -- Never make a reply public while its parent is still pending.
    v_pending := v_pending or v_parent.status = 'pending';
  end if;

  insert into comment_private.comments (
    thread, parent_id, author_id, nickname, body, body_hash, created_at,
    status, depth, request_id, request_hash
  ) values (
    p_thread, p_parent_id, v_actor.user_id, v_nickname, v_body, v_body_hash, v_now,
    case when v_pending then 'pending' else 'published' end, v_depth, p_request_id, v_hash
  ) returning id into v_id;
  insert into comment_private.profiles (user_id, nickname) values (v_actor.user_id, v_nickname)
    on conflict (user_id) do update set nickname = excluded.nickname;
  return jsonb_build_object('id', v_id, 'is_pending', v_pending);
end;
$$;

create function public.comment_delete(p_id uuid, p_branch boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor record; v_target record; v_now timestamptz;
begin
  select * into v_actor from comment_private.require_actor(false, true);
  if p_branch is null then raise exception using errcode = 'P0001', message = 'forbidden'; end if;
  if p_branch and not v_actor.is_admin then
    raise exception using errcode = 'P0001', message = 'admin_required';
  end if;
  select c.* into v_target from comment_private.comments c where c.id = p_id;
  if not found then raise exception using errcode = 'P0001', message = 'comment_not_found'; end if;
  if not v_actor.is_admin and v_target.author_id is distinct from v_actor.user_id then
    raise exception using errcode = 'P0001', message = 'forbidden';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('comment:thread:' || v_target.thread, 0));
  v_now := clock_timestamp();
  if p_branch then
    with recursive branch as (
      select c.id from comment_private.comments c where c.id = p_id and c.thread = v_target.thread
      union
      select c.id from comment_private.comments c join branch b on c.parent_id = b.id
        where c.thread = v_target.thread
    )
    update comment_private.comments c set body = '', deleted_at = coalesce(c.deleted_at, v_now),
      hidden_at = coalesce(c.hidden_at, v_now)
      where c.id in (select b.id from branch b) and c.thread = v_target.thread;
  else
    update comment_private.comments c set body = '', deleted_at = coalesce(c.deleted_at, v_now)
      where c.id = p_id;
  end if;
end;
$$;

create function public.comment_ban(p_comment_id uuid, p_banned boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_actor record; v_user uuid;
begin
  select * into v_actor from comment_private.require_actor(true);
  select c.author_id into v_user from comment_private.comments c where c.id = p_comment_id;
  if not found then raise exception using errcode = 'P0001', message = 'comment_not_found'; end if;
  if v_user is null then raise exception using errcode = 'P0001', message = 'comment_author_missing'; end if;
  if p_banned is null then raise exception using errcode = 'P0001', message = 'forbidden'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('comment:user:' || v_user::text, 0));
  if exists (select 1 from comment_private.admins a where a.user_id = v_user) then
    raise exception using errcode = 'P0001', message = 'cannot_ban_admin';
  end if;
  if p_banned then
    insert into comment_private.bans (user_id, banned_by) values (v_user, v_actor.user_id)
      on conflict (user_id) do nothing;
  else
    delete from comment_private.bans b where b.user_id = v_user;
  end if;
end;
$$;

create function public.comment_moderation(p_enabled boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform comment_private.require_actor(true);
  if p_enabled is null then raise exception using errcode = 'P0001', message = 'forbidden'; end if;
  update comment_private.settings set moderation_enabled = p_enabled where singleton;
end;
$$;

create function public.comment_review(p_id uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_target record;
begin
  perform comment_private.require_actor(true);
  if p_approve is null then raise exception using errcode = 'P0001', message = 'forbidden'; end if;
  if not p_approve then perform public.comment_delete(p_id, true); return; end if;
  select c.* into v_target from comment_private.comments c where c.id = p_id;
  if not found then raise exception using errcode = 'P0001', message = 'comment_not_found'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('comment:thread:' || v_target.thread, 0));
  select c.* into v_target from comment_private.comments c where c.id = p_id;
  if v_target.hidden_at is not null then raise exception using errcode = 'P0001', message = 'comment_hidden'; end if;
  if v_target.parent_id is not null and exists (
    select 1 from comment_private.comments p where p.id = v_target.parent_id
      and (p.status = 'pending' or p.hidden_at is not null)
  ) then raise exception using errcode = 'P0001', message = 'parent_pending'; end if;
  update comment_private.comments set status = 'published' where id = p_id;
end;
$$;

revoke all on all functions in schema comment_private from public, anon, authenticated;
revoke all on function public.comment_me() from public, anon, authenticated;
revoke all on function public.comment_list(text, timestamptz, uuid, integer) from public, anon, authenticated;
revoke all on function public.comment_create(text, text, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.comment_delete(uuid, boolean) from public, anon, authenticated;
revoke all on function public.comment_ban(uuid, boolean) from public, anon, authenticated;
revoke all on function public.comment_moderation(boolean) from public, anon, authenticated;
revoke all on function public.comment_review(uuid, boolean) from public, anon, authenticated;
grant execute on function public.comment_me() to anon, authenticated;
grant execute on function public.comment_list(text, timestamptz, uuid, integer) to anon, authenticated;
grant execute on function public.comment_create(text, text, text, uuid, uuid) to authenticated;
grant execute on function public.comment_delete(uuid, boolean) to authenticated;
grant execute on function public.comment_ban(uuid, boolean) to authenticated;
grant execute on function public.comment_moderation(boolean) to authenticated;
grant execute on function public.comment_review(uuid, boolean) to authenticated;

comment on schema comment_private is 'Private comment storage: never add to exposed API schemas.';
notify pgrst, 'reload schema';
commit;
