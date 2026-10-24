-- =============================================================================
-- Marketplace Migration 11 — HDF flooring product type
--
-- Adds «أرضيات HDF» (HDF / laminate flooring) under the existing «الأرضيات»
-- category, next to vinyl and SPC. Its field set follows SPC (installation,
-- design, texture, edge, water resistance, attached underlay; colour, length,
-- width, thickness per variant) plus the one specification buyers compare HDF
-- by: the AC abrasion class (AC3 / AC4 / AC5), added as a new option field.
--
-- Data only: no table, function, policy or grant changes. Idempotent.
-- =============================================================================

-- 1. The type, after SPC (120) and before curtains (130)
insert into public.marketplace_product_types (category_id, key, name_ar, name_en, sort_order)
select c.id, 'hdf_flooring', 'أرضيات HDF', 'HDF Flooring', 125
from public.marketplace_categories c
where c.key = 'flooring'
on conflict (key) do nothing;

-- 2. New field: AC abrasion class (EN 13329)
insert into public.marketplace_attribute_definitions (key, name_ar, name_en, data_type, unit_kind, display_unit_ar, display_unit_en)
values ('abrasion_class', 'درجة مقاومة الاحتكاك', 'Abrasion class', 'option', null, null, null)
on conflict (key) do nothing;

insert into public.marketplace_attribute_options (attribute_id, key, name_ar, name_en, swatch_hex, sort_order)
select d.id, v.option_key, v.name_ar, v.name_en, null, v.sort_order
from (values
  ('ac3', 'AC3 — استخدام منزلي', 'AC3 — residential',          10),
  ('ac4', 'AC4 — تجاري متوسط',   'AC4 — moderate commercial',  20),
  ('ac5', 'AC5 — تجاري كثيف',    'AC5 — heavy commercial',     30)
) as v(option_key, name_ar, name_en, sort_order)
join public.marketplace_attribute_definitions d on d.key = 'abrasion_class'
on conflict (attribute_id, key) do nothing;

-- 3. Fields of the type (same shape as SPC; AC class replaces the wear layer)
insert into public.marketplace_product_type_attributes
  (product_type_id, attribute_id, level, is_required, is_filterable, is_variant_axis,
   name_ar_override, name_en_override, sort_order)
select t.id, d.id, v.level, v.is_required, v.is_filterable, v.is_variant_axis, null, null, v.sort_order
from (values
  ('installation_method', 'product', true,  true,  false, 10),
  ('abrasion_class',      'product', true,  true,  false, 20),
  ('pattern_flooring',    'product', false, true,  false, 30),
  ('texture',             'product', false, true,  false, 40),
  ('edge_type',           'product', false, true,  false, 50),
  ('waterproof',          'product', false, true,  false, 60),
  ('underlay_attached',   'product', false, true,  false, 70),
  ('color',               'variant', true,  true,  true,  80),
  ('length',              'variant', true,  true,  false, 90),
  ('width',               'variant', true,  true,  false, 100),
  ('thickness',           'variant', true,  true,  true,  110),
  ('weight',              'variant', false, false, false, 120)
) as v(attribute_key, level, is_required, is_filterable, is_variant_axis, sort_order)
join public.marketplace_product_types t on t.key = 'hdf_flooring'
join public.marketplace_attribute_definitions d on d.key = v.attribute_key
on conflict (product_type_id, attribute_id) do nothing;
