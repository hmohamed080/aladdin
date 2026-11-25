-- pgTAP: Marketplace stock notifications carry the product name in the language of the text
-- (20261124120001_marketplace_stock_notify_localized.sql). Found on Acceptance 2026-11-24: the English text showed the
-- ARABIC product name because one variable was rendered into both languages.
--
--   A. TEMPLATES   - defaults use the per-language names; every placeholder is declared in `variables`; admin columns untouched
--   B. LOW / OUT   - the Arabic text carries the Arabic name, the English text the English name
--   C. FALLBACK    - a product with only an Arabic name falls back to it in English
--   D. OVERRIDE    - an admin-edited template that still uses {product_name} still renders
--   E. ACTOR       - the actor is still never notified of their own action (app.notify rule unchanged)
--
-- Fixtures (seed-pilot): showroom B 91000005-...005 (owner 71000005).
create extension if not exists pgtap;

begin;
select plan(15);

select set_config('t.b', '91000005-1111-4111-8111-000000000005', true);
select set_config('t.p', 'c8000000-0000-4000-8000-000000000001', true);
select set_config('t.v', 'c8100000-0000-4000-8000-000000000001', true);
select set_config('t.l', 'c8200000-0000-4000-8000-000000000001', true);

select set_config('app.marketplace_seller_write', 'on', true);
insert into public.marketplace_seller_accounts (organization_id, status, approved_at) values (current_setting('t.b')::uuid, 'approved', now());
select set_config('app.marketplace_seller_write', 'off', true);

set session_replication_role = replica;
insert into public.marketplace_products (id, seller_organization_id, product_type_id, slug, name_ar, name_en, status, published_at, low_stock_threshold)
select current_setting('t.p')::uuid, current_setting('t.b')::uuid, t.id, 'stock-loc-wallpaper', 'ورق حائط محلي', 'Localized wallpaper', 'published', now(), 5
from public.marketplace_product_types t where t.key = 'wallpaper';
set session_replication_role = origin;
insert into public.marketplace_product_variants (id, product_id, seller_organization_id, sku, selling_unit, price_egp)
values (current_setting('t.v')::uuid, current_setting('t.p')::uuid, current_setting('t.b')::uuid, 'SL-1', 'roll', 100);
insert into public.marketplace_stock_locations (id, organization_id, key, name_ar, name_en)
values (current_setting('t.l')::uuid, current_setting('t.b')::uuid, 'sl_main', 'مخزن', 'main');
select applied from public.marketplace_stock_apply(current_setting('t.b')::uuid, current_setting('t.v')::uuid, current_setting('t.l')::uuid,
  'initial', 20, 'sl-initial-0000001', 'opening balance', 'manual');

-- ===========================================================================
-- A. Templates
-- ===========================================================================
select is((select default_body_en from public.notification_templates where key = 'marketplace.stock.low'),
  '{product_name_en} has only {quantity} left. Add stock to keep it on the Marketplace.', 'A1. low: the English default uses {product_name_en}');
select is((select position('{product_name_ar}' in default_body_ar) > 0 and position('{product_name_en}' in default_body_en) > 0
           from public.notification_templates where key = 'marketplace.stock.out'), true, 'A2. out: Arabic default uses {product_name_ar}, English {product_name_en}');
select is((select count(*)::int from public.notification_templates t
            where t.key in ('marketplace.stock.low', 'marketplace.stock.out')
              and not (app.template_variables(t.default_title_ar || ' ' || t.default_body_ar || ' ' || t.default_title_en || ' ' || t.default_body_en) <@ t.variables)), 0,
  'A3. every placeholder in a stock default text is declared in `variables`');
select is((select count(*)::int from public.notification_templates t
            where t.key in ('marketplace.stock.low', 'marketplace.stock.out') and t.variables @> array['product_name', 'product_name_ar', 'product_name_en']), 2,
  'A4. product_name stays allowed (for admin-edited texts) next to the two new names');
