-- pgTAP: Marketplace Migration 09 — catalog launch
-- (20261014090004_marketplace_catalog_launch.sql).
--
--   A. SHAPE         grants: admin RPCs authenticated, public page anon, image ref service-only.
--   B. SELLERS       admin overview needs a seller permission; counts are per organization.
--   C. MODERATION    validation recorded with the TRUE stored size; approve requires a recent
--                    successful validation; reject needs a reason and promotes the next image;
--                    moderators only; append-only trail.
--   D. SWITCH        only a moderator flips media verification, with a reason, audited.
--   E. PUBLISH       publish-ready publishes only products with no blockers.
--   F. DELIVERY      the image reference exists only for verified + published + enabled + flag on;
--                    disappears on unpublish, suspension, rejection, flag off.
--   G. PUBLIC PAGE   paging, totals, search, facets, seller name; anon sees only eligible products.
--   H. SELLER PAGE   members only, other tenants refused, stats + filters.
--   I. IMPORT        dispatcher: writer re-check, own-prefix assets only, missing bytes rejected,
--                    opening stock entered once through the ledger.
--
-- Fixtures (seed-pilot): showroom A 9c000000-…001 (owner 70000001), showroom B 91000005-…005
-- (owner 71000005), staff 55555555 (Administrator), 11111111 (Moderator, granted HERE).
create extension if not exists pgtap;

begin;
select plan(74);

update auth.users set email_confirmed_at = now()
  where id in ('70000001-0000-4000-8000-000000000001', '71000005-0000-4000-8000-000000000005',
               '55555555-5555-4555-8555-555555555555', '11111111-1111-4111-8111-111111111111');
select set_config('t.a', '9c000000-cccc-4ccc-8ccc-000000000001', true);
select set_config('t.b', '91000005-1111-4111-8111-000000000005', true);
insert into public.admin_role_assignments (user_id, role_id, scope_type, assigned_by)
select '11111111-1111-4111-8111-111111111111', r.id, 'platform', '55555555-5555-4555-8555-555555555555'
from public.admin_roles r where r.key = 'moderator';

select set_config('app.marketplace_seller_write', 'on', true);
insert into public.marketplace_seller_accounts (organization_id, status, approved_at)
values (current_setting('t.a')::uuid, 'approved', now());
select set_config('app.marketplace_seller_write', 'off', true);

-- ===========================================================================
-- A. Shape
-- ===========================================================================
select is(
  (select array_agg(p.proname::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'admin\_marketplace\_media\_%' and has_function_privilege('anon', p.oid, 'execute')),
  null, 'A1. anon runs no media moderation RPC');
select ok(has_function_privilege('service_role', 'public.marketplace_public_image_ref(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.marketplace_public_image_ref(uuid)', 'execute')
      and not has_function_privilege('authenticated', 'public.marketplace_public_image_ref(uuid)', 'execute'),
  'A2. the public image reference (storage key) is service-role only — never a browser role');
select ok(has_function_privilege('anon', 'public.marketplace_public_catalog_page(text,text,text,text,integer,integer,numeric,numeric,boolean,jsonb)', 'execute')
      and has_function_privilege('anon', 'public.marketplace_public_facets(text)', 'execute'),
  'A3. the paged public catalogue and facets are readable anonymously');
select is((select media_verification_ready from public.marketplace_platform_settings), false,
  'A4. the migration leaves public media OFF');
select is((select count(*)::int from information_schema.role_table_grants
           where table_name in ('marketplace_image_moderation_events', 'marketplace_platform_events')
             and grantee in ('anon', 'authenticated', 'service_role')), 0,
  'A5. the moderation and platform trails have no client grant');

-- ===========================================================================
-- Fixture product for A (complete wallpaper, stock, one uploaded product image)
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('t.p', (public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'), 'product_type_key', 'wallpaper',
  'name_ar', 'ورق إطلاق', 'name_en', 'Launch Paper', 'brand', 'LaunchBrand',
  'attributes', jsonb_build_object('material_wallpaper', 'vinyl_coated'),
  'variants', jsonb_build_array(jsonb_build_object('sku', 'LAUNCH-1', 'selling_unit', 'roll', 'price_egp', 300,
     'attributes', jsonb_build_object('color', 'beige', 'roll_width', 53, 'roll_length', 1000))))) ->> 'id'), true);
