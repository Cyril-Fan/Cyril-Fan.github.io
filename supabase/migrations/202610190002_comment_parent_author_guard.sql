-- A removed auth account leaves author_id NULL. Pending-parent access must fail closed.
-- CREATE OR REPLACE retains the existing explicit authenticated-only EXECUTE grant.
begin;

create or replace function public.comment_create(
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
      or (v_parent.status = 'pending' and not v_actor.is_admin and v_parent.author_id is distinct from v_actor.user_id) then
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

notify pgrst, 'reload schema';
commit;
