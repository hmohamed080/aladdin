-- READ-ONLY structural facts used before and after the Acceptance push of 20261107090003..090006.
select jsonb_build_object(
 'storage_key_column', exists(select 1 from information_schema.columns where table_schema='public' and table_name='media_storage_locations' and column_name='storage_key'),
 'media_locations', (select count(*) from public.media_storage_locations),
 'storage_objects', (select count(*) from storage.objects),
 'backup_tables', (select count(*) from information_schema.tables where table_schema='app' and table_name in ('backup_environment','backup_settings','backup_runs','backup_run_events')),
 'delivery_requests_table', exists(select 1 from information_schema.tables where table_schema='app' and table_name='whatsapp_otp_delivery_requests'),
 'latest_migration', (select max(version) from supabase_migrations.schema_migrations)
) as facts;
