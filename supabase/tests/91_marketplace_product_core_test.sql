-- pgTAP: Marketplace Migration 02 — product core
-- (20261013090001_marketplace_product_core.sql).
--
-- Sections, and the failure each one exists to prevent:
--   A. SHAPE        — five tables, RLS on, SELECT-only grants, nothing for anon.
--   B. PRODUCTS     — seller must be a showroom, immutable seller/type, unique slug,
--                     and a product can never be created or moved to "published".
--   C. VARIANTS     — seller-scoped SKU, exact price, unit, no seller/product mismatch.
--   D. VALUES       — field must belong to the product type at the right level, options
--                     must belong to the field, typed shape, no duplicate values.
--   E. COMBINATIONS — a duplicate variant combination fails at the database.
--   F. IMAGES       — metadata only, cross-product variant rejected, one primary.
--   G. PUBLICATION  — fail closed, even for a fully populated product.
--   H. ACCESS       — draft/archived private, tenant isolation, no client writes.
--   I. MAPPINGS     — a mapping in use cannot be deleted; disabling keeps data.
--   J. ISOLATION    — the B2B catalogue is untouched.
--
-- Fixtures (seed-pilot): showroom A 9c000000-…001 (member 70000001), showroom B
-- 91000005-…005 (member 71000005), supplier aaaaaaaa-… (not a showroom),
-- 70000009 (installer, member of neither), 11111111 (given platform moderator HERE).
create extension if not exists pgtap;

begin;
select plan(99);

update auth.users set email_confirmed_at = now()
  where id in ('70000001-0000-4000-8000-000000000001', '71000005-0000-4000-8000-000000000005',
               '70000009-0000-4000-8000-000000000009', '11111111-1111-4111-8111-111111111111');

-- ---------------------------------------------------------------------------
-- fixtures
-- ---------------------------------------------------------------------------
select set_config('t.org_a', '9c000000-cccc-4ccc-8ccc-000000000001', true);
select set_config('t.org_b', '91000005-1111-4111-8111-000000000005', true);
select set_config('t.org_supplier', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);

-- a multi_option and a text field exist only as fixtures (none is seeded)
insert into public.marketplace_attribute_definitions (key, name_ar, name_en, data_type)
values ('zz_tags', 'وسوم', 'Tags', 'multi_option'), ('zz_note', 'ملاحظة', 'Note', 'text');
insert into public.marketplace_attribute_options (attribute_id, key, name_ar, name_en)
select d.id, v.k, v.k, v.k
from public.marketplace_attribute_definitions d, (values ('red'), ('blue')) v(k) where d.key = 'zz_tags';
insert into public.marketplace_product_type_attributes (product_type_id, attribute_id, level)
select t.id, d.id, 'product'
from public.marketplace_product_types t, public.marketplace_attribute_definitions d
where t.key = 'wallpaper' and d.key in ('zz_tags', 'zz_note');

-- products: A1 + A2 (seller A), B1 (seller B)
insert into public.marketplace_products (id, seller_organization_id, product_type_id, slug, name_ar, name_en, external_ref)
select v.id::uuid, v.org::uuid, t.id, v.slug, 'منتج', v.slug, v.ext
from (values
  ('a1000000-0000-4000-8000-000000000001', current_setting('t.org_a'), 'wallpaper',        'test-wallpaper-a1', 'EXT-1'),
  ('a2000000-0000-4000-8000-000000000002', current_setting('t.org_a'), 'wood_alternative', 'test-wood-a2',      null),
  ('b1000000-0000-4000-8000-000000000001', current_setting('t.org_b'), 'wallpaper',        'test-wallpaper-b1', 'EXT-1')
) as v(id, org, type_key, slug, ext)
join public.marketplace_product_types t on t.key = v.type_key;

-- ===========================================================================
-- A. Shape
-- ===========================================================================
select has_table('public'::name, 'marketplace_products'::name,                 'A1. marketplace_products exists');
select has_table('public'::name, 'marketplace_product_variants'::name,         'A2. marketplace_product_variants exists');
select has_table('public'::name, 'marketplace_product_attribute_values'::name, 'A3. marketplace_product_attribute_values exists');
select has_table('public'::name, 'marketplace_variant_attribute_values'::name, 'A4. marketplace_variant_attribute_values exists');
select has_table('public'::name, 'marketplace_product_images'::name,           'A5. marketplace_product_images exists');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
     and c.relname in ('marketplace_products', 'marketplace_product_variants', 'marketplace_product_attribute_values',
                       'marketplace_variant_attribute_values', 'marketplace_product_images')),
  5, 'A6. RLS is enabled on all five tables');
