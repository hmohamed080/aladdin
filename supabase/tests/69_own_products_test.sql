-- pgTAP: Own Products (20261015090004) — canonical taxonomy, units, product data,
-- lifecycle, the three-image limit and its storage policies.
--
-- The claims under test:
--   * TAXONOMY/UNITS — the 15 canonical categories exist with stable codes; the
--     three new units exist and no historical enum value was lost; unknown
--     categories and unsupported units are refused by the DATABASE.
--   * OWNERSHIP — only a member holding catalog.write of the OWNING organization
--     can create/edit/archive; another tenant, a member without the capability and
--     anonymous callers cannot.
--   * PRODUCT CODE — unique per organization (case/space-insensitive), free across
--     organizations.
--   * LIFECYCLE — archived products leave the public catalog, cannot be published
--     or edited until restored; activation shows the product publicly.
--   * IMAGES — at most 3 live images per product, enforced in the database (RPC AND
--     trigger), ownership enforced by the RPCs and by the storage policies.
--
-- Fixtures, from seed-pilot:
--   Hana  (70000001…001) org.manage + catalog.write on Cairo Ceramics (9c…001)
--   Sara  (70000002…002) sales-only member of Cairo Ceramics (no catalog.write)
--   Tarek (70000003…003) org.manage + catalog.write on Egypt Marble Manufacturing (9d…002)

create extension if not exists pgtap;

begin;
\ir helpers/organization_media_receipt.inc
-- The seed keeps Egypt Marble and Nile Import PENDING on purpose (the Admin review queue). A
-- pending organization is non-operational (20261015090028), so a suite that needs them to act
-- as established businesses approves them here, inside its own transaction.
update public.organizations set status = 'active', is_verified = true
 where id in ('9d000000-dddd-4ddd-8ddd-000000000002', '9e000000-eeee-4eee-8eee-000000000003');
select plan(119);

update auth.users set email_confirmed_at = now() where email_confirmed_at is null;

\set orgC '9c000000-cccc-4ccc-8ccc-000000000001'
\set orgM '9d000000-dddd-4ddd-8ddd-000000000002'
\set hana  '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}'
\set sara  '{"sub":"70000002-0000-4000-8000-000000000002","role":"authenticated"}'
\set tarek '{"sub":"70000003-0000-4000-8000-000000000003","role":"authenticated"}'

-- A. Taxonomy and units (reference data, superuser view).
select is(
  (select array_agg(code order by sort_order) from public.product_categories where is_active),
  array['wallpaper','wood_alternative','marble_alternative','chipboard','cornices','corners','panels','skirting',
        'interior_doors','security_doors','vinyl_flooring','spc_flooring','curtains','posters','paints'],
  'the 15 canonical categories exist, in order, with stable English codes');
select is((select count(*)::int from public.product_categories where label_ar ~ '[A-Za-z]{3}' and code <> 'spc_flooring'), 0,
  'Arabic labels are Arabic (SPC aside) and codes are never Arabic');
select ok(
  (select array['gallon','pail','sheet','kilogram','roll','meter','box','square_meter'] <@ enum_range(null::public.product_unit)::text[]),
  'the three new units exist and historical units (box, square_meter) were not renamed or removed');
select ok(
  (select array['finishing','construction','interior_design','furnishing','supply','tools','other'] <@ enum_range(null::public.product_category)::text[]),
  'the historical broad category enum is intact');

set local role authenticated;
set local request.jwt.claims = :'hana';
create temp table _o (name text primary key, id uuid);
create temp table _k (n int primary key, key text);
grant all on _o, _k to authenticated, anon;

-- B. Create.
insert into _o select 'a', public.own_product_create(:'orgC'::uuid, '  Matt Emulsion 18L ', ' pnt-001 ', 'paints', 'pail',
  '[{"name":"  Warm   White ","hex":"#f5f0e6"},{"name":"warm white","hex":null},{"name":"Sand","hex":"#C9B28A"}]'::jsonb, 3.5, '18 L', 'DeltaCoat', 'Washable', 159.5);
