-- READ-ONLY. Facts for the plan "marketplace-orders" (Acceptance 246 -> 264). acceptance-apply.sh runs it before and after the push; marketplace-orders-smoke.mjs
-- judges the output. One row, one jsonb column `facts`. Only SELECTs; objects that may not exist before the plan are looked up by name. No user data: counts and booleans.
with new_tables(t) as (values ('marketplace_buyer_address_events'), ('marketplace_buyer_addresses'), ('marketplace_cart_items'), ('marketplace_cart_merges'),
  ('marketplace_checkout_sessions'), ('marketplace_order_cancellations'), ('marketplace_order_invoices'), ('marketplace_order_refunds'), ('marketplace_order_shipments'),
  ('marketplace_payment_complaint_events'), ('marketplace_payment_complaints'), ('marketplace_return_events'), ('marketplace_return_evidence'), ('marketplace_return_items'),
  ('marketplace_return_reason_rules'), ('marketplace_return_requests'), ('marketplace_seller_return_settings'), ('marketplace_timers'), ('upload_limit_events'),
  ('upload_limit_exemptions'), ('upload_limit_settings')),
present as (select c.oid, c.relrowsecurity, c.relname from new_tables n join pg_class c on c.relname = n.t and c.relnamespace = 'public'::regnamespace and c.relkind = 'r'),
orders as (select to_jsonb(o) as o from public.marketplace_orders o)
select jsonb_build_object(
  'applied_migrations', (select count(*) from supabase_migrations.schema_migrations),
  'latest_migration', (select max(version) from supabase_migrations.schema_migrations),
  'new_tables', (select count(*) from present),
  'new_tables_without_rls', (select count(*) from present where not relrowsecurity),
  'new_tables_open_to_anon', (select count(*) from present p where has_table_privilege('anon', p.oid, 'select, insert, update, delete')),
  'orders', (select count(*) from orders),
  'orders_open_old_model', (select count(*) from orders where o ->> 'status' not in ('delivered', 'cancelled', 'returned') and coalesce(o ->> 'source', 'legacy') = 'legacy'),
  'orders_not_legacy', (select count(*) from orders where coalesce(o ->> 'source', 'legacy') <> 'legacy'),
  'orders_unmigrated', (select count(*) from orders where o ->> 'placed_at' is null or o ->> 'paid_now_egp' is null or o ->> 'payment_method' = 'instapay'),
  'templates', (select count(*) from public.notification_templates),
  'presets', (select count(*) from public.marketplace_seller_message_presets),
  'new_permissions', (select count(*) from public.admin_permissions where key in ('marketplace_payment_complaints.review', 'marketplace_returns.review')),
  'new_permission_grants', (select count(*) from public.admin_role_permissions where permission_key in ('marketplace_payment_complaints.review', 'marketplace_returns.review')),
  'new_permission_grants_super_admin', (select count(*) from public.admin_role_permissions g join public.admin_roles r on r.id = g.role_id
                                          where r.is_system and r.key = 'super_admin' and g.permission_key in ('marketplace_payment_complaints.review', 'marketplace_returns.review')),
  'return_rules', case when to_regclass('public.marketplace_return_reason_rules') is null then null
     else (xpath('/row/c/text()', query_to_xml('select count(*) as c from public.marketplace_return_reason_rules', false, true, '')))[1]::text::int end,
  'upload_limits', case when to_regclass('public.upload_limit_settings') is null then null
     else (xpath('/row/c/text()', query_to_xml('select hourly_uploads || ''/'' || hourly_attempts || ''/'' || storage_quota_mb as c from public.upload_limit_settings', false, true, '')))[1]::text end,
  'functions_without_search_path', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public', 'app') and p.prokind in ('f', 'p')
     and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%'))
) as facts;
