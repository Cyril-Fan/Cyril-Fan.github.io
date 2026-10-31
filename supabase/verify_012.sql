-- Read-only: verify installed behavior and authority without reading identities.
select
  (select prosrc like '%delete from comment_private.comments%' and prosrc like '%author_id = null%'
    and prosrc like '%while v_parent is not null%' and prosrc like '%pg_advisory_xact_lock%'
    from pg_proc where oid='public.comment_delete(uuid,boolean)'::regprocedure) as physical_deletion_and_pruning,
  (select prosrc like '%c.deleted_at is not null then ''Deleted comment''%'
    from pg_proc where oid='public.comment_thread_list(text,uuid,integer,uuid)'::regprocedure) as anonymous_thread_reader,
  (select prosrc like '%c.deleted_at is not null then ''Deleted comment''%'
    from pg_proc where oid='public.comment_list(text,timestamptz,uuid,integer)'::regprocedure) as anonymous_legacy_reader,
  (select prosrc like '%c.deleted_at is null%'
    from pg_proc where oid='public.comment_author_email(text,uuid)'::regprocedure) as erased_author_email_unavailable,
  not has_function_privilege('anon','public.comment_delete(uuid,boolean)','EXECUTE')
    and has_function_privilege('authenticated','public.comment_delete(uuid,boolean)','EXECUTE') as deletion_requires_login,
  not has_schema_privilege('anon','comment_private','USAGE')
    and not has_schema_privilege('authenticated','comment_private','USAGE') as private_tables_remain_private;