select ok((select id from _o where name = 'a') is not null, 'a writer creates an own product');
select is(
  (select row(p.sku, p.category_code, p.category::text, p.status::text, p.unit::text, p.colors, p.weight_kg, p.size_label, p.name)::text
     from public.products p where p.id = (select id from _o where name = 'a')),
  row('pnt-001', 'paints', 'other', 'draft', 'pail', array['Warm White', 'Sand'], 3.500::numeric, '18 L', 'Matt Emulsion 18L')::text,
  'stored values: trimmed name/code, canonical category, neutral legacy bucket, draft, normalized distinct colors, weight and size');
select is((select code_normalized from public.products where id = (select id from _o where name = 'a')), 'PNT-001',
  'the normalized code is maintained');

select throws_ok(
  format('select public.own_product_create(%L, %L, %L, %L, %L)', :'orgC', 'Other paint', 'PNT-001', 'paints', 'pail'),
  '23505', null, 'a duplicate code (case-insensitive) is refused inside the organization');
select throws_ok(
  format('select public.own_product_create(%L, %L, %L, %L, %L)', :'orgC', 'X product', 'NEW-1', 'not_a_category', 'pail'),
  '22023', null, 'an unknown category code is refused');
select throws_ok(
  format('select public.own_product_create(%L, %L, %L, %L, %L)', :'orgC', 'X product', 'NEW-2', null, 'pail'),
  '22023', null, 'a missing category is refused');
select throws_ok(
  format('select public.own_product_create(%L, %L, %L, %L, %L)', :'orgC', 'X product', 'NEW-3', 'paints', 'ton'),
  '22023', null, 'a unit outside the shared unit list is refused for a new product');
select throws_ok(
  format('select public.own_product_create(%L, %L, %L, %L, %L)', :'orgC', 'X', 'NEW-4', 'paints', 'pail'),
  '22023', null, 'a one-character name is refused');
select throws_ok(
  format('select public.own_product_create(%L, %L, %L, %L, %L, %L, %L)', :'orgC', 'X product', 'NEW-5', 'paints', 'pail', '[]', -1),
  '22023', null, 'a negative weight is refused');
select throws_ok(
  format('select public.own_product_create(%L, %L, %L, %L, %L, %L)', :'orgC', 'X product', 'NEW-6', 'paints', 'pail',
         (select jsonb_agg(jsonb_build_object('name', 'c' || g, 'hex', null))::text from generate_series(1, 13) g)),
  '22023', null, 'more than 12 colors are refused');

-- C. Ownership of create/edit.
set local request.jwt.claims = :'tarek';
select lives_ok(
  format('select public.own_product_create(%L, %L, %L, %L, %L)', :'orgM', 'Marble look panel', 'pnt-001', 'panels', 'sheet'),
  'the SAME code is free in another organization');
select throws_ok(
  format('select public.own_product_create(%L, %L, %L, %L, %L)', :'orgC', 'Foreign', 'F-1', 'paints', 'pail'),
  '42501', null, 'a member of another tenant cannot create into this organization');
select throws_ok(
  format('select public.own_product_update(%L, 1, %L, %L, %L, %L)', (select id from _o where name = 'a'), 'Hijack', 'H-1', 'paints', 'pail'),
  '42501', null, 'another tenant cannot edit the product');
select throws_ok(
  format('select public.own_product_set_archived(%L, true, 1)', (select id from _o where name = 'a')),
  '42501', null, 'another tenant cannot archive the product');
select is((select count(*)::int from public.products where id = (select id from _o where name = 'a')), 0,
  'another tenant cannot even see an unpublished (draft) product');

set local request.jwt.claims = :'sara';
select throws_ok(
  format('select public.own_product_create(%L, %L, %L, %L, %L)', :'orgC', 'No cap', 'S-1', 'paints', 'pail'),
  '42501', null, 'a member without catalog.write cannot create');
select throws_ok(
  format('select public.own_product_update(%L, 1, %L, %L, %L, %L)', (select id from _o where name = 'a'), 'Nope', 'S-2', 'paints', 'pail'),
  '42501', null, 'a member without catalog.write cannot edit');
select throws_ok(
  format('select public.own_product_set_archived(%L, true, 1)', (select id from _o where name = 'a')),
  '42501', null, 'a member without catalog.write cannot archive');

-- D. Edit.
set local request.jwt.claims = :'hana';
select is(public.own_product_update((select id from _o where name = 'a'), 1, 'Matt Emulsion 20L', 'PNT-001', 'paints', 'gallon',
  '[{"name":"Sand","hex":"#C9B28A"}]'::jsonb, null, null, null, null, 150), 2, 'the owner edits with the right version; the version advances');