select is((select count(*)::int from public.notification_templates t
            where t.key in ('marketplace.stock.low', 'marketplace.stock.out')
              and (t.title_ar is not null or t.body_ar is not null or t.title_en is not null or t.body_en is not null or t.version <> 1)), 0,
  'A5. admin columns and version were not touched by the migration');

-- ===========================================================================
-- B. Low and out of stock: each language carries its own name
-- ===========================================================================
select applied from public.marketplace_stock_apply(current_setting('t.b')::uuid, current_setting('t.v')::uuid, current_setting('t.l')::uuid,
  'correction', -16, 'sl-low-00000000001', 'sold', 'manual');
select is((select content -> 'en' ->> 'body' from public.notifications where event_type = 'marketplace.stock.low'
           and subject_id = current_setting('t.p')::uuid and recipient_user_id = '71000005-0000-4000-8000-000000000005'),
  'Localized wallpaper has only 4 left. Add stock to keep it on the Marketplace.', 'B1. low: the English text carries the English name');
select is((select content -> 'ar' ->> 'body' from public.notifications where event_type = 'marketplace.stock.low'
           and subject_id = current_setting('t.p')::uuid and recipient_user_id = '71000005-0000-4000-8000-000000000005'),
  'المنتج ورق حائط محلي تبقّى منه 4 فقط. أضف كمية لتجنّب سحبه من المتجر.', 'B2. low: the Arabic text carries the Arabic name');
select is((select position('Localized' in content -> 'ar' ->> 'body') from public.notifications where event_type = 'marketplace.stock.low'
           and subject_id = current_setting('t.p')::uuid and recipient_user_id = '71000005-0000-4000-8000-000000000005'), 0,
  'B3. low: the Arabic text has no English name in it');
select applied from public.marketplace_stock_apply(current_setting('t.b')::uuid, current_setting('t.v')::uuid, current_setting('t.l')::uuid,
  'correction', -4, 'sl-out-00000000001', 'sold', 'manual');
select is((select content -> 'en' ->> 'body' from public.notifications where event_type = 'marketplace.stock.out'
           and subject_id = current_setting('t.p')::uuid and recipient_user_id = '71000005-0000-4000-8000-000000000005'),
  'Localized wallpaper is out of stock and was withdrawn from the Marketplace. It returns automatically when you add stock.', 'B4. out: the English text carries the English name');
select is((select content -> 'ar' ->> 'body' from public.notifications where event_type = 'marketplace.stock.out'
           and subject_id = current_setting('t.p')::uuid and recipient_user_id = '71000005-0000-4000-8000-000000000005'),
  'نفدت كمية المنتج ورق حائط محلي وتم سحبه من المتجر. سيعود تلقائيًا عند إضافة كمية.', 'B5. out: the Arabic text carries the Arabic name');

-- ===========================================================================
-- C. Only an Arabic name: English falls back to it
-- ===========================================================================
alter table public.marketplace_products alter column name_en drop not null;   -- rolled back with the test
update public.marketplace_products set name_en = null where id = current_setting('t.p')::uuid;
select applied from public.marketplace_stock_apply(current_setting('t.b')::uuid, current_setting('t.v')::uuid, current_setting('t.l')::uuid,
  'replenish', 20, 'sl-back-0000000001', 'restock', 'manual');
select applied from public.marketplace_stock_apply(current_setting('t.b')::uuid, current_setting('t.v')::uuid, current_setting('t.l')::uuid,
  'correction', -16, 'sl-low-00000000002', 'sold', 'manual');
select is((select count(*)::int from public.notifications where event_type = 'marketplace.stock.low' and subject_id = current_setting('t.p')::uuid
           and content -> 'en' ->> 'body' = 'ورق حائط محلي has only 4 left. Add stock to keep it on the Marketplace.'), 1,
  'C1. no English name: the English text falls back to the Arabic name');
