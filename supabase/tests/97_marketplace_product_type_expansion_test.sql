-- pgTAP: Marketplace Migration 08 — product-type expansion
-- (20261014090003_marketplace_product_types_expansion.sql).
--
--   A. CATALOGUE    — the fifteen approved types, bilingual, in the approved order, under the
--                     right categories; the nine new ones are complete and well-formed.
--   B. SCHEMA SANITY— every new type has a required product field, 1..3 variant axes, only
--                     real fields, and every option field it uses has active options.
--   C. SECURITY     — still public-read of ACTIVE rows and no client write path (no policy,
--                     grant or function was added by this migration).
--   D. SELLER FLOW  — an approved seller saves a DRAFT of every new type through the trusted
--                     RPC, with a complete payload; readiness reports only stock / media
--                     blockers (never a missing field); a foreign field is refused.
--
-- Fixtures (seed-pilot): showroom A 9c000000-…001, owner 70000001; outsider 70000009.
create extension if not exists pgtap;

begin;
select plan(38);

update auth.users set email_confirmed_at = now()
  where id in ('70000001-0000-4000-8000-000000000001', '70000009-0000-4000-8000-000000000009');
select set_config('t.a', '9c000000-cccc-4ccc-8ccc-000000000001', true);
select set_config('app.marketplace_seller_write', 'on', true);
insert into public.marketplace_seller_accounts (organization_id, status, approved_at)
values (current_setting('t.a')::uuid, 'approved', now())
on conflict (organization_id) do update set status = 'approved', approved_at = now();
select set_config('app.marketplace_seller_write', 'off', true);

-- ===========================================================================
-- A. Catalogue
-- ===========================================================================
select is(
  (select array_agg(key order by sort_order) from public.marketplace_product_types where is_active),
  array['wallpaper', 'wood_alternative', 'marble_alternative', 'sheeboard', 'cornice', 'corner_trim',
        'wall_panel', 'skirting', 'interior_door', 'armored_door', 'vinyl_flooring', 'spc_flooring',
        'hdf_flooring', 'curtain', 'poster', 'paint'],
  'A1. the approved product types, in the approved order (HDF added by Migration 11)');
select is(
  (select array_agg(name_ar order by sort_order) from public.marketplace_product_types where is_active),
  array['ورق حائط', 'بديل خشب', 'بديل رخام', 'شيبورد', 'كرانيش', 'زوايا', 'بانوهات', 'وزرة',
        'أبواب داخلية', 'أبواب مصفحة', 'أرضيات فينيل', 'أرضيات SPC', 'أرضيات HDF', 'ستائر', 'بوسترات', 'دهانات'],
  'A2. ...with their Arabic names');
select is(
  (select array_agg(c.key || ':' || t.key order by t.sort_order) from public.marketplace_product_types t
   join public.marketplace_categories c on c.id = t.category_id where t.sort_order >= 70),
  array['wall_coverings_panels:wall_panel', 'cornices_mouldings:skirting', 'doors:interior_door', 'doors:armored_door',
        'flooring:vinyl_flooring', 'flooring:spc_flooring', 'flooring:hdf_flooring', 'window_treatments:curtain',
        'wall_coverings_panels:poster', 'paints_coatings:paint'],
  'A3. each new type sits under the right category');
select is((select count(*)::int from public.marketplace_categories where key in ('doors', 'flooring', 'window_treatments', 'paints_coatings') and is_active), 4,
  'A4. the four new categories are active');
select is((select count(*)::int from public.marketplace_product_types where is_active and (char_length(btrim(name_en)) = 0 or char_length(btrim(name_ar)) = 0)), 0,
  'A5. every type has both names');
select is((select count(*)::int from public.marketplace_product_types), 16, 'A6. no extra / duplicate type rows (15 + HDF from Migration 11)');

-- ===========================================================================
-- B. Schema sanity for the nine new types
-- ===========================================================================
with new_types as (select id from public.marketplace_product_types where sort_order >= 70)
select is((select count(*)::int from new_types nt
           where not exists (select 1 from public.marketplace_product_type_attributes a
                             where a.product_type_id = nt.id and a.level = 'product' and a.is_required and a.is_active)), 0,
  'B1. every new type has a required product-level field');
with new_types as (select id from public.marketplace_product_types where sort_order >= 70)
select is((select count(*)::int from new_types nt
           where (select count(*) from public.marketplace_product_type_attributes a
                  where a.product_type_id = nt.id and a.is_variant_axis and a.is_active) not between 1 and 3), 0,
  'B2. every new type has between one and three variant axes (the V1 limit)');