select set_config('t.v', (select id::text from public.marketplace_product_variants where sku = 'LAUNCH-1' and seller_organization_id = current_setting('t.a')::uuid), true);
select set_config('t.loc', public.marketplace_seller_default_location(current_setting('t.a')::uuid)::text, true);
select public.marketplace_seller_stock_adjust(current_setting('t.v')::uuid, current_setting('t.loc')::uuid, 20, 'launch-stock-0001');
select set_config('t.img', (public.marketplace_seller_image_request_upload(current_setting('t.p')::uuid, 'image/png')) ->> 'image_id', true);
select set_config('t.key', (select object_key from public.marketplace_product_images where id = current_setting('t.img')::uuid), true);
insert into storage.objects (bucket_id, name, metadata) values ('marketplace-product-images', current_setting('t.key'), '{"size": 2048, "mimetype": "image/png"}');
select public.marketplace_seller_image_confirm_upload(current_setting('t.img')::uuid);
select set_config('t.img2', (public.marketplace_seller_image_request_upload(current_setting('t.p')::uuid, 'image/png')) ->> 'image_id', true);
insert into storage.objects (bucket_id, name, metadata)
select 'marketplace-product-images', object_key, '{"size": 1024, "mimetype": "image/png"}' from public.marketplace_product_images where id = current_setting('t.img2')::uuid;
select public.marketplace_seller_image_confirm_upload(current_setting('t.img2')::uuid);
reset role;

-- ===========================================================================
-- B. Sellers overview
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select is((select seller_status from public.admin_marketplace_seller_overview() where organization_id = current_setting('t.a')::uuid),
  'approved', 'B1. the admin overview shows showroom A as approved');
select is((select products_total::int from public.admin_marketplace_seller_overview() where organization_id = current_setting('t.a')::uuid),
  1, 'B2. ...with its Marketplace product count');
select ok((select seller_status is null and not exists (select 1 from public.marketplace_seller_accounts where organization_id = current_setting('t.b')::uuid)
           from public.admin_marketplace_seller_overview() where organization_id = current_setting('t.b')::uuid),
  'B3. an eligible but unapproved showroom is listed WITHOUT being enabled');
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_like($$ select * from public.admin_marketplace_seller_overview() $$, 'mp:not_permitted%',
  'B4. a seller cannot read the admin overview');
reset role;

-- ===========================================================================
-- C. Moderation
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_like($$ select public.admin_marketplace_media_queue() $$, 'mp:not_permitted%',
  'C1. a Moderator (no media permission) cannot open the queue');
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_like($$ select public.admin_marketplace_media_approve(array[current_setting('t.img')::uuid]) $$, 'mp:not_permitted%',
  'C2. the seller cannot approve its own image');
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select ok((public.admin_marketplace_media_queue('pending', 50, 0) ->> 'total')::int >= 2, 'C3. the Administrator sees the pending images');
select is((public.admin_marketplace_media_approve(array[current_setting('t.img')::uuid]) -> 0 ->> 'result'),
  'validation_required', 'C4. an image without a byte-level validation cannot be approved');
select throws_like($$ select public.admin_marketplace_media_record_validation(current_setting('t.img')::uuid, true, 'png', 800, 600, 9999, repeat('a', 64)) $$,
  'mp:validation_mismatch%', 'C5. a VALID verdict for a byte size that is not the stored object is refused');
select lives_ok($$ select public.admin_marketplace_media_record_validation(current_setting('t.img')::uuid, true, 'png', 800, 600, 2048, repeat('a', 64)) $$,
  'C6. a validation matching the stored object is recorded');
