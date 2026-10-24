-- pgTAP: Marketplace Migration 12 — delivery prices by area + the public cart read
-- (20261019090002_marketplace_delivery_and_cart.sql).
--
--   A. SHAPE     — table RLS / no client write grant; the three functions' privileges.
--   B. SAVE      — a showroom chooses WHERE it delivers (areas) and WHAT it charges there (prices): validation, atomicity.
--   C. AUTHZ     — other showroom / sales-only member / outsider / anon / suspended seller.
--   D. CART      — lines resolve against the LIVE catalogue; unavailable lines say only that;
--                  delivery is priced per showroom (area, else governorate default, else not available).
--   E. PRIVACY   — nothing about a showroom's organization leaves the database; no image while the media flag is off.
--
-- Fixtures (seed-pilot): showroom A 9c000000-…001 (owner 70000001; 70000002 is a sales-only member),
-- showroom B 91000005-…005 (owner 71000005), outsider 70000009, staff 55555555 (administrator).
create extension if not exists pgtap;

begin;
select plan(91);

update auth.users set email_confirmed_at = now()
  where id in ('70000001-0000-4000-8000-000000000001', '70000002-0000-4000-8000-000000000002',
               '71000005-0000-4000-8000-000000000005', '70000009-0000-4000-8000-000000000009',
               '55555555-5555-4555-8555-555555555555');
select set_config('t.a', '9c000000-cccc-4ccc-8ccc-000000000001', true);
select set_config('t.b', '91000005-1111-4111-8111-000000000005', true);
select set_config('app.marketplace_seller_write', 'on', true);
insert into public.marketplace_seller_accounts (organization_id, status, approved_at)
values (current_setting('t.a')::uuid, 'approved', now()), (current_setting('t.b')::uuid, 'approved', now())
on conflict (organization_id) do update set status = 'approved', approved_at = now();
select set_config('app.marketplace_seller_write', 'off', true);
-- two real area keys per governorate, from the platform's own catalogue
select set_config('t.cairo_area', (select min(key) from app.place_cities where governorate_key = 'cairo'), true);
select set_config('t.cairo_area2', (select max(key) from app.place_cities where governorate_key = 'cairo'), true);
select set_config('t.giza_area', (select min(key) from app.place_cities where governorate_key = 'giza'), true);

-- ===========================================================================
-- A. Shape
-- ===========================================================================
select is((select relrowsecurity from pg_class where oid = 'public.marketplace_delivery_rates'::regclass), true, 'A1. the price list has RLS on');
select is((select count(*)::int from information_schema.role_table_grants
           where table_schema = 'public' and table_name = 'marketplace_delivery_rates'
             and grantee in ('anon', 'authenticated', 'service_role') and privilege_type <> 'SELECT'), 0,
  'A2. no client write grant on the price list');
select is((select array_agg(policyname::text order by policyname::text) from pg_policies
           where schemaname = 'public' and tablename = 'marketplace_delivery_rates'),
  array['marketplace_delivery_rates_select_owner', 'marketplace_delivery_rates_select_staff'],
  'A3. only member + staff SELECT policies (no write policy)');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('marketplace_seller_delivery_get', 'marketplace_seller_delivery_areas_save', 'marketplace_seller_delivery_prices_save', 'marketplace_seller_pickup_set', 'marketplace_public_cart')
             and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=""')), 5,
  'A4. the five functions are SECURITY DEFINER with an empty search_path');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('marketplace_seller_delivery_get', 'marketplace_seller_delivery_areas_save', 'marketplace_seller_delivery_prices_save', 'marketplace_seller_pickup_set')
             and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
             and not has_function_privilege('service_role', p.oid, 'execute')), 4,
  'A5. the showroom RPCs are authenticated-only (never anon, never a service credential)');
select ok(has_function_privilege('anon', 'public.marketplace_public_cart(jsonb,text,text)', 'execute')
      and has_function_privilege('authenticated', 'public.marketplace_public_cart(jsonb,text,text)', 'execute'),
  'A6. the public cart read is granted to anon and authenticated');
