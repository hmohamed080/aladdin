-- pgTAP: Marketplace Migration 01 — product taxonomy + dynamic attribute definitions
-- (20261012090001_marketplace_taxonomy_and_attributes.sql).
--
-- What must stay true, and the failure each section exists to prevent:
--   A. SHAPE        — the five tables exist, RLS is ON, keys are unique and shaped.
--   B. SEED         — the seven categories and fifteen approved types are present (six from\n--                     Migration 01, nine from Migration 08), and each
--                     type carries a sensible field schema (not one hard-coded table per type).
--   C. PUBLIC READ  — anon reads ACTIVE reference data and never an inactive row.
--   D. NO WRITES    — no client role can insert / update / delete reference data. A
--                     browser that can rename a field turns canonical data into content.
--   E. INTEGRITY    — duplicate keys, bad key shape, a measurement with no unit, options on
--                     a non-option field, mutating a field's identity, an axis on a product-
--                     level mapping, and deleting a category that still has types all fail.
--   F. STAFF        — platform staff (and only staff) see inactive rows.
--   G. ISOLATION    — the B2B catalogue and every existing table are untouched.
create extension if not exists pgtap;

begin;
select plan(63);

update auth.users set email_confirmed_at = now()
  where id in ('11111111-1111-4111-8111-111111111111', '70000009-0000-4000-8000-000000000009');

-- ===========================================================================
-- A. Shape
-- ===========================================================================
select has_table('public'::name, 'marketplace_categories'::name,              'A1. marketplace_categories exists');
select has_table('public'::name, 'marketplace_product_types'::name,           'A2. marketplace_product_types exists');
select has_table('public'::name, 'marketplace_attribute_definitions'::name,   'A3. marketplace_attribute_definitions exists');
select has_table('public'::name, 'marketplace_product_type_attributes'::name, 'A4. marketplace_product_type_attributes exists');
select has_table('public'::name, 'marketplace_attribute_options'::name,       'A5. marketplace_attribute_options exists');

select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
     and c.relname in ('marketplace_categories', 'marketplace_product_types', 'marketplace_attribute_definitions',
                       'marketplace_product_type_attributes', 'marketplace_attribute_options')),
  5, 'A6. all five taxonomy / attribute tables have row level security ENABLED');
select is(
  (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and c.relname in ('marketplace_categories', 'marketplace_product_types', 'marketplace_attribute_definitions',
                       'marketplace_product_type_attributes', 'marketplace_attribute_options')),
  5, 'A7. the five taxonomy / attribute tables exist (product tables arrive in later migrations)');

select col_is_pk('public'::name, 'marketplace_product_type_attributes'::name,
  array['product_type_id', 'attribute_id']::name[],
  'A8. a type-attribute mapping is keyed on (type, attribute)');
select col_is_unique('public'::name, 'marketplace_product_types'::name, 'key', 'A9. product type key is unique');
select has_index('public'::name, 'marketplace_product_types'::name, 'ix_marketplace_product_types_category'::name,
  'A10. the category foreign key is indexed');

-- ===========================================================================
-- B. Seed
-- ===========================================================================
select is((select count(*)::int from public.marketplace_categories where is_active), 7, 'B1. seven active categories (three from Migration 01, four from Migration 08)');
select is(
  (select array_agg(key order by sort_order) from public.marketplace_product_types where is_active),
  array['wallpaper', 'wood_alternative', 'marble_alternative', 'sheeboard', 'cornice', 'corner_trim',
         'wall_panel', 'skirting', 'interior_door', 'armored_door', 'vinyl_flooring', 'spc_flooring',
         'hdf_flooring', 'curtain', 'poster', 'paint'],
  'B2. exactly the sixteen approved product types, in the approved order (HDF from Migration 11)');
select is(
  (select c.key from public.marketplace_product_types t join public.marketplace_categories c on c.id = t.category_id
   where t.key = 'cornice'),
  'cornices_mouldings', 'B3. cornices sit under Cornices & Mouldings');
select is(
  (select count(*)::int from public.marketplace_product_types t join public.marketplace_categories c on c.id = t.category_id
   where c.key = 'wall_coverings_panels'),
  6, 'B4. six types sit under Wall Coverings & Decorative Panels (incl. wall panels and posters)');
select is(
  (select count(*)::int from public.marketplace_product_types where name_ar is null or name_en is null),
  0, 'B5. every type has Arabic and English names');

