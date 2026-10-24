-- pgTAP: Marketplace Migration 06 — trusted seller product writes
-- (20261014090001_marketplace_seller_product_writes.sql).
--
--   A. SHAPE        — definer functions, authenticated-only EXECUTE, private bucket, no grants.
--   B. CREATE       — an approved seller saves a draft with variants and dynamic attributes.
--   C. VALIDATION   — SKU, price, unit, type, attributes, duplicates: precise refusals.
--   D. UPDATE       — edits, variant removal = deactivation, type immutable.
--   E. AUTHZ        — anon, outsiders, members without catalogue authority, other tenants.
--   F. STOCK        — default location, initial / +/- through the ledger, idempotency,
--                     reserved respected, optimistic check, ownership.
--   G. IMAGES       — server-created key, storage policy needs the pending row,
--                     confirm checks real bytes, upload != verified, arrange, remove.
--   H. SUSPENSION   — a suspended seller can read but not write.
--   I. PUBLICATION  — still closed; readiness reports the blockers.
--
-- Fixtures (seed-pilot): showroom A 9c000000-…001 (owner 70000001; 70000002 is a
-- sales-only member), showroom B 91000005-…005 (owner 71000005), outsider 70000009,
-- staff 55555555 (administrator).
create extension if not exists pgtap;

begin;
select plan(76);

update auth.users set email_confirmed_at = now()
  where id in ('70000001-0000-4000-8000-000000000001', '70000002-0000-4000-8000-000000000002',
               '71000005-0000-4000-8000-000000000005', '70000009-0000-4000-8000-000000000009',
               '55555555-5555-4555-8555-555555555555');
select set_config('t.a', '9c000000-cccc-4ccc-8ccc-000000000001', true);
select set_config('t.b', '91000005-1111-4111-8111-000000000005', true);

select set_config('app.marketplace_seller_write', 'on', true);
insert into public.marketplace_seller_accounts (organization_id, status, approved_at)
values (current_setting('t.a')::uuid, 'approved', now()), (current_setting('t.b')::uuid, 'approved', now());
select set_config('app.marketplace_seller_write', 'off', true);

-- ===========================================================================
-- A. Shape
-- ===========================================================================
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'marketplace\_seller\_%'
     and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=""')),
  18, 'A1. the eighteen seller RPCs (nine from Migration 06, two from 07, three from 09, four from 12) are SECURITY DEFINER with an empty search_path');
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'marketplace\_seller\_%'
     and has_function_privilege('authenticated', p.oid, 'execute')
     and not has_function_privilege('anon', p.oid, 'execute')
     and not has_function_privilege('service_role', p.oid, 'execute')),
  18, 'A2. ...executable by authenticated only (never anon, never a service credential)');
select is(
  (select array_agg(p.proname::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app' and p.proname like 'marketplace\_%' and has_function_privilege('authenticated', p.oid, 'execute')),
  array['marketplace_storage_can_delete_image', 'marketplace_storage_can_upload_image', 'marketplace_storage_can_upload_import',
        'marketplace_storage_moderator_can_read', 'marketplace_storage_owns_image'],
  'A3. the only app.marketplace_* functions a client may run are the three storage-policy predicates');
select is((select public from storage.buckets where id = 'marketplace-product-images'), false,
  'A4. the product image bucket is private');
select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT'
     and table_name like 'marketplace\_%'), 0,
  'A5. still no client write grant on any marketplace table');

-- ===========================================================================
-- B. Create a draft
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('t.p1', (public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'),
  'product_type_key', 'wallpaper',
  'name_ar', 'ورق حائط مودرن', 'name_en', 'Modern Wallpaper',
  'description_ar', 'تصميم رخامي فاخر', 'brand', 'Decore', 'external_ref', 'WP-MODERN',
  'attributes', jsonb_build_object('material_wallpaper', 'vinyl_coated', 'washable', true),
  'variants', jsonb_build_array(
    jsonb_build_object('sku', 'WPM-BEIGE', 'selling_unit', 'roll', 'price_egp', '450.00',
                       'attributes', jsonb_build_object('color', 'beige', 'roll_width', 53, 'roll_length', 1000)),
    jsonb_build_object('sku', 'WPM-CREAM', 'selling_unit', 'roll', 'price_egp', 470,
                       'attributes', jsonb_build_object('color', 'cream', 'roll_width', 53, 'roll_length', 1000)))
)) ->> 'id'), true);
reset role;
select ok(current_setting('t.p1')::uuid is not null, 'B1. an approved seller creates a product');
select is((select status from public.marketplace_products where id = current_setting('t.p1')::uuid), 'draft',
  'B2. it is a DRAFT');
