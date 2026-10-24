-- ===========================================================================
-- Marketplace — Migration 02: product core
-- ===========================================================================
-- WHAT THIS IS. The catalogue rows themselves, on top of Migration 01's
-- taxonomy and attribute definitions:
--
--   marketplace_products                  a listing a seller owns
--   marketplace_product_variants          the sellable SKUs of a listing
--   marketplace_product_attribute_values  typed, relational product-level values
--   marketplace_variant_attribute_values  typed, relational variant-level values
--   marketplace_product_images            image METADATA (no binaries, no URLs)
--
-- It reuses marketplace_product_types / marketplace_attribute_definitions /
-- marketplace_product_type_attributes / marketplace_attribute_options. No
-- taxonomy table is duplicated.
--
-- WHAT THIS IS NOT. No inventory (Migration 03), no bulk import (Migration 04),
-- no cart, checkout, offers, payments or upload infrastructure. Nothing here
-- touches public.products, RFQs, quotations, B2B orders, Showroom account
-- implementation, memberships' capability list or the Kashier integration.
--
-- FAIL CLOSED — the most important property of this migration
--   * A product CANNOT reach status = 'published'. app.marketplace_publication_
--     blockers() always reports `seller_enablement_not_available` and
--     `inventory_not_available`, and a BEFORE trigger refuses the transition,
--     for every role including the table owner. Opening publication is a later,
--     reviewed migration that replaces that one function — nothing else changes.
--   * There is NO client write grant and NO write policy on any table here, and
--     NO anon grant at all. Rows are written by trusted DB-side operations
--     (migrations, seeds, the future audited seller RPCs). Org members may READ
--     their own organization's rows; platform staff may read everything.
--   * The seller is a reference to an existing organization. It is checked to be
--     a showroom (V1 sellers are Showrooms), but being a showroom is NOT
--     authorization: explicit seller enablement is a separate future table
--     (see "Deferred rules" below) and is part of the publication blockers.
--
-- DEFERRED RULES (documented, not implemented here)
--   1. Seller enablement. A future `marketplace_seller_accounts` row per
--      organization (status approved / suspended / revoked, approved_by,
--      approved_at) created only through an audited admin RPC. Publication
--      requires an `approved` row. Showroom capability keys are NOT added here:
--      that requires editing the membership capability check, which belongs to
--      the Showroom permission machinery owned by another engineer.
--   2. Inventory (Migration 03): a published variant must be purchasable
--      (on-hand and not reserved).
--   3. Media verification: publication requires a verified primary image; the
--      storage provider (Supabase Storage today, Cloudflare R2 once its security
--      blockers are closed) stays a column value, not a schema decision.
--   4. A public catalogue projection (view / RPC) exposing ONLY approved columns.
--      It does not exist yet on purpose: there is nothing publishable to project,
--      and `storage_bucket` / `object_key` are private by default.
--
-- Forward-only and additive. Migration 01 objects are only EXTENDED by one
-- guard trigger (section 7) that protects values already in use.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. marketplace_products
-- ---------------------------------------------------------------------------
create table public.marketplace_products (
  id                     uuid        primary key default gen_random_uuid(),
  seller_organization_id uuid        not null references public.organizations (id) on delete restrict,
  product_type_id        uuid        not null references public.marketplace_product_types (id) on delete restrict,
  slug                   text        not null,
  name_ar                text        not null,
  name_en                text        not null,
  description_ar         text,
  description_en         text,
  brand                  text,
  -- The seller's own code for this listing; used by bulk import (Migration 04)
  -- to match a re-uploaded row to the product it already created.
  external_ref           text,
  status                 text        not null default 'draft',
  published_at           timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint ck_marketplace_products_slug
    check (char_length(slug) between 3 and 120 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint ck_marketplace_products_name_ar check (char_length(btrim(name_ar)) between 1 and 200),
  constraint ck_marketplace_products_name_en check (char_length(btrim(name_en)) between 1 and 200),
  constraint ck_marketplace_products_description_ar check (description_ar is null or char_length(description_ar) <= 5000),
  constraint ck_marketplace_products_description_en check (description_en is null or char_length(description_en) <= 5000),
  constraint ck_marketplace_products_brand check (brand is null or char_length(btrim(brand)) between 1 and 80),
  constraint ck_marketplace_products_external_ref check (external_ref is null or char_length(btrim(external_ref)) between 1 and 80),
  constraint ck_marketplace_products_status check (status in ('draft', 'published', 'unpublished', 'archived')),
  -- published <=> has a publication time. (A product that was unpublished keeps
  -- the time it first went live; a draft never had one.)
  constraint ck_marketplace_products_published_at
    check (status <> 'published' or published_at is not null),
  -- Lets variants and images carry (product_id, seller_organization_id) and
  -- prove, with a composite foreign key, that they cannot name a different seller.
  constraint uq_marketplace_products_id_seller unique (id, seller_organization_id)
);

comment on table public.marketplace_products is
  'A Marketplace listing owned by one seller organization (V1: a Showroom). Separate from the B2B public.products. Created as draft; status = published is unreachable until seller enablement, inventory and media verification ship (fail closed — see the migration header). No client write grant, no anon grant: org members read their own rows; platform staff read all.';
comment on column public.marketplace_products.seller_organization_id is
  'The selling organization (immutable). Must be a showroom_dealer at creation; this is eligibility, not authorization — enablement is a separate future table and a publication blocker. NEVER a hardcoded organization id.';
comment on column public.marketplace_products.product_type_id is
  'Immutable: values are validated against this type''s field schema; changing it would orphan them.';
comment on column public.marketplace_products.slug is
  'Public URL handle, globally unique, lower-kebab-case.';
comment on column public.marketplace_products.status is
  'draft | published | unpublished | archived. Only published may ever be public; draft, unpublished and archived are private. published is currently unreachable (publication blockers).';

create unique index ux_marketplace_products_slug on public.marketplace_products (slug);
-- A seller sees "my products by status, newest first".
create index ix_marketplace_products_seller_status
  on public.marketplace_products (seller_organization_id, status, updated_at desc);
-- Catalogue browse / filter by type, only over what can ever be public.
create index ix_marketplace_products_type_published
  on public.marketplace_products (product_type_id, published_at desc) where status = 'published';
create index ix_marketplace_products_type on public.marketplace_products (product_type_id);
-- Bulk import idempotence: one listing per (seller, external code).
create unique index ux_marketplace_products_seller_external_ref
  on public.marketplace_products (seller_organization_id, external_ref) where external_ref is not null;

create trigger set_marketplace_products_updated_at
  before update on public.marketplace_products
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. marketplace_product_variants
-- ---------------------------------------------------------------------------
create table public.marketplace_product_variants (
  id                     uuid          primary key default gen_random_uuid(),
  product_id             uuid          not null,
  -- Denormalized from the product so SKU uniqueness can be declared per seller.
  -- The composite foreign key makes a mismatch impossible.
  seller_organization_id uuid          not null,
  sku                    text          not null,
  selling_unit           text          not null,
  -- Exclusive of VAT. The database stores no tax rate and no tax-inclusive price.
  price_egp              numeric(12,2) not null,
  status                 text          not null default 'active',
  -- Canonical combination of the variant-defining attributes. Maintained ONLY by
  -- the value-table triggers (section 6); NULL while the variant has no axis
  -- value. The unique index below is what makes duplicate combinations
  -- impossible even under concurrent writers.
  option_signature       text,
  created_at             timestamptz   not null default now(),
  updated_at             timestamptz   not null default now(),
  constraint fk_marketplace_variants_product_seller
    foreign key (product_id, seller_organization_id)
    references public.marketplace_products (id, seller_organization_id) on delete cascade,
  constraint ck_marketplace_variants_sku
    check (char_length(sku) between 1 and 64 and sku ~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$'),
  -- Closed list for V1. A new unit is a one-line change to this constraint (a
  -- migration), which keeps unit conversion decisions reviewed.
  constraint ck_marketplace_variants_unit
    check (selling_unit in ('piece', 'roll', 'board', 'bar', 'linear_meter', 'square_meter', 'pack')),
  constraint ck_marketplace_variants_price check (price_egp > 0),
  constraint ck_marketplace_variants_status check (status in ('active', 'inactive')),
  constraint uq_marketplace_variants_id_product unique (id, product_id)
);

comment on table public.marketplace_product_variants is
  'A sellable SKU of a listing: seller-scoped SKU, selling unit, price in EGP EXCLUDING VAT, and a canonical option signature. Dimensions are variant attribute values (canonical millimetres), not free text. Combinations are only what the seller creates — nothing is generated.';
comment on column public.marketplace_product_variants.price_egp is
  'EGP, numeric(12,2), exclusive of VAT, > 0. No tax percentage is stored anywhere.';
comment on column public.marketplace_product_variants.option_signature is
  'Deterministic digest of the variant-defining attribute values. Written only by triggers; unique per product (partial unique index), so a duplicate combination fails at the database under concurrency.';

create unique index ux_marketplace_variants_seller_sku
  on public.marketplace_product_variants (seller_organization_id, sku);
create unique index ux_marketplace_variants_product_signature
  on public.marketplace_product_variants (product_id, option_signature) where option_signature is not null;
create index ix_marketplace_variants_product_status
  on public.marketplace_product_variants (product_id, status);

create trigger set_marketplace_variants_updated_at
  before update on public.marketplace_product_variants
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Typed attribute values (relational, no JSON)
-- ---------------------------------------------------------------------------
-- One row per value. Exactly the column that matches the field's data_type is
-- filled (CHECK). measurement is stored numerically in the canonical unit named
-- by the definition's unit_kind (length = mm, weight = g, volume = ml); number
-- is a plain numeric. multi_option is several rows, one per chosen option.
create table public.marketplace_product_attribute_values (
  id           uuid        primary key default gen_random_uuid(),
  product_id   uuid        not null references public.marketplace_products (id) on delete cascade,
  attribute_id uuid        not null references public.marketplace_attribute_definitions (id) on delete restrict,
  -- Copied from the definition by trigger (the definition's data_type is
  -- immutable). It exists so uniqueness can be expressed as an index.
  data_type    text        not null,
  value_text    text,
  value_number  numeric(18,4),
  value_boolean boolean,
  option_id     uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint fk_marketplace_pav_option
    foreign key (option_id, attribute_id)
    references public.marketplace_attribute_options (id, attribute_id) on delete restrict,
  constraint ck_marketplace_pav_shape check (
    (data_type = 'text'         and value_text is not null    and value_number is null and value_boolean is null and option_id is null) or
    (data_type in ('number', 'measurement')
                                and value_number is not null  and value_text is null   and value_boolean is null and option_id is null) or
    (data_type = 'boolean'      and value_boolean is not null and value_text is null   and value_number is null  and option_id is null) or
    (data_type in ('option', 'multi_option')
                                and option_id is not null     and value_text is null   and value_number is null  and value_boolean is null)
  ),
  constraint ck_marketplace_pav_text check (value_text is null or char_length(btrim(value_text)) between 1 and 500),
  constraint ck_marketplace_pav_measurement check (data_type <> 'measurement' or value_number > 0)
);

comment on table public.marketplace_product_attribute_values is
  'Product-level field values (material, pattern, washable …), typed and relational. The field must be mapped to the product''s type at product level (trigger); options must belong to the field (composite FK). Single-valued fields have one row; multi_option has one row per option.';

create unique index ux_marketplace_pav_single
  on public.marketplace_product_attribute_values (product_id, attribute_id) where data_type <> 'multi_option';
create unique index ux_marketplace_pav_multi
  on public.marketplace_product_attribute_values (product_id, attribute_id, option_id) where data_type = 'multi_option';
-- Filtering: "products whose <field> is <option>" and "<measurement> between".
create index ix_marketplace_pav_option
  on public.marketplace_product_attribute_values (attribute_id, option_id, product_id) where option_id is not null;
create index ix_marketplace_pav_number
  on public.marketplace_product_attribute_values (attribute_id, value_number, product_id) where value_number is not null;
create index ix_marketplace_pav_fk_option on public.marketplace_product_attribute_values (option_id, attribute_id);

create trigger set_marketplace_pav_updated_at
  before update on public.marketplace_product_attribute_values
  for each row execute function app.set_updated_at();

create table public.marketplace_variant_attribute_values (
  id           uuid        primary key default gen_random_uuid(),
  variant_id   uuid        not null references public.marketplace_product_variants (id) on delete cascade,
  attribute_id uuid        not null references public.marketplace_attribute_definitions (id) on delete restrict,
  data_type    text        not null,
  value_text    text,
  value_number  numeric(18,4),
  value_boolean boolean,
  option_id     uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint fk_marketplace_vav_option
    foreign key (option_id, attribute_id)
    references public.marketplace_attribute_options (id, attribute_id) on delete restrict,
  constraint ck_marketplace_vav_shape check (
    (data_type = 'text'         and value_text is not null    and value_number is null and value_boolean is null and option_id is null) or
    (data_type in ('number', 'measurement')
                                and value_number is not null  and value_text is null   and value_boolean is null and option_id is null) or
    (data_type = 'boolean'      and value_boolean is not null and value_text is null   and value_number is null  and option_id is null) or
    (data_type in ('option', 'multi_option')
                                and option_id is not null     and value_text is null   and value_number is null  and value_boolean is null)
  ),
  constraint ck_marketplace_vav_text check (value_text is null or char_length(btrim(value_text)) between 1 and 500),
  constraint ck_marketplace_vav_measurement check (data_type <> 'measurement' or value_number > 0)
);

comment on table public.marketplace_variant_attribute_values is
  'Variant-level field values (colour, thickness, roll width, weight …). The field must be mapped to the product type at VARIANT level. Fields flagged is_variant_axis define the variant''s option_signature.';

create unique index ux_marketplace_vav_single
  on public.marketplace_variant_attribute_values (variant_id, attribute_id) where data_type <> 'multi_option';
create unique index ux_marketplace_vav_multi
  on public.marketplace_variant_attribute_values (variant_id, attribute_id, option_id) where data_type = 'multi_option';
create index ix_marketplace_vav_option
  on public.marketplace_variant_attribute_values (attribute_id, option_id, variant_id) where option_id is not null;
create index ix_marketplace_vav_number
  on public.marketplace_variant_attribute_values (attribute_id, value_number, variant_id) where value_number is not null;
create index ix_marketplace_vav_fk_option on public.marketplace_variant_attribute_values (option_id, attribute_id);

create trigger set_marketplace_vav_updated_at
  before update on public.marketplace_variant_attribute_values
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. marketplace_product_images — metadata only
-- ---------------------------------------------------------------------------
create table public.marketplace_product_images (
  id               uuid        primary key default gen_random_uuid(),
  product_id       uuid        not null,
  -- NULL = a product-level image; otherwise the image belongs to that variant,
  -- which the composite foreign key forces to be a variant OF THIS product.
  variant_id       uuid,
  storage_provider text        not null,
  storage_bucket   text        not null,
  object_key       text        not null,
  sort_order       integer     not null default 0,
  is_primary       boolean     not null default false,
  alt_text_ar      text,
  alt_text_en      text,
  status           text        not null default 'pending',
  mime_type        text,
  width_px         integer,
  height_px        integer,
  byte_size        bigint,
  checksum_sha256  text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint fk_marketplace_images_product
    foreign key (product_id) references public.marketplace_products (id) on delete cascade,
  constraint fk_marketplace_images_variant_product
    foreign key (variant_id, product_id)
    references public.marketplace_product_variants (id, product_id) on delete cascade,
  constraint ck_marketplace_images_provider
    check (storage_provider in ('supabase_storage', 'cloudflare_r2')),
  constraint ck_marketplace_images_bucket
    check (char_length(storage_bucket) between 1 and 63 and storage_bucket ~ '^[a-z0-9][a-z0-9._-]*$'),
  -- A stable object KEY: relative, no traversal, not a URL, and no query string
  -- (a signed URL carries one) — so a temporary URL can never be saved here.
  constraint ck_marketplace_images_object_key check (
    char_length(object_key) between 1 and 512
    and object_key !~ '^/'
    and object_key !~ '\.\.'
    and object_key !~ '^[a-zA-Z][a-zA-Z0-9+.-]*://'
    and object_key !~ '[?#]'
  ),
  constraint ck_marketplace_images_status check (status in ('pending', 'verified', 'rejected')),
  constraint ck_marketplace_images_sort check (sort_order >= 0),
  constraint ck_marketplace_images_alt_ar check (alt_text_ar is null or char_length(alt_text_ar) <= 300),
  constraint ck_marketplace_images_alt_en check (alt_text_en is null or char_length(alt_text_en) <= 300),
  constraint ck_marketplace_images_dims check (
    (width_px is null or width_px > 0) and (height_px is null or height_px > 0) and (byte_size is null or byte_size > 0)
  ),
  constraint ck_marketplace_images_checksum check (checksum_sha256 is null or checksum_sha256 ~ '^[0-9a-f]{64}$'),
  constraint ck_marketplace_images_mime check (mime_type is null or mime_type in ('image/jpeg', 'image/png', 'image/webp'))
);

comment on table public.marketplace_product_images is
  'Image METADATA for a listing or one of its variants. Object bytes live in object storage; only a provider, bucket and stable object key are stored — never a signed or public URL (the object_key check rejects URLs and query strings). Provider-independent (Supabase Storage now, Cloudflare R2 later). No client grant: bucket and key are private and must not be returned by any public projection.';
comment on column public.marketplace_product_images.variant_id is
  'NULL = product-level image. When set, (variant_id, product_id) is a composite foreign key, so an image can never point at another product''s variant.';
comment on column public.marketplace_product_images.status is
  'pending (uploaded, unverified) | verified | rejected. Only verified images may ever count toward publication; a rejected image does not hold the primary slot.';

-- Unique object location per provider/bucket.
create unique index ux_marketplace_images_object
  on public.marketplace_product_images (storage_provider, storage_bucket, object_key);
-- At most ONE active (non-rejected) primary product-level image per product.
create unique index ux_marketplace_images_primary_product
  on public.marketplace_product_images (product_id)
  where is_primary and variant_id is null and status <> 'rejected';
-- Deterministic ordering: one image per slot.
create unique index ux_marketplace_images_order_product
  on public.marketplace_product_images (product_id, sort_order) where variant_id is null;
create unique index ux_marketplace_images_order_variant
  on public.marketplace_product_images (variant_id, sort_order) where variant_id is not null;
create index ix_marketplace_images_product on public.marketplace_product_images (product_id, sort_order);

create trigger set_marketplace_images_updated_at
  before update on public.marketplace_product_images
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Integrity triggers — products and variants
-- ---------------------------------------------------------------------------
create or replace function app.marketplace_product_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_type    text;
  v_deleted timestamptz;
begin
  if tg_op = 'UPDATE' then
    if new.seller_organization_id is distinct from old.seller_organization_id
       or new.product_type_id is distinct from old.product_type_id then
      raise exception 'marketplace product seller and product type are immutable' using errcode = '23514';
    end if;
  else
    select o.org_type::text, o.deleted_at into v_type, v_deleted
    from public.organizations o where o.id = new.seller_organization_id;
    if v_type is distinct from 'showroom_dealer' or v_deleted is not null then
      raise exception 'a marketplace seller must be a live showroom organization' using errcode = '23514';
    end if;
  end if;

  -- Publication is only ever granted through the blockers function (fail closed).
  if new.status = 'published' and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    if tg_op = 'INSERT' then
      -- a brand-new row has no values yet, so it can never satisfy publication
      raise exception 'a marketplace product cannot be created as published'
        using errcode = '23514', hint = 'Create it as draft; publication is gated.';
    end if;
    if cardinality(app.marketplace_publication_blockers(new.id)) > 0 then
      raise exception 'marketplace publication is blocked: %',
        array_to_string(app.marketplace_publication_blockers(new.id), ', ')
        using errcode = '23514';
    end if;
    new.published_at := coalesce(new.published_at, now());
  end if;
  return new;
end;
$$;

create trigger marketplace_product_guard
  before insert or update on public.marketplace_products
  for each row execute function app.marketplace_product_guard();

create or replace function app.marketplace_variant_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.product_id is distinct from old.product_id
                           or new.seller_organization_id is distinct from old.seller_organization_id) then
    raise exception 'marketplace variant product and seller are immutable' using errcode = '23514';
  end if;
  -- option_signature is trigger-owned: a direct write cannot forge a combination.
  if tg_op = 'INSERT' then
    new.option_signature := null;
  elsif new.option_signature is distinct from old.option_signature
        and current_setting('app.marketplace_signature_write', true) is distinct from 'on' then
    new.option_signature := old.option_signature;
  end if;
  return new;
end;
$$;

create trigger marketplace_variant_guard
  before insert or update on public.marketplace_product_variants
  for each row execute function app.marketplace_variant_guard();

-- ---------------------------------------------------------------------------
-- 6. Integrity triggers — attribute values (type / level / ownership / unit)
-- ---------------------------------------------------------------------------
-- The signature of a variant: its variant-defining (is_variant_axis) values,
-- ordered by attribute, as text. NULL when the variant has no axis value yet.
create or replace function app.marketplace_variant_signature(p_variant_id uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select string_agg(
           v.attribute_id::text || '=' || coalesce(
             v.option_id::text,
             trim_scale(v.value_number)::text,
             v.value_boolean::text,
             lower(btrim(v.value_text))),
           '|' order by v.attribute_id, v.option_id)
  from public.marketplace_variant_attribute_values v
  join public.marketplace_product_variants pv on pv.id = v.variant_id
  join public.marketplace_products p on p.id = pv.product_id
  join public.marketplace_product_type_attributes a
    on a.product_type_id = p.product_type_id and a.attribute_id = v.attribute_id and a.is_variant_axis
  where v.variant_id = p_variant_id;
$$;

create or replace function app.marketplace_attribute_value_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_def         public.marketplace_attribute_definitions;
  v_type_id     uuid;
  v_level       text;
  v_opt_active  boolean;
  v_owner_id    uuid;
begin
  if tg_table_name = 'marketplace_product_attribute_values' then
    v_owner_id := new.product_id;
    v_level := 'product';
    select p.product_type_id into v_type_id from public.marketplace_products p where p.id = new.product_id;
  else
    v_owner_id := new.variant_id;
    v_level := 'variant';
    select p.product_type_id into v_type_id
    from public.marketplace_product_variants pv
    join public.marketplace_products p on p.id = pv.product_id
    where pv.id = new.variant_id;
  end if;

  if tg_op = 'UPDATE' then
    -- (kept as separate statements: the two tables have different owner columns)
    if new.attribute_id is distinct from old.attribute_id then
      raise exception 'an attribute value cannot move to another field' using errcode = '23514';
    end if;
    if tg_table_name = 'marketplace_product_attribute_values' then
      if new.product_id is distinct from old.product_id then
        raise exception 'an attribute value cannot move to another product' using errcode = '23514';
      end if;
    else
      if new.variant_id is distinct from old.variant_id then
        raise exception 'an attribute value cannot move to another variant' using errcode = '23514';
      end if;
    end if;
  end if;

  select d.* into v_def from public.marketplace_attribute_definitions d where d.id = new.attribute_id;
  if not found then
    raise exception 'unknown attribute definition' using errcode = '23503';
  end if;
  new.data_type := v_def.data_type;   -- never trust the caller's copy

  -- The field must belong to this product type, at this level. New values need
  -- an active field and an active mapping; existing values stay valid when a
  -- field is later switched off (UPDATE of a retired field's value is allowed).
  if tg_op = 'INSERT' then
    if not v_def.is_active then
      raise exception 'attribute definition % is not active', v_def.key using errcode = '23514';
    end if;
    if not exists (
      select 1 from public.marketplace_product_type_attributes a
      where a.product_type_id = v_type_id and a.attribute_id = new.attribute_id
        and a.level = v_level and a.is_active
    ) then
      raise exception 'attribute % is not an active % field of this product type', v_def.key, v_level
        using errcode = '23514';
    end if;
    if new.option_id is not null then
      select o.is_active into v_opt_active from public.marketplace_attribute_options o
      where o.id = new.option_id and o.attribute_id = new.attribute_id;
      if v_opt_active is not true then
        raise exception 'option is not an active option of attribute %', v_def.key using errcode = '23514';
      end if;
    end if;
  end if;

  return new;
end;
$$;

create trigger marketplace_pav_guard
  before insert or update on public.marketplace_product_attribute_values
  for each row execute function app.marketplace_attribute_value_guard();
create trigger marketplace_vav_guard
  before insert or update on public.marketplace_variant_attribute_values
  for each row execute function app.marketplace_attribute_value_guard();

-- Keep the variant's option_signature in step with its values. The unique index
-- on (product_id, option_signature) then rejects a duplicate combination at the
-- statement that creates it — safe under concurrent writers.
create or replace function app.marketplace_refresh_variant_signature()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid := coalesce(new.variant_id, old.variant_id);
begin
  perform set_config('app.marketplace_signature_write', 'on', true);
  update public.marketplace_product_variants
     set option_signature = app.marketplace_variant_signature(v_id)
   where id = v_id
     and option_signature is distinct from app.marketplace_variant_signature(v_id);
  perform set_config('app.marketplace_signature_write', 'off', true);
  return null;
end;
$$;

create trigger marketplace_vav_signature
  after insert or update or delete on public.marketplace_variant_attribute_values
  for each row execute function app.marketplace_refresh_variant_signature();

-- ---------------------------------------------------------------------------
-- 7. Protect values already in use from changes to Migration 01 mappings
-- ---------------------------------------------------------------------------
-- Switching a field off (is_active = false) is always allowed and keeps data.
-- What must not happen silently is DELETING a mapping, or moving it to another
-- level / type, while products already carry values for it.
create or replace function app.marketplace_type_attribute_in_use_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_in_use boolean;
begin
  if tg_op = 'UPDATE' and new.product_type_id = old.product_type_id
     and new.attribute_id = old.attribute_id and new.level = old.level then
    return new;            -- flags, labels, order: always fine
  end if;
  select exists (
           select 1 from public.marketplace_product_attribute_values v
           join public.marketplace_products p on p.id = v.product_id
           where p.product_type_id = old.product_type_id and v.attribute_id = old.attribute_id)
      or exists (
           select 1 from public.marketplace_variant_attribute_values v
           join public.marketplace_product_variants pv on pv.id = v.variant_id
           join public.marketplace_products p on p.id = pv.product_id
           where p.product_type_id = old.product_type_id and v.attribute_id = old.attribute_id)
    into v_in_use;
  if v_in_use then
    raise exception 'marketplace type-attribute mapping is in use by product values'
      using errcode = '23503', hint = 'Set is_active = false instead; stored values are kept.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger marketplace_type_attribute_in_use_guard
  before update or delete on public.marketplace_product_type_attributes
  for each row execute function app.marketplace_type_attribute_in_use_guard();

-- ---------------------------------------------------------------------------
-- 8. Publication blockers — fail closed
-- ---------------------------------------------------------------------------
-- Returns every reason a product cannot be published right now. Dynamic: it
-- reads the product type's CURRENT required-field mapping, so admin-configured
-- fields are enforced without code changes. The last two constants are the
-- deferred dependencies; a later migration removes them by replacing this
-- function — the guard trigger above does not change.
create or replace function app.marketplace_publication_blockers(p_product_id uuid)
returns text[]
language plpgsql
stable
set search_path = ''
as $$
declare
  v_blockers text[] := '{}';
  v_type_id  uuid;
  v_count    integer;
  r          record;
begin
  select p.product_type_id into v_type_id from public.marketplace_products p where p.id = p_product_id;
  if v_type_id is null then
    return array['product_not_found'];
  end if;

  -- 1. required PRODUCT-level fields
  for r in
    select d.key
    from public.marketplace_product_type_attributes a
    join public.marketplace_attribute_definitions d on d.id = a.attribute_id
    where a.product_type_id = v_type_id and a.level = 'product' and a.is_required and a.is_active and d.is_active
      and not exists (select 1 from public.marketplace_product_attribute_values v
                      where v.product_id = p_product_id and v.attribute_id = a.attribute_id)
    order by a.sort_order
  loop
    v_blockers := v_blockers || ('missing_product_attribute:' || r.key);
  end loop;

  -- 2. at least one active variant
  select count(*) into v_count from public.marketplace_product_variants
   where product_id = p_product_id and status = 'active';
  if v_count = 0 then
    v_blockers := array_append(v_blockers, 'no_active_variant'::text);
  end if;

  -- 3. every ACTIVE variant carries each required VARIANT-level field
  for r in
    select pv.sku, d.key
    from public.marketplace_product_variants pv
    cross join public.marketplace_product_type_attributes a
    join public.marketplace_attribute_definitions d on d.id = a.attribute_id
    where pv.product_id = p_product_id and pv.status = 'active'
      and a.product_type_id = v_type_id and a.level = 'variant' and a.is_required and a.is_active and d.is_active
      and not exists (select 1 from public.marketplace_variant_attribute_values v
                      where v.variant_id = pv.id and v.attribute_id = a.attribute_id)
    order by pv.sku, a.sort_order
  loop
    v_blockers := v_blockers || ('missing_variant_attribute:' || r.sku || ':' || r.key);
  end loop;

  -- 4. several active variants must be told apart by their option combination
  if v_count > 1 and exists (
       select 1 from public.marketplace_product_variants
       where product_id = p_product_id and status = 'active' and option_signature is null) then
    v_blockers := array_append(v_blockers, 'variant_without_option_combination'::text);
  end if;

  -- 5. a verified primary product image
  if not exists (select 1 from public.marketplace_product_images i
                 where i.product_id = p_product_id and i.variant_id is null
                   and i.is_primary and i.status = 'verified') then
    v_blockers := array_append(v_blockers, 'no_verified_primary_image'::text);
  end if;

  -- 6. DEFERRED DEPENDENCIES (constants until their migrations exist)
  v_blockers := array_append(v_blockers, 'seller_enablement_not_available'::text);
  v_blockers := array_append(v_blockers, 'inventory_not_available'::text);

  return v_blockers;
end;
$$;

comment on function app.marketplace_publication_blockers(uuid) is
  'Every reason a marketplace product cannot be published now. Reads the live required-field mapping. Always includes seller_enablement_not_available and inventory_not_available until those migrations replace this function, which keeps publication closed (fail closed). Internal: no role has EXECUTE.';

revoke all on function app.marketplace_publication_blockers(uuid) from public, anon, authenticated, service_role;
revoke all on function app.marketplace_variant_signature(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. RLS + privileges
-- ---------------------------------------------------------------------------
alter table public.marketplace_products                 enable row level security;
alter table public.marketplace_product_variants         enable row level security;
alter table public.marketplace_product_attribute_values enable row level security;
alter table public.marketplace_variant_attribute_values enable row level security;
alter table public.marketplace_product_images           enable row level security;

revoke all on public.marketplace_products                 from public, anon, authenticated, service_role;
revoke all on public.marketplace_product_variants         from public, anon, authenticated, service_role;
revoke all on public.marketplace_product_attribute_values from public, anon, authenticated, service_role;
revoke all on public.marketplace_variant_attribute_values from public, anon, authenticated, service_role;
revoke all on public.marketplace_product_images           from public, anon, authenticated, service_role;

-- SELECT only, authenticated + service_role. NOTHING for anon: until a public
-- projection exists and publication is open there is nothing public to read, and
-- storage coordinates must never be reachable through a base table.
grant select on public.marketplace_products                 to authenticated, service_role;
grant select on public.marketplace_product_variants         to authenticated, service_role;
grant select on public.marketplace_product_attribute_values to authenticated, service_role;
grant select on public.marketplace_variant_attribute_values to authenticated, service_role;
grant select on public.marketplace_product_images           to authenticated, service_role;

-- A seller organization's members read ALL of their own rows (every status).
create policy marketplace_products_select_seller on public.marketplace_products
  for select to authenticated
  using (app.is_org_member(seller_organization_id));
create policy marketplace_variants_select_seller on public.marketplace_product_variants
  for select to authenticated
  using (app.is_org_member(seller_organization_id));
create policy marketplace_pav_select_seller on public.marketplace_product_attribute_values
  for select to authenticated
  using (exists (select 1 from public.marketplace_products p
                 where p.id = product_id and app.is_org_member(p.seller_organization_id)));
create policy marketplace_vav_select_seller on public.marketplace_variant_attribute_values
  for select to authenticated
  using (exists (select 1 from public.marketplace_product_variants v
                 where v.id = variant_id and app.is_org_member(v.seller_organization_id)));
create policy marketplace_images_select_seller on public.marketplace_product_images
  for select to authenticated
  using (exists (select 1 from public.marketplace_products p
                 where p.id = product_id and app.is_org_member(p.seller_organization_id)));

-- Platform staff read everything (support / review). Read only.
create policy marketplace_products_select_staff on public.marketplace_products
  for select to authenticated using (app.is_admin_staff());
create policy marketplace_variants_select_staff on public.marketplace_product_variants
  for select to authenticated using (app.is_admin_staff());
create policy marketplace_pav_select_staff on public.marketplace_product_attribute_values
  for select to authenticated using (app.is_admin_staff());
create policy marketplace_vav_select_staff on public.marketplace_variant_attribute_values
  for select to authenticated using (app.is_admin_staff());
create policy marketplace_images_select_staff on public.marketplace_product_images
  for select to authenticated using (app.is_admin_staff());

-- NO insert / update / delete policy and NO such grant, in any role.