select is((select row(unit::text, name, weight_kg, size_label, brand, colors)::text from public.products where id = (select id from _o where name = 'a')),
  row('gallon', 'Matt Emulsion 20L', null::numeric, null::text, null::text, array['Sand'])::text,
  'an edit replaces the editable fields and clears omitted optional ones');
select throws_ok(
  format('select public.own_product_update(%L, 1, %L, %L, %L, %L)', (select id from _o where name = 'a'), 'Stale', 'PNT-001', 'paints', 'gallon'),
  'VC001', null, 'a stale version is refused');
select throws_ok(
  format('select public.set_product_published(%L, true, 1)', (select id from _o where name = 'a')),
  'VC001', null, 'a stale publish is a version conflict (not the retryable 40001)');
select throws_ok(
  format('select public.own_product_set_archived(%L, true, 1)', (select id from _o where name = 'a')),
  'VC001', null, 'a stale archive is a version conflict (not the retryable 40001)');
insert into _o select 'b', public.own_product_create(:'orgC'::uuid, 'Second paint', 'PNT-002', 'paints', 'gallon');
select throws_ok(
  format('select public.own_product_update(%L, 1, %L, %L, %L, %L)', (select id from _o where name = 'b'), 'Second paint', ' pnt-001 ', 'paints', 'gallon'),
  '23505', null, 'an edit cannot take another product''s code');
-- A historical product keeps its (non-required) unit but must pick a canonical category to be edited.
insert into _o select 'legacy', (select id from public.products where organization_id = :'orgC'::uuid and category_code is null and deleted_at is null order by id limit 1);
select ok((select category_code is null from public.products where id = (select id from _o where name = 'legacy')),
  'a historical product starts unclassified (no guessed canonical category)');
select lives_ok(
  format('select public.own_product_update(%L, %L, %L, %L, %L, %L)', (select id from _o where name = 'legacy'),
    (select version from public.products where id = (select id from _o where name = 'legacy')),
    (select name from public.products where id = (select id from _o where name = 'legacy')),
    'LEG-1', 'wallpaper', (select unit from public.products where id = (select id from _o where name = 'legacy'))),
  'a historical product can be classified and saved while keeping its existing unit');

-- E. Lifecycle.
select is(public.own_product_set_archived((select id from _o where name = 'b'), true, 1), 2, 'archive returns the new version');
select is((select row(status::text, archived_at is not null)::text from public.products where id = (select id from _o where name = 'b')),
  row('draft', true)::text, 'archived = unpublished draft with archived_at set');
select throws_ok(
  format('select public.set_product_published(%L, true, %L)', (select id from _o where name = 'b'),
    (select version from public.products where id = (select id from _o where name = 'b'))),
  '22023', null, 'an archived product cannot be published');
select throws_ok(
  format('select public.own_product_update(%L, %L, %L, %L, %L, %L)', (select id from _o where name = 'b'),
    (select version from public.products where id = (select id from _o where name = 'b')), 'Edit archived', 'PNT-002', 'paints', 'gallon'),
  '22023', null, 'an archived product cannot be edited until restored');
select lives_ok(
  format('select public.own_product_set_archived(%L, false, %L)', (select id from _o where name = 'b'),
    (select version from public.products where id = (select id from _o where name = 'b'))),
  'restore works');
select is((select row(status::text, archived_at is null)::text from public.products where id = (select id from _o where name = 'b')),
  row('draft', true)::text, 'a restored product is inactive (draft), not automatically public');

select public.product_audiences_set((select id from _o where name = 'a'), array['showroom_dealer','supplier','manufacturer','importer','contractor','engineer','installer_technician','end_consumer']);
select lives_ok(
  format('select public.set_product_published(%L, true, %L)', (select id from _o where name = 'a'),
    (select version from public.products where id = (select id from _o where name = 'a'))),
  'activating (publishing) works');
set local request.jwt.claims = :'tarek';
select is((select category_code from public.catalog_products(:'orgM'::uuid) where id = (select id from _o where name = 'a')), 'paints',
  'another tenant sees the activated product in the public catalog with its canonical category');
