-- pgTAP: Marketplace PR 8 — seller delivery and payment settings
-- (20261123120001_marketplace_seller_delivery_payment_settings.sql).
--
--   A. SHAPE     — RLS, no client write grant, function privileges.
--   B. TERMS     — preparation days, free-shipping minimum, per-area duration / next-day / minimum; validation.
--   C. PAYMENT   — InstaPay (full) next to the deposit; old callers keep working.
--   D. FREE SHIP — per-product flag.
--   E. READINESS — the missing-data contract consumed by the publication gate.
--   F. AUTHZ     — sales-only member, other showroom, anon; append-only audit trail.
--
-- Fixtures (seed-pilot): showroom A 9c000000-…001 (owner 70000001; 70000002 sales-only member),
-- showroom B 91000005-…005 (owner 71000005).
create extension if not exists pgtap;

begin;
select plan(46);

update auth.users set email_confirmed_at = now()
  where id in ('70000001-0000-4000-8000-000000000001', '70000002-0000-4000-8000-000000000002',
               '71000005-0000-4000-8000-000000000005');
select set_config('t.a', '9c000000-cccc-4ccc-8ccc-000000000001', true);
select set_config('t.b', '91000005-1111-4111-8111-000000000005', true);
select set_config('app.marketplace_seller_write', 'on', true);
insert into public.marketplace_seller_accounts (organization_id, status, approved_at)
values (current_setting('t.a')::uuid, 'approved', now()), (current_setting('t.b')::uuid, 'approved', now())
on conflict (organization_id) do update set status = 'approved', approved_at = now();
select set_config('t.cairo_area', (select min(key) from app.place_cities where governorate_key = 'cairo'), true);
-- a clean slate for the two showrooms, and one product each
delete from public.marketplace_delivery_rates where seller_organization_id in (current_setting('t.a')::uuid, current_setting('t.b')::uuid);
delete from public.marketplace_seller_payment_settings where seller_organization_id in (current_setting('t.a')::uuid, current_setting('t.b')::uuid);
update public.marketplace_stock_locations set supports_pickup = false where organization_id in (current_setting('t.a')::uuid, current_setting('t.b')::uuid);
insert into public.marketplace_products (id, seller_organization_id, product_type_id, slug, name_ar, name_en)
select 'a0000000-0000-4000-8000-0000000000a1', current_setting('t.a')::uuid, (select id from public.marketplace_product_types limit 1), 'pr8-test-product-a', 'منتج', 'PR8 product A';
insert into public.marketplace_products (id, seller_organization_id, product_type_id, slug, name_ar, name_en)
select 'b0000000-0000-4000-8000-0000000000b1', current_setting('t.b')::uuid, (select id from public.marketplace_product_types limit 1), 'pr8-test-product-b', 'منتج', 'PR8 product B';
select set_config('app.marketplace_seller_write', 'off', true);

-- ===========================================================================
-- A. Shape
-- ===========================================================================
select is((select bool_and(relrowsecurity) from pg_class where oid in (
  'public.marketplace_seller_delivery_settings'::regclass, 'public.marketplace_free_shipping_products'::regclass,
  'public.marketplace_seller_settings_events'::regclass)), true, 'A1. the three new tables have RLS on');
select is((select count(*)::int from information_schema.role_table_grants
           where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role') and privilege_type <> 'SELECT'
             and table_name in ('marketplace_seller_delivery_settings', 'marketplace_free_shipping_products', 'marketplace_seller_settings_events')), 0,
  'A2. no client write grant on the new tables');
select is((select count(*)::int from information_schema.role_table_grants
           where table_schema = 'public' and grantee = 'anon' and table_name in ('marketplace_seller_delivery_settings', 'marketplace_free_shipping_products', 'marketplace_seller_settings_events')), 0,
  'A3. anon has no grant at all');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('marketplace_seller_commerce_readiness', 'marketplace_seller_delivery_terms_save', 'marketplace_seller_free_shipping_products_get', 'marketplace_seller_product_free_shipping_set')
             and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=""')
             and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
             and not has_function_privilege('service_role', p.oid, 'execute')), 4,
  'A4. the four new RPCs are SECURITY DEFINER, empty search_path, authenticated-only');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'app' and p.proname in ('marketplace_seller_commerce_missing', 'marketplace_settings_event')
             and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))), 0,
  'A5. the internal helpers (readiness list, audit writer) have no client grant');

