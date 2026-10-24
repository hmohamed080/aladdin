-- ===========================================================================
-- Marketplace — Migration 01: product taxonomy + dynamic attribute definitions
-- ===========================================================================
-- WHAT THIS IS. The first increment of the public, direct-price Marketplace
-- product database (docs: Marketplace Product Database ERD V1, ADR-0011):
--
--   Domain 01  TAXONOMY            marketplace_categories → marketplace_product_types
--   Domain 02  DYNAMIC ATTRIBUTES  marketplace_attribute_definitions
--                                  marketplace_product_type_attributes
--                                  marketplace_attribute_options
--
-- It answers "what kinds of product exist and which fields does each kind
-- have" — as DATA, so the Aladdin platform admin can later add a product type
-- (paints, doors, flooring …) or a field without a structural change.
--
-- WHAT THIS IS NOT. No products, variants, images, stock, prices, import,
-- cart, checkout or payment (Migrations 02–04 and later domains). Nothing
-- here touches public.products, rfqs, quotations, orders, organizations,
-- memberships, showroom accounts or the Kashier integration. The marketplace_*
-- tables reference NO existing table: the seller/organization link arrives
-- with marketplace_products (Migration 02).
--
-- DESIGN DECISIONS
--   * Product types are ROWS, never an enum. A fixed enum would need a
--     migration (and a deploy) per new type.
--   * Fields are ROWS (marketplace_attribute_definitions) mapped to types
--     (marketplace_product_type_attributes). Paints are not forced to carry
--     panel length / width / thickness; wallpaper carries roll width / length.
--   * Display names are COLUMNS (name_ar / name_en) here, unlike public.trades
--     (whose labels live in the i18n catalogs). The difference is deliberate:
--     trades are fixed by a migration, but admin-created types and fields
--     have no code deploy to ship a catalog entry with — the label must travel
--     with the row.
--   * Measurements are numeric in ONE canonical unit per kind (length → mm,
--     weight → g, volume → ml). A label such as "290 x 20 cm" is never stored.
--   * Disabling is a flag (is_active), never a delete: foreign keys from the
--     value tables (Migration 02) are ON DELETE RESTRICT, so a field or option
--     that holds product data cannot be dropped, and switching it off hides it
--     from the catalogue without erasing what was entered.
--   * Variant "axes" (the up-to-three option groups a seller varies a SKU by)
--     are a per-type FLAG, not a database cap: V1's seller UI limits itself to
--     three, the schema does not.
--
-- SECURITY MODEL (RLS on every table, explicit grants)
--   * Reference data is world-readable WHEN ACTIVE (anon + authenticated), so
--     the public marketplace and its filters need no sign-in.
--   * Inactive rows are visible to platform staff (app.is_admin_staff()) only.
--   * NO insert / update / delete grant exists for anon, authenticated or
--     service_role. Rows change by migration today; the future Schema Builder
--     admin writes go through audited, permission-checked RPCs (a later
--     migration), never through direct table grants.
--   * No SECURITY DEFINER function is introduced; the three triggers below
--     are plain invoker functions with an empty search_path.
--
-- Forward-only and additive. Idempotent seeds (on conflict do nothing).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. marketplace_categories — navigation grouping of product types
-- ---------------------------------------------------------------------------
create table public.marketplace_categories (
  id         uuid        primary key default gen_random_uuid(),
  key        text        not null,
  name_ar    text        not null,
  name_en    text        not null,
  sort_order integer     not null default 0,
  is_active  boolean     not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_marketplace_categories_key unique (key),
  constraint ck_marketplace_categories_key
    check (char_length(key) between 2 and 64 and key ~ '^[a-z][a-z0-9_]*$'),
  constraint ck_marketplace_categories_name_ar check (char_length(btrim(name_ar)) between 1 and 120),
  constraint ck_marketplace_categories_name_en check (char_length(btrim(name_en)) between 1 and 120)
);

comment on table public.marketplace_categories is
  'Marketplace navigation grouping of product types (taxonomy level 1). Reference data: no client write grant; changed by migration / future audited admin RPC. Bilingual names are columns because admin-created rows have no code deploy to carry an i18n entry.';
comment on column public.marketplace_categories.key is
  'Stable lower_snake_case machine identifier. Immutable in practice: it becomes a URL filter value and an import column header.';
comment on column public.marketplace_categories.is_active is
  'False hides the category from the public catalogue without deleting it (product types under it stay intact).';

