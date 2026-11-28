-- READ-ONLY. Facts for the Acceptance plan "marketplace-v2" (acceptance-apply.sh runs it before and after the push; marketplace-v2-smoke.mjs judges the output).
-- One row, one jsonb column `facts`. Only SELECTs; the public reads are STABLE security-definer functions that write nothing. No row data of users is returned.
-- Works on the 237-migration state too (before the push): every object that only exists after the push is looked up by name, never referenced directly.
select jsonb_build_object(
  'applied_migrations', (select count(*) from supabase_migrations.schema_migrations),
  'latest_migration', (select max(version) from supabase_migrations.schema_migrations),
  'new_tables', (select coalesce(jsonb_agg(c.relname order by c.relname), '[]'::jsonb) from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = 'public' and c.relkind = 'r' and c.relname in ('marketplace_seller_message_presets', 'marketplace_seller_preset_events',
                    'marketplace_seller_delivery_settings', 'marketplace_free_shipping_products', 'marketplace_seller_settings_events', 'marketplace_video_events')),
  'templates', (select count(*) from public.notification_templates),
  'stock_templates', (select count(*) from public.notification_templates where key in ('marketplace.stock.low', 'marketplace.stock.out')),
  'presets', case when to_regclass('public.marketplace_seller_message_presets') is null then null
                  else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.marketplace_seller_message_presets', false, true, '')))[1]::text::bigint end,
  'preset_actions', case when to_regclass('public.marketplace_seller_message_presets') is null then null
                         else (xpath('/row/a/text()', query_to_xml('select coalesce(string_agg(action || '':'' || n, '','' order by action), '''') as a from (select action, count(*) n from public.marketplace_seller_message_presets group by action) s', false, true, '')))[1]::text end,
  'marketplace_open', (select to_jsonb(m) -> 'marketplace_open' from public.marketplace_platform_settings m where singleton),
  'marketplace_open_default', (select pg_get_expr(d.adbin, d.adrelid) from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
                                 where d.adrelid = 'public.marketplace_platform_settings'::regclass and a.attname = 'marketplace_open'),
  'media_verification_ready', (select to_jsonb(m) -> 'media_verification_ready' from public.marketplace_platform_settings m where singleton),
  'enum_has_marketplace', exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'media_video_scope' and e.enumlabel = 'marketplace'),
  'permission', (select count(*) from public.admin_permissions where key = 'marketplace_platform.manage'),
  'permission_super_admin_locked', (select count(*) from public.admin_role_permissions rp join public.admin_roles r on r.id = rp.role_id
                                     where rp.permission_key = 'marketplace_platform.manage' and r.is_system and r.key = 'super_admin' and rp.is_locked),
  'permission_other_roles', (select count(*) from public.admin_role_permissions rp where rp.permission_key = 'marketplace_platform.manage'
                              and rp.role_id not in (select id from public.admin_roles where is_system and key = 'super_admin')),
  'marketplace_videos', (select count(*) from public.media_videos where scope::text = 'marketplace'),
  'sellers', (select count(*) from public.marketplace_seller_accounts),
  'products', (select count(*) from public.marketplace_products),
  'published_products', (select count(*) from public.marketplace_products where status = 'published'),
  'functions_present', (select coalesce(jsonb_agg(f order by f), '[]'::jsonb) from unnest(array[
      'public.marketplace_public_status()', 'public.marketplace_public_browse(text,text,text,text,integer,integer,numeric,numeric,jsonb,boolean,integer,text,text,text)',
      'public.marketplace_public_catalog_page(text,text,text,text,integer,integer,numeric,numeric,boolean,jsonb)', 'public.marketplace_public_facets(text)',
      'public.marketplace_public_product(text)', 'public.marketplace_public_delivery(text,text,text,text)', 'public.marketplace_public_seller(text)',
      'public.admin_marketplace_platform_status()', 'public.admin_marketplace_set_open(boolean,text)', 'public.admin_marketplace_seller_presets()',
      'public.admin_marketplace_product_review_queue(text,integer,integer)', 'public.admin_marketplace_pending_videos(integer)',
      'public.marketplace_product_video_list(uuid)', 'public.marketplace_seller_commerce_readiness(uuid)', 'app.marketplace_publication_blockers(uuid)',
      'app.marketplace_is_open()', 'app.notify_from_template(uuid,uuid,text,text,uuid,text,jsonb,jsonb,jsonb)']) f
      where to_regprocedure(f) is not null),
  -- the public reads answer (they write nothing); skipped before the push because the functions do not exist yet
  'public_status', case when to_regprocedure('public.marketplace_public_status()') is null then null
                        else (xpath('/row/s/text()', query_to_xml('select public.marketplace_public_status()::text as s', false, true, '')))[1]::text::jsonb end,
  'public_catalog_page', case when to_regprocedure('public.marketplace_public_catalog_page(text,text,text,text,integer,integer,numeric,numeric,boolean,jsonb)') is null then null
                              else (xpath('/row/s/text()', query_to_xml('select jsonb_typeof(public.marketplace_public_catalog_page(null, null, null, ''newest'', 1, 0, null, null, false, null))::text as s', false, true, '')))[1]::text end,
  'public_facets', case when to_regprocedure('public.marketplace_public_facets(text)') is null then null
                        else (xpath('/row/s/text()', query_to_xml('select jsonb_typeof(public.marketplace_public_facets(null))::text as s', false, true, '')))[1]::text end,
  'publication_blockers_unknown_product', case when to_regprocedure('app.marketplace_publication_blockers(uuid)') is null then null
                        else (xpath('/row/s/text()', query_to_xml('select jsonb_typeof(to_jsonb(app.marketplace_publication_blockers(''00000000-0000-0000-0000-000000000000''::uuid)))::text as s', false, true, '')))[1]::text end
) as facts;
