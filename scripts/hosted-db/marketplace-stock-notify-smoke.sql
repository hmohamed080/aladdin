-- READ-ONLY. Facts for the stock-notify migration 20261124120001 (plans "marketplace-slug" Acceptance 244 -> 246 and "prod-marketplace-v2" Production 237 -> 246).
-- acceptance-apply.sh / production-apply.sh run it before and after the push; marketplace-stock-notify-smoke.mjs judges the output. One row, one jsonb column `facts`.
-- Only SELECTs; the trigger function and the templates are looked up by name (they may not exist before the plan). No user data is returned, only booleans and counts.
select jsonb_build_object(
  'applied_migrations', (select count(*) from supabase_migrations.schema_migrations),
  'latest_migration', (select max(version) from supabase_migrations.schema_migrations),
  'fn_present', to_regprocedure('app.marketplace_stock_notify()') is not null,
  'fn_passes_localized_names', coalesce((select p.prosrc like '%product_name_ar%' and p.prosrc like '%product_name_en%' from pg_proc p where p.oid = to_regprocedure('app.marketplace_stock_notify()')), false),
  'fn_callable_by_api_roles', (select count(*) from pg_proc p where p.oid = to_regprocedure('app.marketplace_stock_notify()')
                                 and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))),
  'trigger_enabled', exists (select 1 from pg_trigger t where t.tgname = 'marketplace_stock_notify' and not t.tgisinternal and t.tgenabled = 'O'),
  'stock_templates', (select count(*) from public.notification_templates where key in ('marketplace.stock.low', 'marketplace.stock.out')),
  'defaults_localized', (select count(*) from public.notification_templates t where t.key in ('marketplace.stock.low', 'marketplace.stock.out')
                           and t.default_body_ar like '%{product_name_ar}%' and t.default_body_en like '%{product_name_en}%'),
  'defaults_declared', (select count(*) from public.notification_templates t where t.key in ('marketplace.stock.low', 'marketplace.stock.out')
                           and t.variables @> array['product_name', 'product_name_ar', 'product_name_en']),
  'stock_templates_edited', (select count(*) from public.notification_templates t where t.key in ('marketplace.stock.low', 'marketplace.stock.out')
                               and (t.title_ar is not null or t.body_ar is not null or t.title_en is not null or t.body_en is not null))
) as facts;