create trigger set_marketplace_categories_updated_at
  before update on public.marketplace_categories
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. marketplace_product_types — what a listing IS (wallpaper, cornice, paint …)
-- ---------------------------------------------------------------------------
create table public.marketplace_product_types (
  id          uuid        primary key default gen_random_uuid(),
  category_id uuid        not null references public.marketplace_categories (id) on delete restrict,
  key         text        not null,
  name_ar     text        not null,
  name_en     text        not null,
  sort_order  integer     not null default 0,
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint uq_marketplace_product_types_key unique (key),
  constraint ck_marketplace_product_types_key
    check (char_length(key) between 2 and 64 and key ~ '^[a-z][a-z0-9_]*$'),
  constraint ck_marketplace_product_types_name_ar check (char_length(btrim(name_ar)) between 1 and 120),
  constraint ck_marketplace_product_types_name_en check (char_length(btrim(name_en)) between 1 and 120)
);

comment on table public.marketplace_product_types is
  'The kind of product a Marketplace listing is (taxonomy level 2). A ROW, never an enum: adding paints, doors or flooring is an INSERT plus field mappings, not a structural change. Owns its attribute schema through marketplace_product_type_attributes.';
comment on column public.marketplace_product_types.category_id is
  'RESTRICT: a category that still groups types cannot be deleted; retire it with is_active.';

create index ix_marketplace_product_types_category
  on public.marketplace_product_types (category_id, sort_order);

create trigger set_marketplace_product_types_updated_at
  before update on public.marketplace_product_types
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. marketplace_attribute_definitions — a field, defined once, reusable
-- ---------------------------------------------------------------------------
-- data_type decides which typed column of the value tables (Migration 02) a
-- value lands in. It is a CHECKed text rather than an enum so a new kind of
-- field is a one-line constraint change, but it is IMMUTABLE once the row
-- exists (trigger below): changing it would reinterpret every stored value.
create table public.marketplace_attribute_definitions (
  id              uuid        primary key default gen_random_uuid(),
  key             text        not null,
  name_ar         text        not null,
  name_en         text        not null,
  data_type       text        not null,
  unit_kind       text,
  display_unit_ar text,
  display_unit_en text,
  is_active       boolean     not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint uq_marketplace_attribute_definitions_key unique (key),
  constraint ck_marketplace_attribute_definitions_key
    check (char_length(key) between 2 and 64 and key ~ '^[a-z][a-z0-9_]*$'),
  constraint ck_marketplace_attribute_definitions_name_ar check (char_length(btrim(name_ar)) between 1 and 120),
  constraint ck_marketplace_attribute_definitions_name_en check (char_length(btrim(name_en)) between 1 and 120),
  constraint ck_marketplace_attribute_definitions_data_type
    check (data_type in ('text', 'number', 'boolean', 'option', 'multi_option', 'measurement')),
  -- A measurement names its physical kind (and therefore its canonical unit);
  -- every other data type must not.
  constraint ck_marketplace_attribute_definitions_unit_kind check (
    (data_type = 'measurement' and unit_kind is not null and unit_kind in ('length', 'weight', 'volume'))
    or (data_type <> 'measurement' and unit_kind is null)
  ),
  -- A free display unit ("m²/L") only makes sense for a plain number.
  constraint ck_marketplace_attribute_definitions_display_unit check (
    (display_unit_ar is null and display_unit_en is null) or data_type = 'number'
  )
);

comment on table public.marketplace_attribute_definitions is
  'A product field defined once and reused across product types (material, color, thickness, volume …). Admin-configurable in the future Schema Builder. data_type / unit_kind / key are immutable (trigger): changing them would reinterpret stored values.';
comment on column public.marketplace_attribute_definitions.data_type is
  'text | number | boolean | option | multi_option | measurement. option/multi_option values reference marketplace_attribute_options; measurement is stored numerically in the canonical unit of unit_kind.';
comment on column public.marketplace_attribute_definitions.unit_kind is
  'Only for measurement. Canonical storage units: length = millimetres, weight = grams, volume = millilitres. The frontend converts for display; labels like "290 x 20 cm" are never stored.';
comment on column public.marketplace_attribute_definitions.is_active is
  'False switches the field off for new use and hides it from filters; values already stored are NOT deleted (value-table foreign keys are RESTRICT).';

create trigger set_marketplace_attribute_definitions_updated_at
  before update on public.marketplace_attribute_definitions
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. marketplace_product_type_attributes — which fields a type has, and how
-- ---------------------------------------------------------------------------
create table public.marketplace_product_type_attributes (
  product_type_id uuid        not null references public.marketplace_product_types (id) on delete cascade,
  attribute_id    uuid        not null references public.marketplace_attribute_definitions (id) on delete restrict,
  -- product  : one value for the whole listing (material, pattern, washable)
  -- variant  : differs per sellable SKU (color, thickness, roll width, weight)
  level           text        not null,
  is_required     boolean     not null default false,
  is_filterable   boolean     not null default false,
  -- One of the (V1: up to three) option groups a seller varies SKUs by.
  is_variant_axis boolean     not null default false,
  -- Optional per-type label (the cornice calls "length" its "bar length").
  name_ar_override text,
  name_en_override text,
  sort_order      integer     not null default 0,
  is_active       boolean     not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (product_type_id, attribute_id),
  constraint ck_marketplace_pta_level check (level in ('product', 'variant')),
  constraint ck_marketplace_pta_axis_is_variant check (not is_variant_axis or level = 'variant'),
  constraint ck_marketplace_pta_override_ar
    check (name_ar_override is null or char_length(btrim(name_ar_override)) between 1 and 120),
  constraint ck_marketplace_pta_override_en
    check (name_en_override is null or char_length(btrim(name_en_override)) between 1 and 120)
);

