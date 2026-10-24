-- ===========================================================================
-- Marketplace — catalog foundation (ADR-0011, docs/marketplace/MARKETPLACE.md)
--
-- WHAT THIS IS. The data model for the public, direct-price Marketplace
-- catalog: the TWO discovery splits, the sellers allowed to publish, and the
-- products / variants / images / stock they own.
--
--   SPLIT 1 — SHOP BY PRODUCT
--     marketplace_categories (3) → marketplace_product_types (6) → products
--   SPLIT 2 — SHOP BY FINISHING TYPE
--     marketplace_finishing_groups (5) → marketplace_finishing_tasks (one per
--     existing installer trade, REUSING public.trades) → product types, with a
--     role (primary / complementary / optional). A product is never duplicated
--     to appear in both paths: a task reaches products THROUGH their product type.
--
-- WHAT THIS IS NOT. No cart, checkout, order, payment, offer, price history,
-- reservation or showroom-facing write path (later migrations). Nothing here
-- touches public.products / rfqs / quotations / orders, the membership
-- capability list, the showroom dashboard or any existing account (D-23).
--
-- SECURITY MODEL.
--   * Reference data (categories, types, units, finishing groups/tasks): world-
--     readable (anon + authenticated) where active; NO client write grant.
--   * Seller-owned data (seller accounts, products, variants, images, stock):
--     RLS enabled, NO policy and NO grant for anon/authenticated/service_role.
--     The browser reaches published products ONLY through the SECURITY DEFINER
--     read RPCs below, which expose a fixed projection (no exact stock).
--   * CLOSED BY DEFAULT: marketplace_settings.browse_enabled is false and a
--     seller exists only as a marketplace_seller_accounts row (D-20, D-21).
--     The first seller is activated DB-side via marketplace_ops_activate_seller
--     (service_role / database owner only).
--   * Writes are performed by trusted DB-side operations (ops function, seeds,
--     later Stage-6 RPCs). Showroom capability keys are deliberately NOT added
--     here: they require editing ck_membership_capability_key, which belongs to
--     the showroom permission machinery and is deferred to Stage 6 (D-23).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------
create type public.marketplace_seller_status  as enum ('approved', 'suspended', 'revoked');
create type public.marketplace_product_status as enum ('draft', 'published', 'unpublished', 'archived');
create type public.marketplace_unit_kind      as enum ('count', 'length', 'area');
create type public.marketplace_task_role      as enum ('primary', 'complementary', 'optional');

-- ---------------------------------------------------------------------------
-- 2. Release flags — one row, closed by default (D-20). Read only by the RPCs.
-- ---------------------------------------------------------------------------
create table public.marketplace_settings (
  singleton        boolean     primary key default true,
  browse_enabled   boolean     not null default false,
  checkout_enabled boolean     not null default false,
  updated_at       timestamptz not null default now(),
  constraint ck_marketplace_settings_singleton check (singleton)
);
comment on table public.marketplace_settings is
  'Marketplace release flags (single row). Closed by default. No client access: read only inside the public read RPCs; changed by the controlled operations path.';
insert into public.marketplace_settings default values;

create trigger set_marketplace_settings_updated_at
  before update on public.marketplace_settings
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. SPLIT 1 reference data — categories, product types, units
-- ---------------------------------------------------------------------------
create table public.marketplace_categories (
  id         uuid        primary key default gen_random_uuid(),
  key        text        not null,
  is_active  boolean     not null default true,
  sort_order smallint    not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_marketplace_categories_key unique (key),
  constraint ck_marketplace_categories_key check (char_length(key) between 2 and 64 and key ~ '^[a-z][a-z0-9_]*$')
);
comment on table public.marketplace_categories is
  'Navigation grouping of product types (Split 1, level 1). Reference data, database-driven (never an enum). Labels live in the i18n catalogs keyed by `key`.';

create table public.marketplace_product_types (
  id          uuid        primary key default gen_random_uuid(),
  category_id uuid        not null references public.marketplace_categories (id) on delete restrict,
  key         text        not null,
  is_active   boolean     not null default true,
  sort_order  smallint    not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint uq_marketplace_product_types_key unique (key),
  constraint ck_marketplace_product_types_key check (char_length(key) between 2 and 64 and key ~ '^[a-z][a-z0-9_]*$')
);
comment on table public.marketplace_product_types is
  'The product type a listing belongs to (Split 1, level 2). Owns the attribute schema, allowed units and finishing-task links. Reference data.';