select lives_ok($$ select public.admin_marketplace_media_record_validation(current_setting('t.img2')::uuid, false, null, null, null, null, null, 'decode failed') $$,
  'C7. a failed validation is recorded too');
select is((public.admin_marketplace_media_approve(array[current_setting('t.img')::uuid, current_setting('t.img2')::uuid])),
  jsonb_build_array(jsonb_build_object('id', current_setting('t.img'), 'result', 'approved'),
                    jsonb_build_object('id', current_setting('t.img2'), 'result', 'validation_required')),
  'C8. a batch approves only the validated image; the invalid one is NOT approved');
reset role;
select is((select status || '/' || content_format || '/' || width_px from public.marketplace_product_images where id = current_setting('t.img')::uuid),
  'verified/png/800', 'C9. approved = verified, with the validated format and size');
select is((select array_agg(action order by sequence) from public.marketplace_image_moderation_events where image_id = current_setting('t.img')::uuid),
  array['validated', 'approved'], 'C10. the trail records validation then approval');
select throws_ok($$ update public.marketplace_image_moderation_events set action = 'rejected' $$, '23514', null,
  'C11. the moderation trail is append-only');
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select throws_like($$ select public.admin_marketplace_media_reject(array[current_setting('t.img2')::uuid], '') $$, 'mp:reason_required%',
  'C12. rejection needs a reason');
select is((public.admin_marketplace_media_reject(array[current_setting('t.img2')::uuid], 'blurry image') -> 0 ->> 'result'),
  'rejected', 'C13. an image can be rejected with a reason');
reset role;
select is((select moderation_reason from public.marketplace_product_images where id = current_setting('t.img2')::uuid),
  'blurry image', 'C14. the reason is stored');

-- ===========================================================================
-- D. Media switch
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_like($$ select public.admin_marketplace_set_media_verification_ready(true, 'seller tries') $$, 'mp:not_permitted%',
  'D1. a seller cannot switch public media on');
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select throws_like($$ select public.admin_marketplace_set_media_verification_ready(true, '') $$, 'mp:reason_required%',
  'D2. switching needs a reason');
-- before the switch: publication is still blocked by the flag alone
reset role;
select is(app.marketplace_publication_blockers(current_setting('t.p')::uuid), array['media_verification_not_available'],
  'D3. with a verified image and stock, only the media switch still blocks');
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select is(public.admin_marketplace_set_media_verification_ready(true, 'acceptance passed'), true, 'D4. a moderator switches media on');
reset role;
select is((select action from public.marketplace_platform_events order by sequence desc limit 1), 'media_verification_enabled',
  'D5. ...and it is recorded');

-- ===========================================================================
-- E. Publish ready
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'), 'product_type_key', 'wallpaper', 'name_ar', 'ناقص', 'name_en', 'Incomplete'));
select is((public.marketplace_seller_publish_ready(current_setting('t.a')::uuid) ->> 'published')::int, 1,
  'E1. publish-ready publishes the one complete product');
select ok((public.marketplace_seller_publish_ready(current_setting('t.a')::uuid) -> 'blocked_by_reason') ? 'no_active_variant',
  'E2. ...and reports the incomplete one by reason, without publishing it');
set local request.jwt.claims = '{"sub":"71000005-0000-4000-8000-000000000005","role":"authenticated"}';
select throws_like($$ select public.marketplace_seller_publish_ready('9c000000-cccc-4ccc-8ccc-000000000001'::uuid) $$, 'mp:%',
  'E3. another showroom cannot publish showroom A''s products');
reset role;
select is((select status from public.marketplace_products where id = current_setting('t.p')::uuid), 'published', 'E4. the product is published');

-- ===========================================================================
-- F. Delivery reference
-- ===========================================================================
set local role service_role;
select is((select object_key from public.marketplace_public_image_ref(current_setting('t.img')::uuid)), current_setting('t.key'),
  'F1. a verified image of a published product of an enabled seller is deliverable');
