-- The GitHub file editor owns no persistent CMS content in Supabase.
-- Before running on production, deploy content-github, publish the new site,
-- verify the canonical Git files, and delete the TWO approved disposable images
-- through Storage (not SQL metadata deletion). This guard refuses changed content.
begin;
do $$
declare digest text; total integer;
begin
  if exists(select 1 from storage.objects where bucket_id='cms-media') then
    raise exception 'CMS storage is not empty. Preserve unapproved files and use the Storage API/UI to remove approved objects first.';
  end if;
  if to_regclass('cms_private.documents') is not null then
    select count(*),md5(string_agg(to_jsonb(d)::text,'|' order by id)) into total,digest from cms_private.documents d;
    if total>0 and (total<>17 or digest<>'23fe1d4112e304096306293aa5aa6abc') then
      raise exception 'CMS inventory changed since the owner-approved audit. Stop and preserve the new content.';
    end if;
  end if;
end $$;
drop policy if exists cms_media_read on storage.objects;
drop policy if exists cms_media_insert on storage.objects;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as signature from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=any(array[
      'cms_initialize','cms_list','cms_get','cms_history','cms_save','cms_trash',
      'cms_prepare_publish','cms_jobs','cms_media_list','cms_media_save',
      'cms_service_claim','cms_service_finish','cms_service_stage','cms_service_redeploy'])
  loop execute 'drop function '||f.signature; end loop;
end $$;
drop schema if exists cms_private cascade;
-- Empty bucket only. Storage object bytes have already been removed separately.
delete from storage.buckets where id='cms-media';
commit;