select is((select seller_organization_id from public.marketplace_products where id = current_setting('t.p1')::uuid),
  current_setting('t.a')::uuid, 'B3. owned by the caller''s organization');
select is((select count(*)::int from public.marketplace_product_variants where product_id = current_setting('t.p1')::uuid and status = 'active'),
  2, 'B4. both variants exist');
select is((select count(*)::int from public.marketplace_product_attribute_values where product_id = current_setting('t.p1')::uuid),
  2, 'B5. product-level attributes were stored');
select is((select count(*)::int from public.marketplace_variant_attribute_values v
           join public.marketplace_product_variants pv on pv.id = v.variant_id
           where pv.product_id = current_setting('t.p1')::uuid), 6, 'B6. variant-level attributes were stored');
select ok((select slug ~ '^modern-wallpaper-[0-9a-f]{10}$' from public.marketplace_products where id = current_setting('t.p1')::uuid),
  'B7. a URL-safe slug is generated when none is given');
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select is((public.marketplace_seller_product_get(current_setting('t.p1')::uuid) -> 'attributes' ->> 'material_wallpaper'),
  'vinyl_coated', 'B8. the edit read returns the saved attributes by key');
select is(jsonb_array_length(public.marketplace_seller_product_get(current_setting('t.p1')::uuid) -> 'variants'), 2,
  'B9. ...and the variants');
select is((public.marketplace_seller_product_get(current_setting('t.p1')::uuid) -> 'variants' -> 0 -> 'attributes' ->> 'color'),
  'beige', 'B10. ...with their own attributes');

-- ===========================================================================
-- C. Validation
-- ===========================================================================
select throws_like($$ select public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'), 'product_type_key', 'wallpaper', 'name_ar', 'س', 'name_en', 's',
  'variants', jsonb_build_array(jsonb_build_object('sku', 'DUP-1', 'selling_unit', 'roll', 'price_egp', 10),
                                jsonb_build_object('sku', 'dup-1', 'selling_unit', 'roll', 'price_egp', 10)))) $$,
  'mp:duplicate_sku_in_form%', 'C1. the same SKU twice in one form is refused');
select throws_like($$ select public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'), 'product_type_key', 'wallpaper', 'name_ar', 'س', 'name_en', 's',
  'variants', jsonb_build_array(jsonb_build_object('sku', 'WPM-BEIGE', 'selling_unit', 'roll', 'price_egp', 10)))) $$,
  'mp:sku_taken:WPM-BEIGE%', 'C2. a SKU owned by another product of the seller is refused');
select throws_like($$ select public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'), 'product_type_key', 'wallpaper', 'name_ar', 'س', 'name_en', 's',
  'variants', jsonb_build_array(jsonb_build_object('sku', 'BAD SKU', 'selling_unit', 'roll', 'price_egp', 10)))) $$,
  'mp:sku_invalid%', 'C3. a malformed SKU is refused');
select throws_like($$ select public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'), 'product_type_key', 'wallpaper', 'name_ar', 'س', 'name_en', 's',
  'variants', jsonb_build_array(jsonb_build_object('sku', 'P-0', 'selling_unit', 'roll', 'price_egp', 0)))) $$,
  'mp:price_invalid%', 'C4. a zero price is refused');
select throws_like($$ select public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'), 'product_type_key', 'wallpaper', 'name_ar', 'س', 'name_en', 's',
  'variants', jsonb_build_array(jsonb_build_object('sku', 'P-1', 'selling_unit', 'roll', 'price_egp', '10.123')))) $$,
  'mp:price_invalid%', 'C5. a price with more than two decimals is refused');
select throws_like($$ select public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'), 'product_type_key', 'wallpaper', 'name_ar', 'س', 'name_en', 's',
  'variants', jsonb_build_array(jsonb_build_object('sku', 'P-2', 'selling_unit', 'bucket', 'price_egp', 10)))) $$,
  'mp:selling_unit_invalid%', 'C6. an unknown selling unit is refused');
