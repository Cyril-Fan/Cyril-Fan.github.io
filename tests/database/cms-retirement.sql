do $$
begin
  if to_regnamespace('cms_private') is not null then raise exception 'Legacy CMS schema remains'; end if;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'cms_%') then raise exception 'Legacy CMS API remains'; end if;
  if exists(select 1 from storage.buckets where id='cms-media') then raise exception 'Legacy CMS bucket remains'; end if;
  if to_regclass('comment_private.comments') is null or to_regclass('site_private.traffic') is null then raise exception 'Unrelated data structure removed'; end if;
  if not exists(select 1 from storage.buckets where id='comment-avatars') then raise exception 'User avatar bucket removed'; end if;
end $$;