with new_types as (select id from public.marketplace_product_types where sort_order >= 70)
select is((select count(*)::int from new_types nt
           where not exists (select 1 from public.marketplace_product_type_attributes a
                             where a.product_type_id = nt.id and a.level = 'variant' and a.is_required and a.is_active)), 0,
  'B3. every new type has a required variant-level field');
select is((select count(*)::int from public.marketplace_attribute_definitions d
           where d.data_type in ('option', 'multi_option') and d.is_active
             and exists (select 1 from public.marketplace_product_type_attributes a where a.attribute_id = d.id)
             and not exists (select 1 from public.marketplace_attribute_options o where o.attribute_id = d.id and o.is_active)), 0,
  'B4. every mapped option field has at least one active option');
select is((select count(*)::int from public.marketplace_product_type_attributes a
           join public.marketplace_attribute_definitions d on d.id = a.attribute_id
           where a.is_variant_axis and d.data_type = 'text'), 0, 'B5. no free-text field is a variant axis');
select is((select count(*)::int from public.marketplace_product_type_attributes a
           join public.marketplace_product_types t on t.id = a.product_type_id
           where t.sort_order >= 70 and a.name_ar_override is not null and a.name_en_override is null), 0,
  'B6. relabelled fields carry both languages');
select is((select count(*)::int from public.marketplace_attribute_definitions where data_type = 'measurement' and unit_kind is null), 0,
  'B7. every measurement still names its canonical unit kind');
select is((select unit_kind from public.marketplace_attribute_definitions where key = 'height'), 'length', 'B8. height is a length (mm)');
select is((select display_unit_en from public.marketplace_attribute_definitions where key = 'coverage_per_liter'), 'm²/L',
  'B9. paint coverage is a plain number with its display unit');
select is((select count(*)::int from public.marketplace_attribute_options o
           join public.marketplace_attribute_definitions d on d.id = o.attribute_id where d.key = 'pack_volume'), 9,
  'B10. paint pack sizes: nine volumes');
select is((select count(*)::int from public.marketplace_attribute_options o
           join public.marketplace_attribute_definitions d on d.id = o.attribute_id where d.key = 'color' and o.swatch_hex is null), 0,
  'B11. every colour option (incl. the five new ones) has a swatch');

-- ===========================================================================
-- C. Security unchanged
-- ===========================================================================
set local role anon;
select is((select count(*)::int from public.marketplace_product_types), 16, 'C1. anon reads all sixteen types (HDF added by Migration 11)');
select is((select count(*)::int from public.marketplace_categories), 7, 'C2. ...and the seven categories');
select ok((select count(*)::int from public.marketplace_product_type_attributes a
           join public.marketplace_product_types t on t.id = a.product_type_id where t.key = 'paint') > 0,
  'C3. anon reads the new types'' field mappings');
select throws_ok($$ insert into public.marketplace_product_types (category_id, key, name_ar, name_en)
                    select id, 'anon_type', 'x', 'x' from public.marketplace_categories limit 1 $$, '42501', null,
  'C4. anon cannot add a type');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';
select throws_ok($$ insert into public.marketplace_attribute_options (attribute_id, key, name_ar, name_en)
                    select id, 'hack', 'x', 'x' from public.marketplace_attribute_definitions where key = 'pack_volume' $$, '42501', null,
  'C5. a signed-in user cannot add an option');
select throws_ok($$ update public.marketplace_product_types set is_active = false where key = 'paint' $$, '42501', null,
  'C6. ...nor retire a type');
reset role;
select is((select count(*)::int from information_schema.role_table_grants
           where table_schema = 'public' and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT'
             and table_name like 'marketplace\_%'), 0, 'C7. still no client write grant on any marketplace table');

-- ===========================================================================
-- D. An approved seller can save a draft of every new type
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';

