-- READ-ONLY structural facts used before and after an Acceptance push (counts and a version only, no row data).
select jsonb_build_object(
 'media_locations', (select count(*) from public.media_storage_locations),
 'storage_objects', (select count(*) from storage.objects),
 'latest_migration', (select max(version) from supabase_migrations.schema_migrations),
 'applied_migrations', (select count(*) from supabase_migrations.schema_migrations)
) as facts;