select is((select count(*)::int from public.marketplace_public_image_ref(current_setting('t.img2')::uuid)), 0,
  'F2. a rejected image is never deliverable');
reset role;
update public.marketplace_platform_settings set media_verification_ready = false;
set local role service_role;
select is((select count(*)::int from public.marketplace_public_image_ref(current_setting('t.img')::uuid)), 0,
  'F3. with the media switch off nothing is deliverable');
reset role;
update public.marketplace_platform_settings set media_verification_ready = true;
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select public.admin_marketplace_seller_suspend('9c000000-cccc-4ccc-8ccc-000000000001', 'delivery test');
reset role;
set local role service_role;
select is((select count(*)::int from public.marketplace_public_image_ref(current_setting('t.img')::uuid)), 0,
  'F4. suspending the seller stops delivery at once');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select public.admin_marketplace_seller_reinstate('9c000000-cccc-4ccc-8ccc-000000000001', 'delivery test over');
reset role;
set local role service_role;
select is((select count(*)::int from public.marketplace_public_image_ref(current_setting('t.img')::uuid)), 1, 'F5. reinstating restores it');
reset role;

select set_config('t.aname', (select name from public.organizations where id = current_setting('t.a')::uuid), true);
select set_config('t.wallcat', (select cc.key from public.marketplace_categories cc join public.marketplace_product_types t on t.category_id = cc.id where t.key = 'wallpaper'), true);
select set_config('t.pslug', (select slug from public.marketplace_products where id = current_setting('t.p')::uuid), true);
-- ===========================================================================
-- G. Public page
-- ===========================================================================
set local role anon;
select is((public.marketplace_public_catalog_page(null, null, null, 'newest', 24, 0) ->> 'total')::int, 1,
  'G1. anon sees exactly the one eligible product');
select is((public.marketplace_public_catalog_page(null, null, null, 'newest', 24, 0) -> 'items' -> 0 ->> 'seller_name'),
  current_setting('t.aname'), 'G2. with the seller name');
select is((public.marketplace_public_catalog_page(null, null, null, 'newest', 24, 0) -> 'items' -> 0 ->> 'image_id'),
  current_setting('t.img'), 'G3. and its cover image id (the approved one)');
select is((public.marketplace_public_catalog_page(null, null, 'launch-1', 'newest', 24, 0) ->> 'total')::int, 1, 'G4. search matches a SKU');
select is((public.marketplace_public_catalog_page(null, null, 'no-such-thing', 'newest', 24, 0) ->> 'total')::int, 0, 'G5. a miss returns nothing');
select is((public.marketplace_public_catalog_page('walls_does_not_exist', null, null, 'newest', 24, 0) ->> 'total')::int, 0, 'G6. an unknown category returns nothing');
select is((public.marketplace_public_catalog_page(null, null, null, 'newest', 1000, 0) ->> 'limit')::int, 60, 'G7. page size is capped at 60');
select ok(position('object_key' in public.marketplace_public_catalog_page(null, null, null, 'newest', 24, 0)::text) = 0
      and position(current_setting('t.key') in public.marketplace_public_catalog_page(null, null, null, 'newest', 24, 0)::text) = 0,
  'G8. the public page carries no storage key');
select ok((select (c ->> 'count')::int from jsonb_array_elements(public.marketplace_public_facets() -> 'categories') c
           where c ->> 'key' = current_setting('t.wallcat')) = 1,
  'G9. facets count the public product under its category');
select is((public.marketplace_public_product(current_setting('t.pslug')) ->> 'cover_image_id'),
  current_setting('t.img'), 'G10. the detail document names the cover image');