select is(
  (select count(*)::int from public.marketplace_product_types t
   where not exists (select 1 from public.marketplace_product_type_attributes a
                     where a.product_type_id = t.id and a.level = 'product' and a.is_required)),
  0, 'B6. every seeded type has at least one required product-level field');
select is(
  (select count(*)::int from public.marketplace_product_types t
   where not exists (select 1 from public.marketplace_product_type_attributes a
                     where a.product_type_id = t.id and a.is_variant_axis)),
  0, 'B7. every seeded type has at least one variant-defining field');
select is(
  (select a.is_required from public.marketplace_product_type_attributes a
   join public.marketplace_product_types t on t.id = a.product_type_id
   join public.marketplace_attribute_definitions d on d.id = a.attribute_id
   where t.key = 'sheeboard' and d.key = 'material_sheeboard'),
  true, 'B8. a sheeboard must state its ACTUAL material (never defaulted)');
select ok(
  exists (select 1 from public.marketplace_product_type_attributes a
          join public.marketplace_product_types t on t.id = a.product_type_id
          join public.marketplace_attribute_definitions d on d.id = a.attribute_id
          where t.key = 'wallpaper' and d.key = 'roll_width' and a.level = 'variant'),
  'B9. wallpaper carries a ROLL width at variant level');
select ok(
  not exists (select 1 from public.marketplace_product_type_attributes a
              join public.marketplace_product_types t on t.id = a.product_type_id
              join public.marketplace_attribute_definitions d on d.id = a.attribute_id
              where t.key = 'wallpaper' and d.key in ('thickness', 'length', 'width')),
  'B10. wallpaper is NOT forced to carry panel length / width / thickness');
select is(
  (select a.name_en_override from public.marketplace_product_type_attributes a
   join public.marketplace_product_types t on t.id = a.product_type_id
   join public.marketplace_attribute_definitions d on d.id = a.attribute_id
   where t.key = 'cornice' and d.key = 'length'),
  'Bar length', 'B11. a type may relabel a shared field (cornice "Bar length")');
select is(
  (select count(*)::int from public.marketplace_attribute_options o
   join public.marketplace_attribute_definitions d on d.id = o.attribute_id
   where d.data_type not in ('option', 'multi_option')),
  0, 'B12. only option fields own options');
select is(
  (select count(*)::int from public.marketplace_attribute_options o
   join public.marketplace_attribute_definitions d on d.id = o.attribute_id
   where d.key = 'color'),
  24, 'B13. the shared colour catalogue carries 24 colours (19 + 5 added for paints and curtains)');
select is(
  (select count(*)::int from public.marketplace_attribute_definitions
   where data_type = 'measurement' and unit_kind is null),
  0, 'B14. every measurement field names its canonical unit kind');

-- ===========================================================================
-- C. Public read: active rows only
-- ===========================================================================
reset role;
insert into public.marketplace_categories (key, name_ar, name_en, is_active)
  values ('hidden_category_fixture', 'مخفي', 'Hidden', false);
insert into public.marketplace_product_types (category_id, key, name_ar, name_en, is_active)
  values ((select id from public.marketplace_categories where key = 'hidden_category_fixture'),
          'hidden_type_fixture', 'مخفي', 'Hidden', true);
insert into public.marketplace_attribute_definitions (key, name_ar, name_en, data_type, is_active)
  values ('retired_field_fixture', 'محذوف', 'Retired', 'text', false);

set local role anon;
select is((select count(*)::int from public.marketplace_categories), 7,
  'C1. anon reads the seven ACTIVE categories and not the retired fixture');
select is((select count(*)::int from public.marketplace_product_types), 16,
  'C2. anon reads the sixteen types; a type under an inactive category is withheld');
select is((select count(*)::int from public.marketplace_attribute_definitions where key = 'retired_field_fixture'), 0,
  'C3. anon does not see an inactive field definition');
select ok((select count(*)::int from public.marketplace_product_type_attributes) > 0,
  'C4. anon reads the type-field mappings');
select ok((select count(*)::int from public.marketplace_attribute_options) > 0,
  'C5. anon reads the field options');
reset role;

-- ===========================================================================
-- D. No client write path, in any role
-- ===========================================================================
set local role anon;
select throws_ok($$ insert into public.marketplace_categories (key, name_ar, name_en) values ('x_anon', 'x', 'x') $$,
  '42501', null, 'D1. anon cannot insert a category');