select throws_like($$ select public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'), 'product_type_key', 'no_such_type', 'name_ar', 'س', 'name_en', 's')) $$,
  'mp:product_type_invalid%', 'C7. an unknown product type is refused');
select throws_like($$ select public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'), 'product_type_key', 'wallpaper', 'name_ar', '', 'name_en', 's')) $$,
  'mp:name_ar_invalid%', 'C8. a missing Arabic name is refused');
select throws_like($$ select public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'), 'product_type_key', 'wallpaper', 'name_ar', 'س', 'name_en', 's',
  'attributes', jsonb_build_object('bogus_field', 'x'))) $$,
  'mp:attribute_unknown:bogus_field%', 'C9. a field that is not part of the product type is refused');
select throws_like($$ select public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'), 'product_type_key', 'wallpaper', 'name_ar', 'س', 'name_en', 's',
  'attributes', jsonb_build_object('material_wallpaper', 'not_an_option'))) $$,
  'mp:attribute_invalid:material_wallpaper%', 'C10. an option that does not exist is refused');
select throws_like($$ select public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'), 'product_type_key', 'wallpaper', 'name_ar', 'س', 'name_en', 's',
  'attributes', jsonb_build_object('color', 'beige'))) $$,
  'mp:attribute_unknown:color%', 'C11. a variant-level field cannot be saved on the product');
select throws_like($$ select public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'), 'product_type_key', 'wallpaper', 'name_ar', 'س', 'name_en', 's',
  'variants', jsonb_build_array(
    jsonb_build_object('sku', 'SAME-1', 'selling_unit', 'roll', 'price_egp', 10, 'attributes', jsonb_build_object('color', 'beige')),
    jsonb_build_object('sku', 'SAME-2', 'selling_unit', 'roll', 'price_egp', 10, 'attributes', jsonb_build_object('color', 'beige'))))) $$,
  'mp:duplicate_variant_combination%', 'C12. two variants with the same option combination are refused');
select lives_ok($$ select public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'), 'product_type_key', 'wallpaper', 'name_ar', 'مسودة ناقصة', 'name_en', 'Incomplete draft')) $$,
  'C13. a draft may be saved before its required fields are complete');
select is((select count(*)::int from public.marketplace_products where seller_organization_id = current_setting('t.a')::uuid),
  2, 'C14. refused saves left nothing behind (only the two successful drafts exist)');

-- ===========================================================================
-- D. Update
-- ===========================================================================
select is((public.marketplace_seller_product_save(
  public.marketplace_seller_product_get(current_setting('t.p1')::uuid)
  || jsonb_build_object('name_en', 'Modern Wallpaper Plus',
       'variants', jsonb_build_array(jsonb_build_object(
         'id', public.marketplace_seller_product_get(current_setting('t.p1')::uuid) -> 'variants' -> 0 ->> 'id',
         'sku', 'WPM-BEIGE', 'selling_unit', 'roll', 'price_egp', 499.5,
         'attributes', jsonb_build_object('color', 'beige', 'roll_width', 53, 'roll_length', 1000))))
) ->> 'status'), 'draft', 'D1. an edit saves and the product stays a draft');
reset role;
select is((select name_en from public.marketplace_products where id = current_setting('t.p1')::uuid), 'Modern Wallpaper Plus',
  'D2. the product field changed');
select is((select price_egp from public.marketplace_product_variants where sku = 'WPM-BEIGE' and seller_organization_id = current_setting('t.a')::uuid),
  499.50, 'D3. the variant price changed');
select is((select status from public.marketplace_product_variants where sku = 'WPM-CREAM' and seller_organization_id = current_setting('t.a')::uuid),
  'inactive', 'D4. a variant removed from the form is DEACTIVATED, never deleted');
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_like($$ select public.marketplace_seller_product_save(
  public.marketplace_seller_product_get(current_setting('t.p1')::uuid) || '{"product_type_key":"cornice"}'::jsonb) $$,
  'mp:product_type_immutable%', 'D5. the product type cannot be changed');
select lives_ok($$ select public.marketplace_seller_product_save(jsonb_build_object(
  'id', current_setting('t.p1'), 'organization_id', '91000005-1111-4111-8111-000000000005',
  'name_ar', 'س', 'name_en', 'Org field ignored')) $$,
  'D6. a payload organization id never moves an existing product (the product decides its owner)');