create index ix_marketplace_product_types_category on public.marketplace_product_types (category_id);

create table public.marketplace_units (
  id         uuid                         primary key default gen_random_uuid(),
  key        text                         not null,
  kind       public.marketplace_unit_kind not null,
  is_active  boolean                      not null default true,
  sort_order smallint                     not null default 0,
  created_at timestamptz                  not null default now(),
  updated_at timestamptz                  not null default now(),
  constraint uq_marketplace_units_key unique (key),
  constraint ck_marketplace_units_key check (char_length(key) between 2 and 64 and key ~ '^[a-z][a-z0-9_]*$')
);
comment on table public.marketplace_units is
  'Units of sale. Its own table: the B2B public.product_unit enum lacks board and bar and is not widened. Price and stock are expressed per unit; the platform never converts between units.';

create table public.marketplace_product_type_units (
  product_type_id uuid not null references public.marketplace_product_types (id) on delete cascade,
  unit_id         uuid not null references public.marketplace_units (id) on delete restrict,
  primary key (product_type_id, unit_id)
);
comment on table public.marketplace_product_type_units is
  'Units a product type may be sold in. The seeded set is a CANDIDATE set pending owner confirmation (D-08); changing it is a data migration.';

-- ---------------------------------------------------------------------------
-- 4. SPLIT 2 reference data — finishing groups, tasks (reusing public.trades)
-- ---------------------------------------------------------------------------
create table public.marketplace_finishing_groups (
  id         uuid        primary key default gen_random_uuid(),
  key        text        not null,
  is_active  boolean     not null default true,
  sort_order smallint    not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_marketplace_finishing_groups_key unique (key),
  constraint ck_marketplace_finishing_groups_key check (char_length(key) between 2 and 64 and key ~ '^[a-z][a-z0-9_]*$')
);
comment on table public.marketplace_finishing_groups is
  'Presentation-only grouping of finishing tasks (Split 2, level 1). Not a trade attribute and not authorization.';

create table public.marketplace_finishing_tasks (
  id         uuid        primary key default gen_random_uuid(),
  group_id   uuid        not null references public.marketplace_finishing_groups (id) on delete restrict,
  trade_id   uuid        references public.trades (id) on delete restrict,
  key        text        not null,
  is_active  boolean     not null default true,
  sort_order smallint    not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_marketplace_finishing_tasks_key unique (key),
  constraint uq_marketplace_finishing_tasks_trade unique (trade_id),
  constraint ck_marketplace_finishing_tasks_key check (char_length(key) between 2 and 64 and key ~ '^[a-z][a-z0-9_]*$')
);
comment on table public.marketplace_finishing_tasks is
  'A piece of finishing work a shopper may start from (Split 2, level 2). trade_id REUSES public.trades (no duplicate installer taxonomy, no change to registration/onboarding); a trade is a discovery signal, never authorization (O5).';
create index ix_marketplace_finishing_tasks_group on public.marketplace_finishing_tasks (group_id);

create table public.marketplace_finishing_task_product_types (
  task_id         uuid                         not null references public.marketplace_finishing_tasks (id) on delete cascade,
  product_type_id uuid                         not null references public.marketplace_product_types (id) on delete cascade,
  role            public.marketplace_task_role not null,
  primary key (task_id, product_type_id)
);
comment on table public.marketplace_finishing_task_product_types is
  'Which product types a finishing task needs and in what role. Compatibility is explicit, never assumed; a task with no linked, published products is hidden by the public RPC.';
create index ix_marketplace_task_types_type on public.marketplace_finishing_task_product_types (product_type_id);

-- ---------------------------------------------------------------------------
-- 5. Sellers — eligibility is data; selling permission is separate from the
--    organization's identity. NO ROW = CLOSED.
-- ---------------------------------------------------------------------------
create table public.marketplace_seller_eligible_org_types (
  org_type   public.account_type primary key,
  is_active  boolean             not null default true,
  created_at timestamptz         not null default now(),
  constraint ck_marketplace_seller_eligible_not_consumer check (org_type <> 'end_consumer')
);
comment on table public.marketplace_seller_eligible_org_types is
  'Organization types allowed to sell. V1: showroom_dealer only. Extending to Supplier/Importer is a row, not a code change (DL-02).';

