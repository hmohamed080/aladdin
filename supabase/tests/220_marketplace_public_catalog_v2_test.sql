-- pgTAP: Marketplace PR 9 — public catalog v2 (20261123130001_marketplace_public_catalog_v2.sql)
--
--   A. SHAPE      — grants: the public reads are anon-callable, the internal helpers are not.
--   B. VISIBILITY — published + enabled + in stock only; stock-out withdraws the product everywhere; suspended seller; privacy.
--   C. CARD       — seller slug, official-store flag, "only N left", free shipping by a free (0) delivery fee, seller filter.
--   D. COMPAT     — the old catalog_page signature still answers with the same visibility.
--   E. SWITCH     — Marketplace closed (PR 7 switch): every public read answers as empty. Skipped when PR 7 is not applied.
--
-- Runs with or without PR 7 / PR 8 (the migration degrades). The delivery-estimate rules live in 221.
-- Fixtures (seed-pilot): showroom A 9c000000-…001 (owner 70000001), showroom B 91000005-…005 (owner 71000005).
create extension if not exists pgtap;

begin;
select plan(43);

update auth.users set email_confirmed_at = now()
  where id in ('70000001-0000-4000-8000-000000000001', '71000005-0000-4000-8000-000000000005', '55555555-5555-4555-8555-555555555555');
select set_config('t.a', '9c000000-cccc-4ccc-8ccc-000000000001', true);
select set_config('t.b', '91000005-1111-4111-8111-000000000005', true);
select set_config('app.marketplace_seller_write', 'on', true);
insert into public.marketplace_seller_accounts (organization_id, status, approved_at)
values (current_setting('t.a')::uuid, 'approved', now()), (current_setting('t.b')::uuid, 'approved', now())
on conflict (organization_id) do update set status = 'approved', approved_at = now();
select set_config('app.marketplace_seller_write', 'off', true);
update public.organizations set slug = 'mkt9-showroom-a' where id = current_setting('t.a')::uuid;
update public.organizations set slug = 'mkt9-showroom-b' where id = current_setting('t.b')::uuid;

-- ===========================================================================
-- A. Shape
-- ===========================================================================
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('marketplace_public_status', 'marketplace_public_browse', 'marketplace_public_delivery',
                                                        'marketplace_public_seller', 'marketplace_public_catalog_page', 'marketplace_public_facets', 'marketplace_public_product')
             and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=""')
             and has_function_privilege('anon', p.oid, 'execute') and has_function_privilege('authenticated', p.oid, 'execute')
             and not has_function_privilege('service_role', p.oid, 'execute')), 7,
  'A1. the seven public reads are SECURITY DEFINER, empty search_path, granted to anon + authenticated only');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'app' and p.proname in ('marketplace_public_stock_left',
                                                     'marketplace_product_ships_free', 'marketplace_delivery_terms', 'marketplace_free_shipping')
             and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute')
             and not has_function_privilege('service_role', p.oid, 'execute')), 4,
  'A2. the four internal helpers have no client grant');

-- ===========================================================================
-- Fixtures: A has an in-stock product (CART-like), a zero-stock one and a draft; B has an in-stock one
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('t.pa', (public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'), 'product_type_key', 'wallpaper', 'name_ar', 'ورق حائط تسعة', 'name_en', 'Mkt9 wallpaper A',
  'brand', 'Decore', 'slug', 'mkt9-wallpaper-a', 'attributes', jsonb_build_object('material_wallpaper', 'vinyl'),
  'variants', jsonb_build_array(jsonb_build_object('sku', 'MKT9-A-BEIGE', 'selling_unit', 'roll', 'price_egp', 450,
    'attributes', jsonb_build_object('color', 'beige', 'roll_width', 53, 'roll_length', 1000))))) ->> 'id'), true);
select set_config('t.pz', (public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'), 'product_type_key', 'wallpaper', 'name_ar', 'ورق حائط نافد', 'name_en', 'Mkt9 wallpaper OUT',
  'slug', 'mkt9-wallpaper-out', 'attributes', jsonb_build_object('material_wallpaper', 'vinyl'),
  'variants', jsonb_build_array(jsonb_build_object('sku', 'MKT9-OUT-1', 'selling_unit', 'roll', 'price_egp', 300,
    'attributes', jsonb_build_object('color', 'cream', 'roll_width', 53, 'roll_length', 1000))))) ->> 'id'), true);