comment on table public.marketplace_product_type_attributes is
  'Maps a product type to the fields it uses and how: product- or variant-level, required, filterable, variant-defining. Disabling a mapping (is_active) keeps existing product data. The "at most three axes" rule is a V1 seller-UI limit, deliberately NOT a database constraint.';
comment on column public.marketplace_product_type_attributes.level is
  'product = one value per listing; variant = one value per sellable SKU. Value tables (Migration 02) enforce the matching side.';
comment on column public.marketplace_product_type_attributes.is_variant_axis is
  'The field is one of the option groups a seller combines into variants (color, size, thickness …). Only valid at variant level.';

-- The attribute side of the foreign key: "which types use this field".
create index ix_marketplace_pta_attribute
  on public.marketplace_product_type_attributes (attribute_id);
-- Rendering a type's form / filters reads its active mappings in order.
create index ix_marketplace_pta_type_order
  on public.marketplace_product_type_attributes (product_type_id, sort_order) where is_active;
-- Filter lists: only the filterable fields of a type.
create index ix_marketplace_pta_type_filterable
  on public.marketplace_product_type_attributes (product_type_id) where is_active and is_filterable;

create trigger set_marketplace_pta_updated_at
  before update on public.marketplace_product_type_attributes
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. marketplace_attribute_options — the allowed values of an option field
-- ---------------------------------------------------------------------------
create table public.marketplace_attribute_options (
  id           uuid        primary key default gen_random_uuid(),
  attribute_id uuid        not null references public.marketplace_attribute_definitions (id) on delete restrict,
  key          text        not null,
  name_ar      text        not null,
  name_en      text        not null,
  -- Colour options carry a swatch; every other option leaves it null.
  swatch_hex   text,
  sort_order   integer     not null default 0,
  is_active    boolean     not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint uq_marketplace_attribute_options_attr_key unique (attribute_id, key),
  -- Lets a value row carry (option_id, attribute_id) and prove, with a
  -- composite foreign key, that the option belongs to the attribute it claims.
  constraint uq_marketplace_attribute_options_id_attr unique (id, attribute_id),
  constraint ck_marketplace_attribute_options_key
    check (char_length(key) between 1 and 64 and key ~ '^[a-z0-9][a-z0-9_]*$'),
  constraint ck_marketplace_attribute_options_name_ar check (char_length(btrim(name_ar)) between 1 and 120),
  constraint ck_marketplace_attribute_options_name_en check (char_length(btrim(name_en)) between 1 and 120),
  constraint ck_marketplace_attribute_options_swatch check (swatch_hex is null or swatch_hex ~ '^#[0-9a-fA-F]{6}$')
);

comment on table public.marketplace_attribute_options is
  'Allowed values of an option / multi_option field (a material, a pattern, a colour). RESTRICT from values: an option in use cannot be deleted, only deactivated. Only attributes of data_type option / multi_option may own options (trigger).';

create index ix_marketplace_attribute_options_attr_order
  on public.marketplace_attribute_options (attribute_id, sort_order) where is_active;

create trigger set_marketplace_attribute_options_updated_at
  before update on public.marketplace_attribute_options
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- 6. Integrity triggers (invoker, empty search_path — no privilege escalation)
-- ---------------------------------------------------------------------------
-- 6a. An attribute's identity cannot change once it exists.
create or replace function app.marketplace_attribute_definition_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.key is distinct from old.key
     or new.data_type is distinct from old.data_type
     or new.unit_kind is distinct from old.unit_kind then
    raise exception 'marketplace attribute key / data_type / unit_kind are immutable'
      using errcode = '23514',
            hint = 'Create a new attribute definition and deactivate this one.';
  end if;
  return new;
end;
$$;

create trigger marketplace_attribute_definition_guard
  before update on public.marketplace_attribute_definitions
  for each row execute function app.marketplace_attribute_definition_guard();