-- ===========================================================================
-- E (start) + B. Terms
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select is(public.marketplace_seller_commerce_readiness(current_setting('t.a')::uuid),
  '{"complete": false, "delivery_complete": false, "payment_complete": false,
    "missing": ["preparation_days_missing", "delivery_option_missing", "payment_method_missing"]}'::jsonb,
  'E1. nothing configured: preparation, a way to receive and a payment method are missing');
select is(public.marketplace_seller_delivery_get(current_setting('t.a')::uuid) -> 'settings',
  '{"preparation_days": null, "free_shipping_min_egp": null, "pickup_instructions": null}'::jsonb,
  'B1. the settings read is empty for a new showroom');
select is(public.marketplace_seller_delivery_areas_save(current_setting('t.a')::uuid, jsonb_build_array(
    jsonb_build_object('governorate_key', 'cairo'),
    jsonb_build_object('governorate_key', 'cairo', 'area_key', current_setting('t.cairo_area')))), '{"saved": 2}'::jsonb,
  'B2. the old areas save still works');
select is(public.marketplace_seller_commerce_readiness(current_setting('t.a')::uuid) -> 'missing',
  '["preparation_days_missing", "delivery_area_unpriced", "delivery_area_duration_missing", "payment_method_missing"]'::jsonb,
  'E2. covered but unpriced places without duration are reported');
select is(public.marketplace_seller_delivery_prices_save(current_setting('t.a')::uuid,
    jsonb_build_array(jsonb_build_object('governorate_key', 'cairo', 'fee_egp', 50))), '{"saved": 1}'::jsonb,
  'B3. the old prices save still works');
select is(((public.marketplace_seller_delivery_terms_save(current_setting('t.a')::uuid,
    jsonb_build_object('preparation_days', 2, 'free_shipping_min_egp', 5000, 'pickup_instructions', ' Ask at reception '),
    jsonb_build_array(
      jsonb_build_object('governorate_key', 'cairo', 'fee_egp', 60, 'duration_min_days', 1, 'duration_max_days', 3,
                         'next_day_available', true, 'next_day_fee_egp', 40),
      jsonb_build_object('governorate_key', 'cairo', 'area_key', current_setting('t.cairo_area'), 'fee_egp', 0,
                         'duration_min_days', 1, 'duration_max_days', 1, 'free_shipping_min_egp', 1000)))) -> 'settings'),
  '{"preparation_days": 2, "free_shipping_min_egp": 5000.00, "pickup_instructions": "Ask at reception"}'::jsonb,
  'B4. terms save stores preparation, minimum and trimmed pickup instructions');
select is((select r from jsonb_array_elements(public.marketplace_seller_delivery_get(current_setting('t.a')::uuid) -> 'rates') r where r ->> 'area_key' is null),
  '{"governorate_key":"cairo","area_key":null,"fee_egp":60.00,"duration_min_days":1,"duration_max_days":3,"next_day_available":true,"next_day_fee_egp":40.00,"free_shipping_min_egp":null}'::jsonb,
  'B5. the governorate row carries fee, duration and the next-day option');
select is((select (r ->> 'free_shipping_min_egp')::numeric from jsonb_array_elements(public.marketplace_seller_delivery_get(current_setting('t.a')::uuid) -> 'rates') r where r ->> 'area_key' is not null), 1000.00,
  'B6. the area row carries its own free-shipping minimum');
select is(public.marketplace_seller_delivery_terms_save(current_setting('t.a')::uuid, '{"free_shipping_min_egp": null}'::jsonb) -> 'settings' ->> 'preparation_days', '2',
  'B7. a missing key keeps the stored value (areas = null leaves places untouched)');
select is(public.marketplace_seller_delivery_get(current_setting('t.a')::uuid) -> 'settings' -> 'free_shipping_min_egp', 'null'::jsonb,
  'B8. an explicit null clears the free-shipping minimum');