create table public.marketplace_seller_accounts (
  organization_id uuid                            primary key references public.organizations (id) on delete restrict,
  status          public.marketplace_seller_status not null default 'approved',
  cod_enabled     boolean                         not null default false,
  activated_at    timestamptz                     not null default now(),
  activated_by    uuid                            references public.users (id) on delete set null,
  reason          text,
  version         integer                         not null default 1,
  created_at      timestamptz                     not null default now(),
  updated_at      timestamptz                     not null default now(),
  constraint ck_marketplace_seller_accounts_reason_len check (reason is null or char_length(reason) <= 500)
);
comment on table public.marketplace_seller_accounts is
  'An organization enrolled to sell on the Marketplace. Creating a row does NOT modify the organization, its memberships, capabilities or dashboard. Absence of a row means closed. Written only by marketplace_ops_activate_seller.';

create function app.marketplace_seller_accounts_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.organizations o
    join public.marketplace_seller_eligible_org_types e
      on e.org_type = o.org_type and e.is_active
    where o.id = new.organization_id
  ) then
    raise exception 'organization type is not eligible to sell on the marketplace'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger marketplace_seller_accounts_guard
  before insert on public.marketplace_seller_accounts
  for each row execute function app.marketplace_seller_accounts_guard();

create trigger set_marketplace_seller_accounts_updated_at
  before update on public.marketplace_seller_accounts
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- 6. Catalog — products, variants, images, stock
-- ---------------------------------------------------------------------------
create table public.marketplace_products (
  id              uuid                              primary key default gen_random_uuid(),
  organization_id uuid                              not null references public.marketplace_seller_accounts (organization_id) on delete restrict,
  product_type_id uuid                              not null references public.marketplace_product_types (id) on delete restrict,
  slug            text                              not null,
  name_ar         text,
  name_en         text,
  description_ar  text,
  description_en  text,
  brand           text,
  status          public.marketplace_product_status not null default 'draft',
  published_at    timestamptz,
  version         integer                           not null default 1,
  created_by      uuid                              references public.users (id) on delete set null,
  created_at      timestamptz                       not null default now(),
  updated_at      timestamptz                       not null default now(),
  deleted_at      timestamptz,
  constraint uq_marketplace_products_slug unique (slug),
  -- Parent key so every child row proves "same seller" with a composite FK.
  constraint uq_marketplace_products_org_id unique (organization_id, id),
  constraint ck_marketplace_products_slug check (char_length(slug) between 3 and 120 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint ck_marketplace_products_name_present check (
    nullif(btrim(coalesce(name_ar, '')), '') is not null or nullif(btrim(coalesce(name_en, '')), '') is not null
  ),
  constraint ck_marketplace_products_name_len check (
    (name_ar is null or char_length(name_ar) <= 160) and (name_en is null or char_length(name_en) <= 160)
  ),
  constraint ck_marketplace_products_desc_len check (
    (description_ar is null or char_length(description_ar) <= 2000) and (description_en is null or char_length(description_en) <= 2000)
  ),
  constraint ck_marketplace_products_brand_len check (brand is null or char_length(brand) <= 120),
  constraint ck_marketplace_products_publish_consistency check ((status = 'published') = (published_at is not null)),
  -- D-09 (open): Arabic is the primary locale, so a published product needs an Arabic name;
  -- requiring English too is a one-line change once decided.
  constraint ck_marketplace_products_published_name check (
    status <> 'published' or nullif(btrim(coalesce(name_ar, '')), '') is not null
  )
);
comment on table public.marketplace_products is
  'A Marketplace listing owned by an enrolled seller. Separate from the B2B public.products (no FK either way). Visible publicly only when published, not deleted, seller approved and browse enabled — via marketplace_public_* RPCs.';
create index ix_marketplace_products_type_published on public.marketplace_products (product_type_id)
  where status = 'published' and deleted_at is null;
create index ix_marketplace_products_org_status on public.marketplace_products (organization_id, status)
  where deleted_at is null;
create index ix_marketplace_products_published_order on public.marketplace_products (published_at desc, id desc)
  where status = 'published' and deleted_at is null;

create trigger set_marketplace_products_updated_at
  before update on public.marketplace_products
  for each row execute function app.set_updated_at();

create table public.marketplace_variants (
  id                   uuid          primary key default gen_random_uuid(),
  organization_id      uuid          not null,
  product_id           uuid          not null,
  sku                  text          not null,
  sale_unit_id         uuid          not null references public.marketplace_units (id) on delete restrict,
  price_egp            numeric(14,2) not null,
  currency             text          not null default 'EGP',
  pack_size            integer,
  coverage_per_unit_m2 numeric(10,3),
  min_order_qty        numeric(12,3) not null default 1,
  qty_step             numeric(12,3) not null default 1,
  is_active            boolean       not null default true,
  created_at           timestamptz   not null default now(),
  updated_at           timestamptz   not null default now(),
  constraint fk_marketplace_variants_product foreign key (organization_id, product_id)
    references public.marketplace_products (organization_id, id) on delete restrict,
  constraint uq_marketplace_variants_org_id unique (organization_id, id),
  constraint uq_marketplace_variants_sku unique (organization_id, sku),
  constraint ck_marketplace_variants_sku check (char_length(sku) between 1 and 80),
  -- Price is per SALE UNIT and tax-EXCLUSIVE (D-15); tax is computed separately at checkout.
  constraint ck_marketplace_variants_price check (price_egp >= 0 and price_egp <= 1000000000),
  constraint ck_marketplace_variants_currency check (currency = 'EGP'),
  constraint ck_marketplace_variants_pack check (pack_size is null or pack_size > 0),
  constraint ck_marketplace_variants_coverage check (coverage_per_unit_m2 is null or coverage_per_unit_m2 > 0),
  constraint ck_marketplace_variants_qty check (min_order_qty > 0 and qty_step > 0)
);
comment on table public.marketplace_variants is
  'The sellable SKU: price per sale unit (EGP, tax-exclusive), pack/coverage hints declared by the seller, quantity rules. Stock is counted in the same unit — no runtime conversion.';
create index ix_marketplace_variants_product on public.marketplace_variants (product_id) where is_active;

create trigger set_marketplace_variants_updated_at
  before update on public.marketplace_variants
  for each row execute function app.set_updated_at();

create function app.marketplace_variants_unit_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.marketplace_products p
    join public.marketplace_product_type_units tu on tu.product_type_id = p.product_type_id
    where p.id = new.product_id and tu.unit_id = new.sale_unit_id
  ) then
    raise exception 'sale unit is not allowed for this product type' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger marketplace_variants_unit_guard
  before insert or update of sale_unit_id, product_id on public.marketplace_variants
  for each row execute function app.marketplace_variants_unit_guard();