-- 6b. Options belong only to option-type attributes, and never change owner.
create or replace function app.marketplace_attribute_option_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_type text;
begin
  if tg_op = 'UPDATE' and new.attribute_id is distinct from old.attribute_id then
    raise exception 'marketplace option attribute_id is immutable' using errcode = '23514';
  end if;
  select d.data_type into v_type
  from public.marketplace_attribute_definitions d
  where d.id = new.attribute_id;
  if v_type is null or v_type not in ('option', 'multi_option') then
    raise exception 'options may only belong to option / multi_option attributes (got %)', coalesce(v_type, 'missing attribute')
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger marketplace_attribute_option_guard
  before insert or update on public.marketplace_attribute_options
  for each row execute function app.marketplace_attribute_option_guard();

-- 6c. A mapping keeps its identity and its variant-axis flag only makes sense
--     for a field that can be chosen from a set (option / multi_option /
--     boolean) or measured — free text cannot define a variant.
create or replace function app.marketplace_pta_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_type text;
begin
  if tg_op = 'UPDATE' and (new.product_type_id is distinct from old.product_type_id
                           or new.attribute_id is distinct from old.attribute_id) then
    raise exception 'marketplace type-attribute mapping identity is immutable' using errcode = '23514';
  end if;
  if new.is_variant_axis then
    select d.data_type into v_type
    from public.marketplace_attribute_definitions d
    where d.id = new.attribute_id;
    if v_type = 'text' then
      raise exception 'a free-text field cannot be a variant axis' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger marketplace_pta_guard
  before insert or update on public.marketplace_product_type_attributes
  for each row execute function app.marketplace_pta_guard();

-- ---------------------------------------------------------------------------
-- 7. RLS + privileges — public read of ACTIVE reference data, no client write
-- ---------------------------------------------------------------------------
alter table public.marketplace_categories              enable row level security;
alter table public.marketplace_product_types           enable row level security;
alter table public.marketplace_attribute_definitions   enable row level security;
alter table public.marketplace_product_type_attributes enable row level security;
alter table public.marketplace_attribute_options       enable row level security;

revoke all on public.marketplace_categories              from public, anon, authenticated, service_role;
revoke all on public.marketplace_product_types           from public, anon, authenticated, service_role;
revoke all on public.marketplace_attribute_definitions   from public, anon, authenticated, service_role;
revoke all on public.marketplace_product_type_attributes from public, anon, authenticated, service_role;
revoke all on public.marketplace_attribute_options       from public, anon, authenticated, service_role;

grant select on public.marketplace_categories              to anon, authenticated;
grant select on public.marketplace_product_types           to anon, authenticated;
grant select on public.marketplace_attribute_definitions   to anon, authenticated;
grant select on public.marketplace_product_type_attributes to anon, authenticated;
grant select on public.marketplace_attribute_options       to anon, authenticated;
-- service_role keeps SELECT so trusted workers (import, indexing) can read the
-- vocabulary; it gets NO write grant either — see the security model above.
grant select on public.marketplace_categories              to service_role;
grant select on public.marketplace_product_types           to service_role;
grant select on public.marketplace_attribute_definitions   to service_role;
grant select on public.marketplace_product_type_attributes to service_role;
grant select on public.marketplace_attribute_options       to service_role;

-- Active rows are public. A row is public only if everything it hangs from is.
create policy marketplace_categories_select_active on public.marketplace_categories
  for select to anon, authenticated
  using (is_active);

create policy marketplace_product_types_select_active on public.marketplace_product_types
  for select to anon, authenticated
  using (
    is_active
    and exists (select 1 from public.marketplace_categories c where c.id = category_id and c.is_active)
  );

create policy marketplace_attribute_definitions_select_active on public.marketplace_attribute_definitions
  for select to anon, authenticated
  using (is_active);

create policy marketplace_pta_select_active on public.marketplace_product_type_attributes
  for select to anon, authenticated
  using (
    is_active
    and exists (select 1 from public.marketplace_attribute_definitions d where d.id = attribute_id and d.is_active)
    and exists (select 1 from public.marketplace_product_types t where t.id = product_type_id and t.is_active)
  );

create policy marketplace_attribute_options_select_active on public.marketplace_attribute_options
  for select to anon, authenticated
  using (
    is_active
    and exists (select 1 from public.marketplace_attribute_definitions d where d.id = attribute_id and d.is_active)
  );

-- Platform staff read everything, retired rows included (support / the future
-- Schema Builder need the whole vocabulary). Read only — no staff write policy.
create policy marketplace_categories_select_staff on public.marketplace_categories
  for select to authenticated using (app.is_admin_staff());
create policy marketplace_product_types_select_staff on public.marketplace_product_types
  for select to authenticated using (app.is_admin_staff());
create policy marketplace_attribute_definitions_select_staff on public.marketplace_attribute_definitions
  for select to authenticated using (app.is_admin_staff());