select is((select count(*)::int from information_schema.role_table_grants
           where table_schema = 'public' and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT'
             and table_name like 'marketplace\_%'), 0, 'A7. still no client write grant on any marketplace table');

-- ===========================================================================
-- B. Save
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
-- B1-B8: WHERE the showroom delivers (areas)
select is(public.marketplace_seller_delivery_get(current_setting('t.a')::uuid) -> 'rates', '[]'::jsonb, 'B1. a new showroom delivers nowhere (empty list)');
select is((public.marketplace_seller_delivery_areas_save(current_setting('t.a')::uuid, jsonb_build_array(
    jsonb_build_object('governorate_key', 'cairo'),
    jsonb_build_object('governorate_key', 'cairo', 'area_key', current_setting('t.cairo_area')),
    jsonb_build_object('governorate_key', 'giza'))) ->> 'saved')::int, 3, 'B2. the owner adds three places');
select is(jsonb_array_length(public.marketplace_seller_delivery_get(current_setting('t.a')::uuid) -> 'rates'), 3, 'B3. ...and reads them back');
select is((select count(*)::int from jsonb_array_elements(public.marketplace_seller_delivery_get(current_setting('t.a')::uuid) -> 'rates') r
           where r -> 'fee_egp' = 'null'::jsonb), 3, 'B4. a newly added place has NO price yet');
select is(public.marketplace_seller_delivery_get(current_setting('t.a')::uuid) -> 'rates' -> 0 ->> 'area_key', null,
  'B5. a governorate comes before its areas');
select is((public.marketplace_seller_delivery_prices_save(current_setting('t.a')::uuid, jsonb_build_array(
    jsonb_build_object('governorate_key', 'cairo', 'fee_egp', 80),
    jsonb_build_object('governorate_key', 'cairo', 'area_key', current_setting('t.cairo_area'), 'fee_egp', '100.50'),
    jsonb_build_object('governorate_key', 'giza', 'fee_egp', 0))) ->> 'saved')::int, 3, 'B6. the owner prices the places she added');
select is((select (r ->> 'fee_egp')::numeric from jsonb_array_elements(public.marketplace_seller_delivery_get(current_setting('t.a')::uuid) -> 'rates') r
           where r ->> 'governorate_key' = 'cairo' and r ->> 'area_key' is null), 80.00, 'B7. the governorate price is saved');
select is((select (r ->> 'fee_egp')::numeric from jsonb_array_elements(public.marketplace_seller_delivery_get(current_setting('t.a')::uuid) -> 'rates') r
           where r ->> 'governorate_key' = 'giza'), 0.00, 'B8. a free delivery is an explicit 0');
-- changing the set keeps the price of a place that stays, adds the new one unpriced, drops the rest
select is((public.marketplace_seller_delivery_areas_save(current_setting('t.a')::uuid, jsonb_build_array(
    jsonb_build_object('governorate_key', 'cairo'), jsonb_build_object('governorate_key', 'alexandria'))) ->> 'saved')::int, 2,
  'B9. the set of places can be replaced');
select is((select (r ->> 'fee_egp')::numeric from jsonb_array_elements(public.marketplace_seller_delivery_get(current_setting('t.a')::uuid) -> 'rates') r
           where r ->> 'governorate_key' = 'cairo'), 80.00, 'B10. a place that stays KEEPS its price');
select is((select count(*)::int from jsonb_array_elements(public.marketplace_seller_delivery_get(current_setting('t.a')::uuid) -> 'rates') r
           where r ->> 'governorate_key' = 'alexandria' and r -> 'fee_egp' = 'null'::jsonb), 1, 'B11. a new place starts unpriced');
select is(jsonb_array_length(public.marketplace_seller_delivery_get(current_setting('t.a')::uuid) -> 'rates'), 2, 'B12. a place that is left out is gone (with its price)');
select throws_like(format($$ select public.marketplace_seller_delivery_areas_save(%L::uuid, '[{"governorate_key":"atlantis"}]'::jsonb) $$, current_setting('t.a')),
  'mp:delivery_location_invalid:atlantis%', 'B13. an unknown governorate is refused');