select is((select count(*)::int from public.catalog_products(:'orgM'::uuid) where id = (select id from _o where name = 'b')), 0,
  'an inactive product is not in the public catalog');
set local request.jwt.claims = :'hana';
select lives_ok(
  format('select public.own_product_set_archived(%L, true, %L)', (select id from _o where name = 'a'),
    (select version from public.products where id = (select id from _o where name = 'a'))),
  'archiving an active product works');
set local request.jwt.claims = :'tarek';
select is((select count(*)::int from public.catalog_products(:'orgM'::uuid) where id = (select id from _o where name = 'a')), 0,
  'an archived product leaves the public catalog immediately');
set local request.jwt.claims = :'hana';
select lives_ok(
  format('select public.own_product_set_archived(%L, false, %L)', (select id from _o where name = 'a'),
    (select version from public.products where id = (select id from _o where name = 'a'))), 'restore the first product');

-- F. Images: allocation, ownership, the 3-image limit.
insert into _k select 1, public.product_image_request_upload((select id from _o where name = 'a'), 'image/jpeg');
select ok((select key ~ ('^' || :'orgC' || '/' || (select id::text from _o where name = 'a') || '/[0-9a-f-]{36}\.jpg$') from _k where n = 1),
  'the key is organization/product scoped and server generated');
select throws_ok(format('select public.product_image_request_upload(%L, %L)', (select id from _o where name = 'a'), 'application/pdf'),
  '22023', null, 'a non-image content type is refused');
set local request.jwt.claims = :'tarek';
select throws_ok(format('select public.product_image_request_upload(%L, %L)', (select id from _o where name = 'a'), 'image/png'),
  '42501', null, 'another tenant cannot add an image');
set local request.jwt.claims = :'sara';
select throws_ok(format('select public.product_image_request_upload(%L, %L)', (select id from _o where name = 'a'), 'image/png'),
  '42501', null, 'a member without catalog.write cannot add an image');
set local request.jwt.claims = :'hana';
select throws_ok(format('select public.product_image_confirm_upload(%L)', :'orgC' || '/' || (select id::text from _o where name = 'a') || '/aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa.jpg'),
  'P0002', null, 'a key the caller never requested cannot be confirmed');

-- Storage policies: the pending row is the only door.
select lives_ok(format($q$insert into storage.objects (bucket_id, name) values ('product-images', %L)$q$, (select key from _k where n = 1)),
  'the owner uploads to the key the RPC issued');
set local request.jwt.claims = :'tarek';
select throws_ok(
  format($q$insert into storage.objects (bucket_id, name) values ('product-images', %L)$q$, :'orgC' || '/' || (select id::text from _o where name = 'a') || '/aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa.jpg'),
  '42501', null, 'a key nobody requested cannot be uploaded to, even with a well-formed shape');
select is((select count(*)::int from storage.objects where bucket_id = 'product-images' and name = (select key from _k where n = 1)), 0,
  'another tenant cannot read the object');
select is(
  (select array_agg(cmd order by cmd) from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname like 'product_images_%'),
  array['DELETE', 'INSERT', 'SELECT', 'SELECT'],
  'the product-images bucket has exactly insert, delete and two select policies — no UPDATE');
select ok((select qual like '%can_delete_product_image_object%' from pg_policies
            where schemaname = 'storage' and tablename = 'objects' and policyname = 'product_images_delete_writer'),
  'deleting an image object requires catalog.write on the OWNING organization (direct SQL deletes are blocked by Storage itself)');
set local request.jwt.claims = :'hana';
select pg_temp.attest_organization_fixture('product',(select key from _k where n = 1));
select lives_ok(format('select public.product_image_confirm_upload(%L)', (select key from _k where n = 1)), 'the owner confirms the verified upload');
select is((select count(*)::int from storage.objects where bucket_id = 'product-images' and name = (select key from _k where n = 1)), 0,
  'private Storage bytes are backend-only, including for the owning organization');

insert into _k select 2, public.product_image_request_upload((select id from _o where name = 'a'), 'image/png');
insert into _k select 3, public.product_image_request_upload((select id from _o where name = 'a'), 'image/webp');
select throws_ok(format('select public.product_image_request_upload(%L, %L)', (select id from _o where name = 'a'), 'image/jpeg'),
  '23514', null, 'a fourth image is refused by the RPC');
