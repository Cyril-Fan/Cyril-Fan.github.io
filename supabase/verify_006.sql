-- Read-only installation check. Safe before or after 006; returns no private data.
select
  to_regprocedure('public.comment_list(text,timestamptz,uuid,integer)') is not null as legacy_reader_present,
  to_regprocedure('public.comment_thread_list(text,uuid,integer,uuid)') is not null as conversation_reader_present,
  to_regprocedure('public.comment_author_email(text,uuid)') is not null as owner_email_reader_present;

select
  coalesce(has_function_privilege('anon',to_regprocedure('public.comment_thread_list(text,uuid,integer,uuid)'),'EXECUTE'),false) as anonymous_conversation_read_allowed,
  coalesce(has_function_privilege('authenticated',to_regprocedure('public.comment_thread_list(text,uuid,integer,uuid)'),'EXECUTE'),false) as member_conversation_read_allowed,
  coalesce(not has_function_privilege('anon',to_regprocedure('public.comment_author_email(text,uuid)'),'EXECUTE'),false) as anonymous_email_read_denied,
  coalesce(has_function_privilege('authenticated',to_regprocedure('public.comment_author_email(text,uuid)'),'EXECUTE'),false) as signed_in_email_rpc_available,
  not has_schema_privilege('anon','comment_private','USAGE') as anonymous_private_schema_denied,
  not has_schema_privilege('authenticated','comment_private','USAGE') as member_private_schema_denied;

-- When installed, both functions must execute with their own fixed search path.
select count(*)=2 and coalesce(bool_and(p.prosecdef and p.proconfig @> array['search_path=""']),false)
  as both_new_functions_have_fixed_definer_context
from pg_catalog.pg_proc p where p.oid in (
  to_regprocedure('public.comment_thread_list(text,uuid,integer,uuid)'),
  to_regprocedure('public.comment_author_email(text,uuid)')
);
