-- Read-only verification of the leaf-comment display upgrade.
-- Returns booleans only; no commenter data or private email is exposed.
select
  to_regprocedure('public.comment_thread_list(text,uuid,integer,uuid)') is not null as reader_present,
  coalesce((select prosrc like '%visible_base%' and prosrc like '%has_replies%' and prosrc like '%d.deleted_at is null%'
    from pg_catalog.pg_proc where oid=to_regprocedure('public.comment_thread_list(text,uuid,integer,uuid)')),false) as visibility_upgrade_present,
  coalesce(has_function_privilege('anon',to_regprocedure('public.comment_thread_list(text,uuid,integer,uuid)'),'EXECUTE'),false) as public_reader_allowed,
  coalesce(has_function_privilege('authenticated',to_regprocedure('public.comment_thread_list(text,uuid,integer,uuid)'),'EXECUTE'),false) as member_reader_allowed,
  not has_schema_privilege('anon','comment_private','USAGE') and not has_schema_privilege('authenticated','comment_private','USAGE') as private_tables_remain_private,
  coalesce((select prosecdef and proconfig @> array['search_path=""']
    from pg_catalog.pg_proc where oid=to_regprocedure('public.comment_thread_list(text,uuid,integer,uuid)')),false) as fixed_definer_context;

