-- READ-ONLY. Facts for the plan "marketplace-retest" (Acceptance 266 -> 267). acceptance-apply.sh runs it before and after the push; marketplace-retest-smoke.mjs
-- judges the output. One row, one jsonb column `facts`. Only SELECTs; objects that may not exist before the plan are looked up by name. No user data: counts only.
select jsonb_build_object(
  'applied_migrations', (select count(*) from supabase_migrations.schema_migrations),
  'latest_migration', (select max(version) from supabase_migrations.schema_migrations),
  'money_helper', (select count(*) from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = 'marketplace_money'),
  'writers_using_helper', (select count(*) from pg_proc p where p.pronamespace in ('app'::regnamespace, 'public'::regnamespace)
     and p.proname in ('marketplace_order_notify', 'marketplace_return_notify', 'marketplace_seller_cancel_refund_record', 'marketplace_buyer_cancel_refund_confirm') and position('app.marketplace_money(' in p.prosrc) > 0),
  'writers_old_format', (select count(*) from pg_proc p where p.pronamespace in ('app'::regnamespace, 'public'::regnamespace)
     and p.proname in ('marketplace_order_notify', 'marketplace_return_notify', 'marketplace_seller_cancel_refund_record', 'marketplace_buyer_cancel_refund_confirm') and position('FM999,999,990.00' in p.prosrc) > 0),
  'invoice_address_fallback', (select count(*) from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname = 'marketplace_order_invoice_issue'
     and position('b.deleted_at is null' in p.prosrc) > 0),
  'waybill_payment_status', (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'marketplace_order_waybill_get'
     and position('''status'', o.payment_status' in p.prosrc) > 0),
  'templates', (select count(*) from public.notification_templates),
  'invoices', (select count(*) from public.marketplace_order_invoices),
  'showrooms_selling_without_address', (select count(distinct sl.organization_id) from public.marketplace_stock_locations sl
     where sl.is_active and not exists (select 1 from public.branches b where b.organization_id = sl.organization_id and b.is_active and b.deleted_at is null
       and coalesce(nullif(btrim(b.address_ar), ''), nullif(btrim(b.address_en), '')) is not null))
) as facts;