select set_config('t.draft', (public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'), 'product_type_key', 'wallpaper', 'name_ar', 'مسودة', 'name_en', 'Mkt9 draft', 'slug', 'mkt9-draft',
  'variants', jsonb_build_array(jsonb_build_object('sku', 'MKT9-DRAFT', 'selling_unit', 'roll', 'price_egp', 1)))) ->> 'id'), true);
select set_config('t.loc', public.marketplace_seller_default_location(current_setting('t.a')::uuid)::text, true);
select public.marketplace_seller_stock_adjust((select id from public.marketplace_product_variants where sku = 'MKT9-A-BEIGE' and seller_organization_id = current_setting('t.a')::uuid),
  current_setting('t.loc')::uuid, 25, 'mkt9-stock-a-0001');
set local request.jwt.claims = '{"sub":"71000005-0000-4000-8000-000000000005","role":"authenticated"}';
select set_config('t.pb', (public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.b'), 'product_type_key', 'cornice', 'name_ar', 'كرنيش تسعة', 'name_en', 'Mkt9 cornice B', 'slug', 'mkt9-cornice-b',
  'attributes', jsonb_build_object('material_cornice', 'pu'),
  'variants', jsonb_build_array(jsonb_build_object('sku', 'MKT9-B-1', 'selling_unit', 'bar', 'price_egp', 320,
    'attributes', jsonb_build_object('length', 2900, 'profile_height', 80))))) ->> 'id'), true);
select set_config('t.locb', public.marketplace_seller_default_location(current_setting('t.b')::uuid)::text, true);
select public.marketplace_seller_stock_adjust((select id from public.marketplace_product_variants where sku = 'MKT9-B-1' and seller_organization_id = current_setting('t.b')::uuid),
  current_setting('t.locb')::uuid, 2, 'mkt9-stock-b-0001');
reset role;
-- publication is gated by the media pipeline; for THIS fixture only, the publication trigger is bypassed
set local session_replication_role = replica;
update public.marketplace_products set status = 'published', published_at = now()
 where id in (current_setting('t.pa')::uuid, current_setting('t.pz')::uuid, current_setting('t.pb')::uuid);
set local session_replication_role = origin;

-- ===========================================================================
-- B. Visibility
-- ===========================================================================
set local role anon;
select set_config('t.browse', public.marketplace_public_browse(p_query => 'mkt9')::text, true);
reset role;
select is((current_setting('t.browse')::jsonb ->> 'total')::int, 2, 'B1. anon sees the two in-stock published products (stock-out and draft are not listed)');
select ok(not (current_setting('t.browse')::jsonb -> 'items' @> '[{"slug":"mkt9-wallpaper-out"}]'), 'B2. the zero-stock product is withdrawn from the catalog');
select ok(not (current_setting('t.browse')::jsonb -> 'items' @> '[{"slug":"mkt9-draft"}]'), 'B3. a draft is not listed');
select is(public.marketplace_public_product('mkt9-wallpaper-out'), null, 'B4. the zero-stock product page is a 404 (null)');
select is(public.marketplace_public_product('mkt9-draft'), null, 'B5. a draft product page is a 404 (null)');
select is(public.marketplace_public_product('mkt9-wallpaper-a') ->> 'seller_slug', 'mkt9-showroom-a', 'B6. the product page names the seller by its public slug');
select ok(position(current_setting('t.a') in current_setting('t.browse')) = 0 and position(current_setting('t.a') in public.marketplace_public_product('mkt9-wallpaper-a')::text) = 0,
  'B7. no organization id leaves the database (catalog and product)');