reset role;
select is((select seller_organization_id from public.marketplace_products where id = current_setting('t.p1')::uuid),
  current_setting('t.a')::uuid, 'D7. ...and the owner is unchanged');

-- ===========================================================================
-- E. Authorisation
-- ===========================================================================
set local role anon;
select throws_ok($$ select public.marketplace_seller_product_save('{}'::jsonb) $$, '42501', null,
  'E1. anon cannot call the seller RPCs');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';
select throws_like($$ select public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'), 'product_type_key', 'wallpaper', 'name_ar', 'س', 'name_en', 's')) $$,
  'mp:not_permitted%', 'E2. an outsider cannot create a product for showroom A');
select throws_like($$ select public.marketplace_seller_product_get(current_setting('t.p1')::uuid) $$,
  'mp:not_found%', 'E3. an outsider cannot read showroom A''s product');
set local request.jwt.claims = '{"sub":"70000002-0000-4000-8000-000000000002","role":"authenticated"}';
select throws_like($$ select public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'), 'product_type_key', 'wallpaper', 'name_ar', 'س', 'name_en', 's')) $$,
  'mp:not_permitted%', 'E4. a member WITHOUT catalogue authority (sales only) cannot write');
select lives_ok($$ select public.marketplace_seller_product_get(current_setting('t.p1')::uuid) $$,
  'E5. ...but, as a member, can read');
set local request.jwt.claims = '{"sub":"71000005-0000-4000-8000-000000000005","role":"authenticated"}';
select throws_like($$ select public.marketplace_seller_product_save(
  jsonb_build_object('id', current_setting('t.p1'), 'name_ar', 'س', 'name_en', 'from B')) $$,
  'mp:not_permitted%', 'E6. showroom B cannot edit showroom A''s product (cross-tenant)');
select lives_ok($$ select public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', '91000005-1111-4111-8111-000000000005', 'product_type_key', 'wallpaper', 'name_ar', 'س', 'name_en', 's',
  'variants', jsonb_build_array(jsonb_build_object('sku', 'WPM-BEIGE', 'selling_unit', 'roll', 'price_egp', 10)))) $$,
  'E7. SKUs are unique PER SELLER: showroom B may use a SKU showroom A also uses');
reset role;

-- ===========================================================================
-- F. Stock
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('t.loc', public.marketplace_seller_default_location(current_setting('t.a')::uuid)::text, true);
select is(public.marketplace_seller_default_location(current_setting('t.a')::uuid), current_setting('t.loc')::uuid,
  'F1. the main stock location is created once and reused');
select set_config('t.v1', (select id::text from public.marketplace_product_variants where sku = 'WPM-BEIGE'
  and seller_organization_id = current_setting('t.a')::uuid), true);
select is((public.marketplace_seller_stock_adjust(current_setting('t.v1')::uuid, current_setting('t.loc')::uuid, 10, 'stock-key-0001') ->> 'available')::int,
  10, 'F2. initial stock is entered through the ledger');
select is((public.marketplace_seller_stock_adjust(current_setting('t.v1')::uuid, current_setting('t.loc')::uuid, -3, 'stock-key-0002') ->> 'available')::int,
  7, 'F3. minus adjusts the same variant at the same location');
select is((public.marketplace_seller_stock_adjust(current_setting('t.v1')::uuid, current_setting('t.loc')::uuid, -3, 'stock-key-0002') ->> 'applied')::boolean,
  false, 'F4. a repeated click (same key) changes nothing');
select throws_like($$ select public.marketplace_seller_stock_adjust(current_setting('t.v1')::uuid, current_setting('t.loc')::uuid, -100, 'stock-key-0003') $$,
  'mp:insufficient_stock%', 'F5. stock cannot go below zero');
select throws_like($$ select public.marketplace_seller_stock_adjust(current_setting('t.v1')::uuid, current_setting('t.loc')::uuid, 1, 'stock-key-0004', null, 99) $$,
  'mp:stock_changed%', 'F6. a stale screen (expected on-hand mismatch) is refused instead of overwriting');