select throws_ok($$ update public.marketplace_product_types set name_en = 'Hacked' $$,
  '42501', null, 'D2. anon cannot update a product type');
select throws_ok($$ delete from public.marketplace_attribute_options $$,
  '42501', null, 'D3. anon cannot delete options');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';
select throws_ok($$ insert into public.marketplace_attribute_definitions (key, name_ar, name_en, data_type) values ('x_auth', 'x', 'x', 'text') $$,
  '42501', null, 'D4. an ordinary signed-in user cannot create a global attribute definition');
select throws_ok($$ update public.marketplace_attribute_definitions set is_active = false $$,
  '42501', null, 'D5. an ordinary signed-in user cannot disable a field');
select throws_ok($$ insert into public.marketplace_product_type_attributes (product_type_id, attribute_id, level)
                    select t.id, d.id, 'product' from public.marketplace_product_types t, public.marketplace_attribute_definitions d limit 1 $$,
  '42501', null, 'D6. an ordinary signed-in user cannot map a field to a type');
select is((select count(*)::int from public.marketplace_product_types), 16,
  'D7. a signed-in non-staff user sees the same sixteen active types');
reset role;

select is(
  (select count(*)::int from information_schema.role_table_grants
   where grantee in ('anon', 'authenticated', 'service_role') and table_schema = 'public'
     and table_name like 'marketplace\_%' and privilege_type <> 'SELECT'),
  0, 'D8. no role holds any non-SELECT privilege on any marketplace_* table');
select is(
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename like 'marketplace\_%'
     and cmd <> 'SELECT'),
  0, 'D9. there is no insert / update / delete policy on any marketplace_* table');

-- ===========================================================================
-- E. Integrity (run as the table owner: constraints, not privileges)
-- ===========================================================================
select throws_ok($$ insert into public.marketplace_categories (key, name_ar, name_en) values ('wall_coverings_panels', 'a', 'a') $$,
  '23505', null, 'E1. a duplicate category key is rejected');
select throws_ok($$ insert into public.marketplace_categories (key, name_ar, name_en) values ('Bad Key', 'a', 'a') $$,
  '23514', null, 'E2. a key must be lower snake case');
select throws_ok($$ insert into public.marketplace_categories (key, name_ar, name_en) values ('blank_name', '  ', 'a') $$,
  '23514', null, 'E3. a blank Arabic name is rejected');
select throws_ok($$ insert into public.marketplace_product_types (category_id, key, name_ar, name_en)
                    values (gen_random_uuid(), 'orphan_type', 'a', 'a') $$,
  '23503', null, 'E4. a product type must reference a real category');

select throws_ok($$ insert into public.marketplace_attribute_definitions (key, name_ar, name_en, data_type)
                    values ('bad_measure', 'a', 'a', 'measurement') $$,
  '23514', null, 'E5. a measurement without a unit kind is rejected');
select throws_ok($$ insert into public.marketplace_attribute_definitions (key, name_ar, name_en, data_type, unit_kind)
                    values ('bad_text_unit', 'a', 'a', 'text', 'length') $$,
  '23514', null, 'E6. a non-measurement field cannot carry a unit kind');
select throws_ok($$ insert into public.marketplace_attribute_definitions (key, name_ar, name_en, data_type)
                    values ('bad_type', 'a', 'a', 'blob') $$,
  '23514', null, 'E7. an unknown data type is rejected');
select lives_ok($$ insert into public.marketplace_attribute_definitions (key, name_ar, name_en, data_type, display_unit_ar, display_unit_en)
                   values ('paint_coverage_fixture', 'التغطية', 'Coverage', 'number', 'م²/لتر', 'm²/L') $$,
  'E8. a plain number may carry a free display unit (paint coverage)');
select throws_ok($$ insert into public.marketplace_attribute_definitions (key, name_ar, name_en, data_type, display_unit_en)
                    values ('bad_display_unit', 'a', 'a', 'text', 'm') $$,
  '23514', null, 'E9. a display unit on a non-number field is rejected');

select throws_ok($$ update public.marketplace_attribute_definitions set data_type = 'text' where key = 'length' $$,
  '23514', null, 'E10. a field''s data_type is immutable (it would reinterpret stored values)');