create policy marketplace_pta_select_staff on public.marketplace_product_type_attributes
  for select to authenticated using (app.is_admin_staff());
create policy marketplace_attribute_options_select_staff on public.marketplace_attribute_options
  for select to authenticated using (app.is_admin_staff());

-- NO insert / update / delete policy and NO such grant, in any role (see header).

-- ---------------------------------------------------------------------------
-- 8. Seed — three categories, the six approved product types
-- ---------------------------------------------------------------------------
insert into public.marketplace_categories (key, name_ar, name_en, sort_order) values
  ('wall_coverings_panels', 'أغطية الجدران والألواح الديكورية', 'Wall Coverings & Decorative Panels', 10),
  ('cornices_mouldings',    'الكرانيش والقطاعات',               'Cornices & Mouldings',                 20),
  ('finishing_accessories', 'ملحقات التشطيب',                   'Finishing Accessories',                30)
on conflict (key) do nothing;

insert into public.marketplace_product_types (category_id, key, name_ar, name_en, sort_order)
select c.id, v.key, v.name_ar, v.name_en, v.sort_order
from (values
  ('wall_coverings_panels', 'wallpaper',          'ورق حائط',  'Wallpaper',          10),
  ('wall_coverings_panels', 'wood_alternative',   'بديل خشب',  'Wood Alternative',   20),
  ('wall_coverings_panels', 'marble_alternative', 'بديل رخام', 'Marble Alternative', 30),
  ('wall_coverings_panels', 'sheeboard',          'شيبورد',    'Sheeboard',          40),
  ('cornices_mouldings',    'cornice',            'كرانيش',    'Cornices',           50),
  ('finishing_accessories', 'corner_trim',        'زوايا',     'Corner Trims',       60)
) as v(category_key, key, name_ar, name_en, sort_order)
join public.marketplace_categories c on c.key = v.category_key
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 9. Seed — attribute definitions (vocabulary of the six approved types)
-- ---------------------------------------------------------------------------
-- Draft V1 vocabulary: editable by the platform admin once the Schema Builder
-- ships. Material and pattern vocabularies differ per type, so they are
-- separate definitions; colour, finish and texture are shared.
insert into public.marketplace_attribute_definitions (key, name_ar, name_en, data_type, unit_kind) values
  ('material_wallpaper',          'الخامة',          'Material',          'option', null),
  ('material_wood_alternative',   'الخامة',          'Material',          'option', null),
  ('material_marble_alternative', 'الخامة',          'Material',          'option', null),
  ('material_sheeboard',          'الخامة الفعلية',  'Actual material',   'option', null),
  ('material_cornice',            'الخامة',          'Material',          'option', null),
  ('material_corner_trim',        'الخامة',          'Material',          'option', null),
  ('pattern_wallpaper',           'التصميم',         'Design',            'option', null),
  ('pattern_wood_alternative',    'التصميم',         'Design',            'option', null),
  ('pattern_marble_alternative',  'التصميم',         'Design',            'option', null),
  ('pattern_sheeboard',           'التصميم',         'Design',            'option', null),
  ('pattern_cornice',             'التصميم',         'Design',            'option', null),
  ('texture',                     'الملمس',          'Texture',           'option', null),
  ('finish',                      'التشطيب',         'Surface finish',    'option', null),
  ('color',                       'اللون',           'Color',             'option', null),
  ('corner_kind',                 'النوع',           'Type',              'option', null),
  ('washable',                    'قابل للغسيل',     'Washable',          'boolean', null),
  ('moisture_resistant',          'مقاوم للرطوبة',   'Moisture resistant','boolean', null),
  ('paintable',                   'قابل للدهان',     'Paintable',         'boolean', null),
  ('led_compatible',              'يدعم إضاءة LED',  'LED compatible',    'boolean', null),
  ('length',                      'الطول',           'Length',            'measurement', 'length'),
  ('width',                       'العرض',           'Width',             'measurement', 'length'),
  ('thickness',                   'السُمك',          'Thickness',         'measurement', 'length'),
  ('roll_width',                  'عرض الرول',       'Roll width',        'measurement', 'length'),
  ('roll_length',                 'طول الرول',       'Roll length',       'measurement', 'length'),
  ('profile_width',               'عرض القطاع',      'Profile width',     'measurement', 'length'),
  ('profile_height',              'ارتفاع القطاع',   'Profile height',    'measurement', 'length'),
  ('profile_size',                'مقاس القطاع',     'Profile size',      'measurement', 'length'),
  ('weight',                      'الوزن',           'Weight',            'measurement', 'weight')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 10. Seed — option values
