-- pgTAP: Marketplace Migration 11 — HDF flooring (20261019090001_marketplace_hdf_flooring.sql).
--
--   A. CATALOGUE — «أرضيات HDF» exists once, bilingual, under «الأرضيات», after SPC.
--   B. FIELDS    — the AC abrasion class field and its three options; the type's twelve
--                  fields, which are required, which select between variants.
--   C. SELLER    — an approved seller saves a complete HDF draft through the trusted RPC;
--                  readiness reports no missing field; a wrong AC class and a missing
--                  required field are reported.
--   D. PUBLIC    — anon reads the type and its filterable fields; nothing writable.
--
-- Fixtures (seed-pilot): showroom A 9c000000-…001, owner 70000001.
create extension if not exists pgtap;

begin;
select plan(18);

update auth.users set email_confirmed_at = now() where id = '70000001-0000-4000-8000-000000000001';
select set_config('t.a', '9c000000-cccc-4ccc-8ccc-000000000001', true);
select set_config('app.marketplace_seller_write', 'on', true);
insert into public.marketplace_seller_accounts (organization_id, status, approved_at)
values (current_setting('t.a')::uuid, 'approved', now())
on conflict (organization_id) do update set status = 'approved', approved_at = now();
select set_config('app.marketplace_seller_write', 'off', true);

-- ===========================================================================
-- A. Catalogue
-- ===========================================================================
select is((select count(*)::int from public.marketplace_product_types where key = 'hdf_flooring'), 1,
  'A1. the HDF flooring type exists exactly once');
select is((select c.key from public.marketplace_product_types t join public.marketplace_categories c on c.id = t.category_id
           where t.key = 'hdf_flooring'), 'flooring', 'A2. ...under the flooring category');
select is((select name_ar || ' / ' || name_en from public.marketplace_product_types where key = 'hdf_flooring'),
  'أرضيات HDF / HDF Flooring', 'A3. ...with its Arabic and English names');
select is((select array_agg(t.key order by t.sort_order) from public.marketplace_product_types t
           join public.marketplace_categories c on c.id = t.category_id where c.key = 'flooring' and t.is_active),
  array['vinyl_flooring', 'spc_flooring', 'hdf_flooring'], 'A4. flooring lists vinyl, SPC, then HDF');

-- ===========================================================================
-- B. Fields
-- ===========================================================================
select is((select data_type from public.marketplace_attribute_definitions where key = 'abrasion_class'), 'option',
  'B1. the AC abrasion class is an option field');
select is((select array_agg(o.key order by o.sort_order) from public.marketplace_attribute_options o
           join public.marketplace_attribute_definitions d on d.id = o.attribute_id
           where d.key = 'abrasion_class' and o.is_active),
  array['ac3', 'ac4', 'ac5'], 'B2. ...with the classes AC3, AC4, AC5');
select is((select count(*)::int from public.marketplace_product_type_attributes a
           join public.marketplace_product_types t on t.id = a.product_type_id where t.key = 'hdf_flooring' and a.is_active), 12,
  'B3. HDF has twelve fields');
select is((select array_agg(d.key order by a.sort_order) from public.marketplace_product_type_attributes a
           join public.marketplace_product_types t on t.id = a.product_type_id
           join public.marketplace_attribute_definitions d on d.id = a.attribute_id
           where t.key = 'hdf_flooring' and a.is_required),
  array['installation_method', 'abrasion_class', 'color', 'length', 'width', 'thickness'],
  'B4. required: installation, AC class, colour, length, width, thickness');
select is((select array_agg(d.key order by a.sort_order) from public.marketplace_product_type_attributes a
           join public.marketplace_product_types t on t.id = a.product_type_id
           join public.marketplace_attribute_definitions d on d.id = a.attribute_id
           where t.key = 'hdf_flooring' and a.is_variant_axis),
  array['color', 'thickness'], 'B5. variants differ by colour and thickness');
select is((select count(*)::int from public.marketplace_product_type_attributes a
           join public.marketplace_product_types t on t.id = a.product_type_id
           join public.marketplace_attribute_definitions d on d.id = a.attribute_id
           where t.key = 'hdf_flooring' and d.key = 'wear_layer'), 0,
  'B6. the vinyl/SPC wear layer is not an HDF field');

-- ===========================================================================
-- C. Seller flow
-- ===========================================================================
select set_config('request.jwt.claims', '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;

create temp table t_hdf on commit drop as
select public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'), 'product_type_key', 'hdf_flooring',
  'name_ar', 'أرضيات HDF بلوط', 'name_en', 'HDF oak laminate',
  'attributes', jsonb_build_object('installation_method', 'click', 'abrasion_class', 'ac4', 'edge_type', 'beveled', 'waterproof', false),
  'variants', jsonb_build_array(
    jsonb_build_object('sku', 'T-HDF-1', 'selling_unit', 'square_meter', 'price_egp', 520,
      'attributes', jsonb_build_object('color', 'oak', 'length', 1380, 'width', 193, 'thickness', 8)),
    jsonb_build_object('sku', 'T-HDF-2', 'selling_unit', 'square_meter', 'price_egp', 610,
      'attributes', jsonb_build_object('color', 'oak', 'length', 1380, 'width', 193, 'thickness', 12))))) as r;

select is((select r ->> 'status' from t_hdf), 'draft', 'C1. a complete HDF product saves as a DRAFT');
select is((select jsonb_array_length(r -> 'variants') from t_hdf), 2, 'C2. ...with its two thickness variants');
select is((select count(*)::int from t_hdf, unnest(public.marketplace_seller_product_readiness((r ->> 'id')::uuid)) b
           where b like 'missing_%' or b = 'variant_without_option_combination'), 0,
  'C3. readiness reports no missing field and no ambiguous variant');
select is((select public.marketplace_seller_product_get((r ->> 'id')::uuid) -> 'attributes' ->> 'abrasion_class' from t_hdf), 'ac4',
  'C4. the AC class reads back');
select throws_like($$ select public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'), 'product_type_key', 'hdf_flooring', 'name_ar', 'س', 'name_en', 's',
  'attributes', jsonb_build_object('abrasion_class', 'ac9'))) $$,
  'mp:attribute_invalid:abrasion_class%', 'C5. an unknown AC class is refused');
create temp table t_hdf2 on commit drop as
select public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'), 'product_type_key', 'hdf_flooring', 'name_ar', 'بدون درجة', 'name_en', 'No class',
  'attributes', jsonb_build_object('installation_method', 'click'),
  'variants', jsonb_build_array(jsonb_build_object('sku', 'T-HDF-3', 'selling_unit', 'square_meter', 'price_egp', 500,
    'attributes', jsonb_build_object('color', 'oak', 'length', 1380, 'width', 193, 'thickness', 8))))) as r;
select ok((select 'missing_product_attribute:abrasion_class' = any(public.marketplace_seller_product_readiness((r ->> 'id')::uuid)) from t_hdf2),
  'C6. a product without its AC class cannot be published (blocker reported)');
reset role;

-- ===========================================================================
-- D. Public
-- ===========================================================================
set local role anon;
select is((select count(*)::int from public.marketplace_product_types where key = 'hdf_flooring'), 1,
  'D1. anon reads the HDF type');
select ok(exists (select 1 from jsonb_array_elements(public.marketplace_public_facets('hdf_flooring') -> 'categories') c
                  where c ->> 'key' = 'flooring'
                    and exists (select 1 from jsonb_array_elements(c -> 'types') t where t ->> 'key' = 'hdf_flooring')),
  'D2. the public facets list HDF under flooring');
reset role;

select * from finish();
rollback;