create table public.marketplace_product_images (
  id              uuid        primary key default gen_random_uuid(),
  organization_id uuid        not null,
  product_id      uuid        not null,
  image_ref       text        not null,
  alt_ar          text,
  alt_en          text,
  sort_order      smallint    not null default 0,
  created_at      timestamptz not null default now(),
  constraint fk_marketplace_images_product foreign key (organization_id, product_id)
    references public.marketplace_products (organization_id, id) on delete restrict,
  constraint uq_marketplace_images_order unique (product_id, sort_order),
  constraint ck_marketplace_images_ref check (char_length(image_ref) between 1 and 500),
  constraint ck_marketplace_images_alt check (
    (alt_ar is null or char_length(alt_ar) <= 200) and (alt_en is null or char_length(alt_en) <= 200)
  )
);
comment on table public.marketplace_product_images is
  'Product image reference (a path or storage key). The public-bucket policy for published images is decided with the Media foundation (D-16); until then a reference only.';

-- Stock. Quantities are numeric because area/length units can be fractional.
create table public.marketplace_inventory (
  variant_id      uuid          primary key,
  organization_id uuid          not null,
  on_hand         numeric(14,3) not null default 0,
  reserved        numeric(14,3) not null default 0,
  updated_at      timestamptz   not null default now(),
  constraint fk_marketplace_inventory_variant foreign key (organization_id, variant_id)
    references public.marketplace_variants (organization_id, id) on delete cascade,
  constraint ck_marketplace_inventory_qty check (on_hand >= 0 and reserved >= 0 and reserved <= on_hand)
);
comment on table public.marketplace_inventory is
  'Per-variant stock (per seller, V1). available = on_hand - reserved. Reservation/ledger behavior arrives with checkout; the CHECK is the oversell backstop.';

create trigger set_marketplace_inventory_updated_at
  before update on public.marketplace_inventory
  for each row execute function app.set_updated_at();

-- Every variant gets its stock row at creation (zero), so availability is never "unknown".
create function app.marketplace_variants_create_inventory()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.marketplace_inventory (variant_id, organization_id)
  values (new.id, new.organization_id);
  return new;
end;
$$;

create trigger marketplace_variants_create_inventory
  after insert on public.marketplace_variants
  for each row execute function app.marketplace_variants_create_inventory();