-- ---------------------------------------------------------------------------
insert into public.marketplace_attribute_options (attribute_id, key, name_ar, name_en, swatch_hex, sort_order)
select d.id, v.option_key, v.name_ar, v.name_en, v.swatch_hex, v.sort_order
from (values
  -- materials
  ('material_wallpaper', 'paper',        'ورق',          'Paper',        null, 10),
  ('material_wallpaper', 'vinyl',        'فينيل',        'Vinyl',        null, 20),
  ('material_wallpaper', 'non_woven',    'غير منسوج',    'Non-woven',    null, 30),
  ('material_wallpaper', 'fabric',       'قماش',         'Fabric',       null, 40),
  ('material_wallpaper', 'vinyl_coated', 'فينيل مغطّى',  'Vinyl-coated', null, 50),
  ('material_wood_alternative', 'pvc', 'PVC', 'PVC', null, 10),
  ('material_wood_alternative', 'wpc', 'WPC', 'WPC', null, 20),
  ('material_wood_alternative', 'mdf', 'MDF', 'MDF', null, 30),
  ('material_wood_alternative', 'ps',  'PS',  'PS',  null, 40),
  ('material_marble_alternative', 'pvc',                'PVC',          'PVC',                null, 10),
  ('material_marble_alternative', 'spc',                'SPC',          'SPC',                null, 20),
  ('material_marble_alternative', 'verified_composite', 'مركّب موثّق',  'Verified composite', null, 30),
  ('material_sheeboard', 'particleboard',          'خشب حبيبي',          'Particleboard',           null, 10),
  ('material_sheeboard', 'mdf',                    'MDF',                'MDF',                     null, 20),
  ('material_sheeboard', 'pvc_foam_board',         'لوح فوم PVC',        'PVC foam board',          null, 30),
  ('material_sheeboard', 'wpc',                    'WPC',                'WPC',                     null, 40),
  ('material_sheeboard', 'other_verified_material','خامة أخرى موثّقة',   'Other verified material', null, 50),
  ('material_cornice', 'pu',     'PU',   'PU',     null, 10),
  ('material_cornice', 'ps',     'PS',   'PS',     null, 20),
  ('material_cornice', 'gypsum', 'جبس',  'Gypsum', null, 30),
  ('material_cornice', 'pvc',    'PVC',  'PVC',    null, 40),
  ('material_corner_trim', 'aluminum',        'ألومنيوم',    'Aluminum',        null, 10),
  ('material_corner_trim', 'pvc',             'PVC',         'PVC',             null, 20),
  ('material_corner_trim', 'stainless_steel', 'ستانلس ستيل', 'Stainless steel', null, 30),
  ('material_corner_trim', 'wpc',             'WPC',         'WPC',             null, 40),
  -- patterns
  ('pattern_wallpaper', 'plain',     'سادة',          'Plain',     null, 10),
  ('pattern_wallpaper', 'geometric', 'هندسي',         'Geometric', null, 20),
  ('pattern_wallpaper', 'floral',    'نباتي',         'Floral',    null, 30),
  ('pattern_wallpaper', 'classic',   'كلاسيك',        'Classic',   null, 40),
  ('pattern_wallpaper', 'marble',    'رخامي',         'Marble',    null, 50),
  ('pattern_wallpaper', 'wood',      'خشبي',          'Wood',      null, 60),
  ('pattern_wallpaper', 'three_d',   'ثلاثي الأبعاد', '3D',        null, 70),
  ('pattern_wallpaper', 'kids',      'أطفال',         'Kids',      null, 80),
  ('pattern_wood_alternative', 'slats',      'شرائح طولية', 'Longitudinal slats', null, 10),
  ('pattern_wood_alternative', 'fluted',     'مضلّع',       'Fluted',             null, 20),
  ('pattern_wood_alternative', 'wood_grain', 'عروق خشبية',  'Wood grain',         null, 30),
  ('pattern_wood_alternative', 'plain',      'سادة',        'Plain',              null, 40),
  ('pattern_wood_alternative', 'geometric',  'هندسي',       'Geometric',          null, 50),
  ('pattern_marble_alternative', 'gold_veins',    'عروق ذهبية',     'Gold veins',        null, 10),
  ('pattern_marble_alternative', 'grey_veins',    'عروق رمادية',    'Grey veins',        null, 20),
  ('pattern_marble_alternative', 'black_veins',   'عروق سوداء',     'Black veins',       null, 30),
  ('pattern_marble_alternative', 'natural_stone', 'شكل حجر طبيعي',  'Natural-stone look',null, 40),
  ('pattern_marble_alternative', 'plain',         'سادة',           'Plain',             null, 50),
  ('pattern_sheeboard', 'wood',      'خشبي',   'Wood',      null, 10),
  ('pattern_sheeboard', 'plain',     'سادة',   'Plain',     null, 20),
  ('pattern_sheeboard', 'marble',    'رخامي',  'Marble',    null, 30),
  ('pattern_sheeboard', 'geometric', 'هندسي',  'Geometric', null, 40),
  ('pattern_cornice', 'plain',   'سادة',    'Plain',   null, 10),
  ('pattern_cornice', 'classic', 'كلاسيك',  'Classic', null, 20),
  ('pattern_cornice', 'modern',  'مودرن',   'Modern',  null, 30),
  ('pattern_cornice', 'ornate',  'مزخرف',   'Ornate',  null, 40),
  -- shared
  ('texture', 'smooth',   'ناعم',  'Smooth',   null, 10),
  ('texture', 'grainy',   'محبّب', 'Grainy',   null, 20),
  ('texture', 'embossed', 'بارز',  'Embossed', null, 30),
  ('texture', 'fabric',   'قماشي', 'Fabric',   null, 40),
  ('texture', 'wood',     'خشبي',  'Wood',     null, 50),
  ('texture', 'stone',    'حجري',  'Stone',    null, 60),
  ('texture', 'carved',   'محفور', 'Carved',   null, 70),
  ('finish', 'matt',       'مط',        'Matt',       null, 10),
  ('finish', 'gloss',      'لامع',      'Gloss',      null, 20),
  ('finish', 'semi_gloss', 'نصف لامع',  'Semi-gloss', null, 30),
  ('finish', 'polished',   'مصقول',     'Polished',   null, 40),
  ('corner_kind', 'internal', 'زاوية داخلية', 'Internal corner', null, 10),
  ('corner_kind', 'external', 'زاوية خارجية', 'External corner', null, 20),
  ('corner_kind', 'end',      'زاوية نهاية',  'End corner',      null, 30),
  -- shared colour catalogue
  ('color', 'white',       'أبيض',          'White',       '#ffffff', 10),
  ('color', 'off_white',   'أوف وايت',      'Off-white',   '#f5f2ea', 20),
  ('color', 'cream',       'كريمي',         'Cream',       '#efe6cf', 30),
  ('color', 'beige',       'بيج',           'Beige',       '#d9c7a5', 40),
  ('color', 'light_grey',  'رمادي فاتح',    'Light grey',  '#c9c9c7', 50),
  ('color', 'dark_grey',   'رمادي غامق',    'Dark grey',   '#5b5d60', 60),
  ('color', 'black',       'أسود',          'Black',       '#1b1b1c', 70),
  ('color', 'light_brown', 'بني فاتح',      'Light brown', '#a97c50', 80),
  ('color', 'dark_brown',  'بني غامق',      'Dark brown',  '#4a2f1d', 90),
  ('color', 'walnut',      'جوز',           'Walnut',      '#5d4030', 100),
  ('color', 'oak',         'بلوط',          'Oak',         '#b98a54', 110),
  ('color', 'gold',        'ذهبي',          'Gold',        '#c9a24a', 120),
  ('color', 'silver',      'فضي',           'Silver',      '#bfc3c7', 130),
  ('color', 'bronze',      'برونزي',        'Bronze',      '#8c6a3b', 140),
  ('color', 'copper',      'نحاسي',         'Copper',      '#b4683c', 150),
  ('color', 'green',       'أخضر',          'Green',       '#5f8a5a', 160),
  ('color', 'blue',        'أزرق',          'Blue',        '#4f7aa8', 170),
  ('color', 'pink',        'وردي',          'Pink',        '#e4a7b5', 180),
  ('color', 'multi',       'متعدد الألوان', 'Multicolour', '#d8d0c4', 190)
) as v(attribute_key, option_key, name_ar, name_en, swatch_hex, sort_order)
join public.marketplace_attribute_definitions d on d.key = v.attribute_key
on conflict (attribute_id, key) do nothing;

