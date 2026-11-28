-- READ-ONLY. Facts for the plan "marketplace-clarity" (Acceptance 264 -> 266). acceptance-apply.sh runs it before and after the push; marketplace-clarity-smoke.mjs
-- judges the output. One row, one jsonb column `facts`. Only SELECTs; objects that may not exist before the plan are looked up by name. No user data: counts only.
select jsonb_build_object(
  'applied_migrations', (select count(*) from supabase_migrations.schema_migrations),
  'latest_migration', (select max(version) from supabase_migrations.schema_migrations),
  'templates', (select count(*) from public.notification_templates),
  'new_templates', (select count(*) from public.notification_templates
     where key in ('marketplace.return.shipped', 'marketplace.return.complaint_filed', 'marketplace.return.refund_confirm_reminder')),
  'new_helpers', (select count(*) from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname in ('marketplace_attribute_number', 'marketplace_date_range')),
  'active_return_timers', (select count(*) from public.marketplace_timers where state = 'active' and kind like 'return%'),
  'refund_confirm_timers', (select count(*) from public.marketplace_timers where kind = 'return_refund_confirm'),
  'return_reject_presets', (select count(*) from public.marketplace_seller_message_presets where action = 'return_reject'),
  'invoices', (select count(*) from public.marketplace_order_invoices)
) as facts;