reset role;
select throws_ok(
  format($q$insert into public.product_images (product_id, organization_id, object_key, content_type, slot, created_by)
            values (%L, %L, %L, 'image/jpeg', 1, '70000001-0000-4000-8000-000000000001')$q$,
         (select id from _o where name = 'a'), :'orgC',
         :'orgC' || '/' || (select id::text from _o where name = 'a') || '/bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb.jpg'),
  '23514', null, 'the database itself refuses a fourth live image, whoever inserts it');
select throws_ok(
  format($q$insert into public.product_images (product_id, organization_id, object_key, content_type, slot, created_by)
            values (%L, %L, %L, 'image/jpeg', 1, '70000001-0000-4000-8000-000000000001')$q$,
         (select id from _o where name = 'b'), :'orgM',
         :'orgM' || '/' || (select id::text from _o where name = 'b') || '/cccccccc-1111-4111-8111-cccccccccccc.jpg'),
  '23503', null, 'an image cannot name another organization than its product''s');
set local role authenticated;
set local request.jwt.claims = :'hana';
select throws_ok(
  format($q$insert into public.product_images (product_id, organization_id, object_key, content_type, slot, created_by)
            values (%L, %L, %L, 'image/jpeg', 1, auth.uid())$q$, (select id from _o where name = 'b'), :'orgC',
         :'orgC' || '/' || (select id::text from _o where name = 'b') || '/dddddddd-1111-4111-8111-dddddddddddd.jpg'),
  '42501', null, 'product_images cannot be written directly');

-- Upload + confirm the other two, then order and primary image.
select lives_ok(format($q$insert into storage.objects (bucket_id, name) values ('product-images', %L), ('product-images', %L)$q$,
  (select key from _k where n = 2), (select key from _k where n = 3)), 'two more uploads');
select pg_temp.attest_organization_fixture('product',(select key from _k where n = 2));
select pg_temp.attest_organization_fixture('product',(select key from _k where n = 3));
select lives_ok(format('select public.product_image_confirm_upload(%L), public.product_image_confirm_upload(%L)',
  (select key from _k where n = 2), (select key from _k where n = 3)), 'confirm both');
select public.product_audiences_set((select id from _o where name = 'a'), array['showroom_dealer','supplier','manufacturer','importer','contractor','engineer','installer_technician','end_consumer']);
select lives_ok(format('select public.set_product_published(%L, true, %L)', (select id from _o where name = 'a'),
  (select version from public.products where id = (select id from _o where name = 'a'))), 'activate the product with images');
set local request.jwt.claims = :'tarek';
select is((select primary_image_key from public.catalog_products(:'orgM'::uuid) where id = (select id from _o where name = 'a')),
  (select key from _k where n = 1), 'the public catalog derives the primary image (lowest slot)');
select is((select count(*)::int from public.catalog_product_images(:'orgM'::uuid, array[(select id from _o where name = 'a')])), 3,
  'a targeted workspace of another tenant can list the ready images of a PUBLISHED product through the reader (metadata only)');
select is((select count(*)::int from public.product_images where product_id = (select id from _o where name = 'a')), 0,
  'the product_images table itself is no longer readable across tenants');
set local request.jwt.claims = :'hana';
select lives_ok(
  format('select public.product_image_reorder(%L, %L)', (select id from _o where name = 'a'),
    array[(select id from public.product_images where object_key = (select key from _k where n = 3)),
          (select id from public.product_images where object_key = (select key from _k where n = 1)),
          (select id from public.product_images where object_key = (select key from _k where n = 2))]),
  'the owner reorders the images');
set local request.jwt.claims = :'tarek';
select is((select primary_image_key from public.catalog_products(:'orgM'::uuid) where id = (select id from _o where name = 'a')),
  (select key from _k where n = 3), 'the new first image became primary');
set local request.jwt.claims = :'hana';
select throws_ok(
  format('select public.product_image_reorder(%L, %L)', (select id from _o where name = 'a'),
    array[(select id from public.product_images where object_key = (select key from _k where n = 1))]),
  '22023', null, 'an order that omits images is refused');

-- Remove frees a slot; removal is owner-only.
reset role;
create temp table _img2 as select id from public.product_images where object_key = (select key from _k where n = 2);
grant select on _img2 to authenticated;
set local role authenticated;
set local request.jwt.claims = :'tarek';
select throws_ok(format('select public.product_image_remove(%L)', (select id from _img2)),
  '42501', null, 'another tenant cannot remove an image');