select throws_like(format($$ select public.marketplace_seller_delivery_areas_save(%L::uuid, %L::jsonb) $$, current_setting('t.a'),
  jsonb_build_array(jsonb_build_object('governorate_key', 'cairo', 'area_key', current_setting('t.giza_area')))::text),
  'mp:delivery_location_invalid:cairo/%', 'B14. an area of ANOTHER governorate is refused');
select throws_like(format($$ select public.marketplace_seller_delivery_areas_save(%L::uuid, '[{"governorate_key":"cairo"},{"governorate_key":"CAIRO"}]'::jsonb) $$, current_setting('t.a')),
  'mp:delivery_duplicate:cairo/%', 'B15. the same place twice is refused (case-insensitively)');
select throws_like(format($$ select public.marketplace_seller_delivery_areas_save(%L::uuid, '{"governorate_key":"cairo"}'::jsonb) $$, current_setting('t.a')),
  'mp:delivery_invalid%', 'B16. a payload that is not a list is refused');
select throws_like(format($$ select public.marketplace_seller_delivery_areas_save(%L::uuid, (select jsonb_agg(jsonb_build_object('governorate_key', 'cairo')) from generate_series(1, 2001) n)) $$, current_setting('t.a')),
  'mp:delivery_too_many%', 'B17. more than 2000 places are refused');
select is(jsonb_array_length(public.marketplace_seller_delivery_get(current_setting('t.a')::uuid) -> 'rates'), 2,
  'B18. every refused save left the places untouched (atomic)');
-- B19-B30: WHAT the showroom charges (prices), only for places it covers
select throws_like(format($$ select public.marketplace_seller_delivery_prices_save(%L::uuid, '[{"governorate_key":"cairo","fee_egp":-1}]'::jsonb) $$, current_setting('t.a')),
  'mp:delivery_fee_invalid:1%', 'B19. a negative fee is refused');
select throws_like(format($$ select public.marketplace_seller_delivery_prices_save(%L::uuid, '[{"governorate_key":"cairo","fee_egp":"abc"}]'::jsonb) $$, current_setting('t.a')),
  'mp:delivery_fee_invalid:1%', 'B20. a non-numeric fee is refused');
select throws_like(format($$ select public.marketplace_seller_delivery_prices_save(%L::uuid, '[{"governorate_key":"cairo","fee_egp":100001}]'::jsonb) $$, current_setting('t.a')),
  'mp:delivery_fee_invalid:1%', 'B21. a fee above 100000 is refused');
select throws_like(format($$ select public.marketplace_seller_delivery_prices_save(%L::uuid, '[{"governorate_key":"cairo","fee_egp":"10.123"}]'::jsonb) $$, current_setting('t.a')),
  'mp:delivery_fee_invalid:1%', 'B22. more than two decimals is refused');
select throws_like(format($$ select public.marketplace_seller_delivery_prices_save(%L::uuid, '[{"governorate_key":"giza","fee_egp":10}]'::jsonb) $$, current_setting('t.a')),
  'mp:delivery_area_unknown:giza/%', 'B23. a price for a place the showroom does not cover is refused');
select throws_like(format($$ select public.marketplace_seller_delivery_prices_save(%L::uuid, '[{"governorate_key":"cairo","fee_egp":10},{"governorate_key":"cairo","fee_egp":20}]'::jsonb) $$, current_setting('t.a')),
  'mp:delivery_duplicate:cairo/%', 'B24. the same place twice is refused');
select throws_like(format($$ select public.marketplace_seller_delivery_prices_save(%L::uuid, '{"governorate_key":"cairo"}'::jsonb) $$, current_setting('t.a')),
  'mp:delivery_invalid%', 'B25. a payload that is not a list is refused');