select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'anon'
     and table_name in ('marketplace_products', 'marketplace_product_variants', 'marketplace_product_attribute_values',
                        'marketplace_variant_attribute_values', 'marketplace_product_images')),
  0, 'A7. anon holds NO privilege on any product-core table');
select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('authenticated', 'service_role') and privilege_type <> 'SELECT'
     and table_name in ('marketplace_products', 'marketplace_product_variants', 'marketplace_product_attribute_values',
                        'marketplace_variant_attribute_values', 'marketplace_product_images')),
  0, 'A8. authenticated and service_role hold SELECT only (no write privilege)');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and cmd <> 'SELECT'
     and tablename in ('marketplace_products', 'marketplace_product_variants', 'marketplace_product_attribute_values',
                       'marketplace_variant_attribute_values', 'marketplace_product_images')),
  0, 'A9. there is no insert / update / delete policy on any product-core table');
select is(
  (select indexdef ~ 'UNIQUE.*\(product_id, option_signature\).*WHERE' from pg_indexes
   where indexname = 'ux_marketplace_variants_product_signature'),
  true, 'A10. combination uniqueness is a UNIQUE partial index (race-proof, not a check-then-insert)');
select is(
  (select indexdef ~ 'UNIQUE.*\(seller_organization_id, sku\)' from pg_indexes
   where indexname = 'ux_marketplace_variants_seller_sku'),
  true, 'A11. SKU uniqueness is a UNIQUE index scoped to the seller');
select ok(
  not has_function_privilege('authenticated', 'app.marketplace_publication_blockers(uuid)', 'execute'),
  'A12. no client role can execute the publication-blockers function');

-- ===========================================================================
-- B. Products
-- ===========================================================================
select throws_ok($$ insert into public.marketplace_products (seller_organization_id, product_type_id, slug, name_ar, name_en)
                    select current_setting('t.org_a')::uuid, id, 'test-wallpaper-a1', 'x', 'x' from public.marketplace_product_types where key = 'wallpaper' $$,
  '23505', null, 'B1. a duplicate slug is rejected');
select throws_ok($$ insert into public.marketplace_products (seller_organization_id, product_type_id, slug, name_ar, name_en)
                    select current_setting('t.org_a')::uuid, id, 'Bad Slug', 'x', 'x' from public.marketplace_product_types where key = 'wallpaper' $$,
  '23514', null, 'B2. a slug must be lower-kebab-case');
select throws_ok($$ insert into public.marketplace_products (seller_organization_id, product_type_id, slug, name_ar, name_en)
                    select current_setting('t.org_a')::uuid, id, 'blank-name', '  ', 'x' from public.marketplace_product_types where key = 'wallpaper' $$,
  '23514', null, 'B3. a blank Arabic name is rejected');
select throws_ok($$ insert into public.marketplace_products (seller_organization_id, product_type_id, slug, name_ar, name_en)
                    select current_setting('t.org_supplier')::uuid, id, 'supplier-product', 'x', 'x' from public.marketplace_product_types where key = 'wallpaper' $$,
  '23514', null, 'B4. a non-showroom organization cannot be a seller (V1)');
select throws_ok($$ insert into public.marketplace_products (seller_organization_id, product_type_id, slug, name_ar, name_en)
                    select gen_random_uuid(), id, 'ghost-seller', 'x', 'x' from public.marketplace_product_types where key = 'wallpaper' $$,
  '23514', null, 'B5. an unknown seller organization is rejected');
select throws_ok($$ insert into public.marketplace_products (seller_organization_id, product_type_id, slug, name_ar, name_en)
                    values (current_setting('t.org_a')::uuid, gen_random_uuid(), 'ghost-type', 'x', 'x') $$,
  '23503', null, 'B6. a product must reference a real product type');
select throws_ok($$ insert into public.marketplace_products (seller_organization_id, product_type_id, slug, name_ar, name_en, status)
                    select current_setting('t.org_a')::uuid, id, 'born-published', 'x', 'x', 'published' from public.marketplace_product_types where key = 'wallpaper' $$,
  '23514', null, 'B7. a product cannot be created as published');
