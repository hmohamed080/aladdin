-- ===========================================================================
-- Marketplace — Migration 08: product-type expansion (nine more types)
-- ===========================================================================
-- Migration 01 seeded six approved product types. The approved catalogue is
-- fifteen. This migration adds the other nine as DATA — categories, types,
-- field definitions, option values and the type -> field mappings — exactly the
-- way Migration 01 prescribed ("adding paints, doors or flooring is an INSERT
-- plus field mappings, not a structural change"):
--
--   Wall Coverings & Decorative Panels   + wall_panel  (بانوهات)
--                                        + poster      (بوسترات)
--   Cornices & Mouldings                 + skirting    (وزرة)
--   Doors              (new category)    + interior_door (أبواب داخلية)
--                                        + armored_door  (أبواب مصفحة)
--   Flooring           (new category)    + vinyl_flooring (أرضيات فينيل)
--                                        + spc_flooring   (أرضيات SPC)
--   Curtains & Blinds  (new category)    + curtain     (ستائر)
--   Paints & Coatings  (new category)    + paint       (دهانات)
--
-- No structural change: no table, column, constraint, policy, grant, function or
-- trigger is touched, so every security property of Migration 01 (public read of
-- ACTIVE rows, no client write grant) applies to the new rows unchanged. The seller
-- save RPC reads the type's fields from these rows, so the seller form, readiness
-- blockers and bulk import pick the new types up with no code change.
--
-- Vocabulary is the draft V1 set the platform admin can edit once the Schema
-- Builder ships. Measurements are stored in the canonical unit of their kind
-- (length -> mm). Selling units stay within the existing set (piece / roll /
-- board / bar / linear_meter / square_meter / pack): paint is sold by the can
-- (`piece`) or a carton (`pack`) with its volume as a variant option, doors by
-- the `piece`, flooring by the `square_meter` or the carton (`pack`), curtains by
-- the `piece` or the `linear_meter`, skirting by the `bar`.
--
-- Forward-only, additive, idempotent (on conflict do nothing).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Categories
-- ---------------------------------------------------------------------------
insert into public.marketplace_categories (key, name_ar, name_en, sort_order) values
  ('doors',             'الأبواب',           'Doors',             40),
  ('flooring',          'الأرضيات',          'Flooring',          50),
  ('window_treatments', 'الستائر',           'Curtains & Blinds', 60),
  ('paints_coatings',   'الدهانات',          'Paints & Coatings', 70)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Product types (sort order follows the approved list)
-- ---------------------------------------------------------------------------
insert into public.marketplace_product_types (category_id, key, name_ar, name_en, sort_order)
select c.id, v.key, v.name_ar, v.name_en, v.sort_order
from (values
  ('wall_coverings_panels', 'wall_panel',     'بانوهات',       'Wall Panels',      70),
  ('cornices_mouldings',    'skirting',       'وزرة',          'Skirting',         80),
  ('doors',                 'interior_door',  'أبواب داخلية',  'Interior Doors',   90),
  ('doors',                 'armored_door',   'أبواب مصفحة',   'Armored Doors',    100),
  ('flooring',              'vinyl_flooring', 'أرضيات فينيل',  'Vinyl Flooring',   110),
  ('flooring',              'spc_flooring',   'أرضيات SPC',    'SPC Flooring',     120),
  ('window_treatments',     'curtain',        'ستائر',         'Curtains & Blinds',130),
  ('wall_coverings_panels', 'poster',         'بوسترات',       'Posters',          140),
  ('paints_coatings',       'paint',          'دهانات',        'Paints',           150)
) as v(category_key, key, name_ar, name_en, sort_order)
join public.marketplace_categories c on c.key = v.category_key
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Field definitions (only those Migration 01 does not already have)
-- ---------------------------------------------------------------------------
insert into public.marketplace_attribute_definitions (key, name_ar, name_en, data_type, unit_kind, display_unit_ar, display_unit_en) values
  -- materials / kinds / styles
  ('material_wall_panel',      'الخامة',               'Material',            'option', null, null, null),
  ('pattern_wall_panel',       'التصميم',              'Design',              'option', null, null, null),
  ('material_skirting',        'الخامة',               'Material',            'option', null, null, null),
  ('material_interior_door',   'الخامة',               'Material',            'option', null, null, null),
  ('door_style',               'الطراز',               'Style',               'option', null, null, null),
  ('door_opening',             'طريقة الفتح',          'Opening type',        'option', null, null, null),
  ('door_core',                'قلب الباب',            'Door core',           'option', null, null, null),
  ('door_handing',             'اتجاه الفتح',          'Handing',             'option', null, null, null),
  ('armored_door_cladding',    'تكسية الباب',          'Cladding',            'option', null, null, null),
  ('lock_system',              'نظام القفل',           'Lock system',         'option', null, null, null),
  ('vinyl_format',             'الشكل',                'Format',              'option', null, null, null),
  ('installation_method',      'طريقة التركيب',        'Installation method', 'option', null, null, null),
  ('pattern_flooring',         'التصميم',              'Design',              'option', null, null, null),
  ('edge_type',                'نوع الحافة',           'Edge type',           'option', null, null, null),
  ('curtain_style',            'النوع',                'Type',                'option', null, null, null),
  ('curtain_fabric',           'نوع القماش',           'Fabric',              'option', null, null, null),
  ('light_control',            'التحكم في الإضاءة',    'Light control',       'option', null, null, null),
  ('pattern_curtain',          'التصميم',              'Design',              'option', null, null, null),
  ('poster_material',          'الخامة',               'Material',            'option', null, null, null),
  ('poster_subject',           'الموضوع',              'Subject',             'option', null, null, null),
  ('paint_base',               'نوع الدهان',           'Paint type',          'option', null, null, null),
  ('paint_use',                'الاستخدام',            'Use',                 'option', null, null, null),
  ('pack_volume',              'حجم العبوة',           'Pack size',           'option', null, null, null),
  -- yes / no
  ('includes_frame',           'يشمل الحلق',           'Frame included',      'boolean', null, null, null),
  ('fire_rated',               'مقاوم للحريق',         'Fire rated',          'boolean', null, null, null),
  ('sound_insulated',          'عازل للصوت',           'Sound insulated',     'boolean', null, null, null),
  ('waterproof',               'مقاوم للماء',          'Waterproof',          'boolean', null, null, null),
  ('underlay_attached',        'بطبقة سفلية ملصقة',    'Underlay attached',   'boolean', null, null, null),
  ('framed',                   'بإطار',                'Framed',              'boolean', null, null, null),
  -- measurements (canonical unit of their kind: length = mm)
  ('height',                   'الارتفاع',             'Height',              'measurement', 'length', null, null),
  ('wear_layer',               'طبقة التآكل',          'Wear layer',          'measurement', 'length', null, null),
  -- plain number with a free display unit
  ('coverage_per_liter',       'التغطية',              'Coverage',            'number', null, 'م²/لتر', 'm²/L')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Option values
-- ---------------------------------------------------------------------------
insert into public.marketplace_attribute_options (attribute_id, key, name_ar, name_en, swatch_hex, sort_order)
select d.id, v.option_key, v.name_ar, v.name_en, v.swatch_hex, v.sort_order
from (values
  -- wall panels
  ('material_wall_panel', 'pvc',    'PVC',  'PVC',    null, 10),
  ('material_wall_panel', 'wpc',    'WPC',  'WPC',    null, 20),
  ('material_wall_panel', 'mdf',    'MDF',  'MDF',    null, 30),
  ('material_wall_panel', 'pu',     'PU',   'PU',     null, 40),
  ('material_wall_panel', 'ps',     'PS',   'PS',     null, 50),
  ('material_wall_panel', 'gypsum', 'جبس',  'Gypsum', null, 60),
  ('pattern_wall_panel', 'fluted',    'مضلّع',          'Fluted',    null, 10),
  ('pattern_wall_panel', 'three_d',   'ثلاثي الأبعاد',  '3D',        null, 20),
  ('pattern_wall_panel', 'geometric', 'هندسي',          'Geometric', null, 30),
  ('pattern_wall_panel', 'wood',      'خشبي',           'Wood',      null, 40),
  ('pattern_wall_panel', 'marble',    'رخامي',          'Marble',    null, 50),
  ('pattern_wall_panel', 'plain',     'سادة',           'Plain',     null, 60),
  -- skirting
  ('material_skirting', 'pvc',      'PVC',      'PVC',      null, 10),
  ('material_skirting', 'wpc',      'WPC',      'WPC',      null, 20),
  ('material_skirting', 'mdf',      'MDF',      'MDF',      null, 30),
  ('material_skirting', 'pu',       'PU',       'PU',       null, 40),
  ('material_skirting', 'ps',       'PS',       'PS',       null, 50),
  ('material_skirting', 'wood',     'خشب',      'Wood',     null, 60),
  ('material_skirting', 'aluminum', 'ألومنيوم', 'Aluminum', null, 70),
  -- interior doors
  ('material_interior_door', 'solid_wood', 'خشب طبيعي', 'Solid wood', null, 10),
  ('material_interior_door', 'mdf',        'MDF',       'MDF',        null, 20),
  ('material_interior_door', 'hdf',        'HDF',       'HDF',        null, 30),
  ('material_interior_door', 'wpc',        'WPC',       'WPC',        null, 40),
  ('material_interior_door', 'pvc',        'PVC',       'PVC',        null, 50),
  ('material_interior_door', 'aluminum',   'ألومنيوم',  'Aluminum',   null, 60),
  ('material_interior_door', 'glass',      'زجاج',      'Glass',      null, 70),
  ('door_style', 'flush',   'سادة',     'Flush',   null, 10),
  ('door_style', 'panel',   'حشوات',    'Panel',   null, 20),
  ('door_style', 'glass',   'زجاجي',    'Glass',   null, 30),
  ('door_style', 'carved',  'مفرّغ',    'Carved',  null, 40),
  ('door_style', 'modern',  'مودرن',    'Modern',  null, 50),
  ('door_style', 'classic', 'كلاسيك',   'Classic', null, 60),
  ('door_opening', 'swing',   'مفصلي',   'Swing',   null, 10),
  ('door_opening', 'sliding', 'سحاب',    'Sliding', null, 20),
  ('door_opening', 'folding', 'مطوي',    'Folding', null, 30),
  ('door_opening', 'pocket',  'جيب',     'Pocket',  null, 40),
  ('door_core', 'solid',     'مصمت',    'Solid',     null, 10),
  ('door_core', 'honeycomb', 'قرص عسل', 'Honeycomb', null, 20),
  ('door_core', 'hollow',    'مجوّف',   'Hollow',    null, 30),
  ('door_handing', 'right',      'يمين',        'Right',      null, 10),
  ('door_handing', 'left',       'يسار',        'Left',       null, 20),
  ('door_handing', 'reversible', 'قابل للعكس',  'Reversible', null, 30),
  -- armored doors
  ('armored_door_cladding', 'wood_veneer',       'قشرة خشب',       'Wood veneer',       null, 10),
  ('armored_door_cladding', 'mdf',               'MDF',            'MDF',               null, 20),
  ('armored_door_cladding', 'hdf_laminate',      'HDF لامينيت',    'HDF laminate',      null, 30),
  ('armored_door_cladding', 'pvc',               'PVC',            'PVC',               null, 40),
  ('armored_door_cladding', 'powder_coated_steel','صاج مدهون بودرة','Powder-coated steel',null, 50),
  ('lock_system', 'standard',    'قفل عادي',        'Standard',    null, 10),
  ('lock_system', 'multi_point', 'قفل متعدد النقاط','Multi-point', null, 20),
  ('lock_system', 'digital',     'قفل رقمي',        'Digital',     null, 30),
  -- flooring (vinyl + SPC)
  ('vinyl_format', 'planks',     'ألواح طولية', 'Planks',     null, 10),
  ('vinyl_format', 'tiles',      'بلاطات',      'Tiles',      null, 20),
  ('vinyl_format', 'sheet_roll', 'رول',         'Sheet roll', null, 30),
  ('installation_method', 'click',         'تركيب بالتعشيق', 'Click-lock',    null, 10),
  ('installation_method', 'glue_down',     'لصق',            'Glue-down',     null, 20),
  ('installation_method', 'self_adhesive', 'لاصق ذاتي',      'Self-adhesive', null, 30),
  ('installation_method', 'loose_lay',     'تركيب حر',       'Loose-lay',     null, 40),
  ('pattern_flooring', 'wood',      'خشبي',  'Wood',      null, 10),
  ('pattern_flooring', 'stone',     'حجري',  'Stone',     null, 20),
  ('pattern_flooring', 'marble',    'رخامي', 'Marble',    null, 30),
  ('pattern_flooring', 'concrete',  'خرساني','Concrete',  null, 40),
  ('pattern_flooring', 'plain',     'سادة',  'Plain',     null, 50),
  ('pattern_flooring', 'geometric', 'هندسي', 'Geometric', null, 60),
  ('edge_type', 'beveled',      'حافة مشطوفة',      'Beveled',      null, 10),
  ('edge_type', 'micro_bevel',  'حافة مشطوفة دقيقة','Micro-bevel',  null, 20),
  ('edge_type', 'square',       'حافة مستقيمة',     'Square',       null, 30),
  -- curtains & blinds
  ('curtain_style', 'ready_made_curtain', 'ستارة جاهزة',   'Ready-made curtain', null, 10),
  ('curtain_style', 'fabric_by_meter',    'قماش بالمتر',   'Fabric by the metre',null, 20),
  ('curtain_style', 'roller_blind',       'ستارة رول',     'Roller blind',       null, 30),
  ('curtain_style', 'roman_blind',        'ستارة رومان',   'Roman blind',        null, 40),
  ('curtain_style', 'zebra_blind',        'ستارة زيبرا',   'Zebra blind',        null, 50),
  ('curtain_fabric', 'polyester', 'بوليستر', 'Polyester', null, 10),
  ('curtain_fabric', 'velvet',    'مخمل',    'Velvet',    null, 20),
  ('curtain_fabric', 'linen',     'كتان',    'Linen',     null, 30),
  ('curtain_fabric', 'cotton',    'قطن',     'Cotton',    null, 40),
  ('curtain_fabric', 'chiffon',   'شيفون',   'Chiffon',   null, 50),
  ('curtain_fabric', 'jacquard',  'جاكار',   'Jacquard',  null, 60),
  ('curtain_fabric', 'blackout',  'قماش بلاك آوت', 'Blackout fabric', null, 70),
  ('light_control', 'sheer',    'شفاف',      'Sheer',    null, 10),
  ('light_control', 'dim_out',  'حجب جزئي',  'Dim-out',  null, 20),
  ('light_control', 'blackout', 'حجب كامل',  'Blackout', null, 30),
  ('pattern_curtain', 'plain',     'سادة',   'Plain',     null, 10),
  ('pattern_curtain', 'striped',   'مخطط',   'Striped',   null, 20),
  ('pattern_curtain', 'floral',    'نباتي',  'Floral',    null, 30),
  ('pattern_curtain', 'geometric', 'هندسي',  'Geometric', null, 40),
  ('pattern_curtain', 'jacquard',  'جاكار',  'Jacquard',  null, 50),
  ('pattern_curtain', 'kids',      'أطفال',  'Kids',      null, 60),
  -- posters
  ('poster_material', 'paper',         'ورق',          'Paper',          null, 10),
  ('poster_material', 'canvas',        'كانفاس',       'Canvas',         null, 20),
  ('poster_material', 'vinyl_sticker', 'ستيكر فينيل',  'Vinyl sticker',  null, 30),
  ('poster_material', 'framed_print',  'بإطار جاهز',   'Framed print',   null, 40),
  ('poster_subject', 'abstract',     'تجريدي',        'Abstract',      null, 10),
  ('poster_subject', 'nature',       'طبيعة',         'Nature',        null, 20),
  ('poster_subject', 'calligraphy',  'خط عربي',       'Calligraphy',   null, 30),
  ('poster_subject', 'architecture', 'عمارة ومدن',    'Architecture',  null, 40),
  ('poster_subject', 'quotes',       'عبارات',        'Quotes',        null, 50),
  ('poster_subject', 'kids',         'أطفال',         'Kids',          null, 60),
  ('poster_subject', 'portrait',     'بورتريه',       'Portrait',      null, 70),
  ('poster_subject', 'geometric',    'هندسي',         'Geometric',     null, 80),
  -- paints
  ('paint_base', 'plastic_emulsion', 'بلاستيك',        'Plastic emulsion', null, 10),
  ('paint_base', 'water_based',      'مائي',           'Water-based',      null, 20),
  ('paint_base', 'acrylic',          'أكريليك',        'Acrylic',          null, 30),
  ('paint_base', 'oil_based',        'زيتي',           'Oil-based',        null, 40),
  ('paint_base', 'epoxy',            'إيبوكسي',        'Epoxy',            null, 50),
  ('paint_use', 'interior',          'داخلي',          'Interior',          null, 10),
  ('paint_use', 'exterior',          'خارجي',          'Exterior',          null, 20),
  ('paint_use', 'interior_exterior', 'داخلي وخارجي',   'Interior & exterior',null, 30),
  ('paint_use', 'wood_metal',        'خشب وحديد',      'Wood & metal',      null, 40),
  ('pack_volume', 'l_0_5', '٠٫٥ لتر', '0.5 L', null, 10),
  ('pack_volume', 'l_1',   '١ لتر',   '1 L',   null, 20),
  ('pack_volume', 'l_2_5', '٢٫٥ لتر', '2.5 L', null, 30),
  ('pack_volume', 'l_3_5', '٣٫٥ لتر', '3.5 L', null, 40),
  ('pack_volume', 'l_4',   '٤ لتر',   '4 L',   null, 50),
  ('pack_volume', 'l_5',   '٥ لتر',   '5 L',   null, 60),
  ('pack_volume', 'l_9',   '٩ لتر',   '9 L',   null, 70),
  ('pack_volume', 'l_10',  '١٠ لتر',  '10 L',  null, 80),
  ('pack_volume', 'l_18',  '١٨ لتر',  '18 L',  null, 90),
  -- the shared colour catalogue gains the colours paints and curtains need
  ('color', 'yellow',    'أصفر',     'Yellow',    '#e3c14a', 200),
  ('color', 'orange',    'برتقالي',  'Orange',    '#d9843b', 210),
  ('color', 'red',       'أحمر',     'Red',       '#b5413a', 220),
  ('color', 'purple',    'بنفسجي',   'Purple',    '#7a5a8c', 230),
  ('color', 'turquoise', 'تركواز',   'Turquoise', '#3fa7a0', 240)
) as v(attribute_key, option_key, name_ar, name_en, swatch_hex, sort_order)
join public.marketplace_attribute_definitions d on d.key = v.attribute_key
on conflict (attribute_id, key) do nothing;

-- ---------------------------------------------------------------------------
-- 5. Which fields each new type has
-- ---------------------------------------------------------------------------
-- (type, attribute, level, required, filterable, variant_axis, ar override,
--  en override, sort). At most three variant axes per type (the V1 seller-UI
--  limit); every type has a required product-level field and a variant axis.
insert into public.marketplace_product_type_attributes
  (product_type_id, attribute_id, level, is_required, is_filterable, is_variant_axis,
   name_ar_override, name_en_override, sort_order)
select t.id, d.id, v.level, v.is_required, v.is_filterable, v.is_variant_axis,
       v.ar_override, v.en_override, v.sort_order
from (values
  -- wall panels
  ('wall_panel', 'material_wall_panel', 'product', true,  true,  false, null, null, 10),
  ('wall_panel', 'pattern_wall_panel',  'product', false, true,  false, null, null, 20),
  ('wall_panel', 'texture',             'product', false, true,  false, null, null, 30),
  ('wall_panel', 'finish',              'product', false, true,  false, null, null, 40),
  ('wall_panel', 'moisture_resistant',  'product', false, true,  false, null, null, 50),
  ('wall_panel', 'color',               'variant', true,  true,  true,  null, null, 60),
  ('wall_panel', 'length',              'variant', true,  true,  false, null, null, 70),
  ('wall_panel', 'width',               'variant', true,  true,  false, null, null, 80),
  ('wall_panel', 'thickness',           'variant', true,  true,  true,  null, null, 90),
  ('wall_panel', 'weight',              'variant', false, false, false, null, null, 100),
  -- skirting
  ('skirting', 'material_skirting',  'product', true,  true,  false, null, null, 10),
  ('skirting', 'finish',             'product', false, true,  false, null, null, 20),
  ('skirting', 'paintable',          'product', false, true,  false, null, null, 30),
  ('skirting', 'moisture_resistant', 'product', false, true,  false, null, null, 40),
  ('skirting', 'color',              'variant', true,  true,  true,  null, null, 50),
  ('skirting', 'length',             'variant', true,  true,  true,  'طول العود', 'Bar length', 60),
  ('skirting', 'height',             'variant', true,  true,  true,  'ارتفاع الوزرة', 'Skirting height', 70),
  ('skirting', 'weight',             'variant', false, false, false, null, null, 80),
  -- interior doors
  ('interior_door', 'material_interior_door', 'product', true,  true,  false, null, null, 10),
  ('interior_door', 'door_style',             'product', false, true,  false, null, null, 20),
  ('interior_door', 'door_opening',           'product', false, true,  false, null, null, 30),
  ('interior_door', 'door_core',              'product', false, true,  false, null, null, 40),
  ('interior_door', 'includes_frame',         'product', false, true,  false, null, null, 50),
  ('interior_door', 'moisture_resistant',     'product', false, true,  false, null, null, 60),
  ('interior_door', 'color',                  'variant', true,  true,  true,  null, null, 70),
  ('interior_door', 'width',                  'variant', true,  true,  true,  null, null, 80),
  ('interior_door', 'height',                 'variant', true,  true,  false, null, null, 90),
  ('interior_door', 'thickness',              'variant', false, true,  false, null, null, 100),
  ('interior_door', 'door_handing',           'variant', true,  true,  true,  null, null, 110),
  ('interior_door', 'weight',                 'variant', false, false, false, null, null, 120),
  -- armored doors
  ('armored_door', 'armored_door_cladding', 'product', true,  true,  false, null, null, 10),
  ('armored_door', 'lock_system',           'product', false, true,  false, null, null, 20),
  ('armored_door', 'fire_rated',            'product', false, true,  false, null, null, 30),
  ('armored_door', 'sound_insulated',       'product', false, true,  false, null, null, 40),
  ('armored_door', 'includes_frame',        'product', false, true,  false, null, null, 50),
  ('armored_door', 'color',                 'variant', true,  true,  true,  null, null, 60),
  ('armored_door', 'width',                 'variant', true,  true,  true,  null, null, 70),
  ('armored_door', 'height',                'variant', true,  true,  false, null, null, 80),
  ('armored_door', 'thickness',             'variant', false, true,  false, null, null, 90),
  ('armored_door', 'door_handing',          'variant', true,  true,  true,  null, null, 100),
  ('armored_door', 'weight',                'variant', false, false, false, null, null, 110),
  -- vinyl flooring
  ('vinyl_flooring', 'vinyl_format',        'product', true,  true,  false, null, null, 10),
  ('vinyl_flooring', 'installation_method', 'product', false, true,  false, null, null, 20),
  ('vinyl_flooring', 'pattern_flooring',    'product', false, true,  false, null, null, 30),
  ('vinyl_flooring', 'texture',             'product', false, true,  false, null, null, 40),
  ('vinyl_flooring', 'waterproof',          'product', false, true,  false, null, null, 50),
  ('vinyl_flooring', 'underlay_attached',   'product', false, true,  false, null, null, 60),
  ('vinyl_flooring', 'wear_layer',          'product', false, true,  false, null, null, 70),
  ('vinyl_flooring', 'color',               'variant', true,  true,  true,  null, null, 80),
  ('vinyl_flooring', 'length',              'variant', true,  true,  false, null, null, 90),
  ('vinyl_flooring', 'width',               'variant', true,  true,  false, null, null, 100),
  ('vinyl_flooring', 'thickness',           'variant', true,  true,  true,  null, null, 110),
  ('vinyl_flooring', 'weight',              'variant', false, false, false, null, null, 120),
  -- SPC flooring
  ('spc_flooring', 'installation_method', 'product', true,  true,  false, null, null, 10),
  ('spc_flooring', 'pattern_flooring',    'product', false, true,  false, null, null, 20),
  ('spc_flooring', 'texture',             'product', false, true,  false, null, null, 30),
  ('spc_flooring', 'edge_type',           'product', false, true,  false, null, null, 40),
  ('spc_flooring', 'waterproof',          'product', false, true,  false, null, null, 50),
  ('spc_flooring', 'underlay_attached',   'product', false, true,  false, null, null, 60),
  ('spc_flooring', 'wear_layer',          'product', false, true,  false, null, null, 70),
  ('spc_flooring', 'color',               'variant', true,  true,  true,  null, null, 80),
  ('spc_flooring', 'length',              'variant', true,  true,  false, null, null, 90),
  ('spc_flooring', 'width',               'variant', true,  true,  false, null, null, 100),
  ('spc_flooring', 'thickness',           'variant', true,  true,  true,  null, null, 110),
  ('spc_flooring', 'weight',              'variant', false, false, false, null, null, 120),
  -- curtains & blinds
  ('curtain', 'curtain_style',   'product', true,  true,  false, null, null, 10),
  ('curtain', 'curtain_fabric',  'product', false, true,  false, null, null, 20),
  ('curtain', 'light_control',   'product', false, true,  false, null, null, 30),
  ('curtain', 'pattern_curtain', 'product', false, true,  false, null, null, 40),
  ('curtain', 'washable',        'product', false, true,  false, null, null, 50),
  ('curtain', 'color',           'variant', true,  true,  true,  null, null, 60),
  ('curtain', 'width',           'variant', true,  true,  true,  null, null, 70),
  ('curtain', 'height',          'variant', true,  true,  true,  null, null, 80),
  ('curtain', 'weight',          'variant', false, false, false, null, null, 90),
  -- posters
  ('poster', 'poster_material', 'product', true,  true,  false, null, null, 10),
  ('poster', 'poster_subject',  'product', false, true,  false, null, null, 20),
  ('poster', 'framed',          'product', false, true,  false, null, null, 30),
  ('poster', 'width',           'variant', true,  true,  true,  null, null, 40),
  ('poster', 'height',          'variant', true,  true,  true,  null, null, 50),
  ('poster', 'weight',          'variant', false, false, false, null, null, 60),
  -- paints
  ('paint', 'paint_base',         'product', true,  true,  false, null, null, 10),
  ('paint', 'paint_use',          'product', false, true,  false, null, null, 20),
  ('paint', 'finish',             'product', false, true,  false, null, null, 30),
  ('paint', 'washable',           'product', false, true,  false, null, null, 40),
  ('paint', 'coverage_per_liter', 'product', false, false, false, null, null, 50),
  ('paint', 'color',              'variant', true,  true,  true,  null, null, 60),
  ('paint', 'pack_volume',        'variant', true,  true,  true,  null, null, 70),
  ('paint', 'weight',             'variant', false, false, false, null, null, 80)
) as v(type_key, attribute_key, level, is_required, is_filterable, is_variant_axis,
       ar_override, en_override, sort_order)
join public.marketplace_product_types t on t.key = v.type_key
join public.marketplace_attribute_definitions d on d.key = v.attribute_key
on conflict (product_type_id, attribute_id) do nothing;