-- stock arrives for the withdrawn product: it comes back
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select public.marketplace_seller_stock_adjust((select id from public.marketplace_product_variants where sku = 'MKT9-OUT-1'), current_setting('t.loc')::uuid, 9, 'mkt9-stock-out-0001');
reset role;
select ok(public.marketplace_public_product('mkt9-wallpaper-out') is not null, 'B8. restocking brings the product back (the withdrawal is computed, nothing is stored)');
select is((public.marketplace_public_browse(p_query => 'mkt9') ->> 'total')::int, 3, 'B9. ...and into the catalog');
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select public.marketplace_seller_stock_adjust((select id from public.marketplace_product_variants where sku = 'MKT9-OUT-1'), current_setting('t.loc')::uuid, -9, 'mkt9-stock-out-0002');
reset role;
select is((select sum((t ->> 'count')::int)::int from jsonb_array_elements(public.marketplace_public_facets() -> 'categories') c, jsonb_array_elements(c -> 'types') t
           where t ->> 'key' = 'wallpaper'), (select count(*)::int from public.marketplace_products p where p.product_type_id = (select id from public.marketplace_product_types where key = 'wallpaper')
           and p.status = 'published' and app.marketplace_product_is_listed(p.id) and app.marketplace_seller_is_public(p.seller_organization_id)),
  'B10. facet counts skip the withdrawn product');
-- suspended seller
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select public.admin_marketplace_seller_suspend(current_setting('t.b')::uuid, 'mkt9 test');
reset role;
select is(public.marketplace_public_product('mkt9-cornice-b'), null, 'B11. a suspended seller''s product page disappears');
select is((public.marketplace_public_browse(p_query => 'cornice b') ->> 'total')::int, 0, 'B12. ...and its card');
select is(public.marketplace_public_seller('mkt9-showroom-b'), null, 'B13. ...and its storefront');
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select public.admin_marketplace_seller_reinstate(current_setting('t.b')::uuid, 'mkt9 test over');
reset role;
-- PR 7: a suspension unpublishes the seller's products and reinstatement does not republish; the fixture republishes
set local session_replication_role = replica;
update public.marketplace_products set status = 'published', published_at = now() where id = current_setting('t.pb')::uuid;
set local session_replication_role = origin;

-- ===========================================================================
-- C. Card and seller storefront
-- ===========================================================================
select is((select i ->> 'seller_slug' from jsonb_array_elements(public.marketplace_public_browse(p_query => 'wallpaper a') -> 'items') i limit 1),
  'mkt9-showroom-a', 'C1. the card carries the seller slug');
select is((select (i -> 'seller_official')::text from jsonb_array_elements(public.marketplace_public_browse(p_query => 'wallpaper a') -> 'items') i limit 1),
  'false', 'C2. a showroom without business verification is not an official store');
set local session_replication_role = replica;
update public.organizations set business_verified_at = now(), business_verification_id = gen_random_uuid() where id = current_setting('t.a')::uuid;
set local session_replication_role = origin;
select is((select (i -> 'seller_official')::text from jsonb_array_elements(public.marketplace_public_browse(p_query => 'wallpaper a') -> 'items') i limit 1),
  'true', 'C3. a business-verified showroom is an official store (the blue badge)');
select is(public.marketplace_public_product('mkt9-wallpaper-a') ->> 'seller_official', 'true', 'C4. ...on the product page too');
select is(public.marketplace_public_seller('mkt9-showroom-a') ->> 'official', 'true', 'C5. ...and on its storefront');
select is((public.marketplace_public_seller('mkt9-showroom-b') ->> 'product_count')::int, 1, 'C6. the storefront counts only shelf products');
select is(public.marketplace_public_seller('does-not-exist'), null, 'C7. an unknown seller is null');
select is(public.marketplace_public_seller('Not A Slug!'), null, 'C8. a malformed slug is refused quietly');
select is((public.marketplace_public_browse(p_seller => 'mkt9-showroom-b') ->> 'total')::int, 1, 'C9. the seller filter lists only that showroom');
select is((select i ->> 'stock_left' from jsonb_array_elements(public.marketplace_public_browse(p_seller => 'mkt9-showroom-b') -> 'items') i limit 1),
  '2', 'C10. 2 units left: the card says "only 2 left"');
select is((select i ->> 'stock_left' from jsonb_array_elements(public.marketplace_public_browse(p_query => 'wallpaper a') -> 'items') i limit 1),
  null, 'C11. 25 units: no stock number is published');