select throws_ok($$ update public.marketplace_attribute_definitions set key = 'renamed_length' where key = 'length' $$,
  '23514', null, 'E11. a field''s key is immutable');
select lives_ok($$ update public.marketplace_attribute_definitions set name_en = 'Overall length' where key = 'length' $$,
  'E12. a field''s label may change');

select throws_ok($$ insert into public.marketplace_attribute_options (attribute_id, key, name_ar, name_en)
                    values ((select id from public.marketplace_attribute_definitions where key = 'length'), 'oops', 'a', 'a') $$,
  '23514', null, 'E13. a measurement field cannot own options');
select throws_ok($$ insert into public.marketplace_attribute_options (attribute_id, key, name_ar, name_en)
                    values ((select id from public.marketplace_attribute_definitions where key = 'color'), 'white', 'a', 'a') $$,
  '23505', null, 'E14. an option key is unique within its field');
select throws_ok($$ insert into public.marketplace_attribute_options (attribute_id, key, name_ar, name_en, swatch_hex)
                    values ((select id from public.marketplace_attribute_definitions where key = 'color'), 'bad_swatch', 'a', 'a', 'red') $$,
  '23514', null, 'E15. a swatch must be a #rrggbb colour');
select throws_ok($$ update public.marketplace_attribute_options
                    set attribute_id = (select id from public.marketplace_attribute_definitions where key = 'finish')
                    where attribute_id = (select id from public.marketplace_attribute_definitions where key = 'color') and key = 'gold' $$,
  '23514', null, 'E16. an option cannot move to another field');

select throws_ok($$ insert into public.marketplace_product_type_attributes (product_type_id, attribute_id, level, is_variant_axis)
                    select (select id from public.marketplace_product_types where key = 'wallpaper'),
                           (select id from public.marketplace_attribute_definitions where key = 'paintable'), 'product', true $$,
  '23514', null, 'E17. a variant axis must be at variant level');
select throws_ok($$ insert into public.marketplace_product_type_attributes (product_type_id, attribute_id, level)
                    select (select id from public.marketplace_product_types where key = 'wallpaper'),
                           (select id from public.marketplace_attribute_definitions where key = 'paintable'), 'listing' $$,
  '23514', null, 'E18. the level must be product or variant');
select throws_ok($$ insert into public.marketplace_product_type_attributes (product_type_id, attribute_id, level)
                    select (select id from public.marketplace_product_types where key = 'wallpaper'),
                           (select id from public.marketplace_attribute_definitions where key = 'color'), 'variant' $$,
  '23505', null, 'E19. a field maps to a type only once');
select throws_ok($$ delete from public.marketplace_categories where key = 'wall_coverings_panels' $$,
  '23503', null, 'E20. a category that still groups types cannot be deleted');
select throws_ok($$ delete from public.marketplace_attribute_definitions where key = 'color' $$,
  '23503', null, 'E21. a field that is still mapped or has options cannot be deleted');

-- ===========================================================================
-- F. Platform staff see the whole vocabulary, retired rows included
-- ===========================================================================
insert into public.platform_role_grants (user_id, role, granted_by)
values ('11111111-1111-4111-8111-111111111111', 'moderator', '11111111-1111-4111-8111-111111111111');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select is((select count(*)::int from public.marketplace_attribute_definitions where key = 'retired_field_fixture'), 1,
  'F1. platform staff see an inactive field definition');
select is((select count(*)::int from public.marketplace_categories), 8,
  'F2. platform staff see the retired category as well (7 active + 1 fixture)');
reset role;

-- ===========================================================================
-- G. Nothing existing was touched
-- ===========================================================================
select is(
  (select count(*)::int from information_schema.columns
   where table_schema = 'public' and table_name = 'products' and column_name like 'marketplace%'),
  0, 'G1. public.products (the B2B catalogue) gained no marketplace column');
select is(
  (select count(*)::int from pg_constraint c
   join pg_class src on src.oid = c.conrelid and src.relname in ('marketplace_categories', 'marketplace_product_types', 'marketplace_attribute_definitions',
                       'marketplace_product_type_attributes', 'marketplace_attribute_options')
   join pg_class dst on dst.oid = c.confrelid
   where c.contype = 'f' and dst.relname not like 'marketplace_%'),
  0, 'G2. no taxonomy / attribute table references an existing (non-marketplace) table');

select * from finish();
rollback;