select throws_ok($$select public.marketplace_seller_delivery_terms_save(current_setting('t.a')::uuid, '{"preparation_days": 31}'::jsonb)$$, '22023', 'mp:preparation_days_invalid', 'B9. preparation days above 30 are refused');
select is(public.marketplace_seller_delivery_terms_save(current_setting('t.a')::uuid, '{"order_cutoff_time": "14:30"}'::jsonb) -> 'settings' ? 'order_cutoff_time', false,
  'B10. there is no order cut-off (the Marketplace runs 24h): the key is ignored and never stored or returned');
select throws_ok($$select public.marketplace_seller_delivery_terms_save(current_setting('t.a')::uuid, '{"free_shipping_min_egp": 0}'::jsonb)$$, '22023', 'mp:free_shipping_invalid', 'B11. a zero free-shipping minimum is refused');
select throws_ok($$select public.marketplace_seller_delivery_terms_save(current_setting('t.a')::uuid, '{}'::jsonb, jsonb_build_array(jsonb_build_object('governorate_key', 'cairo', 'duration_min_days', 3, 'duration_max_days', 1)))$$, '22023', 'mp:duration_invalid:1', 'B12. min above max duration is refused');
select throws_ok($$select public.marketplace_seller_delivery_terms_save(current_setting('t.a')::uuid, '{}'::jsonb, jsonb_build_array(jsonb_build_object('governorate_key', 'cairo', 'duration_min_days', 3)))$$, '22023', 'mp:duration_invalid:1', 'B13. only one duration bound is refused');
select throws_ok($$select public.marketplace_seller_delivery_terms_save(current_setting('t.a')::uuid, '{}'::jsonb, jsonb_build_array(jsonb_build_object('governorate_key', 'cairo', 'next_day_available', true)))$$, '22023', 'mp:next_day_fee_invalid:1', 'B14. next day without a fee is refused');
select throws_ok($$select public.marketplace_seller_delivery_terms_save(current_setting('t.a')::uuid, '{}'::jsonb, jsonb_build_array(jsonb_build_object('governorate_key', 'cairo', 'next_day_fee_egp', 10)))$$, '22023', 'mp:next_day_fee_invalid:1', 'B15. a next-day fee without the option is refused');
select throws_ok($$select public.marketplace_seller_delivery_terms_save(current_setting('t.a')::uuid, '{}'::jsonb, jsonb_build_array(jsonb_build_object('governorate_key', 'giza')))$$, '22023', 'mp:delivery_area_unknown:giza/', 'B16. a place that is not covered is refused (coverage cannot widen)');
select throws_ok($$select public.marketplace_seller_delivery_terms_save(current_setting('t.a')::uuid, '{"preparation_days": 5}'::jsonb, jsonb_build_array(jsonb_build_object('governorate_key', 'giza')))$$, '22023', 'mp:delivery_area_unknown:giza/', 'B17. a refusal in the places...');
select is(public.marketplace_seller_delivery_get(current_setting('t.a')::uuid) -> 'settings' ->> 'preparation_days', '2', 'B18. ...rolls the settings back too');

-- ===========================================================================
-- C. Payment
-- ===========================================================================
select is(public.marketplace_seller_payment_settings_save(current_setting('t.a')::uuid,
  '{"cod_enabled": true, "instapay_enabled": false}'::jsonb) ->> 'instapay_full_enabled', 'false', 'C1. an old-style save works and reports full = false');
select throws_ok($$select public.marketplace_seller_payment_settings_save(current_setting('t.a')::uuid, '{"instapay_full_enabled": true}'::jsonb)$$, '23514', 'mp:instapay_address_required', 'C2. InstaPay (full) needs the address');
select is((public.marketplace_seller_payment_settings_save(current_setting('t.a')::uuid,
  '{"cod_enabled": false, "instapay_full_enabled": true, "instapay_address": "shop@instapay", "instapay_account_name": "Shop"}'::jsonb) ->> 'instapay_full_enabled'), 'true',
  'C3. InstaPay (full) saves without a deposit share');
select is(public.marketplace_seller_payment_settings_save(current_setting('t.a')::uuid,
  '{"cod_enabled": false, "instapay_enabled": false, "instapay_address": "shop@instapay", "instapay_account_name": "Shop"}'::jsonb) ->> 'instapay_full_enabled', 'true',
  'C4. a caller that does not send the new key keeps the stored value');