set local request.jwt.claims = :'hana';
select is(public.product_image_remove((select id from public.product_images where object_key = (select key from _k where n = 2))),
  (select key from _k where n = 2), 'removal returns the storage key for byte cleanup');
select lives_ok(format('select public.product_image_request_upload(%L, %L)', (select id from _o where name = 'a'), 'image/jpeg'),
  'a removed image frees its slot');

-- Archived products take no image changes.
select lives_ok(format('select public.own_product_set_archived(%L, true, %L)', (select id from _o where name = 'a'),
  (select version from public.products where id = (select id from _o where name = 'a'))), 'archive the product');
select throws_ok(format('select public.product_image_request_upload(%L, %L)', (select id from _o where name = 'a'), 'image/jpeg'),
  '22023', null, 'an archived product takes no new images');

-- H. Base price, structured colors, 250-CHARACTER description (20261015090015) (20261015090005).
set local request.jwt.claims = :'hana';
insert into _o select 'p', public.own_product_create(:'orgC'::uuid, 'Priced paint', 'PRC-1', 'paints', 'pail',
  '[{"name":"Terracotta","hex":"#b96f52"},{"name":"Cream","hex":"#F2E9D8"}]'::jsonb, null, null, null, 'Short text', 159.99);
select ok((select id from _o where name = 'p') is not null, 'a product is created with a price and structured colors');
select is((select base_price from public.product_prices where product_id = (select id from _o where name = 'p')), 159.99::numeric, 'the base price is stored exactly (numeric, no float) in the private price table');
select is((select color_items -> 0 ->> 'hex' from public.products where id = (select id from _o where name = 'p')), '#B96F52', 'a hex value is canonicalized to upper-case #RRGGBB');
select is((select colors from public.products where id = (select id from _o where name = 'p')), array['Terracotta', 'Cream'], 'the legacy names column mirrors the structured colors, in order');
select throws_ok(format('select public.own_product_create(%L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L)', :'orgC', 'Bad price', 'BP-1', 'paints', 'pail', '[]', null, null, null, null, 0), '22023', null, 'a zero price is refused');
select throws_ok(format('select public.own_product_create(%L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L)', :'orgC', 'Bad price', 'BP-2', 'paints', 'pail', '[]', null, null, null, null, -5), '22023', null, 'a negative price is refused');
select throws_ok(format('select public.own_product_create(%L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L)', :'orgC', 'Bad price', 'BP-3', 'paints', 'pail', '[]', null, null, null, null, 1.234), '22023', null, 'a price with more than two decimals is refused');
select throws_ok(format('select public.own_product_create(%L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L)', :'orgC', 'Bad price', 'BP-4', 'paints', 'pail', '[]', null, null, null, null, 100000001), '22023', null, 'an absurd price is refused');
select throws_ok(format('select public.own_product_create(%L, %L, %L, %L, %L, %L)', :'orgC', 'Bad hex', 'BH-1', 'paints', 'pail', '[{"name":"Red","hex":"#GGGGGG"}]'), '22023', null, 'a non-hex color value is refused');
select throws_ok(format('select public.own_product_create(%L, %L, %L, %L, %L, %L)', :'orgC', 'Bad hex', 'BH-2', 'paints', 'pail', '[{"name":"Red","hex":"#fff"}]'), '22023', null, 'a 3-digit hex is refused (canonical form is #RRGGBB)');
select throws_ok(format('select public.own_product_create(%L, %L, %L, %L, %L, %L)', :'orgC', 'Bad hex', 'BH-3', 'paints', 'pail', '[{"name":"Red","hex":"red"}]'), '22023', null, 'a color keyword is refused');
select throws_ok(format('select public.own_product_create(%L, %L, %L, %L, %L, %L)', :'orgC', 'Bad colors', 'BC-1', 'paints', 'pail', '{"name":"Red"}'), '22023', null, 'colors that are not a list are refused');
insert into _o select 'w250', public.own_product_create(:'orgC'::uuid, 'Long text', 'LT-1', 'paints', 'pail', '[]', null, null, null, repeat('a', 250));
select ok((select id from _o where name = 'w250') is not null, 'a 250-character description is accepted');
select throws_ok(format('select public.own_product_create(%L, %L, %L, %L, %L, %L, %L, %L, %L, %L)', :'orgC', 'Long text', 'LT-2', 'paints', 'pail', '[]', null, null, null, repeat('a', 251)), '22023', null, 'a 251-character description is refused');
select lives_ok(format('select public.own_product_create(%L, %L, %L, %L, %L, %L, %L, %L, %L, %L)', :'orgC', 'Arabic text', 'LT-3', 'paints', 'pail', '[]', null, null, null, repeat('ك', 250)), '250 Arabic characters are accepted (characters, not bytes)');
select throws_ok(format('select public.own_product_create(%L, %L, %L, %L, %L, %L, %L, %L, %L, %L)', :'orgC', 'Arabic text', 'LT-4', 'paints', 'pail', '[]', null, null, null, repeat('ك', 251)), '22023', null, '251 Arabic characters are refused');
select throws_ok(format('select public.own_product_create(%L, %L, %L, %L, %L, %L, %L, %L, %L, %L)', :'orgC', 'Words text', 'LT-5', 'paints', 'pail', '[]', null, null, null, (select string_agg('w', ' ') from generate_series(1, 250))), '22023', null, '250 one-letter words (499 characters) are refused: the unit is characters, not words');
select throws_ok(format('select public.own_product_update(%L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L)', (select id from _o where name = 'p'), (select version from public.products where id = (select id from _o where name = 'p')), 'Priced paint', 'PRC-1', 'paints', 'pail', '[]', null, null, null, null, null),
  '22023', null, 'a price, once set, cannot be blanked');