-- ---------------------------------------------------------------------------
-- 11. Seed — which fields each of the six types has
-- ---------------------------------------------------------------------------
-- (type, attribute, level, required, filterable, variant_axis, sort,
--  ar override, en override)
insert into public.marketplace_product_type_attributes
  (product_type_id, attribute_id, level, is_required, is_filterable, is_variant_axis,
   name_ar_override, name_en_override, sort_order)
select t.id, d.id, v.level, v.is_required, v.is_filterable, v.is_variant_axis,
       v.ar_override, v.en_override, v.sort_order
from (values
  -- wallpaper
  ('wallpaper', 'material_wallpaper', 'product', true,  true,  false, null, null, 10),
  ('wallpaper', 'pattern_wallpaper',  'product', false, true,  false, null, null, 20),
  ('wallpaper', 'texture',            'product', false, true,  false, null, null, 30),
  ('wallpaper', 'washable',           'product', false, true,  false, null, null, 40),
  ('wallpaper', 'color',              'variant', true,  true,  true,  null, null, 50),
  ('wallpaper', 'roll_width',         'variant', true,  true,  true,  null, null, 60),
  ('wallpaper', 'roll_length',        'variant', true,  true,  false, null, null, 70),
  ('wallpaper', 'weight',             'variant', false, false, false, null, null, 80),
  -- wood alternative
  ('wood_alternative', 'material_wood_alternative', 'product', true,  true,  false, null, null, 10),
  ('wood_alternative', 'pattern_wood_alternative',  'product', false, true,  false, null, null, 20),
  ('wood_alternative', 'texture',                   'product', false, true,  false, null, null, 30),
  ('wood_alternative', 'finish',                    'product', false, true,  false, null, null, 40),
  ('wood_alternative', 'moisture_resistant',        'product', false, true,  false, null, null, 50),
  ('wood_alternative', 'color',                     'variant', true,  true,  true,  null, null, 60),
  ('wood_alternative', 'length',                    'variant', true,  true,  false, null, null, 70),
  ('wood_alternative', 'width',                     'variant', true,  true,  false, null, null, 80),
  ('wood_alternative', 'thickness',                 'variant', true,  true,  true,  null, null, 90),
  ('wood_alternative', 'weight',                    'variant', false, false, false, null, null, 100),
  -- marble alternative
  ('marble_alternative', 'material_marble_alternative', 'product', true,  true,  false, null, null, 10),
  ('marble_alternative', 'pattern_marble_alternative',  'product', false, true,  false, null, null, 20),
  ('marble_alternative', 'texture',                     'product', false, true,  false, null, null, 30),
  ('marble_alternative', 'finish',                      'product', false, true,  false, null, null, 40),
  ('marble_alternative', 'color',                       'variant', true,  true,  true,  null, null, 50),
  ('marble_alternative', 'length',                      'variant', true,  true,  false, null, null, 60),
  ('marble_alternative', 'width',                       'variant', true,  true,  false, null, null, 70),
  ('marble_alternative', 'thickness',                   'variant', true,  true,  true,  null, null, 80),
  ('marble_alternative', 'weight',                      'variant', false, false, false, null, null, 90),
  -- sheeboard: the ACTUAL material is mandatory and never defaulted (DL-18)
  ('sheeboard', 'material_sheeboard', 'product', true,  true,  false, null, null, 10),
  ('sheeboard', 'pattern_sheeboard',  'product', false, true,  false, null, null, 20),
  ('sheeboard', 'texture',            'product', false, true,  false, null, null, 30),
  ('sheeboard', 'finish',             'product', false, true,  false, null, null, 40),
  ('sheeboard', 'color',              'variant', true,  true,  true,  null, null, 50),
  ('sheeboard', 'length',             'variant', true,  true,  false, null, null, 60),
  ('sheeboard', 'width',              'variant', true,  true,  false, null, null, 70),
  ('sheeboard', 'thickness',          'variant', true,  true,  true,  null, null, 80),
  ('sheeboard', 'weight',             'variant', false, false, false, null, null, 90),
  -- cornice
  ('cornice', 'material_cornice', 'product', true,  true,  false, null, null, 10),
  ('cornice', 'pattern_cornice',  'product', false, true,  false, null, null, 20),
  ('cornice', 'texture',          'product', false, true,  false, null, null, 30),
  ('cornice', 'paintable',        'product', false, true,  false, null, null, 40),
  ('cornice', 'led_compatible',   'product', false, true,  false, null, null, 50),
  ('cornice', 'length',           'variant', true,  true,  true,  'طول العود', 'Bar length', 60),
  ('cornice', 'profile_width',    'variant', true,  true,  false, null, null, 70),
  ('cornice', 'profile_height',   'variant', true,  true,  true,  null, null, 80),
  ('cornice', 'weight',           'variant', false, false, false, null, null, 90),
  -- corner trim
  ('corner_trim', 'corner_kind',          'product', true,  true,  false, null, null, 10),
  ('corner_trim', 'material_corner_trim', 'product', true,  true,  false, null, null, 20),
  ('corner_trim', 'finish',               'product', false, true,  false, null, null, 30),
  ('corner_trim', 'color',                'variant', true,  true,  true,  null, null, 40),
  ('corner_trim', 'length',               'variant', true,  true,  false, null, null, 50),
  ('corner_trim', 'profile_size',         'variant', true,  true,  true,  null, null, 60),
  ('corner_trim', 'weight',               'variant', false, false, false, null, null, 70)
) as v(type_key, attribute_key, level, is_required, is_filterable, is_variant_axis,
       ar_override, en_override, sort_order)
join public.marketplace_product_types t on t.key = v.type_key
join public.marketplace_attribute_definitions d on d.key = v.attribute_key
on conflict (product_type_id, attribute_id) do nothing;