reset role;
-- an order holds 5 units (trusted path), then the seller tries to remove 4 of the 7
select applied from public.marketplace_stock_apply(current_setting('t.a')::uuid, current_setting('t.v1')::uuid,
  current_setting('t.loc')::uuid, 'reserve', 5, 'order-hold-00001', 'order', 'order');
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_like($$ select public.marketplace_seller_stock_adjust(current_setting('t.v1')::uuid, current_setting('t.loc')::uuid, -4, 'stock-key-0005') $$,
  'mp:insufficient_stock%', 'F7. units reserved for orders cannot be removed');
reset role;
select is((select on_hand::text || '/' || reserved::text from public.marketplace_inventory_levels
           where variant_id = current_setting('t.v1')::uuid), '7/5', 'F8. the level is exactly what the ledger says');
select is((select count(*)::int from public.marketplace_stock_movements where variant_id = current_setting('t.v1')::uuid
           and actor_user_id = '70000001-0000-4000-8000-000000000001' and source = 'manual'), 2,
  'F9. every seller change is an auditable movement with its actor');
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000005-0000-4000-8000-000000000005","role":"authenticated"}';
select throws_like($$ select public.marketplace_seller_stock_adjust(current_setting('t.v1')::uuid, current_setting('t.loc')::uuid, 50, 'stock-key-b001') $$,
  'mp:not_permitted%', 'F10. showroom B cannot change showroom A''s stock');
select set_config('t.locb', public.marketplace_seller_default_location('91000005-1111-4111-8111-000000000005')::text, true);
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_like($$ select public.marketplace_seller_stock_adjust(current_setting('t.v1')::uuid, current_setting('t.locb')::uuid, 5, 'stock-key-0006') $$,
  'mp:location_invalid%', 'F11. stock cannot be placed at another organization''s location');
select throws_ok($$ insert into public.marketplace_inventory_levels (variant_id, location_id, seller_organization_id, on_hand)
                    values (current_setting('t.v1')::uuid, current_setting('t.loc')::uuid, current_setting('t.a')::uuid, 999) $$,
  '42501', null, 'F12. the browser role still cannot write inventory directly');

-- ===========================================================================
-- G. Images
-- ===========================================================================
select throws_ok($$ insert into storage.objects (bucket_id, name, metadata)
                    values ('marketplace-product-images', current_setting('t.a') || '/' || current_setting('t.p1') || '/forged.jpg', '{}') $$,
  '42501', null, 'G1. bytes cannot be uploaded to a key the server did not issue');
select set_config('t.img', (public.marketplace_seller_image_request_upload(current_setting('t.p1')::uuid, 'image/webp')) ->> 'image_id', true);
select set_config('t.key', (select object_key from public.marketplace_product_images where id = current_setting('t.img')::uuid), true);
select ok(current_setting('t.key') like current_setting('t.a') || '/' || current_setting('t.p1') || '/%.webp',
  'G2. the server issues an org/product-scoped key');
select throws_like($$ select public.marketplace_seller_image_confirm_upload(current_setting('t.img')::uuid) $$,
  'mp:upload_not_found%', 'G3. confirming before the bytes exist is refused (no fake "uploaded")');
select lives_ok($$ insert into storage.objects (bucket_id, name, metadata)
                   values ('marketplace-product-images', current_setting('t.key'), '{"size": 1234, "mimetype": "image/webp"}') $$,
  'G4. the issued key can be uploaded to');
select is((public.marketplace_seller_image_confirm_upload(current_setting('t.img')::uuid) ->> 'upload_state'), 'confirmed',
  'G5. confirm finds the real object');
reset role;
select is((select status || '/' || is_primary::text || '/' || byte_size::text from public.marketplace_product_images
           where id = current_setting('t.img')::uuid), 'pending/true/1234',
  'G6. uploaded = confirmed + primary + real size, but content is still PENDING (never auto-verified)');
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('t.img2', (public.marketplace_seller_image_request_upload(current_setting('t.p1')::uuid, 'image/png')) ->> 'image_id', true);
insert into storage.objects (bucket_id, name, metadata)
select 'marketplace-product-images', object_key, '{"size": 10}' from public.marketplace_product_images where id = current_setting('t.img2')::uuid;
select public.marketplace_seller_image_confirm_upload(current_setting('t.img2')::uuid);
select lives_ok(format($$ select public.marketplace_seller_images_update(%L::uuid, %L::jsonb) $$,
  current_setting('t.p1'),
  jsonb_build_array(jsonb_build_object('id', current_setting('t.img2'), 'sort_order', 0, 'is_primary', true),
                    jsonb_build_object('id', current_setting('t.img'), 'sort_order', 1, 'is_primary', false))),
  'G7. images can be reordered and the primary changed');