select is(public.own_product_update((select id from _o where name = 'p'), (select version from public.products where id = (select id from _o where name = 'p')), 'Priced paint', 'PRC-1', 'paints', 'pail', '[{"name":"Terracotta","hex":"#B96F52"}]', null, null, null, null, 175.25), 2, 'the price can be changed');
select public.product_audiences_set((select id from _o where name = 'p'), array['showroom_dealer','supplier','manufacturer','importer','contractor','engineer','installer_technician','end_consumer']);
select lives_ok(format('select public.set_product_published(%L, true, %L)', (select id from _o where name = 'p'), (select version from public.products where id = (select id from _o where name = 'p'))),
  'the priced product is published');
select is((select base_price from public.product_prices where product_id = (select id from _o where name = 'p')), 175.25::numeric, 'the owning organization reads (and has updated) its own price');
select throws_ok(format('insert into public.product_prices (product_id, organization_id, base_price) values (%L, %L, 1)', (select id from _o where name = 'w250'), :'orgC'),
  '42501', null, 'even the owner cannot write prices directly (RPC-only)');
set local request.jwt.claims = :'tarek';
select is((select count(*)::int from public.product_prices where product_id = (select id from _o where name = 'p')), 0,
  'another organization cannot read the private price of a PUBLISHED product');
select is((select count(*)::int from public.products where id = (select id from _o where name = 'p')), 0,
  'the products table is no longer readable across tenants: the audience-aware reader is the only door');
select is((select count(*)::int from public.catalog_products(:'orgM'::uuid) where id = (select id from _o where name = 'p')), 1,
  'the published product still appears in the public catalog');
select is((select color_items -> 0 ->> 'name' from public.catalog_products(:'orgM'::uuid) where id = (select id from _o where name = 'p')), 'Terracotta',
  'structured colors are readable by other organizations through the catalog view');
select throws_ok(format('insert into public.product_prices (product_id, organization_id, base_price) values (%L, %L, 1)', (select id from _o where name = 'p'), :'orgC'),
  '42501', null, 'another organization cannot write a price either');
select is((select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'products' and column_name = 'base_price'), 0,
  'products no longer carries a price column that a published-row read could expose');
set local request.jwt.claims = :'tarek';
select throws_ok(format('select public.own_product_update(%L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L, %L)', (select id from _o where name = 'p'), (select version from public.products where id = (select id from _o where name = 'p')), 'Hijack', 'PRC-1', 'paints', 'pail',
  '[{"name":"Evil","hex":"#000000"}]', null, null, null, null, 1), '42501', null, 'another organization cannot change a product''s price or colors');