select throws_like(format($$ select public.marketplace_seller_delivery_prices_save(%L::uuid, '[{"governorate_key":"cairo","fee_egp":55},{"governorate_key":"alexandria","fee_egp":"x"}]'::jsonb) $$, current_setting('t.a')),
  'mp:delivery_fee_invalid:2%', 'B26. a bad price anywhere refuses the whole call');
select is((select (r ->> 'fee_egp')::numeric from jsonb_array_elements(public.marketplace_seller_delivery_get(current_setting('t.a')::uuid) -> 'rates') r
           where r ->> 'governorate_key' = 'cairo'), 80.00, 'B27. ...and no price before it was changed (atomic)');
select is((public.marketplace_seller_delivery_prices_save(current_setting('t.a')::uuid, '[{"governorate_key":"alexandria","fee_egp":150}]'::jsonb) ->> 'saved')::int, 1,
  'B28. prices can be set for some places only');
select is((select (r ->> 'fee_egp')::numeric from jsonb_array_elements(public.marketplace_seller_delivery_get(current_setting('t.a')::uuid) -> 'rates') r
           where r ->> 'governorate_key' = 'cairo'), 80.00, 'B29. ...the places that were not listed keep their price');
select public.marketplace_seller_delivery_prices_save(current_setting('t.a')::uuid, '[{"governorate_key":"cairo","fee_egp":null}]'::jsonb);
select is((select r -> 'fee_egp' from jsonb_array_elements(public.marketplace_seller_delivery_get(current_setting('t.a')::uuid) -> 'rates') r
           where r ->> 'governorate_key' = 'cairo'), 'null'::jsonb, 'B30. a null price clears it (the place stays covered)');
select is((public.marketplace_seller_delivery_areas_save(current_setting('t.a')::uuid, '[]'::jsonb) ->> 'saved')::int, 0, 'B31. an empty list means "delivers nowhere"');

-- ===========================================================================
-- C. Authorisation
-- ===========================================================================
select public.marketplace_seller_delivery_areas_save(current_setting('t.a')::uuid, '[{"governorate_key":"cairo"}]'::jsonb);
select public.marketplace_seller_delivery_prices_save(current_setting('t.a')::uuid, '[{"governorate_key":"cairo","fee_egp":80}]'::jsonb);
set local request.jwt.claims = '{"sub":"71000005-0000-4000-8000-000000000005","role":"authenticated"}';
select throws_like(format($$ select public.marketplace_seller_delivery_areas_save(%L::uuid, '[]'::jsonb) $$, current_setting('t.a')),
  'mp:not_permitted%', 'C1. another showroom cannot change showroom A''s places');
select throws_like(format($$ select public.marketplace_seller_delivery_prices_save(%L::uuid, '[]'::jsonb) $$, current_setting('t.a')),
  'mp:not_permitted%', 'C1b. ...nor its prices');
select throws_like(format($$ select public.marketplace_seller_delivery_get(%L::uuid) $$, current_setting('t.a')),
  'mp:not_found%', 'C2. ...nor read them through the RPC');
select is((select count(*)::int from public.marketplace_delivery_rates where seller_organization_id = current_setting('t.a')::uuid), 0,
  'C3. ...nor see them through the table (RLS)');
set local request.jwt.claims = '{"sub":"70000002-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_like(format($$ select public.marketplace_seller_delivery_areas_save(%L::uuid, '[]'::jsonb) $$, current_setting('t.a')),
  'mp:not_permitted%', 'C4. a member WITHOUT catalogue authority cannot write places');
select throws_like(format($$ select public.marketplace_seller_delivery_prices_save(%L::uuid, '[]'::jsonb) $$, current_setting('t.a')),
  'mp:not_permitted%', 'C4b. ...nor prices');
select lives_ok(format($$ select public.marketplace_seller_delivery_get(%L::uuid) $$, current_setting('t.a')), 'C5. ...but, as a member, can read');
set local request.jwt.claims = '{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';
select throws_like(format($$ select public.marketplace_seller_delivery_get(%L::uuid) $$, current_setting('t.a')), 'mp:not_found%', 'C6. an outsider cannot read');
select throws_ok(format($$ insert into public.marketplace_delivery_rates (seller_organization_id, governorate_key, fee_egp) values (%L::uuid, 'cairo', 1) $$, current_setting('t.a')),
  '42501', null, 'C7. nobody can write the table directly');