-- Migration 10 filters
select is((public.marketplace_public_catalog_page(p_price_max => 0.01) ->> 'total')::int, 0, 'G10a. a price ceiling below every variant excludes the product');
select is((public.marketplace_public_catalog_page(p_price_min => 0.01) ->> 'total')::int, 1, 'G10b. a price floor below the price keeps it');
select is((public.marketplace_public_catalog_page(p_attrs => '{"no_such_field":["x"]}') ->> 'total')::int, 0, 'G10c. an attribute filter nothing carries matches nothing');
select is((public.marketplace_public_catalog_page(p_attrs => '{"no_such_field":[]}') ->> 'total')::int, 1, 'G10d. an empty attribute filter is ignored');
select ok(public.marketplace_public_facets() ? 'price' and public.marketplace_public_facets() ? 'filters', 'G10e. facets carry the price bounds and option filters');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select public.marketplace_product_unpublish(current_setting('t.p')::uuid);
reset role;
set local role anon;
select is((public.marketplace_public_catalog_page(null, null, null, 'newest', 24, 0) ->> 'total')::int, 0, 'G11. unpublishing removes it from the public page');
reset role;
set local role service_role;
select is((select count(*)::int from public.marketplace_public_image_ref(current_setting('t.img')::uuid)), 0, 'G12. ...and from image delivery');
reset role;

-- ===========================================================================
-- H. Seller page
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select is((public.marketplace_seller_products_page(current_setting('t.a')::uuid) -> 'stats' ->> 'total')::int, 2, 'H1. the seller page counts the whole catalogue');
select is((public.marketplace_seller_products_page(current_setting('t.a')::uuid, 'launch') ->> 'total')::int, 1, 'H2. search narrows the page');
select is((public.marketplace_seller_products_page(current_setting('t.a')::uuid, null, null, null, null, 1000, 0) ->> 'limit')::int, 100, 'H3. page size is capped at 100');
select is((public.marketplace_seller_products_page(current_setting('t.a')::uuid, 'launch') -> 'items' -> 0 -> 'inline_stock' ->> 'on_hand')::int, 20,
  'H4. a single-variant single-location product exposes its inline stock target');
set local request.jwt.claims = '{"sub":"71000005-0000-4000-8000-000000000005","role":"authenticated"}';
select throws_like($$ select public.marketplace_seller_products_page('9c000000-cccc-4ccc-8ccc-000000000001'::uuid) $$, 'mp:not_found%',
  'H5. another showroom cannot read showroom A''s page');
reset role;

-- ===========================================================================
-- I. Import dispatcher
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('t.job', public.marketplace_import_job_create('9c000000-cccc-4ccc-8ccc-000000000001', 'csv', 'launch.csv',
  repeat('ab', 32), 'apply', 50, 'launch-import-key-01')::text, true);
select is((public.marketplace_seller_import_step(current_setting('t.job')::uuid, 'stage_rows', jsonb_build_array(
  jsonb_build_object('row_number', 1, 'external_ref', 'IMP-1', 'sku', 'IMP-1-A', 'product_type', 'wallpaper',
                     'name_ar', 'مستورد', 'name_en', 'Imported', 'selling_unit', 'roll', 'price', '450', 'quantity', '12',
                     'attributes', jsonb_build_object('material_wallpaper', 'vinyl_coated', 'color', 'beige', 'roll_width', 53, 'roll_length', 1000)),
  jsonb_build_object('row_number', 2, 'external_ref', 'IMP-2', 'sku', 'IMP-2-A', 'product_type', 'wallpaper',
                     'name_ar', 'كمية خطأ', 'name_en', 'Bad qty', 'selling_unit', 'roll', 'price', '450', 'quantity', 'x'))) ->> 'added')::int,
  2, 'I1. the seller stages rows through the dispatcher');
select throws_like(format($$ select public.marketplace_seller_import_step(%L::uuid, 'stage_assets', %L::jsonb) $$,
  current_setting('t.job'),
  jsonb_build_array(jsonb_build_object('file_name', 'IMP-1-A_01.png', 'storage_bucket', 'marketplace-product-images',
                                       'object_key', current_setting('t.key')))),
  'mp:asset_outside_job%', 'I2. an asset outside this job''s own prefix (e.g. another product''s object) is refused');