reset role;
select ok((select not exists (select 1 from public.product_prices where product_id = (select id from _o where name = 'legacy')) and color_items = '[]'::jsonb from public.products where id = (select id from _o where name = 'legacy')),
  'a historical product has no price row and no structured colors, and stays readable');
select lives_ok(format('update public.products set colors = array[%L, %L] where id = %L', 'Sand', 'Grey', (select id from _o where name = 'legacy')),
  'legacy named colors (no structured value) remain a valid state');
select throws_ok(format('update public.products set color_items = %L::jsonb where id = %L', '[{"name":"X","hex":null}]', (select id from _o where name = 'legacy')),
  '23514', null, 'structured colors must mirror the legacy names (one source of truth)');
select is(app.word_count('  hello   world '), 2, 'words are counted on whitespace, ignoring padding');
select is(app.word_count('مرحبا بالعالم الجميل'), 3, 'Arabic words are counted the same way');
select is(app.word_count(null), 0, 'no text is zero words');
select is((select count(*)::int from (select unnest(p.proargnames) n, unnest(p.proargmodes) m from pg_proc p where p.oid = 'public.catalog_products(uuid)'::regprocedure) x where m = 't' and n in ('base_price', 'price')), 0,
  'the catalog reader does not expose the price');
select is((select count(*)::int from (select unnest(p.proargnames) n, unnest(p.proargmodes) m from pg_proc p where p.oid = 'public.catalog_products(uuid)'::regprocedure) x where m = 't' and n = 'color_items'), 1,
  'the catalog reader exposes the structured colors');
set local role authenticated;

-- G. Anonymous callers.
reset role;
set local role anon;
select throws_ok(format('select public.own_product_create(%L, %L, %L, %L, %L)', :'orgC', 'Anon', 'AN-1', 'paints', 'pail'),
  '42501', null, 'anon cannot create products');
select throws_ok(format('select public.own_product_update(%L, 1, %L, %L, %L, %L)', (select id from _o where name = 'a'), 'Anon', 'AN-1', 'paints', 'pail'),
  '42501', null, 'anon cannot edit products');
select throws_ok(format('select public.product_image_request_upload(%L, %L)', (select id from _o where name = 'a'), 'image/png'),
  '42501', null, 'anon cannot request an image upload');
select throws_ok($$select count(*) from public.product_categories$$, '42501', null, 'anon cannot read the taxonomy table');

-- I. Stable colour codes (20261015090013): a library colour keeps its code, an unnamed value is `custom`.
reset role;
set local role authenticated;
set local request.jwt.claims = :'hana';
insert into _o select 'pcode', public.own_product_create(:'orgC'::uuid, 'Coded paint', 'CODE-1', 'paints', 'pail',
  '[{"name":"أحمر","hex":"#c62828","code":"red"},{"name":"لون مخصص #3A5F8A","hex":"#3a5f8a","code":"custom"},{"name":"لون مخصص #112233","hex":"#112233","code":"custom"}]'::jsonb, null, null, null, 'Short text', 120);
select is((select color_items -> 0 ->> 'code' from public.products where id = (select id from _o where name = 'pcode')), 'red', 'a library colour keeps its stable code');
select is((select jsonb_array_length(color_items) from public.products where id = (select id from _o where name = 'pcode')), 3, 'several custom colours may share the reserved custom code (their names differ)');
select is((select color_items -> 1 ->> 'hex' from public.products where id = (select id from _o where name = 'pcode')), '#3A5F8A', 'a custom colour keeps its canonical hex');
select is((select app.normalize_product_color_items('[{"name":"Red","hex":"#C62828","code":"red"},{"name":"أحمر","hex":"#C62828","code":"red"}]'::jsonb)),
  '[{"hex": "#C62828", "code": "red", "name": "Red"}]'::jsonb, 'the same library colour twice (even under two language names) is stored once');
select throws_ok(format('select public.own_product_create(%L, %L, %L, %L, %L, %L)', :'orgC', 'Bad code', 'BCD-1', 'paints', 'pail', '[{"name":"Red","hex":"#C62828","code":"Red Color!"}]'), '22023', null, 'a malformed colour code is refused');
select ok(not ((select color_items -> 0 from public.products where id = (select id from _o where name = 'p')) ? 'code'), 'a colour saved without a code stays valid and gets none');

select * from finish();
rollback;