-- Publishing needs at least one active, priced variant and an active seller.
create function app.marketplace_products_publish_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'published' then
    return new;
  end if;
  -- Only the transition INTO published is checked (OLD does not exist on INSERT).
  if tg_op = 'UPDATE' then
    if old.status = 'published' then
      return new;
    end if;
  end if;

  if not exists (
    select 1 from public.marketplace_seller_accounts s
    where s.organization_id = new.organization_id and s.status = 'approved'
  ) then
    raise exception 'seller is not approved to publish' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.marketplace_product_types t
    where t.id = new.product_type_id and t.is_active
  ) then
    raise exception 'product type is not active' using errcode = '23514';
  end if;
  -- A brand-new row has no variants yet, so it can never be inserted as published.
  if tg_op = 'INSERT' or not exists (
    select 1 from public.marketplace_variants v
    where v.product_id = new.id and v.is_active
  ) then
    raise exception 'a published product needs at least one active variant' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger marketplace_products_publish_guard
  before insert or update of status on public.marketplace_products
  for each row execute function app.marketplace_products_publish_guard();

-- ---------------------------------------------------------------------------
-- 7. RLS + grants
-- ---------------------------------------------------------------------------
alter table public.marketplace_settings                      enable row level security;
alter table public.marketplace_categories                    enable row level security;
alter table public.marketplace_product_types                 enable row level security;
alter table public.marketplace_units                         enable row level security;
alter table public.marketplace_product_type_units            enable row level security;
alter table public.marketplace_finishing_groups              enable row level security;
alter table public.marketplace_finishing_tasks               enable row level security;
alter table public.marketplace_finishing_task_product_types  enable row level security;
alter table public.marketplace_seller_eligible_org_types     enable row level security;
alter table public.marketplace_seller_accounts               enable row level security;
alter table public.marketplace_products                      enable row level security;
alter table public.marketplace_variants                      enable row level security;
alter table public.marketplace_product_images                enable row level security;
alter table public.marketplace_inventory                     enable row level security;

-- Reference data is public knowledge: readable by guests, active rows only.
create policy marketplace_categories_select_active on public.marketplace_categories
  for select to anon, authenticated using (is_active);
create policy marketplace_product_types_select_active on public.marketplace_product_types
  for select to anon, authenticated using (is_active);
create policy marketplace_units_select_active on public.marketplace_units
  for select to anon, authenticated using (is_active);
create policy marketplace_product_type_units_select on public.marketplace_product_type_units
  for select to anon, authenticated using (true);
create policy marketplace_finishing_groups_select_active on public.marketplace_finishing_groups
  for select to anon, authenticated using (is_active);
create policy marketplace_finishing_tasks_select_active on public.marketplace_finishing_tasks
  for select to anon, authenticated using (is_active);
create policy marketplace_task_types_select on public.marketplace_finishing_task_product_types
  for select to anon, authenticated using (true);

-- Everything seller-owned, plus settings and eligibility: no policy => deny for every client role.
revoke all on public.marketplace_settings, public.marketplace_categories, public.marketplace_product_types,
              public.marketplace_units, public.marketplace_product_type_units,
              public.marketplace_finishing_groups, public.marketplace_finishing_tasks,
              public.marketplace_finishing_task_product_types, public.marketplace_seller_eligible_org_types,
              public.marketplace_seller_accounts, public.marketplace_products, public.marketplace_variants,
              public.marketplace_product_images, public.marketplace_inventory
  from anon, authenticated, service_role;

grant select on public.marketplace_categories, public.marketplace_product_types, public.marketplace_units,
                public.marketplace_product_type_units, public.marketplace_finishing_groups,
                public.marketplace_finishing_tasks, public.marketplace_finishing_task_product_types
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Seed — approved taxonomy (DL-04) and the 14 existing trades as tasks
-- ---------------------------------------------------------------------------
insert into public.marketplace_categories (key, sort_order) values
  ('wall_coverings',        10),
  ('cornices_mouldings',    20),
  ('finishing_accessories', 30);

insert into public.marketplace_product_types (category_id, key, sort_order)
select c.id, v.type_key, v.sort_order
from (values
  ('wall_coverings',        'wallpaper',          10),
  ('wall_coverings',        'wood_alternative',   20),
  ('wall_coverings',        'marble_alternative', 30),
  ('wall_coverings',        'sheeboard',          40),
  ('cornices_mouldings',    'cornice',            10),
  ('finishing_accessories', 'corner_trim',        10)
) as v (category_key, type_key, sort_order)
join public.marketplace_categories c on c.key = v.category_key;