reset role;
set local role anon;
select throws_ok(format($$ select public.marketplace_seller_delivery_areas_save(%L::uuid, '[]'::jsonb) $$, current_setting('t.a')), '42501', null, 'C8. anon cannot call the showroom RPCs');
select throws_ok(format($$ select public.marketplace_seller_delivery_prices_save(%L::uuid, '[]'::jsonb) $$, current_setting('t.a')), '42501', null, 'C8b. ...either one');
select throws_ok($$ select count(*) from public.marketplace_delivery_rates $$, '42501', null, 'C9. anon cannot read the table (no grant)');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select public.admin_marketplace_seller_suspend(current_setting('t.a')::uuid, 'delivery test');
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_like(format($$ select public.marketplace_seller_delivery_areas_save(%L::uuid, '[]'::jsonb) $$, current_setting('t.a')),
  'mp:seller_not_enabled%', 'C10. a suspended showroom cannot change its places');
select throws_like(format($$ select public.marketplace_seller_delivery_prices_save(%L::uuid, '[]'::jsonb) $$, current_setting('t.a')),
  'mp:seller_not_enabled%', 'C10b. ...nor its prices');
select lives_ok(format($$ select public.marketplace_seller_delivery_get(%L::uuid) $$, current_setting('t.a')), 'C11. ...but can still read them');
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select public.admin_marketplace_seller_reinstate(current_setting('t.a')::uuid, 'test over');
reset role;

-- ===========================================================================
-- D. The public cart
-- ===========================================================================
-- showroom A: a published product with two variants (one in stock, one out), a draft product
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('t.pa', (public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'), 'product_type_key', 'wallpaper', 'name_ar', 'ورق حائط أ', 'name_en', 'Cart wallpaper A',
  'brand', 'Decore', 'slug', 'cart-wallpaper-a',
  'attributes', jsonb_build_object('material_wallpaper', 'vinyl'),
  'variants', jsonb_build_array(
    jsonb_build_object('sku', 'CART-A-BEIGE', 'selling_unit', 'roll', 'price_egp', 450,
      'attributes', jsonb_build_object('color', 'beige', 'roll_width', 53, 'roll_length', 1000)),
    jsonb_build_object('sku', 'CART-A-CREAM', 'selling_unit', 'roll', 'price_egp', 470,
      'attributes', jsonb_build_object('color', 'cream', 'roll_width', 53, 'roll_length', 1000))))) ->> 'id'), true);
select set_config('t.draft', (public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'), 'product_type_key', 'wallpaper', 'name_ar', 'مسودة', 'name_en', 'Cart draft', 'slug', 'cart-draft',
  'variants', jsonb_build_array(jsonb_build_object('sku', 'CART-A-DRAFT', 'selling_unit', 'roll', 'price_egp', 1)))) ->> 'id'), true);
select set_config('t.loc', public.marketplace_seller_default_location(current_setting('t.a')::uuid)::text, true);
select public.marketplace_seller_stock_adjust((select id from public.marketplace_product_variants where sku = 'CART-A-BEIGE' and seller_organization_id = current_setting('t.a')::uuid),
  current_setting('t.loc')::uuid, 25, 'cart-stock-a-0001');
-- showroom B: a published product in stock
set local request.jwt.claims = '{"sub":"71000005-0000-4000-8000-000000000005","role":"authenticated"}';
select set_config('t.pb', (public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.b'), 'product_type_key', 'cornice', 'name_ar', 'كرنيش ب', 'name_en', 'Cart cornice B', 'slug', 'cart-cornice-b',
  'attributes', jsonb_build_object('material_cornice', 'pu'),
  'variants', jsonb_build_array(jsonb_build_object('sku', 'CART-B-1', 'selling_unit', 'bar', 'price_egp', 320,
    'attributes', jsonb_build_object('length', 2900, 'profile_height', 80))))) ->> 'id'), true);