select is((public.marketplace_public_product('mkt9-cornice-b') -> 'variants' -> 0 ->> 'stock_left'), '2', 'C12. the product page variant carries the same "only N left"');
-- free shipping through an explicit free delivery fee (works with or without PR 8)
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000005-0000-4000-8000-000000000005","role":"authenticated"}';
select public.marketplace_seller_delivery_areas_save(current_setting('t.b')::uuid, '[{"governorate_key":"cairo"}]'::jsonb);
select public.marketplace_seller_delivery_prices_save(current_setting('t.b')::uuid, '[{"governorate_key":"cairo","fee_egp":0}]'::jsonb);
reset role;
select is((select (i -> 'free_shipping')::text from jsonb_array_elements(public.marketplace_public_browse(p_seller => 'mkt9-showroom-b', p_governorate => 'cairo') -> 'items') i limit 1),
  'true', 'C13. a 0 delivery fee to the chosen place ships free');
select is((public.marketplace_public_browse(p_seller => 'mkt9-showroom-b', p_governorate => 'cairo', p_free_shipping => true) ->> 'total')::int, 1,
  'C14. the free-shipping filter keeps it');
select is((public.marketplace_public_browse(p_query => 'wallpaper a', p_governorate => 'cairo', p_free_shipping => true) ->> 'total')::int, 0,
  'C15. ...and drops a showroom that charges for delivery');
select is(public.marketplace_public_delivery('mkt9-cornice-b', 'cairo') ->> 'status', 'available', 'C16. the delivery block resolves the chosen place');
select is(public.marketplace_public_delivery('mkt9-cornice-b', 'cairo') ->> 'free_reason', 'free_delivery', 'C17. ...and says why it is free');
select is(public.marketplace_public_delivery('mkt9-cornice-b', 'alexandria') ->> 'status', 'not_available', 'C18. a place the showroom does not cover is not_available');
select is(public.marketplace_public_delivery('mkt9-cornice-b') ->> 'status', 'needs_area', 'C19. with no place the block asks for one');
select is(public.marketplace_public_delivery('mkt9-draft', 'cairo'), null, 'C20. no delivery block for a product that is not public');

-- ===========================================================================
-- D. Compatibility: the old signature
-- ===========================================================================
select is((public.marketplace_public_catalog_page(p_query => 'mkt9', p_in_stock => true) ->> 'total')::int,
          (public.marketplace_public_browse(p_query => 'mkt9') ->> 'total')::int, 'D1. the old catalog_page signature answers with the same visibility');
select ok(public.marketplace_public_catalog_page() -> 'items' -> 0 ?& array['slug', 'name_ar', 'from_price_egp', 'in_stock', 'variant_count', 'colors', 'image_id', 'seller_name'],
  'D2. ...and still carries every key the previous storefront reads');

-- ===========================================================================
-- E. The open/close switch (PR 7)
-- ===========================================================================
select set_config('t.pr7', (to_regprocedure('app.marketplace_is_open()') is not null)::text, true);
do $$ begin
  if current_setting('t.pr7')::boolean then
    execute 'update public.marketplace_platform_settings set marketplace_open = false where singleton';
  end if;
end $$;
select case when current_setting('t.pr7')::boolean then is((public.marketplace_public_status() ->> 'open')::boolean, false, 'E1. a closed Marketplace reports open = false') else skip(1, 'PR 7 not applied') end;
select case when current_setting('t.pr7')::boolean then is((public.marketplace_public_browse() ->> 'total')::int, 0, 'E2. ...the catalog is empty') else skip(1, 'PR 7 not applied') end;
select case when current_setting('t.pr7')::boolean then is(public.marketplace_public_product('mkt9-wallpaper-a'), null, 'E3. ...product pages are null') else skip(1, 'PR 7 not applied') end;
select case when current_setting('t.pr7')::boolean then is(public.marketplace_public_seller('mkt9-showroom-a'), null, 'E4. ...storefronts are null') else skip(1, 'PR 7 not applied') end;
select case when current_setting('t.pr7')::boolean then is(jsonb_array_length(public.marketplace_public_facets() -> 'categories') > 0 and (select sum((c ->> 'count')::int) from jsonb_array_elements(public.marketplace_public_facets() -> 'categories') c) = 0, true, 'E5. ...and facets count nothing') else skip(1, 'PR 7 not applied') end;
select case when current_setting('t.pr7')::boolean then is(public.marketplace_public_delivery('mkt9-cornice-b', 'cairo'), null, 'E6. ...and so is the delivery block') else skip(1, 'PR 7 not applied') end;

select * from finish();
rollback;