insert into public.marketplace_units (key, kind, sort_order) values
  ('roll',         'count',  10),
  ('board',        'count',  20),
  ('piece',        'count',  30),
  ('bar',          'count',  40),
  ('linear_meter', 'length', 50),
  ('square_meter', 'area',   60),
  ('pack',         'count',  70);

-- CANDIDATE unit sets (D-08 pending owner confirmation).
insert into public.marketplace_product_type_units (product_type_id, unit_id)
select t.id, u.id
from (values
  ('wallpaper',          'roll'), ('wallpaper',          'square_meter'), ('wallpaper',          'pack'),
  ('wood_alternative',   'board'), ('wood_alternative',  'piece'), ('wood_alternative',  'square_meter'), ('wood_alternative',  'pack'),
  ('marble_alternative', 'board'), ('marble_alternative','square_meter'), ('marble_alternative','pack'),
  ('sheeboard',          'board'), ('sheeboard',         'square_meter'), ('sheeboard',         'piece'), ('sheeboard',         'pack'),
  ('cornice',            'piece'), ('cornice',           'bar'), ('cornice',           'linear_meter'), ('cornice',           'pack'),
  ('corner_trim',        'bar'),   ('corner_trim',       'linear_meter'), ('corner_trim',       'piece'), ('corner_trim',       'pack')
) as v (type_key, unit_key)
join public.marketplace_product_types t on t.key = v.type_key
join public.marketplace_units u on u.key = v.unit_key;

insert into public.marketplace_finishing_groups (key, sort_order) values
  ('wall_coverings',   10),
  ('ceilings_gypsum',  20),
  ('painting_finishes',30),
  ('flooring',         40),
  ('doors_wood',       50);

-- One task per existing installer trade. The trade keys are the 14 seeded by
-- 20260924090003_audience_activities.sql; a missing key simply yields no row.
insert into public.marketplace_finishing_tasks (group_id, trade_id, key, sort_order)
select g.id, tr.id, v.trade_key, v.sort_order
from (values
  ('wall_coverings',   'wallpaper_installation',          10),
  ('wall_coverings',   'wood_alternative_installation',   20),
  ('wall_coverings',   'marble_alternative_installation', 30),
  ('ceilings_gypsum',  'gypsum_board_installation',       10),
  ('ceilings_gypsum',  'plastering_and_gypsum',           20),
  ('ceilings_gypsum',  'foutek_installation',             30),
  ('painting_finishes','painting',                        10),
  ('painting_finishes','spray_paint_and_foundation',      20),
  ('painting_finishes','decorative_paints',               30),
  ('flooring',         'vinyl_flooring_installation',     10),
  ('flooring',         'hdf_flooring_installation',       20),
  ('flooring',         'epoxy_flooring',                  30),
  ('doors_wood',       'door_installation',               10),
  ('doors_wood',       'astarji',                         20)
) as v (group_key, trade_key, sort_order)
join public.marketplace_finishing_groups g on g.key = v.group_key
join public.trades tr on tr.key = v.trade_key;

-- Task → product type links that the approved mapping states outright.
-- NOT seeded on purpose: gypsum/plastering → cornice (D-10 pending) and Sheeboard
-- (no installer trade among the 14 — D-11).
insert into public.marketplace_finishing_task_product_types (task_id, product_type_id, role)
select ta.id, pt.id, v.role::public.marketplace_task_role
from (values
  ('wallpaper_installation',          'wallpaper',          'primary'),
  ('wood_alternative_installation',   'wood_alternative',   'primary'),
  ('wood_alternative_installation',   'corner_trim',        'complementary'),
  ('marble_alternative_installation', 'marble_alternative', 'primary'),
  ('marble_alternative_installation', 'corner_trim',        'complementary'),
  ('foutek_installation',             'cornice',            'complementary')
) as v (task_key, type_key, role)
join public.marketplace_finishing_tasks ta on ta.key = v.task_key
join public.marketplace_product_types pt on pt.key = v.type_key;

insert into public.marketplace_seller_eligible_org_types (org_type) values ('showroom_dealer');