select throws_ok(format($$ insert into storage.objects (bucket_id, name, metadata) values ('marketplace-product-images', %L, '{}') $$,
  'imports/' || current_setting('t.b') || '/' || current_setting('t.job') || '/x.png'),
  '42501', null, 'I3. bytes cannot be uploaded under another organization''s import prefix');
select lives_ok(format($$ insert into storage.objects (bucket_id, name, metadata) values ('marketplace-product-images', %L, '{"size": 500, "mimetype": "image/png"}') $$,
  'imports/' || current_setting('t.a') || '/' || current_setting('t.job') || '/1.png'),
  'I4. the seller uploads under its own job prefix');
select is((public.marketplace_seller_import_step(current_setting('t.job')::uuid, 'stage_assets', jsonb_build_array(
  jsonb_build_object('file_name', 'IMP-1-A_01.png', 'storage_bucket', 'marketplace-product-images',
                     'object_key', 'imports/' || current_setting('t.a') || '/' || current_setting('t.job') || '/1.png'),
  jsonb_build_object('file_name', 'IMP-1-A_02.png', 'storage_bucket', 'marketplace-product-images',
                     'object_key', 'imports/' || current_setting('t.a') || '/' || current_setting('t.job') || '/2.png'))) ->> 'added')::int,
  2, 'I5. both assets are registered');
reset role;
select is((select array_agg(file_name || ':' || status order by file_name) from public.marketplace_import_assets where job_id = current_setting('t.job')::uuid),
  array['IMP-1-A_01.png:pending', 'IMP-1-A_02.png:rejected'], 'I6. an asset whose bytes are missing is rejected, not trusted');
select is((select byte_size::int from public.marketplace_import_assets where job_id = current_setting('t.job')::uuid and file_name = 'IMP-1-A_01.png'),
  500, 'I7. the registered size is the TRUE stored size');
set local role authenticated;
set local request.jwt.claims = '{"sub":"71000005-0000-4000-8000-000000000005","role":"authenticated"}';
select throws_like($$ select public.marketplace_seller_import_step(current_setting('t.job')::uuid, 'seal', null) $$, 'mp:not_permitted%',
  'I8. another showroom cannot drive this job');
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select public.marketplace_seller_import_step(current_setting('t.job')::uuid, 'seal', null);
select is((public.marketplace_seller_import_step(current_setting('t.job')::uuid, 'validate', null) ->> 'status'), 'validated', 'I9. validation runs');
reset role;
select is((select code from public.marketplace_import_errors e join public.marketplace_import_rows r on r.id = e.row_id
           where e.job_id = current_setting('t.job')::uuid and r.row_number = 2 and e.severity = 'error' limit 1),
  'quantity_invalid', 'I10. a malformed quantity is a row error');
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select is((public.marketplace_seller_import_step(current_setting('t.job')::uuid, 'apply', null) ->> 'status'), 'completed_with_errors',
  'I11. the valid row is applied, the invalid one is reported');
reset role;
select is((select l.on_hand from public.marketplace_inventory_levels l join public.marketplace_product_variants v on v.id = l.variant_id
           where v.sku = 'IMP-1-A' and v.seller_organization_id = current_setting('t.a')::uuid), 12,
  'I12. the opening stock was entered through the ledger');
select is((select count(*)::int from public.marketplace_stock_movements m join public.marketplace_product_variants v on v.id = m.variant_id
           where v.sku = 'IMP-1-A' and m.source = 'import'), 1, 'I13. ...as exactly one import movement');
select is((select i.status || '/' || i.upload_state from public.marketplace_product_images i join public.marketplace_products p on p.id = i.product_id
           where p.external_ref = 'IMP-1' and p.seller_organization_id = current_setting('t.a')::uuid),
  'pending/confirmed', 'I14. the imported image is pending moderation, never auto-verified');
select is((select status from public.marketplace_products where external_ref = 'IMP-1' and seller_organization_id = current_setting('t.a')::uuid),
  'draft', 'I15. the imported product is a draft');

select * from finish();
rollback;