create temp table t_case (type_key text primary key, payload jsonb) on commit drop;
grant all on t_case to authenticated;
insert into t_case values
 ('wall_panel', jsonb_build_object('product_type_key', 'wall_panel', 'name_ar', 'بانو مضلع', 'name_en', 'Fluted panel',
    'attributes', jsonb_build_object('material_wall_panel', 'wpc', 'pattern_wall_panel', 'fluted'),
    'variants', jsonb_build_array(jsonb_build_object('sku', 'T-WP-1', 'selling_unit', 'piece', 'price_egp', 350,
       'attributes', jsonb_build_object('color', 'walnut', 'length', 2900, 'width', 160, 'thickness', 9))))),
 ('skirting', jsonb_build_object('product_type_key', 'skirting', 'name_ar', 'وزرة', 'name_en', 'PVC skirting',
    'attributes', jsonb_build_object('material_skirting', 'pvc'),
    'variants', jsonb_build_array(jsonb_build_object('sku', 'T-SK-1', 'selling_unit', 'bar', 'price_egp', 60,
       'attributes', jsonb_build_object('color', 'white', 'length', 2400, 'height', 80))))),
 ('interior_door', jsonb_build_object('product_type_key', 'interior_door', 'name_ar', 'باب داخلي', 'name_en', 'Interior door',
    'attributes', jsonb_build_object('material_interior_door', 'mdf', 'door_style', 'modern', 'includes_frame', true),
    'variants', jsonb_build_array(jsonb_build_object('sku', 'T-ID-1', 'selling_unit', 'piece', 'price_egp', 4200,
       'attributes', jsonb_build_object('color', 'white', 'width', 900, 'height', 2100, 'door_handing', 'right'))))),
 ('armored_door', jsonb_build_object('product_type_key', 'armored_door', 'name_ar', 'باب مصفح', 'name_en', 'Armored door',
    'attributes', jsonb_build_object('armored_door_cladding', 'wood_veneer', 'lock_system', 'multi_point', 'fire_rated', false),
    'variants', jsonb_build_array(jsonb_build_object('sku', 'T-AD-1', 'selling_unit', 'piece', 'price_egp', 14500,
       'attributes', jsonb_build_object('color', 'walnut', 'width', 900, 'height', 2100, 'door_handing', 'left'))))),
 ('vinyl_flooring', jsonb_build_object('product_type_key', 'vinyl_flooring', 'name_ar', 'فينيل', 'name_en', 'Vinyl planks',
    'attributes', jsonb_build_object('vinyl_format', 'planks', 'installation_method', 'click', 'waterproof', true),
    'variants', jsonb_build_array(jsonb_build_object('sku', 'T-VF-1', 'selling_unit', 'square_meter', 'price_egp', 480,
       'attributes', jsonb_build_object('color', 'oak', 'length', 1220, 'width', 180, 'thickness', 4))))),
 ('spc_flooring', jsonb_build_object('product_type_key', 'spc_flooring', 'name_ar', 'إس بي سي', 'name_en', 'SPC click',
    'attributes', jsonb_build_object('installation_method', 'click', 'edge_type', 'beveled', 'wear_layer', 0.5),
    'variants', jsonb_build_array(jsonb_build_object('sku', 'T-SPC-1', 'selling_unit', 'pack', 'price_egp', 1500,
       'attributes', jsonb_build_object('color', 'oak', 'length', 1220, 'width', 180, 'thickness', 5))))),
 ('curtain', jsonb_build_object('product_type_key', 'curtain', 'name_ar', 'ستارة', 'name_en', 'Ready-made curtain',
    'attributes', jsonb_build_object('curtain_style', 'ready_made_curtain', 'light_control', 'blackout', 'washable', true),
    'variants', jsonb_build_array(jsonb_build_object('sku', 'T-CU-1', 'selling_unit', 'piece', 'price_egp', 900,
       'attributes', jsonb_build_object('color', 'beige', 'width', 1400, 'height', 2600))))),
 ('poster', jsonb_build_object('product_type_key', 'poster', 'name_ar', 'بوستر', 'name_en', 'Canvas poster',
    'attributes', jsonb_build_object('poster_material', 'canvas', 'poster_subject', 'calligraphy', 'framed', false),
    'variants', jsonb_build_array(jsonb_build_object('sku', 'T-PO-1', 'selling_unit', 'piece', 'price_egp', 250,
       'attributes', jsonb_build_object('width', 500, 'height', 700))))),
 ('paint', jsonb_build_object('product_type_key', 'paint', 'name_ar', 'دهان', 'name_en', 'Plastic paint',
    'attributes', jsonb_build_object('paint_base', 'plastic_emulsion', 'paint_use', 'interior', 'finish', 'matt', 'coverage_per_liter', 10),
    'variants', jsonb_build_array(jsonb_build_object('sku', 'T-PA-1', 'selling_unit', 'piece', 'price_egp', 780,
       'attributes', jsonb_build_object('color', 'white', 'pack_volume', 'l_4')))));

create temp table t_saved (type_key text primary key, product_id uuid, status text) on commit drop;
grant all on t_saved to authenticated;
insert into t_saved
select c.type_key,
       (r ->> 'id')::uuid,
       r ->> 'status'
from t_case c,
     lateral (select public.marketplace_seller_product_save(c.payload || jsonb_build_object('organization_id', current_setting('t.a'))) as r) s;