-- ---------------------------------------------------------------------------
-- 9. Public read RPCs — the ONLY anonymous path to seller-owned data
-- ---------------------------------------------------------------------------
-- The one definition of "publicly visible product".
create function app.marketplace_visible_product_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.marketplace_settings s
  join public.marketplace_products p on true
  join public.marketplace_seller_accounts sa
    on sa.organization_id = p.organization_id and sa.status = 'approved'
  join public.marketplace_product_types pt on pt.id = p.product_type_id and pt.is_active
  join public.marketplace_categories c on c.id = pt.category_id and c.is_active
  where s.browse_enabled
    and p.status = 'published'
    and p.deleted_at is null
    and exists (
      select 1 from public.marketplace_variants v where v.product_id = p.id and v.is_active
    );
$$;
revoke all on function app.marketplace_visible_product_ids() from public, anon, authenticated;

create function public.marketplace_public_products(
  p_type_key            text        default null,
  p_category_key        text        default null,
  p_task_key            text        default null,
  p_limit               integer     default 24,
  p_after_published_at  timestamptz default null,
  p_after_id            uuid        default null
)
returns table (
  id               uuid,
  slug             text,
  category_key     text,
  product_type_key text,
  name_ar          text,
  name_en          text,
  description_ar   text,
  description_en   text,
  brand            text,
  seller_org_id    uuid,
  seller_name      text,
  price_egp        numeric,
  currency         text,
  sale_unit_key    text,
  variant_count    integer,
  availability     text,
  image_ref        text,
  published_at     timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id, p.slug, c.key, pt.key,
    p.name_ar, p.name_en, p.description_ar, p.description_en, p.brand,
    p.organization_id, app.org_display_name(p.organization_id),
    best.price_egp, best.currency, u.key,
    vc.n,
    case when stock.any_available then 'in_stock' else 'out_of_stock' end,
    img.image_ref,
    p.published_at
  from public.marketplace_products p
  join public.marketplace_product_types pt on pt.id = p.product_type_id
  join public.marketplace_categories c on c.id = pt.category_id
  cross join lateral (
    select v.price_egp, v.currency, v.sale_unit_id
    from public.marketplace_variants v
    where v.product_id = p.id and v.is_active
    order by v.price_egp asc, v.id asc
    limit 1
  ) best
  join public.marketplace_units u on u.id = best.sale_unit_id
  cross join lateral (
    select count(*)::integer as n
    from public.marketplace_variants v where v.product_id = p.id and v.is_active
  ) vc
  cross join lateral (
    select exists (
      select 1
      from public.marketplace_variants v
      join public.marketplace_inventory i on i.variant_id = v.id
      where v.product_id = p.id and v.is_active and i.on_hand - i.reserved > 0
    ) as any_available
  ) stock
  left join lateral (
    select im.image_ref
    from public.marketplace_product_images im
    where im.product_id = p.id
    order by im.sort_order asc
    limit 1
  ) img on true
  where p.id in (select app.marketplace_visible_product_ids())
    and (p_type_key is null or pt.key = p_type_key)
    and (p_category_key is null or c.key = p_category_key)
    and (
      p_task_key is null
      or exists (
        select 1
        from public.marketplace_finishing_tasks t
        join public.marketplace_finishing_task_product_types l on l.task_id = t.id
        where t.key = p_task_key and t.is_active and l.product_type_id = pt.id
      )
    )
    and (
      p_after_published_at is null or p_after_id is null
      or (p.published_at, p.id) < (p_after_published_at, p_after_id)
    )
  order by p.published_at desc, p.id desc
  limit least(greatest(coalesce(p_limit, 24), 1), 48);
$$;
comment on function public.marketplace_public_products(text, text, text, integer, timestamptz, uuid) is
  'Public product listing (keyset paginated). Published, seller-approved, browse-enabled products only; availability is a bucket, never exact stock. Filters: product type, category, or finishing task (through product types).';

create function public.marketplace_public_product_detail(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'slug', p.slug,
    'category_key', c.key,
    'product_type_key', pt.key,
    'name_ar', p.name_ar,
    'name_en', p.name_en,
    'description_ar', p.description_ar,
    'description_en', p.description_en,
    'brand', p.brand,
    'seller_org_id', p.organization_id,
    'seller_name', app.org_display_name(p.organization_id),
    'published_at', p.published_at,
    'images', coalesce((
      select jsonb_agg(jsonb_build_object('image_ref', im.image_ref, 'alt_ar', im.alt_ar, 'alt_en', im.alt_en)
                       order by im.sort_order)
      from public.marketplace_product_images im where im.product_id = p.id
    ), '[]'::jsonb),
    'variants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', v.id,
        'sku', v.sku,
        'sale_unit_key', u.key,
        'price_egp', v.price_egp,
        'currency', v.currency,
        'pack_size', v.pack_size,
        'coverage_per_unit_m2', v.coverage_per_unit_m2,
        'min_order_qty', v.min_order_qty,
        'qty_step', v.qty_step,
        'availability', case when coalesce(i.on_hand - i.reserved, 0) > 0 then 'in_stock' else 'out_of_stock' end
      ) order by v.price_egp, v.id)
      from public.marketplace_variants v
      join public.marketplace_units u on u.id = v.sale_unit_id
      left join public.marketplace_inventory i on i.variant_id = v.id
      where v.product_id = p.id and v.is_active
    ), '[]'::jsonb)
  )
  from public.marketplace_products p
  join public.marketplace_product_types pt on pt.id = p.product_type_id
  join public.marketplace_categories c on c.id = pt.category_id
  where p.slug = p_slug
    and p.id in (select app.marketplace_visible_product_ids());
