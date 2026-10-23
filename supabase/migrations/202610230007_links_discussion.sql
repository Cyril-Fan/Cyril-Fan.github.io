-- Add one canonical discussion. Existing authentication, moderation, rate limits
-- and RPC grants remain unchanged. Both language pages use /links.
begin;
create or replace function comment_private.valid_thread(p_thread text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(
    char_length(p_thread) <= 300
    and p_thread !~ '[[:space:][:cntrl:]?#]'
    and position(chr(92) in p_thread) = 0 and position('//' in p_thread) = 0
    and p_thread !~ '/[.]{1,2}(/|$)' and (
      p_thread in ('/about', '/links') or (
        left(p_thread, 6) = '/blog/' and char_length(p_thread) > 6
        and right(p_thread, 1) <> '/'
      )
    ), false
  );
$$;
commit;