select set_config('t.locb', public.marketplace_seller_default_location(current_setting('t.b')::uuid)::text, true);
select public.marketplace_seller_stock_adjust((select id from public.marketplace_product_variants where sku = 'CART-B-1' and seller_organization_id = current_setting('t.b')::uuid),
  current_setting('t.locb')::uuid, 8, 'cart-stock-b-0001');
reset role;
-- publication is gated by the media pipeline; for THIS fixture only, the publication trigger is bypassed
set local session_replication_role = replica;
update public.marketplace_products set status = 'published', published_at = now() where id in (current_setting('t.pa')::uuid, current_setting('t.pb')::uuid);
set local session_replication_role = origin;

-- showroom prices: A delivers to Cairo (80) with a Nasr-City style override (100), Giza free; B only to Cairo (120)
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select public.marketplace_seller_delivery_areas_save(current_setting('t.a')::uuid, jsonb_build_array(
  jsonb_build_object('governorate_key', 'cairo'),
  jsonb_build_object('governorate_key', 'cairo', 'area_key', current_setting('t.cairo_area')),
  jsonb_build_object('governorate_key', 'giza'),
  jsonb_build_object('governorate_key', 'luxor')));
select public.marketplace_seller_delivery_prices_save(current_setting('t.a')::uuid, jsonb_build_array(
  jsonb_build_object('governorate_key', 'cairo', 'fee_egp', 80),
  jsonb_build_object('governorate_key', 'cairo', 'area_key', current_setting('t.cairo_area'), 'fee_egp', 100),
  jsonb_build_object('governorate_key', 'giza', 'fee_egp', 0)));
set local request.jwt.claims = '{"sub":"71000005-0000-4000-8000-000000000005","role":"authenticated"}';
select public.marketplace_seller_delivery_areas_save(current_setting('t.b')::uuid, '[{"governorate_key":"cairo"}]'::jsonb);
select public.marketplace_seller_delivery_prices_save(current_setting('t.b')::uuid, '[{"governorate_key":"cairo","fee_egp":120}]'::jsonb);
reset role;

select set_config('t.aname', (select name from public.organizations where id = current_setting('t.a')::uuid), true);
set local role anon;
select set_config('t.cart', public.marketplace_public_cart(jsonb_build_array(
  jsonb_build_object('slug', 'cart-wallpaper-a', 'sku', 'CART-A-BEIGE'),
  jsonb_build_object('slug', 'cart-cornice-b', 'sku', 'CART-B-1')), 'cairo', current_setting('t.cairo_area'))::text, true);
select is((current_setting('t.cart')::jsonb -> 'lines' -> 0 ->> 'status'), 'ok', 'D1. anon resolves a published product''s variant');
select is((current_setting('t.cart')::jsonb -> 'lines' -> 0 ->> 'price_egp')::numeric, 450.00, 'D2. ...with its CURRENT price');
select is((current_setting('t.cart')::jsonb -> 'lines' -> 0 ->> 'available')::int, 25, 'D3. ...and how many can be bought');
select is((current_setting('t.cart')::jsonb -> 'lines' -> 0 -> 'attributes' -> 0 ->> 'key'), 'color', 'D4. ...with its options (colour first)');
select is((current_setting('t.cart')::jsonb -> 'lines' -> 0 ->> 'seller')::int, 1, 'D5. showroom A is showroom #1');
select is((current_setting('t.cart')::jsonb -> 'lines' -> 1 ->> 'seller')::int, 2, 'D6. showroom B is showroom #2 (several showrooms in one cart)');
select is(jsonb_array_length(current_setting('t.cart')::jsonb -> 'sellers'), 2, 'D7. each showroom is reported once');
select is((current_setting('t.cart')::jsonb -> 'sellers' -> 0 -> 'delivery' ->> 'fee_egp')::numeric, 100.00,
  'D8. A: the AREA price beats the governorate default');