$$;
comment on function public.marketplace_public_product_detail(text) is
  'Public product detail by slug as one jsonb document (images + active variants with availability bucket). Null when the product is not publicly visible.';

create function public.marketplace_public_type_counts()
returns table (category_key text, product_type_key text, product_count integer)
language sql
stable
security definer
set search_path = ''
as $$
  select c.key, pt.key, count(p.id)::integer
  from public.marketplace_product_types pt
  join public.marketplace_categories c on c.id = pt.category_id and c.is_active
  left join public.marketplace_products p
    on p.product_type_id = pt.id and p.id in (select app.marketplace_visible_product_ids())
  where pt.is_active
  group by c.key, c.sort_order, pt.key, pt.sort_order
  order by c.sort_order, pt.sort_order;
$$;

create function public.marketplace_public_finishing_tasks()
returns table (group_key text, task_key text, trade_key text, product_count integer)
language sql
stable
security definer
set search_path = ''
as $$
  select g.key, t.key, tr.key, count(distinct p.id)::integer
  from public.marketplace_finishing_tasks t
  join public.marketplace_finishing_groups g on g.id = t.group_id and g.is_active
  left join public.trades tr on tr.id = t.trade_id
  join public.marketplace_finishing_task_product_types l on l.task_id = t.id
  join public.marketplace_products p
    on p.product_type_id = l.product_type_id and p.id in (select app.marketplace_visible_product_ids())
  where t.is_active
  group by g.key, g.sort_order, t.key, t.sort_order, tr.key
  order by g.sort_order, t.sort_order;
$$;
comment on function public.marketplace_public_finishing_tasks() is
  'Finishing tasks that currently lead to at least one publicly visible product (a task with none is hidden).';

revoke all on function public.marketplace_public_products(text, text, text, integer, timestamptz, uuid) from public;
revoke all on function public.marketplace_public_product_detail(text) from public;
revoke all on function public.marketplace_public_type_counts() from public;
revoke all on function public.marketplace_public_finishing_tasks() from public;
grant execute on function public.marketplace_public_products(text, text, text, integer, timestamptz, uuid) to anon, authenticated, service_role;
grant execute on function public.marketplace_public_product_detail(text) to anon, authenticated, service_role;
grant execute on function public.marketplace_public_type_counts() to anon, authenticated, service_role;
grant execute on function public.marketplace_public_finishing_tasks() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10. Controlled seller activation (D-21) — database owner / service_role only
-- ---------------------------------------------------------------------------
create function public.marketplace_ops_activate_seller(p_organization_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_organization_id is null then
    raise exception 'organization is required' using errcode = '22023';
  end if;
  insert into public.marketplace_seller_accounts (organization_id, status, reason)
  values (p_organization_id, 'approved', p_reason)
  on conflict (organization_id) do update
    set status = 'approved',
        reason = excluded.reason,
        activated_at = now(),
        version = public.marketplace_seller_accounts.version + 1;
end;
$$;
comment on function public.marketplace_ops_activate_seller(uuid, text) is
  'DB-only controlled seller activation (D-21). Not granted to authenticated/anon. TODO: add an audit_log action in the migration that extends ck_audit_action_known.';
revoke all on function public.marketplace_ops_activate_seller(uuid, text) from public, anon, authenticated;
grant execute on function public.marketplace_ops_activate_seller(uuid, text) to service_role;