select throws_ok($$ insert into public.marketplace_products (seller_organization_id, product_type_id, slug, name_ar, name_en, status)
                    select current_setting('t.org_a')::uuid, id, 'bad-status', 'x', 'x', 'live' from public.marketplace_product_types where key = 'wallpaper' $$,
  '23514', null, 'B8. an unknown status is rejected');
select throws_ok($$ update public.marketplace_products set seller_organization_id = current_setting('t.org_b')::uuid
                    where id = 'a1000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'B9. the seller of a product is immutable');
select throws_ok($$ update public.marketplace_products
                    set product_type_id = (select id from public.marketplace_product_types where key = 'cornice')
                    where id = 'a1000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'B10. the product type of a product is immutable');
select throws_ok($$ insert into public.marketplace_products (seller_organization_id, product_type_id, slug, name_ar, name_en, external_ref)
                    select current_setting('t.org_a')::uuid, id, 'dup-ext', 'x', 'x', 'EXT-1' from public.marketplace_product_types where key = 'wallpaper' $$,
  '23505', null, 'B11. an external reference is unique per seller');
select is(
  (select count(*)::int from public.marketplace_products where external_ref = 'EXT-1'),
  2, 'B12. ...but the same external reference may exist for a different seller');

-- ===========================================================================
-- C. Variants
-- ===========================================================================
insert into public.marketplace_product_variants (id, product_id, seller_organization_id, sku, selling_unit, price_egp)
values ('a1100000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', current_setting('t.org_a')::uuid, 'WP-001', 'roll', 550.00),
       ('a1100000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', current_setting('t.org_a')::uuid, 'WP-002', 'roll', 560.00),
       ('b1100000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', current_setting('t.org_b')::uuid, 'WP-001', 'roll', 510.00);

select is((select count(*)::int from public.marketplace_product_variants where sku = 'WP-001'), 2,
  'C1. the same SKU may exist for two different sellers');
select throws_ok($$ insert into public.marketplace_product_variants (product_id, seller_organization_id, sku, selling_unit, price_egp)
                    values ('a2000000-0000-4000-8000-000000000002', current_setting('t.org_a')::uuid, 'WP-001', 'board', 10) $$,
  '23505', null, 'C2. a SKU is unique within one seller (across that seller''s products)');
select throws_ok($$ insert into public.marketplace_product_variants (product_id, seller_organization_id, sku, selling_unit, price_egp)
                    values ('a1000000-0000-4000-8000-000000000001', current_setting('t.org_b')::uuid, 'MISMATCH', 'roll', 10) $$,
  '23503', null, 'C3. a variant cannot name a seller different from its product''s seller');
select throws_ok($$ insert into public.marketplace_product_variants (product_id, seller_organization_id, sku, selling_unit, price_egp)
                    values ('a1000000-0000-4000-8000-000000000001', current_setting('t.org_a')::uuid, 'ZERO', 'roll', 0) $$,
  '23514', null, 'C4. a zero price is rejected');
select throws_ok($$ insert into public.marketplace_product_variants (product_id, seller_organization_id, sku, selling_unit, price_egp)
                    values ('a1000000-0000-4000-8000-000000000001', current_setting('t.org_a')::uuid, 'NEG', 'roll', -5) $$,
  '23514', null, 'C5. a negative price is rejected');
select throws_ok($$ insert into public.marketplace_product_variants (product_id, seller_organization_id, sku, selling_unit, price_egp)
                    values ('a1000000-0000-4000-8000-000000000001', current_setting('t.org_a')::uuid, 'UNIT', 'bucket', 5) $$,
  '23514', null, 'C6. an unknown selling unit is rejected');
select throws_ok($$ insert into public.marketplace_product_variants (product_id, seller_organization_id, sku, selling_unit, price_egp)
                    values ('a1000000-0000-4000-8000-000000000001', current_setting('t.org_a')::uuid, 'bad sku!', 'roll', 5) $$,
  '23514', null, 'C7. a SKU with spaces or symbols is rejected');
insert into public.marketplace_product_variants (id, product_id, seller_organization_id, sku, selling_unit, price_egp)
values ('a1100000-0000-4000-8000-000000000009', 'a1000000-0000-4000-8000-000000000001', current_setting('t.org_a')::uuid, 'PREC', 'roll', 100.456);
select is((select price_egp::text from public.marketplace_product_variants where sku = 'PREC'), '100.46',
  'C8. price is exact numeric(12,2): 100.456 is stored as 100.46');
select throws_ok($$ update public.marketplace_product_variants set product_id = 'a2000000-0000-4000-8000-000000000002'
                    where id = 'a1100000-0000-4000-8000-000000000001' $$,
  '23514', null, 'C9. a variant cannot move to another product');
select is(
  (select count(*)::int from information_schema.columns
   where table_schema = 'public' and table_name = 'marketplace_product_variants'
     and (column_name ilike '%vat%' or column_name ilike '%tax%')),
  0, 'C10. no VAT / tax column exists (prices are exclusive; no hardcoded rate)');

-- ===========================================================================
-- D. Attribute values
-- ===========================================================================
insert into public.marketplace_product_attribute_values (product_id, attribute_id, option_id)
select 'a1000000-0000-4000-8000-000000000001', d.id, o.id
from public.marketplace_attribute_definitions d
join public.marketplace_attribute_options o on o.attribute_id = d.id and o.key = 'vinyl'
where d.key = 'material_wallpaper';

select is(
  (select data_type from public.marketplace_product_attribute_values
   where product_id = 'a1000000-0000-4000-8000-000000000001'),
  'option', 'D1. data_type is copied from the definition by the database');
select throws_ok($$ insert into public.marketplace_product_attribute_values (product_id, attribute_id, option_id)
                    select 'a1000000-0000-4000-8000-000000000001', d.id, o.id
                    from public.marketplace_attribute_definitions d
                    join public.marketplace_attribute_options o on o.attribute_id = d.id and o.key = 'paper'
                    where d.key = 'material_wallpaper' $$,
  '23505', null, 'D2. a single-valued field cannot hold two values');
select throws_ok($$ insert into public.marketplace_product_attribute_values (product_id, attribute_id, option_id)
                    select 'a2000000-0000-4000-8000-000000000002', d.id, o.id
                    from public.marketplace_attribute_definitions d
                    join public.marketplace_attribute_options o on o.attribute_id = d.id and o.key = 'vinyl'
                    where d.key = 'material_wallpaper' $$,
  '23514', null, 'D3. a field of ANOTHER product type is rejected (wallpaper material on a wood alternative)');
select throws_ok($$ insert into public.marketplace_product_attribute_values (product_id, attribute_id, option_id)
                    select 'a1000000-0000-4000-8000-000000000001', d.id, o.id
                    from public.marketplace_attribute_definitions d
                    join public.marketplace_attribute_options o on o.attribute_id = d.id and o.key = 'beige'
                    where d.key = 'color' $$,
  '23514', null, 'D4. a variant-level field cannot be stored at product level');
select throws_ok($$ insert into public.marketplace_product_attribute_values (product_id, attribute_id, option_id)
                    select 'a1000000-0000-4000-8000-000000000001', d.id, o.id
                    from public.marketplace_attribute_definitions d
                    join public.marketplace_attribute_options o on o.key = 'gold' and o.attribute_id =
                      (select id from public.marketplace_attribute_definitions where key = 'color')
                    where d.key = 'pattern_wallpaper' $$,
  '23514', null, 'D5. an option that belongs to a different field is rejected (guard + composite key backstop)');
select throws_ok($$ insert into public.marketplace_product_attribute_values (product_id, attribute_id, value_text)
                    select 'a1000000-0000-4000-8000-000000000001', id, 'free text' from public.marketplace_attribute_definitions where key = 'pattern_wallpaper' $$,
  '23514', null, 'D6. a text value for an option field violates the typed shape');
select lives_ok($$ insert into public.marketplace_product_attribute_values (product_id, attribute_id, value_text)
                   select 'a1000000-0000-4000-8000-000000000001', id, 'handle with care' from public.marketplace_attribute_definitions where key = 'zz_note' $$,
  'D7. a text field accepts a text value');
select lives_ok($$ insert into public.marketplace_product_attribute_values (product_id, attribute_id, value_boolean)
                   select 'a1000000-0000-4000-8000-000000000001', id, true from public.marketplace_attribute_definitions where key = 'washable' $$,
  'D8. a boolean field accepts a boolean value');
select lives_ok($$ insert into public.marketplace_product_attribute_values (product_id, attribute_id, option_id)
                   select 'a1000000-0000-4000-8000-000000000001', d.id, o.id
                   from public.marketplace_attribute_definitions d join public.marketplace_attribute_options o on o.attribute_id = d.id and o.key = 'red'
                   where d.key = 'zz_tags' $$,
  'D9. a multi_option field accepts a first option');
select lives_ok($$ insert into public.marketplace_product_attribute_values (product_id, attribute_id, option_id)
                   select 'a1000000-0000-4000-8000-000000000001', d.id, o.id
                   from public.marketplace_attribute_definitions d join public.marketplace_attribute_options o on o.attribute_id = d.id and o.key = 'blue'
                   where d.key = 'zz_tags' $$,
  'D10. ...and a second option');
select throws_ok($$ insert into public.marketplace_product_attribute_values (product_id, attribute_id, option_id)
                    select 'a1000000-0000-4000-8000-000000000001', d.id, o.id
                    from public.marketplace_attribute_definitions d join public.marketplace_attribute_options o on o.attribute_id = d.id and o.key = 'red'
                    where d.key = 'zz_tags' $$,
  '23505', null, 'D11. the same multi_option choice cannot be stored twice');

-- variant level: measurement
insert into public.marketplace_variant_attribute_values (variant_id, attribute_id, value_number)
select 'a1100000-0000-4000-8000-000000000001', id, 530 from public.marketplace_attribute_definitions where key = 'roll_width';
select is(
  (select data_type || ':' || value_number::text from public.marketplace_variant_attribute_values
   where variant_id = 'a1100000-0000-4000-8000-000000000001'),
  'measurement:530.0000', 'D12. a measurement is stored numerically (canonical mm) with its data_type');
select throws_ok($$ insert into public.marketplace_variant_attribute_values (variant_id, attribute_id, value_number)
                    select 'a1100000-0000-4000-8000-000000000001', id, 0 from public.marketplace_attribute_definitions where key = 'roll_length' $$,
  '23514', null, 'D13. a measurement must be positive');
select throws_ok($$ insert into public.marketplace_variant_attribute_values (variant_id, attribute_id, value_number)
                    select 'a1100000-0000-4000-8000-000000000001', id, 8 from public.marketplace_attribute_definitions where key = 'thickness' $$,
  '23514', null, 'D14. a field not mapped to the variant''s product type is rejected');
select throws_ok($$ insert into public.marketplace_variant_attribute_values (variant_id, attribute_id, option_id)
                    select 'a1100000-0000-4000-8000-000000000001', d.id, o.id
                    from public.marketplace_attribute_definitions d join public.marketplace_attribute_options o on o.attribute_id = d.id and o.key = 'vinyl'
                    where d.key = 'material_wallpaper' $$,
  '23514', null, 'D15. a product-level field cannot be stored at variant level');
-- Option activity: a retired option cannot be newly chosen
update public.marketplace_attribute_options set is_active = false
  where key = 'beige' and attribute_id = (select id from public.marketplace_attribute_definitions where key = 'color');
select throws_ok($$ insert into public.marketplace_variant_attribute_values (variant_id, attribute_id, option_id)
                    select 'a1100000-0000-4000-8000-000000000001', d.id, o.id
                    from public.marketplace_attribute_definitions d join public.marketplace_attribute_options o on o.attribute_id = d.id and o.key = 'beige'
                    where d.key = 'color' $$,
  '23514', null, 'D16. an inactive option cannot be newly chosen');
update public.marketplace_attribute_options set is_active = true
  where key = 'beige' and attribute_id = (select id from public.marketplace_attribute_definitions where key = 'color');

-- ===========================================================================
-- E. Option combinations
-- ===========================================================================
insert into public.marketplace_variant_attribute_values (variant_id, attribute_id, option_id)
select 'a1100000-0000-4000-8000-000000000001', d.id, o.id
from public.marketplace_attribute_definitions d join public.marketplace_attribute_options o on o.attribute_id = d.id and o.key = 'cream'
where d.key = 'color';
select isnt((select option_signature from public.marketplace_product_variants where id = 'a1100000-0000-4000-8000-000000000001'),
  null, 'E1. a variant with axis values gets a canonical option signature');
select is((select option_signature from public.marketplace_product_variants where id = 'a1100000-0000-4000-8000-000000000002'),
  null, 'E2. a variant with no axis value has no signature (several may coexist while drafting)');

-- WP-002 takes the same colour AND roll width as WP-001 -> the second value completes a duplicate
insert into public.marketplace_variant_attribute_values (variant_id, attribute_id, option_id)
select 'a1100000-0000-4000-8000-000000000002', d.id, o.id
from public.marketplace_attribute_definitions d join public.marketplace_attribute_options o on o.attribute_id = d.id and o.key = 'cream'
where d.key = 'color';
select throws_ok($$ insert into public.marketplace_variant_attribute_values (variant_id, attribute_id, value_number)
                    select 'a1100000-0000-4000-8000-000000000002', id, 530 from public.marketplace_attribute_definitions where key = 'roll_width' $$,
  '23505', null, 'E3. completing a DUPLICATE combination (same colour + roll width) is rejected by the database');
select lives_ok($$ insert into public.marketplace_variant_attribute_values (variant_id, attribute_id, value_number)
                   select 'a1100000-0000-4000-8000-000000000002', id, 1060 from public.marketplace_attribute_definitions where key = 'roll_width' $$,
  'E4. a different roll width makes a distinct, valid combination');
select is(
  (select count(distinct option_signature)::int from public.marketplace_product_variants
   where product_id = 'a1000000-0000-4000-8000-000000000001' and option_signature is not null),
  2, 'E5. each variant now carries its own signature');
select is(
  (select option_signature from public.marketplace_product_variants where id = 'b1100000-0000-4000-8000-000000000001'),
  null, 'E6. another seller''s variant is unaffected');
select lives_ok($$ update public.marketplace_product_variants set option_signature = 'forged' where id = 'a1100000-0000-4000-8000-000000000001' $$,
  'E7. a direct write to option_signature does not error...');
select isnt((select option_signature from public.marketplace_product_variants where id = 'a1100000-0000-4000-8000-000000000001'),
  'forged', 'E8. ...and is ignored: the signature is trigger-owned');

-- ===========================================================================
-- F. Images (metadata only)
-- ===========================================================================
insert into public.marketplace_product_images (id, product_id, storage_provider, storage_bucket, object_key, sort_order, is_primary, status)
values ('a1f00000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'supabase_storage', 'marketplace-products',
        'orgs/a/products/a1/main.webp', 0, true, 'verified');

select throws_ok($$ insert into public.marketplace_product_images (product_id, variant_id, storage_provider, storage_bucket, object_key, sort_order)
                    values ('a1000000-0000-4000-8000-000000000001', 'b1100000-0000-4000-8000-000000000001',
                            'supabase_storage', 'marketplace-products', 'orgs/a/cross.webp', 5) $$,
  '23503', null, 'F1. an image cannot reference a variant of ANOTHER product');
select lives_ok($$ insert into public.marketplace_product_images (product_id, variant_id, storage_provider, storage_bucket, object_key, sort_order)
                   values ('a1000000-0000-4000-8000-000000000001', 'a1100000-0000-4000-8000-000000000001',
                           'supabase_storage', 'marketplace-products', 'orgs/a/products/a1/v1.webp', 0) $$,
  'F2. an image may belong to a variant of the same product');
select throws_ok($$ insert into public.marketplace_product_images (product_id, storage_provider, storage_bucket, object_key, sort_order, is_primary)
                    values ('a1000000-0000-4000-8000-000000000001', 'supabase_storage', 'marketplace-products', 'orgs/a/second-primary.webp', 1, true) $$,
  '23505', null, 'F3. a second ACTIVE primary product image is rejected');
update public.marketplace_product_images set status = 'rejected' where id = 'a1f00000-0000-4000-8000-000000000001';
select lives_ok($$ insert into public.marketplace_product_images (product_id, storage_provider, storage_bucket, object_key, sort_order, is_primary)
                   values ('a1000000-0000-4000-8000-000000000001', 'supabase_storage', 'marketplace-products', 'orgs/a/second-primary.webp', 1, true) $$,
  'F4. a rejected image no longer holds the primary slot');
select throws_ok($$ insert into public.marketplace_product_images (product_id, storage_provider, storage_bucket, object_key, sort_order)
                    values ('a1000000-0000-4000-8000-000000000001', 'supabase_storage', 'marketplace-products', 'orgs/a/dup-order.webp', 1) $$,
  '23505', null, 'F5. two product-level images cannot share a sort position');
select throws_ok($$ insert into public.marketplace_product_images (product_id, storage_provider, storage_bucket, object_key, sort_order)
                    values ('a1000000-0000-4000-8000-000000000001', 'supabase_storage', 'marketplace-products', 'orgs/a/products/a1/v1.webp', 9) $$,
  '23505', null, 'F6. an object location can be registered only once');
select throws_ok($$ insert into public.marketplace_product_images (product_id, storage_provider, storage_bucket, object_key, sort_order)
                    values ('a1000000-0000-4000-8000-000000000001', 'supabase_storage', 'marketplace-products',
                            'https://cdn.example.com/a.webp?token=abc', 9) $$,
  '23514', null, 'F7. a URL (signed or public) is rejected as an object key');
select throws_ok($$ insert into public.marketplace_product_images (product_id, storage_provider, storage_bucket, object_key, sort_order)
                    values ('a1000000-0000-4000-8000-000000000001', 'supabase_storage', 'marketplace-products', 'orgs/a/x.webp?X-Amz-Signature=1', 9) $$,
  '23514', null, 'F8. a key carrying a query string is rejected');
select throws_ok($$ insert into public.marketplace_product_images (product_id, storage_provider, storage_bucket, object_key, sort_order)
                    values ('a1000000-0000-4000-8000-000000000001', 'supabase_storage', 'marketplace-products', 'orgs/../secrets/x.webp', 9) $$,
  '23514', null, 'F9. a key with path traversal is rejected');
select throws_ok($$ insert into public.marketplace_product_images (product_id, storage_provider, storage_bucket, object_key, sort_order)
                    values ('a1000000-0000-4000-8000-000000000001', 'supabase_storage', 'marketplace-products', '/abs/path.webp', 9) $$,
  '23514', null, 'F10. an absolute path is rejected');
select throws_ok($$ insert into public.marketplace_product_images (product_id, storage_provider, storage_bucket, object_key, sort_order)
                    values ('a1000000-0000-4000-8000-000000000001', 'ftp', 'marketplace-products', 'orgs/a/y.webp', 9) $$,
  '23514', null, 'F11. an unknown storage provider is rejected');

-- ===========================================================================
-- G. Publication fails closed
-- ===========================================================================
select ok(
  (select 'missing_product_attribute:material_wallpaper' = any(app.marketplace_publication_blockers('b1000000-0000-4000-8000-000000000001'))),
  'G1. an empty product reports its missing required product-level field (read from the live mapping)');
select ok(
  (select 'seller_not_approved' = any(app.marketplace_publication_blockers('a1000000-0000-4000-8000-000000000001'))
      and 'no_available_stock' = any(app.marketplace_publication_blockers('a1000000-0000-4000-8000-000000000001'))),
  'G2. a populated product of an unapproved seller reports seller_not_approved and no_available_stock');
select throws_ok($$ update public.marketplace_products set status = 'published' where id = 'a1000000-0000-4000-8000-000000000001' $$,
  '23514', null, 'G3. publishing a product is refused');
select throws_ok($$ update public.marketplace_products set status = 'published', published_at = now()
                    where id = 'a2000000-0000-4000-8000-000000000002' $$,
  '23514', null, 'G4. ...including for an empty product with a forged publication time');
select is((select status from public.marketplace_products where id = 'a1000000-0000-4000-8000-000000000001'), 'draft',
  'G5. the product is still a draft');
select lives_ok($$ update public.marketplace_products set status = 'archived' where id = 'a2000000-0000-4000-8000-000000000002' $$,
  'G6. archiving is allowed');
select lives_ok($$ update public.marketplace_products set status = 'draft' where id = 'a2000000-0000-4000-8000-000000000002' $$,
  'G7. returning an archived product to draft is allowed');
select lives_ok($$ update public.marketplace_products set status = 'archived' where id = 'a2000000-0000-4000-8000-000000000002' $$,
  'G8. (archive it again for the visibility checks)');

-- ===========================================================================
-- H. Access: drafts/archived private, tenant isolation, no client writes
-- ===========================================================================
reset role;
set local role anon;
select throws_ok($$ select count(*) from public.marketplace_products $$, '42501', null,
  'H1. anon cannot read the products table at all');
select throws_ok($$ select count(*) from public.marketplace_product_images $$, '42501', null,
  'H2. anon cannot read image metadata (bucket / key stay private)');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select is((select count(*)::int from public.marketplace_products), 2,
  'H3. a member of showroom A sees exactly A''s two products (draft and archived included)');
select is((select count(*)::int from public.marketplace_products where seller_organization_id = current_setting('t.org_b')::uuid), 0,
  'H4. ...and none of showroom B''s');
select is((select count(*)::int from public.marketplace_product_variants), 3,
  'H5. A''s member sees only A''s variants');
select is((select count(*)::int from public.marketplace_product_images), 3,
  'H6. ...and only A''s image metadata');
select throws_ok($$ insert into public.marketplace_products (seller_organization_id, product_type_id, slug, name_ar, name_en)
                    select current_setting('t.org_a')::uuid, id, 'client-write', 'x', 'x' from public.marketplace_product_types where key = 'wallpaper' $$,
  '42501', null, 'H7. a seller''s own member cannot insert directly (writes are trusted-path only)');
select throws_ok($$ update public.marketplace_products set name_en = 'hacked' where id = 'a1000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'H8. ...nor update');
select throws_ok($$ update public.marketplace_products set name_en = 'hacked' where id = 'b1000000-0000-4000-8000-000000000001' $$,
  '42501', null, 'H9. ...and certainly not another seller''s product');
select throws_ok($$ delete from public.marketplace_product_variants $$, '42501', null,
  'H10. ...nor delete variants');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"71000005-0000-4000-8000-000000000005","role":"authenticated"}';
select is((select count(*)::int from public.marketplace_products), 1,
  'H11. a member of showroom B sees only B''s product');
select is((select slug from public.marketplace_products), 'test-wallpaper-b1', 'H12. ...the right one');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';
select is((select count(*)::int from public.marketplace_products), 0,
  'H13. a signed-in user with no seller membership sees no marketplace product (no draft leaks)');
select is((select count(*)::int from public.marketplace_product_attribute_values), 0,
  'H14. ...and no attribute value');
reset role;

insert into public.platform_role_grants (user_id, role, granted_by)
values ('11111111-1111-4111-8111-111111111111', 'moderator', '11111111-1111-4111-8111-111111111111');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select is((select count(*)::int from public.marketplace_products), 3, 'H15. platform staff read every product');
reset role;

-- ===========================================================================
-- I. Mappings in use
-- ===========================================================================
select throws_ok($$ delete from public.marketplace_product_type_attributes
                    where product_type_id = (select id from public.marketplace_product_types where key = 'wallpaper')
                      and attribute_id = (select id from public.marketplace_attribute_definitions where key = 'material_wallpaper') $$,
  '23503', null, 'I1. a mapping that products already use cannot be deleted');
select throws_ok($$ update public.marketplace_product_type_attributes set level = 'variant'
                    where product_type_id = (select id from public.marketplace_product_types where key = 'wallpaper')
                      and attribute_id = (select id from public.marketplace_attribute_definitions where key = 'material_wallpaper') $$,
  '23503', null, 'I2. ...nor moved to another level');
select lives_ok($$ update public.marketplace_product_type_attributes set is_active = false
                   where product_type_id = (select id from public.marketplace_product_types where key = 'wallpaper')
                     and attribute_id = (select id from public.marketplace_attribute_definitions where key = 'material_wallpaper') $$,
  'I3. it can be switched off');
select is(
  (select count(*)::int from public.marketplace_product_attribute_values v
   join public.marketplace_attribute_definitions d on d.id = v.attribute_id where d.key = 'material_wallpaper'),
  1, 'I4. ...and the stored value is kept');
select throws_ok($$ delete from public.marketplace_attribute_definitions where key = 'material_wallpaper' $$,
  '23503', null, 'I5. a field definition holding values cannot be deleted');

-- ===========================================================================
-- J. Nothing existing was touched
-- ===========================================================================
select is(
  (select count(*)::int from information_schema.columns
   where table_schema = 'public' and table_name = 'products' and column_name like 'marketplace%'),
  0, 'J1. public.products (B2B catalogue) gained no marketplace column');
select is(
  (select count(*)::int from pg_constraint c
   join pg_class src on src.oid = c.conrelid and src.relname in
     ('marketplace_products', 'marketplace_product_variants', 'marketplace_product_attribute_values',
      'marketplace_variant_attribute_values', 'marketplace_product_images')
   join pg_class dst on dst.oid = c.confrelid
   where c.contype = 'f' and dst.relname not like 'marketplace\_%' and dst.relname <> 'organizations'),
  0, 'J2. the product-core tables reference no existing table except organizations');

select * from finish();
rollback;