select is((current_setting('t.cart')::jsonb -> 'sellers' -> 1 -> 'delivery' ->> 'fee_egp')::numeric, 120.00,
  'D9. B: no area price, so the governorate default applies');
select is(public.marketplace_public_cart(jsonb_build_array(jsonb_build_object('slug', 'cart-wallpaper-a', 'sku', 'CART-A-BEIGE')),
  'cairo', current_setting('t.cairo_area2')) -> 'sellers' -> 0 -> 'delivery' ->> 'fee_egp', '80.00',
  'D10. another area of Cairo falls back to the governorate default');
select is(public.marketplace_public_cart(jsonb_build_array(jsonb_build_object('slug', 'cart-wallpaper-a', 'sku', 'CART-A-BEIGE')),
  'giza') -> 'sellers' -> 0 -> 'delivery' ->> 'fee_egp', '0.00', 'D11. a free delivery is a 0 fee, not "unavailable"');
select is(public.marketplace_public_cart(jsonb_build_array(jsonb_build_object('slug', 'cart-wallpaper-a', 'sku', 'CART-A-BEIGE')),
  'giza') -> 'sellers' -> 0 -> 'delivery' ->> 'status', 'available', 'D12. ...with status available');
select is(public.marketplace_public_cart(jsonb_build_array(jsonb_build_object('slug', 'cart-wallpaper-a', 'sku', 'CART-A-BEIGE')),
  'alexandria') -> 'sellers' -> 0 -> 'delivery' ->> 'status', 'not_available', 'D13. no price for the place = the showroom does not deliver there');
select is(public.marketplace_public_cart(jsonb_build_array(jsonb_build_object('slug', 'cart-wallpaper-a', 'sku', 'CART-A-BEIGE')),
  'luxor') -> 'sellers' -> 0 -> 'delivery' ->> 'status', 'not_available', 'D13b. a place the showroom covers but has not priced yet is NOT deliverable');
select is(public.marketplace_public_cart(jsonb_build_array(jsonb_build_object('slug', 'cart-wallpaper-a', 'sku', 'CART-A-BEIGE')),
  'giza') -> 'sellers' -> 0 ->> 'name', current_setting('t.aname'), 'D14. the showroom is named');
select is(public.marketplace_public_cart(jsonb_build_array(jsonb_build_object('slug', 'cart-wallpaper-a', 'sku', 'CART-A-BEIGE'))) -> 'sellers' -> 0 -> 'delivery' ->> 'status',
  'needs_area', 'D15. without a governorate the answer is "needs_area"');
select is(public.marketplace_public_cart(jsonb_build_array(jsonb_build_object('slug', 'cart-wallpaper-a', 'sku', 'CART-A-BEIGE'))) -> 'sellers' -> 0 ->> 'pickup_available',
  'false', 'D16. pickup is off until the showroom has a pickup location');
-- unavailable lines say nothing else
select is(public.marketplace_public_cart(jsonb_build_array(jsonb_build_object('slug', 'cart-draft', 'sku', 'CART-A-DRAFT'))) -> 'lines' -> 0, '{"sku":"CART-A-DRAFT","slug":"cart-draft","status":"unavailable"}'::jsonb,
  'D17. a DRAFT product is "unavailable" and reveals nothing');
select is(public.marketplace_public_cart(jsonb_build_array(jsonb_build_object('slug', 'no-such-product', 'sku', 'X'))) -> 'lines' -> 0 ->> 'status', 'unavailable', 'D18. an unknown product is "unavailable"');
select is(public.marketplace_public_cart(jsonb_build_array(jsonb_build_object('slug', 'cart-wallpaper-a', 'sku', 'NOPE'))) -> 'lines' -> 0 ->> 'status', 'unavailable', 'D19. an unknown SKU is "unavailable"');
select is(public.marketplace_public_cart(jsonb_build_array(jsonb_build_object('slug', 'cart-wallpaper-a', 'sku', 'CART-A-CREAM'))) -> 'lines' -> 0 ->> 'available', '0',
  'D20. an out-of-stock variant resolves with available = 0');