reset role;
select is((select array_agg(id::text || ':' || sort_order || ':' || is_primary order by sort_order) from public.marketplace_product_images
           where product_id = current_setting('t.p1')::uuid),
  array[current_setting('t.img2') || ':0:true', current_setting('t.img') || ':1:false'], 'G8. ...and that is what was stored');
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_like(format($$ select public.marketplace_seller_images_update(%L::uuid, %L::jsonb) $$,
  current_setting('t.p1'),
  jsonb_build_array(jsonb_build_object('id', current_setting('t.img2'), 'sort_order', 0, 'is_primary', true),
                    jsonb_build_object('id', current_setting('t.img'), 'sort_order', 1, 'is_primary', true))),
  'mp:one_primary_image%', 'G9. two primary images are refused');
select is(public.marketplace_seller_image_remove(current_setting('t.img')::uuid), current_setting('t.key'),
  'G10. removing an image (phase 1) returns its key so the bytes can be deleted');
select ok(app.marketplace_storage_can_delete_image(current_setting('t.key')),
  'G11. ...and the storage policy lets the seller delete the bytes of that marked row (the real Storage call is proven in marketplace_image_removal_api_test.mjs; lifecycle in 96_)');
set local request.jwt.claims = '{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';
select is((select count(*)::int from storage.objects where bucket_id = 'marketplace-product-images'), 0,
  'G12. an outsider cannot see the seller''s image objects');
set local request.jwt.claims = '{"sub":"71000005-0000-4000-8000-000000000005","role":"authenticated"}';
select throws_like($$ select public.marketplace_seller_image_request_upload(current_setting('t.p1')::uuid, 'image/jpeg') $$,
  'mp:not_permitted%', 'G13. another showroom cannot add images to this product');
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_like($$ select public.marketplace_seller_image_request_upload(current_setting('t.p1')::uuid, 'image/gif') $$,
  'mp:image_type_invalid%', 'G14. only jpeg / png / webp are accepted');
reset role;

-- ===========================================================================
-- H. Suspension
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select public.admin_marketplace_seller_suspend('9c000000-cccc-4ccc-8ccc-000000000001', 'suspension test');
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_like($$ select public.marketplace_seller_product_save(
  jsonb_build_object('id', current_setting('t.p1'), 'name_ar', 'س', 'name_en', 'while suspended')) $$,
  'mp:seller_not_enabled%', 'H1. a suspended seller cannot edit');
select throws_like($$ select public.marketplace_seller_stock_adjust(current_setting('t.v1')::uuid, current_setting('t.loc')::uuid, 1, 'stock-key-0007') $$,
  'mp:seller_not_enabled%', 'H2. ...nor change stock');
select throws_like($$ select public.marketplace_seller_image_request_upload(current_setting('t.p1')::uuid, 'image/jpeg') $$,
  'mp:seller_not_enabled%', 'H3. ...nor upload images');
select lives_ok($$ select public.marketplace_seller_product_get(current_setting('t.p1')::uuid) $$,
  'H4. ...but can still read what it has');
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select public.admin_marketplace_seller_reinstate('9c000000-cccc-4ccc-8ccc-000000000001', 'test over');
reset role;

-- ===========================================================================
-- I. Publication stays closed
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select ok('media_verification_not_available' = any(public.marketplace_seller_product_readiness(current_setting('t.p1')::uuid))
      and 'no_verified_primary_image' = any(public.marketplace_seller_product_readiness(current_setting('t.p1')::uuid)),
  'I1. readiness reports the real blockers (unverified image, media verification off)');
select throws_ok($$ select public.marketplace_product_publish(current_setting('t.p1')::uuid) $$, '23514', null,
  'I2. the product cannot be published');
select is((select count(*)::int from public.marketplace_public_catalog() where slug like 'modern-wallpaper-%'), 0,
  'I3. and it is not in the public catalogue');
reset role;

select * from finish();
rollback;