select throws_ok($$select public.marketplace_seller_payment_settings_save(current_setting('t.a')::uuid, '{"instapay_enabled": "yes"}'::jsonb)$$, '22023', 'mp:invalid_payload', 'C5. a non-boolean flag is refused');

-- ===========================================================================
-- D. Free shipping per product
-- ===========================================================================
select is(public.marketplace_seller_product_free_shipping_set(current_setting('t.a')::uuid, 'a0000000-0000-4000-8000-0000000000a1', true), '{"product_id":"a0000000-0000-4000-8000-0000000000a1","free_shipping":true}'::jsonb, 'D1. a product is flagged free-shipping');
select is((public.marketplace_seller_free_shipping_products_get(current_setting('t.a')::uuid, 'PR8') -> 'items' -> 0 ->> 'free_shipping'), 'true', 'D2. the list shows it, flagged first');
select is((public.marketplace_seller_free_shipping_products_get(current_setting('t.a')::uuid) ->> 'flagged_count'), '1', 'D3. the flagged count');
select throws_ok($$select public.marketplace_seller_product_free_shipping_set(current_setting('t.a')::uuid, 'b0000000-0000-4000-8000-0000000000b1', true)$$, '42501', 'mp:not_found', 'D4. another showroom''s product cannot be flagged');
select is(public.marketplace_seller_product_free_shipping_set(current_setting('t.a')::uuid, 'a0000000-0000-4000-8000-0000000000a1', false) ->> 'free_shipping', 'false', 'D5. the flag is removed');

-- ===========================================================================
-- E. Readiness, complete
-- ===========================================================================
select is(public.marketplace_seller_commerce_readiness(current_setting('t.a')::uuid) -> 'missing', '[]'::jsonb, 'E3. fully configured: nothing missing');
select is(public.marketplace_seller_commerce_readiness(current_setting('t.a')::uuid) -> 'complete', 'true'::jsonb, 'E4. complete = true');
select is(public.marketplace_seller_delivery_terms_save(current_setting('t.a')::uuid, '{}'::jsonb,
  jsonb_build_array(jsonb_build_object('governorate_key', 'cairo', 'fee_egp', 60))) -> 'missing', '["delivery_area_duration_missing"]'::jsonb,
  'E5. clearing a place''s duration is reported again');

-- ===========================================================================
-- F. Authz and audit
-- ===========================================================================
set local request.jwt.claims = '{"sub":"70000002-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_ok($$select public.marketplace_seller_delivery_terms_save(current_setting('t.a')::uuid, '{"preparation_days": 1}'::jsonb)$$, '42501', 'mp:not_permitted', 'F1. a sales-only member cannot save delivery terms');
select is(public.marketplace_seller_commerce_readiness(current_setting('t.a')::uuid) -> 'complete', 'false'::jsonb, 'F2. but a member can read readiness');
set local request.jwt.claims = '{"sub":"71000005-0000-4000-8000-000000000005","role":"authenticated"}';
select throws_ok($$select public.marketplace_seller_commerce_readiness(current_setting('t.a')::uuid)$$, '42501', 'mp:not_found', 'F3. another showroom cannot read it');
select is((select count(*)::int from public.marketplace_seller_settings_events where seller_organization_id = current_setting('t.a')::uuid), 0, 'F4. nor the audit trail (RLS)');
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select cmp_ok((select count(*)::int from public.marketplace_seller_settings_events where seller_organization_id = current_setting('t.a')::uuid), '>=', 8, 'F5. the owner sees the audit trail of the changes above');
select throws_ok($$update public.marketplace_seller_settings_events set kind = 'payment'$$, '42501', null, 'F6. the audit trail cannot be edited by a client');
reset role;
select throws_ok($$update public.marketplace_seller_settings_events set kind = 'payment'$$, '23514', null, 'F7. nor by anyone else (append-only)');
set local role anon;
select throws_ok($$select public.marketplace_seller_commerce_readiness(current_setting('t.a')::uuid)$$, '42501', null, 'F8. anon cannot call the readiness read');

select * from finish();
rollback;