select is(jsonb_array_length(public.marketplace_public_cart(jsonb_build_array(jsonb_build_object('slug', 'bad slug!', 'sku', '../x'))) -> 'sellers'), 0, 'D21. malformed input is just "unavailable" (no seller, no error)');
select is(public.marketplace_public_cart('[]'::jsonb) , '{"lines": [], "sellers": []}'::jsonb, 'D22. an empty cart answers empty');
select throws_like($$ select public.marketplace_public_cart('{}'::jsonb) $$, 'mp:invalid_lines%', 'D23. a non-list is refused');
select throws_like($$ select public.marketplace_public_cart((select jsonb_agg(jsonb_build_object('slug', 'a', 'sku', 'b')) from generate_series(1, 51))) $$, 'mp:too_many_lines%', 'D24. more than 50 lines are refused');
select throws_like($$ select public.marketplace_public_cart('[]'::jsonb, 'Cairo; drop table x') $$, 'mp:invalid_location%', 'D25. a malformed location is refused');

-- E. privacy
select is(position(current_setting('t.a') in current_setting('t.cart')), 0, 'E1. the answer contains no organization id');
select is(current_setting('t.cart')::jsonb -> 'lines' -> 0 -> 'image_id', 'null'::jsonb, 'E2. no image reference while the media pipeline is off');
reset role;

-- a showroom that stops being enabled makes its lines unavailable at once
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select public.admin_marketplace_seller_suspend(current_setting('t.b')::uuid, 'cart test');
reset role;
set local role anon;
select is(public.marketplace_public_cart(jsonb_build_array(jsonb_build_object('slug', 'cart-cornice-b', 'sku', 'CART-B-1'))) -> 'lines' -> 0 ->> 'status', 'unavailable',
  'E3. a suspended showroom''s product leaves every cart');
reset role;

-- pickup: the showroom turns it on (the main location then supports pickup)
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select is(public.marketplace_seller_pickup_set(current_setting('t.a')::uuid, true) ->> 'pickup_available', 'true', 'E4a. the showroom turns pickup on');
select is((public.marketplace_seller_delivery_get(current_setting('t.a')::uuid) ->> 'pickup_available'), 'true', 'E4b. ...and its own settings show it');
reset role;
set local role anon;
select is(public.marketplace_public_cart(jsonb_build_array(jsonb_build_object('slug', 'cart-wallpaper-a', 'sku', 'CART-A-BEIGE'))) -> 'sellers' -> 0 ->> 'pickup_available', 'true',
  'E4. a pickup-capable location makes pickup available');
reset role;

-- F. pickup switch authorisation
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000005-0000-4000-8000-000000000005","role":"authenticated"}';
select throws_like(format($$ select public.marketplace_seller_pickup_set(%L::uuid, false) $$, current_setting('t.a')),
  'mp:not_permitted%', 'F1. another showroom cannot switch showroom A''s pickup');
set local request.jwt.claims = '{"sub":"70000002-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_like(format($$ select public.marketplace_seller_pickup_set(%L::uuid, false) $$, current_setting('t.a')),
  'mp:not_permitted%', 'F2. a member without catalogue authority cannot either');
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_like(format($$ select public.marketplace_seller_pickup_set(%L::uuid, null) $$, current_setting('t.a')),
  'mp:pickup_invalid%', 'F3. a missing value is refused');
select is(public.marketplace_seller_pickup_set(current_setting('t.a')::uuid, false) ->> 'pickup_available', 'false', 'F4. the showroom turns pickup off');
select is((public.marketplace_seller_delivery_get(current_setting('t.a')::uuid) ->> 'pickup_available'), 'false', 'F5. ...every location stops supporting it');
reset role;
set local role anon;
select throws_ok(format($$ select public.marketplace_seller_pickup_set(%L::uuid, true) $$, current_setting('t.a')), '42501', null, 'F6. anon cannot call it');
reset role;

select * from finish();
rollback;