select is((select count(*)::int from t_saved), 9, 'D1. a complete payload for each of the nine new types is accepted');
select is((select count(*)::int from t_saved where status = 'draft'), 9, 'D2. ...every one is a DRAFT (never published)');
select is((select count(*)::int from public.marketplace_products p join t_saved s on s.product_id = p.id
           where p.seller_organization_id = current_setting('t.a')::uuid), 9, 'D3. ...all owned by the seller''s organization');
select is((select count(*)::int from t_saved s
           where exists (select 1 from unnest(public.marketplace_seller_product_readiness(s.product_id)) b
                         where b like 'missing_product_attribute:%' or b like 'missing_variant_attribute:%'
                            or b in ('no_active_variant', 'variant_without_option_combination', 'invalid_variant_price'))), 0,
  'D4. readiness reports NO missing field for any new type (a complete form is complete)');
select is((select count(*)::int from t_saved s
           where 'media_verification_not_available' = any(public.marketplace_seller_product_readiness(s.product_id))
             and 'no_verified_primary_image' = any(public.marketplace_seller_product_readiness(s.product_id))
             and 'no_available_stock' = any(public.marketplace_seller_product_readiness(s.product_id))), 9,
  'D5. ...only stock / media blockers remain, and publication stays closed (media verification off)');
select is((select public.marketplace_seller_product_get(product_id) -> 'attributes' ->> 'paint_base' from t_saved where type_key = 'paint'),
  'plastic_emulsion', 'D6. the saved paint reads back its attributes by key');
select is((select public.marketplace_seller_product_get(product_id) -> 'variants' -> 0 -> 'attributes' ->> 'pack_volume' from t_saved where type_key = 'paint'),
  'l_4', 'D7. ...and its variant pack size');
select is((select public.marketplace_seller_product_get(product_id) -> 'attributes' ->> 'coverage_per_liter' from t_saved where type_key = 'paint'),
  '10.0000', 'D8. ...and the plain-number coverage');
select is((select public.marketplace_seller_product_get(product_id) -> 'variants' -> 0 -> 'attributes' ->> 'door_handing' from t_saved where type_key = 'interior_door'),
  'right', 'D9. a door reads back its handing');

-- refusals
select throws_like($$ select public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'), 'product_type_key', 'paint', 'name_ar', 'س', 'name_en', 's',
  'variants', jsonb_build_array(jsonb_build_object('sku', 'T-PA-X', 'selling_unit', 'piece', 'price_egp', 1,
     'attributes', jsonb_build_object('thickness', 5))))) $$,
  'mp:attribute_unknown:thickness%', 'D10. a paint cannot carry a door/panel field (thickness)');
select throws_like($$ select public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'), 'product_type_key', 'interior_door', 'name_ar', 'س', 'name_en', 's',
  'attributes', jsonb_build_object('material_interior_door', 'granite'))) $$,
  'mp:attribute_invalid:material_interior_door%', 'D11. an unknown option is refused');
select throws_like($$ select public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'), 'product_type_key', 'paint', 'name_ar', 'س', 'name_en', 's',
  'variants', jsonb_build_array(
    jsonb_build_object('sku', 'T-PA-A', 'selling_unit', 'piece', 'price_egp', 1, 'attributes', jsonb_build_object('color', 'red', 'pack_volume', 'l_1')),
    jsonb_build_object('sku', 'T-PA-B', 'selling_unit', 'piece', 'price_egp', 1, 'attributes', jsonb_build_object('color', 'red', 'pack_volume', 'l_1'))))) $$,
  'mp:duplicate_variant_combination%', 'D12. two paints with the same colour and size are one variant (combination refused)');
select lives_ok($$ select public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'), 'product_type_key', 'paint', 'name_ar', 'س', 'name_en', 's',
  'variants', jsonb_build_array(
    jsonb_build_object('sku', 'T-PA-C', 'selling_unit', 'piece', 'price_egp', 1, 'attributes', jsonb_build_object('color', 'red', 'pack_volume', 'l_1')),
    jsonb_build_object('sku', 'T-PA-D', 'selling_unit', 'piece', 'price_egp', 1, 'attributes', jsonb_build_object('color', 'red', 'pack_volume', 'l_4'))))) $$,
  'D13. ...but the same colour in two sizes is fine');
select throws_like($$ select public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'), 'product_type_key', 'curtain', 'name_ar', 'س', 'name_en', 's',
  'variants', jsonb_build_array(jsonb_build_object('sku', 'T-CU-X', 'selling_unit', 'litre', 'price_egp', 1)))) $$,
  'mp:selling_unit_invalid%', 'D14. selling units stay within the existing set');
reset role;

select * from finish();
rollback;