select is((select count(*)::int from public.notifications where event_type = 'marketplace.stock.low' and subject_id = current_setting('t.p')::uuid
           and content -> 'ar' ->> 'body' = 'المنتج ورق حائط محلي تبقّى منه 4 فقط. أضف كمية لتجنّب سحبه من المتجر.'), 2,
  'C2. ...and the Arabic text is unchanged');

-- ===========================================================================
-- D. An admin-edited template that still uses {product_name} still renders (the value is unchanged: Arabic name first)
-- ===========================================================================
update public.notification_templates set
  title_ar = 'تنبيه', body_ar = 'عدّل المدير: {product_name} ({quantity})',
  title_en = 'Alert', body_en = 'Edited by an admin: {product_name} ({quantity})'
 where key = 'marketplace.stock.low';
update public.marketplace_products set name_en = 'Localized wallpaper' where id = current_setting('t.p')::uuid;
select applied from public.marketplace_stock_apply(current_setting('t.b')::uuid, current_setting('t.v')::uuid, current_setting('t.l')::uuid,
  'replenish', 16, 'sl-back-0000000002', 'restock', 'manual');
select applied from public.marketplace_stock_apply(current_setting('t.b')::uuid, current_setting('t.v')::uuid, current_setting('t.l')::uuid,
  'correction', -16, 'sl-low-00000000003', 'sold', 'manual');
select is((select count(*)::int from public.notifications where event_type = 'marketplace.stock.low' and subject_id = current_setting('t.p')::uuid
           and content -> 'en' ->> 'body' = 'Edited by an admin: ورق حائط محلي (4)'
           and content -> 'ar' ->> 'body' = 'عدّل المدير: ورق حائط محلي (4)'), 1,
  'D1. an edited template with {product_name} renders (the variable keeps its old value)');
update public.notification_templates set
  body_ar = 'عدّل المدير: {product_name_ar}', body_en = 'Edited: {product_name_en}'
 where key = 'marketplace.stock.low';
select applied from public.marketplace_stock_apply(current_setting('t.b')::uuid, current_setting('t.v')::uuid, current_setting('t.l')::uuid,
  'replenish', 16, 'sl-back-0000000003', 'restock', 'manual');
select applied from public.marketplace_stock_apply(current_setting('t.b')::uuid, current_setting('t.v')::uuid, current_setting('t.l')::uuid,
  'correction', -16, 'sl-low-00000000004', 'sold', 'manual');
select is((select count(*)::int from public.notifications where event_type = 'marketplace.stock.low' and subject_id = current_setting('t.p')::uuid
           and content -> 'en' ->> 'body' = 'Edited: Localized wallpaper' and content -> 'ar' ->> 'body' = 'عدّل المدير: ورق حائط محلي'), 1,
  'D2. an edited template may use the new per-language variables');
update public.notification_templates set title_ar = null, body_ar = null, title_en = null, body_en = null where key = 'marketplace.stock.low';

-- ===========================================================================
-- E. The actor is never notified of their own action
-- ===========================================================================
select applied from public.marketplace_stock_apply(current_setting('t.b')::uuid, current_setting('t.v')::uuid, current_setting('t.l')::uuid,
  'replenish', 16, 'sl-back-0000000004', 'restock', 'manual');
select set_config('request.jwt.claims', '{"sub":"71000005-0000-4000-8000-000000000005","role":"authenticated"}', true);
select applied from public.marketplace_stock_apply(current_setting('t.b')::uuid, current_setting('t.v')::uuid, current_setting('t.l')::uuid,
  'correction', -16, 'sl-low-00000000005', 'sold by the owner', 'manual');
select is((select count(*)::int from public.notifications where event_type = 'marketplace.stock.low' and subject_id = current_setting('t.p')::uuid
           and recipient_user_id = '71000005-0000-4000-8000-000000000005'), 4,
  'E1. the owner acting does not notify the owner (four low-stock rows from the system crossings, no fifth)');
select set_config('request.jwt.claims', '', true);

select * from finish();
rollback;
