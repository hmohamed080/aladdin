-- Migration: B2B Commerce — Catalog → RFQ → Quotation (Phase 3, Sprint 9).
--
-- Delivers one complete B2B commercial workflow on top of the validated
-- identity/tenancy/audit spine:
--   supplier publishes products → professional browses the catalog →
--   creates an RFQ → supplier quotes → requester accepts/rejects.
-- Accepting a quotation ends in READY FOR ORDER; it does NOT create an order
-- (Orders/Projects are Sprint 10).
--
-- Security model is identical to the hardened Sales domain (ADR-0008): base
-- tables are SELECT-only for client/service roles; every mutation is a
-- security-definer RPC that derives the actor from auth.uid(), enforces
-- organization scope + capability, is optimistic-concurrency safe on `version`,
-- and emits an audit event in the SAME transaction. No direct write grant exists,
-- so nothing can bypass lifecycle/tenant/audit invariants. Capability keys reused
-- from the fixed catalog (catalog.*, rfq.*, quote.*) — no permission-engine change.
--
-- Design: ADR-0007 (tenancy), ADR-0008 (trusted write paths), 06_rls_strategy.md,
-- docs/product/mvp-scope.md (Need → … → Quote → Decision).

-- ===========================================================================
-- 1. Enum types (commerce subset)
-- ===========================================================================
create type public.product_status   as enum ('draft', 'published');
-- Sector taxonomy (PRODUCT_DIRECTION_GUIDE: finishing/construction/interior/
-- furnishing/supply + professional services). UI maps each to a bilingual label.
create type public.product_category as enum (
  'finishing', 'construction', 'interior_design', 'furnishing', 'supply', 'tools', 'other'
);
-- Egyptian-market units of sale. Enum (not free text) keeps AR/EN labels exact.
create type public.product_unit as enum (
  'piece', 'box', 'set', 'meter', 'square_meter', 'linear_meter',
  'kilogram', 'ton', 'liter', 'roll', 'bag', 'pack'
);
-- RFQ lifecycle: draft → submitted → quoted → closed/cancelled.
create type public.rfq_status       as enum ('draft', 'submitted', 'quoted', 'closed', 'cancelled');
-- Quotation lifecycle: draft → submitted → accepted/rejected.
create type public.quotation_status as enum ('draft', 'submitted', 'accepted', 'rejected');

-- ===========================================================================
-- 2. Audit action allow-list extension (append commerce lifecycle events)
-- ===========================================================================
alter table public.audit_log drop constraint ck_audit_action_known;
alter table public.audit_log add constraint ck_audit_action_known check (action in (
  'organization.created',
  'membership.granted', 'membership.activated', 'membership.role_changed',
  'membership.suspended', 'membership.revoked',
  'branch.created', 'branch.assignment_changed',
  'platform_role.granted', 'platform_role.revoked', 'platform.override_used',
  'account.upgrade_requested',
  'verification.review_started', 'verification.changes_requested',
  'verification.approved', 'verification.rejected',
  'account.type_changed', 'profile.listed', 'profile.hidden',
  'customer.created', 'customer.updated',
  'lead.created', 'lead.assigned', 'lead.reassigned', 'lead.stage_changed',
  'lead.won', 'lead.lost', 'lead.reopened', 'lead.archived',
  'followup.created', 'followup.reassigned', 'followup.completed', 'followup.reopened',
  'customer.reassigned', 'lead.details_changed',
  'onboarding.completed',
  'onboarding.consumer_completed', 'onboarding.professional_submitted',
  'onboarding.organization_created',
  -- Sprint 9 — B2B commerce (catalog / RFQ / quotation).
  'product.created', 'product.updated', 'product.published', 'product.unpublished',
  'rfq.created', 'rfq.updated', 'rfq.submitted', 'rfq.closed', 'rfq.cancelled',
  'quotation.created', 'quotation.updated', 'quotation.submitted',
  'quotation.accepted', 'quotation.rejected'
));

-- ===========================================================================
-- 3. products — the tenant-owned catalog item
-- ===========================================================================
create table public.products (
  id                uuid primary key default extensions.gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  name              text not null,
  sku               text,                       -- optional model / SKU
  category          public.product_category not null,
  brand             text,                        -- optional brand / manufacturer
  short_description text,
  unit              public.product_unit not null,
  -- Optional external image reference only (no media-upload infrastructure yet —
  -- kept nullable so a later media phase can populate it additively).
  image_ref         text,
  status            public.product_status not null default 'draft',
  version           integer not null default 1,  -- optimistic-concurrency token
  created_by        uuid not null references public.users (id) on delete restrict,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  published_at      timestamptz,
  deleted_at        timestamptz,
  constraint ck_products_name_len check (char_length(name) between 2 and 160),
  constraint ck_products_sku_len check (sku is null or char_length(sku) <= 80),
  constraint ck_products_brand_len check (brand is null or char_length(brand) <= 120),
  constraint ck_products_desc_len check (short_description is null or char_length(short_description) <= 600),
  constraint ck_products_image_len check (image_ref is null or char_length(image_ref) <= 500),
  constraint ck_products_publish_consistency check ((status = 'published') = (published_at is not null)),
  -- Parent key so RFQ items can reference a product with a COMPOSITE FK
  -- (org_id, id) — a product referenced from a supplier context must belong to
  -- that supplier org, by construction.
  constraint uq_products_org_id unique (organization_id, id)
);
comment on table public.products is 'Tenant-owned B2B catalog item. organization_id is the owning supplier/tenant. Published products are discoverable cross-tenant via the catalog_published_products view; draft products stay private to the org. Written only via security-definer RPCs.';

create index ix_products_org_status on public.products (organization_id, status) where deleted_at is null;
create index ix_products_category on public.products (category) where status = 'published' and deleted_at is null;
create index ix_products_name_trgm on public.products using gin (name extensions.gin_trgm_ops);
create index ix_products_sku_trgm on public.products using gin (coalesce(sku, '') extensions.gin_trgm_ops);

create trigger set_products_updated_at
  before update on public.products
  for each row execute function app.set_updated_at();

-- ===========================================================================
-- 4. rfqs — a request for quotation addressed to exactly one supplier org
-- ===========================================================================
create table public.rfqs (
  id                     uuid primary key default extensions.gen_random_uuid(),
  requester_org_id       uuid not null references public.organizations (id) on delete cascade,
  requester_branch_id    uuid,   -- optional requester-side branch scope (composite FK)
  supplier_org_id        uuid not null references public.organizations (id) on delete restrict,
  title                  text not null,
  note                   text,
  required_date          date,   -- optional delivery/required-by date
  status                 public.rfq_status not null default 'draft',
  version                integer not null default 1,
  submitted_at           timestamptz,
  closed_at              timestamptz,
  created_by             uuid not null references public.users (id) on delete restrict,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint ck_rfqs_title_len check (char_length(title) between 2 and 200),
  constraint ck_rfqs_note_len check (note is null or char_length(note) <= 2000),
  -- A tenant cannot RFQ itself (would collapse requester/supplier isolation).
  constraint ck_rfqs_distinct_orgs check (requester_org_id <> supplier_org_id),
  constraint fk_rfqs_requester_branch foreign key (requester_org_id, requester_branch_id)
    references public.branches (organization_id, id) on delete set null,
  constraint uq_rfqs_id unique (id)
);
comment on table public.rfqs is 'A request for quotation from one requester organization to exactly ONE supplier organization. Draft is private to the requester; the supplier sees it only once submitted. Lifecycle is enforced in RPCs only.';

create index ix_rfqs_supplier_status on public.rfqs (supplier_org_id, status) where status <> 'draft';
create index ix_rfqs_requester_status on public.rfqs (requester_org_id, status);
create index ix_rfqs_requester_branch on public.rfqs (requester_org_id, requester_branch_id);

create trigger set_rfqs_updated_at
  before update on public.rfqs
  for each row execute function app.set_updated_at();

-- ===========================================================================
-- 5. rfq_items — line items of an RFQ (each references a supplier product)
-- ===========================================================================
create table public.rfq_items (
  id             uuid primary key default extensions.gen_random_uuid(),
  rfq_id         uuid not null references public.rfqs (id) on delete cascade,
  product_id     uuid,   -- nullable so a later product removal keeps RFQ history
  -- Snapshots taken at add-time (RFQ history must not shift if the product later
  -- changes name/unit). The supplier still quotes against these lines.
  product_name   text not null,
  unit           public.product_unit not null,
  quantity       numeric(14, 2) not null,
  note           text,
  created_at     timestamptz not null default now(),
  constraint ck_rfq_items_qty check (quantity > 0 and quantity <= 100000000),
  constraint ck_rfq_items_name_len check (char_length(product_name) between 1 and 160),
  constraint ck_rfq_items_note_len check (note is null or char_length(note) <= 600),
  constraint fk_rfq_items_product foreign key (product_id)
    references public.products (id) on delete set null,
  constraint uq_rfq_items_id unique (rfq_id, id)  -- parent key for quotation_items
);
comment on table public.rfq_items is 'RFQ line item. Snapshots product name/unit at add-time so RFQ history is stable. product_id is a soft reference (nullable on product delete).';

create index ix_rfq_items_rfq on public.rfq_items (rfq_id);
create index ix_rfq_items_product on public.rfq_items (product_id);

-- ===========================================================================
-- 6. quotations — a supplier's priced response to a submitted RFQ
-- ===========================================================================
create table public.quotations (
  id                uuid primary key default extensions.gen_random_uuid(),
  rfq_id            uuid not null references public.rfqs (id) on delete cascade,
  supplier_org_id   uuid not null references public.organizations (id) on delete cascade,
  requester_org_id  uuid not null references public.organizations (id) on delete cascade,
  note              text,
  validity_date     date,   -- optional "valid until"
  -- Totals are derived from the line items (subtotal = total for the MVP; no
  -- discount/tax engine — deferred, no design evidence). Kept as distinct columns
  -- so a later pricing phase can diverge them additively.
  subtotal          numeric(16, 2) not null default 0,
  total             numeric(16, 2) not null default 0,
  status            public.quotation_status not null default 'draft',
  version           integer not null default 1,
  submitted_at      timestamptz,
  decided_at        timestamptz,
  decided_by        uuid references public.users (id) on delete set null,
  created_by        uuid not null references public.users (id) on delete restrict,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint ck_quotations_note_len check (note is null or char_length(note) <= 2000),
  constraint ck_quotations_totals check (subtotal >= 0 and total >= 0),
  constraint ck_quotations_distinct_orgs check (requester_org_id <> supplier_org_id),
  constraint uq_quotations_id unique (id)  -- parent key for quotation_items
);
comment on table public.quotations is 'A supplier''s priced response to a submitted RFQ. Draft is private to the supplier; the requester sees it once submitted. Accepting one ends in READY FOR ORDER (no order row — Sprint 10).';

-- At most ONE live (non-rejected) quotation per RFQ. A rejected quotation frees
-- the RFQ so the supplier may revise with a fresh quotation.
create unique index uq_quotations_rfq_live on public.quotations (rfq_id)
  where status <> 'rejected';
create index ix_quotations_supplier_status on public.quotations (supplier_org_id, status);
create index ix_quotations_requester_status on public.quotations (requester_org_id, status) where status <> 'draft';

create trigger set_quotations_updated_at
  before update on public.quotations
  for each row execute function app.set_updated_at();

-- ===========================================================================
-- 7. quotation_items — priced lines mirroring the RFQ items
-- ===========================================================================
create table public.quotation_items (
  id             uuid primary key default extensions.gen_random_uuid(),
  quotation_id   uuid not null references public.quotations (id) on delete cascade,
  rfq_item_id    uuid not null,
  product_name   text not null,
  unit           public.product_unit not null,
  quantity       numeric(14, 2) not null,
  unit_price     numeric(14, 2) not null default 0,
  line_total     numeric(16, 2) generated always as (round(quantity * unit_price, 2)) stored,
  created_at     timestamptz not null default now(),
  constraint ck_quotation_items_qty check (quantity > 0),
  constraint ck_quotation_items_price check (unit_price >= 0 and unit_price <= 1000000000),
  constraint ck_quotation_items_name_len check (char_length(product_name) between 1 and 160),
  constraint fk_quotation_items_quotation foreign key (quotation_id)
    references public.quotations (id) on delete cascade,
  -- rfq_item_id references the RFQ line this quote line answers. The guarantee
  -- that the item shares the quotation's RFQ is enforced in create_quotation
  -- (it only seeds from rfq_items of the same rfq).
  constraint fk_quotation_items_rfq_item foreign key (rfq_item_id)
    references public.rfq_items (id) on delete cascade,
  constraint uq_quotation_items_line unique (quotation_id, rfq_item_id)
);
comment on table public.quotation_items is 'A priced quotation line mirroring one rfq_item. line_total is generated (quantity * unit_price). subtotal/total on the parent quotation are recomputed by the write RPCs.';

create index ix_quotation_items_quotation on public.quotation_items (quotation_id);

-- ===========================================================================
-- 8. Visibility helpers (reused by RLS and RPCs). Security-definer so a policy
--    can call them without recursing into the row's own table RLS.
-- ===========================================================================
-- Catalog authority: create/edit a product needs catalog.write; org owners
-- (org.manage) always qualify. Publish/unpublish needs catalog.publish (or owner).
create or replace function app.can_write_catalog(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.has_capability(p_org_id, 'catalog.write') or app.has_capability(p_org_id, 'org.manage');
$$;
create or replace function app.can_publish_catalog(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.has_capability(p_org_id, 'catalog.publish') or app.has_capability(p_org_id, 'org.manage');
$$;
-- Requester-side RFQ authority; supplier-side quotation authority; decide authority.
create or replace function app.can_create_rfq(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.has_capability(p_org_id, 'rfq.create') or app.has_capability(p_org_id, 'org.manage');
$$;
create or replace function app.can_respond_rfq(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.has_capability(p_org_id, 'rfq.respond')
      or app.has_capability(p_org_id, 'quote.submit')
      or app.has_capability(p_org_id, 'org.manage');
$$;
create or replace function app.can_decide_quote(p_org_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select app.has_capability(p_org_id, 'quote.decide') or app.has_capability(p_org_id, 'org.manage');
$$;

revoke execute on function app.can_write_catalog(uuid), app.can_publish_catalog(uuid),
  app.can_create_rfq(uuid), app.can_respond_rfq(uuid), app.can_decide_quote(uuid) from public;
grant execute on function app.can_write_catalog(uuid), app.can_publish_catalog(uuid),
  app.can_create_rfq(uuid), app.can_respond_rfq(uuid), app.can_decide_quote(uuid) to authenticated;

-- ===========================================================================
-- 9. RLS — reads are scope-limited; writes have NO policy (RPC-only)
-- ===========================================================================
alter table public.products         enable row level security;
alter table public.rfqs             enable row level security;
alter table public.rfq_items        enable row level security;
alter table public.quotations       enable row level security;
alter table public.quotation_items  enable row level security;

-- products: any authenticated user may read a PUBLISHED product (the cross-tenant
-- professional catalog); org members read ALL of their own org's products
-- (drafts included) for management. Platform support reads cross-tenant.
create policy products_select_published on public.products
  for select to authenticated
  using (status = 'published' and deleted_at is null);
create policy products_select_own on public.products
  for select to authenticated
  using (deleted_at is null and app.is_org_member(organization_id));
create policy products_select_platform on public.products
  for select to authenticated
  using (app.is_platform('support'));

-- rfqs: the requester org sees its own RFQs (any status); the supplier org sees
-- an RFQ ONLY once it leaves draft. Platform support reads cross-tenant.
create policy rfqs_select_requester on public.rfqs
  for select to authenticated
  using (app.is_org_member(requester_org_id));
create policy rfqs_select_supplier on public.rfqs
  for select to authenticated
  using (status <> 'draft' and app.is_org_member(supplier_org_id));
create policy rfqs_select_platform on public.rfqs
  for select to authenticated
  using (app.is_platform('support'));

-- rfq_items: visible exactly when the parent RFQ is visible. The EXISTS subquery
-- is itself RLS-filtered by the rfqs policies above, so no predicate duplication.
create policy rfq_items_select_parent on public.rfq_items
  for select to authenticated
  using (exists (select 1 from public.rfqs r where r.id = rfq_items.rfq_id));

-- quotations: the supplier org sees its own quotations (any status); the
-- requester org sees a quotation ONLY once submitted. Platform reads cross-tenant.
create policy quotations_select_supplier on public.quotations
  for select to authenticated
  using (app.is_org_member(supplier_org_id));
create policy quotations_select_requester on public.quotations
  for select to authenticated
  using (status <> 'draft' and app.is_org_member(requester_org_id));
create policy quotations_select_platform on public.quotations
  for select to authenticated
  using (app.is_platform('support'));

create policy quotation_items_select_parent on public.quotation_items
  for select to authenticated
  using (exists (select 1 from public.quotations q where q.id = quotation_items.quotation_id));

-- ===========================================================================
-- 10. Grants (deny-by-default; SELECT only — every write is an RPC)
-- ===========================================================================
revoke all on public.products, public.rfqs, public.rfq_items,
  public.quotations, public.quotation_items from anon, authenticated, service_role;
grant select on public.products        to authenticated, service_role;
grant select on public.rfqs            to authenticated, service_role;
grant select on public.rfq_items       to authenticated, service_role;
grant select on public.quotations      to authenticated, service_role;
grant select on public.quotation_items to authenticated, service_role;

-- ===========================================================================
-- 11. Cross-tenant catalog view (curated supplier identity for the marketplace)
-- ===========================================================================
-- Runs with the view owner's rights (security_invoker = false) so it can surface
-- the supplier org's public identity (name/verified) for PUBLISHED products only,
-- without exposing the private organizations base table. Analogous to
-- organization_public_directory (Sprint 1.1 review B1).
create view public.catalog_published_products with (security_invoker = false) as
  select
    p.id, p.organization_id, o.name as supplier_name, o.is_verified as supplier_verified,
    o.slug as supplier_slug, p.name, p.sku, p.category, p.brand, p.short_description,
    p.unit, p.image_ref, p.published_at
  from public.products p
  join public.organizations o on o.id = p.organization_id
  where p.status = 'published' and p.deleted_at is null and o.deleted_at is null;
comment on view public.catalog_published_products is 'PUBLIC cross-tenant projection of published catalog products with the supplier org''s public identity (name/verified). Never exposes draft products or private org columns. Base products/organizations tables stay tenant-private.';

grant select on public.catalog_published_products to authenticated;

-- ===========================================================================
-- 12. Internal helper — recompute a quotation's totals from its line items.
-- ===========================================================================
create or replace function app.recompute_quotation_totals(p_quotation_id uuid)
returns void language sql security definer set search_path = '' as $$
  update public.quotations q
     set subtotal = coalesce(t.sum_lines, 0),
         total    = coalesce(t.sum_lines, 0)  -- MVP: no discount/tax
    from (select coalesce(sum(line_total), 0) as sum_lines
            from public.quotation_items where quotation_id = p_quotation_id) t
   where q.id = p_quotation_id;
$$;
revoke execute on function app.recompute_quotation_totals(uuid) from public;

-- ===========================================================================
-- 13. Product write paths
-- ===========================================================================
create or replace function public.create_product(
  p_org_id            uuid,
  p_name              text,
  p_category          public.product_category,
  p_unit              public.product_unit,
  p_sku               text default null,
  p_brand             text default null,
  p_short_description text default null,
  p_image_ref         text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not app.is_org_member(p_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  if not app.can_write_catalog(p_org_id) then
    raise exception 'catalog.write required' using errcode = '42501';
  end if;
  insert into public.products (organization_id, name, category, unit, sku, brand, short_description, image_ref, created_by)
  values (p_org_id, p_name, p_category, p_unit, p_sku, p_brand, p_short_description, p_image_ref, (select auth.uid()))
  returning id into v_id;
  perform app.record_audit_event('product.created', 'product', v_id, p_org_id,
    jsonb_build_object('category', p_category, 'unit', p_unit));
  return v_id;
end;
$$;

create or replace function public.update_product(
  p_product_id        uuid,
  p_expected_version  integer,
  p_name              text default null,
  p_category          public.product_category default null,
  p_unit              public.product_unit default null,
  p_sku               text default null,
  p_brand             text default null,
  p_short_description text default null,
  p_image_ref         text default null,
  p_clear_sku         boolean default false,
  p_clear_brand       boolean default false,
  p_clear_description boolean default false
) returns integer language plpgsql security definer set search_path = '' as $$
declare v_p public.products;
begin
  select * into v_p from public.products where id = p_product_id and deleted_at is null for update;
  if not found then raise exception 'product not found'; end if;
  if not app.can_write_catalog(v_p.organization_id) then
    raise exception 'catalog.write required' using errcode = '42501';
  end if;
  if v_p.version <> p_expected_version then
    raise exception 'product was modified concurrently (expected %, found %)', p_expected_version, v_p.version
      using errcode = '40001';
  end if;
  update public.products set
    name              = coalesce(p_name, name),
    category          = coalesce(p_category, category),
    unit              = coalesce(p_unit, unit),
    sku               = case when p_clear_sku then null else coalesce(p_sku, sku) end,
    brand             = case when p_clear_brand then null else coalesce(p_brand, brand) end,
    short_description = case when p_clear_description then null else coalesce(p_short_description, short_description) end,
    image_ref         = coalesce(p_image_ref, image_ref),
    version           = version + 1
  where id = p_product_id;
  perform app.record_audit_event('product.updated', 'product', p_product_id, v_p.organization_id, '{}'::jsonb);
  return v_p.version + 1;
end;
$$;

-- Publish / unpublish. Requires catalog.publish (or owner). Idempotent.
create or replace function public.set_product_published(
  p_product_id       uuid,
  p_published        boolean,
  p_expected_version integer
) returns integer language plpgsql security definer set search_path = '' as $$
declare v_p public.products;
begin
  select * into v_p from public.products where id = p_product_id and deleted_at is null for update;
  if not found then raise exception 'product not found'; end if;
  if not app.can_publish_catalog(v_p.organization_id) then
    raise exception 'catalog.publish required' using errcode = '42501';
  end if;
  if v_p.version <> p_expected_version then
    raise exception 'product was modified concurrently' using errcode = '40001';
  end if;
  if (v_p.status = 'published') = p_published then
    return v_p.version;  -- already in the requested state; no-op
  end if;
  update public.products set
    status       = case when p_published then 'published'::public.product_status else 'draft'::public.product_status end,
    published_at = case when p_published then now() else null end,
    version      = version + 1
  where id = p_product_id;
  perform app.record_audit_event(
    case when p_published then 'product.published' else 'product.unpublished' end,
    'product', p_product_id, v_p.organization_id, '{}'::jsonb);
  return v_p.version + 1;
end;
$$;

-- ===========================================================================
-- 14. RFQ write paths (requester side)
-- ===========================================================================
create or replace function public.create_rfq(
  p_requester_org_id uuid,
  p_supplier_org_id  uuid,
  p_title            text,
  p_note             text default null,
  p_required_date    date default null,
  p_branch_id        uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not app.is_org_member(p_requester_org_id) then
    raise exception 'not a member of this organization' using errcode = '42501';
  end if;
  if not app.can_create_rfq(p_requester_org_id) then
    raise exception 'rfq.create required' using errcode = '42501';
  end if;
  if p_requester_org_id = p_supplier_org_id then
    raise exception 'an organization cannot send an RFQ to itself' using errcode = '22023';
  end if;
  if not exists (select 1 from public.organizations where id = p_supplier_org_id and deleted_at is null) then
    raise exception 'supplier organization not found' using errcode = '22023';
  end if;
  -- Optional requester branch must be in the caller's scope.
  if p_branch_id is not null and p_branch_id not in (select app.current_branch_ids(p_requester_org_id)) then
    raise exception 'branch not in caller scope' using errcode = '42501';
  end if;
  insert into public.rfqs (requester_org_id, requester_branch_id, supplier_org_id, title, note, required_date, created_by)
  values (p_requester_org_id, p_branch_id, p_supplier_org_id, p_title, p_note, p_required_date, (select auth.uid()))
  returning id into v_id;
  perform app.record_audit_event('rfq.created', 'rfq', v_id, p_requester_org_id,
    jsonb_build_object('supplier_org_id', p_supplier_org_id));
  return v_id;
end;
$$;

-- Guard: caller may mutate this RFQ's draft (requester member with rfq.create).
create or replace function app.assert_can_edit_rfq_draft(p_rfq public.rfqs)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.can_create_rfq(p_rfq.requester_org_id) then
    raise exception 'rfq.create required' using errcode = '42501';
  end if;
  if p_rfq.status <> 'draft' then
    raise exception 'only a draft RFQ can be edited' using errcode = '22023';
  end if;
end;
$$;
revoke execute on function app.assert_can_edit_rfq_draft(public.rfqs) from public;
grant execute on function app.assert_can_edit_rfq_draft(public.rfqs) to authenticated;

create or replace function public.add_rfq_item(
  p_rfq_id     uuid,
  p_product_id uuid,
  p_quantity   numeric,
  p_note       text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_r public.rfqs; v_prod public.products; v_id uuid;
begin
  select * into v_r from public.rfqs where id = p_rfq_id for update;
  if not found then raise exception 'RFQ not found'; end if;
  perform app.assert_can_edit_rfq_draft(v_r);
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'quantity must be positive' using errcode = '22023';
  end if;
  -- The product must be a PUBLISHED product OF THE RFQ'S SUPPLIER ORG.
  select * into v_prod from public.products
    where id = p_product_id and organization_id = v_r.supplier_org_id
      and status = 'published' and deleted_at is null;
  if not found then
    raise exception 'product is not a published product of the supplier organization' using errcode = '22023';
  end if;
  insert into public.rfq_items (rfq_id, product_id, product_name, unit, quantity, note)
  values (p_rfq_id, v_prod.id, v_prod.name, v_prod.unit, p_quantity, p_note)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.remove_rfq_item(p_item_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_r public.rfqs; v_rfq_id uuid;
begin
  select rfq_id into v_rfq_id from public.rfq_items where id = p_item_id;
  if not found then raise exception 'RFQ item not found'; end if;
  select * into v_r from public.rfqs where id = v_rfq_id for update;
  perform app.assert_can_edit_rfq_draft(v_r);
  delete from public.rfq_items where id = p_item_id;
end;
$$;

create or replace function public.update_rfq(
  p_rfq_id           uuid,
  p_expected_version integer,
  p_title            text default null,
  p_note             text default null,
  p_required_date    date default null,
  p_clear_note       boolean default false,
  p_clear_required_date boolean default false
) returns integer language plpgsql security definer set search_path = '' as $$
declare v_r public.rfqs;
begin
  select * into v_r from public.rfqs where id = p_rfq_id for update;
  if not found then raise exception 'RFQ not found'; end if;
  perform app.assert_can_edit_rfq_draft(v_r);
  if v_r.version <> p_expected_version then
    raise exception 'RFQ was modified concurrently' using errcode = '40001';
  end if;
  update public.rfqs set
    title         = coalesce(p_title, title),
    note          = case when p_clear_note then null else coalesce(p_note, note) end,
    required_date = case when p_clear_required_date then null else coalesce(p_required_date, required_date) end,
    version       = version + 1
  where id = p_rfq_id;
  perform app.record_audit_event('rfq.updated', 'rfq', p_rfq_id, v_r.requester_org_id, '{}'::jsonb);
  return v_r.version + 1;
end;
$$;

-- draft → submitted. Requires ≥1 line item. Makes the RFQ visible to the supplier.
create or replace function public.submit_rfq(
  p_rfq_id           uuid,
  p_expected_version integer
) returns integer language plpgsql security definer set search_path = '' as $$
declare v_r public.rfqs; v_count integer;
begin
  select * into v_r from public.rfqs where id = p_rfq_id for update;
  if not found then raise exception 'RFQ not found'; end if;
  if not app.can_create_rfq(v_r.requester_org_id) then
    raise exception 'rfq.create required' using errcode = '42501';
  end if;
  if v_r.status <> 'draft' then
    raise exception 'only a draft RFQ can be submitted' using errcode = '22023';
  end if;
  if v_r.version <> p_expected_version then
    raise exception 'RFQ was modified concurrently' using errcode = '40001';
  end if;
  select count(*) into v_count from public.rfq_items where rfq_id = p_rfq_id;
  if v_count = 0 then
    raise exception 'an RFQ needs at least one item before it can be submitted' using errcode = '22023';
  end if;
  update public.rfqs set status = 'submitted', submitted_at = now(), version = version + 1
  where id = p_rfq_id;
  perform app.record_audit_event('rfq.submitted', 'rfq', p_rfq_id, v_r.requester_org_id,
    jsonb_build_object('supplier_org_id', v_r.supplier_org_id, 'item_count', v_count));
  return v_r.version + 1;
end;
$$;

-- Requester cancels an RFQ (draft/submitted/quoted → cancelled). A live quotation
-- (if any) is rejected in the same transaction so the workflow ends cleanly.
create or replace function public.cancel_rfq(p_rfq_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_r public.rfqs;
begin
  select * into v_r from public.rfqs where id = p_rfq_id for update;
  if not found then raise exception 'RFQ not found'; end if;
  if not app.can_create_rfq(v_r.requester_org_id) then
    raise exception 'rfq.create required' using errcode = '42501';
  end if;
  if v_r.status in ('closed', 'cancelled') then
    raise exception 'this RFQ is already finalized' using errcode = '22023';
  end if;
  update public.quotations set status = 'rejected', decided_at = now(), decided_by = (select auth.uid()),
    version = version + 1
  where rfq_id = p_rfq_id and status in ('draft', 'submitted');
  update public.rfqs set status = 'cancelled', version = version + 1 where id = p_rfq_id;
  perform app.record_audit_event('rfq.cancelled', 'rfq', p_rfq_id, v_r.requester_org_id, '{}'::jsonb);
end;
$$;

-- ===========================================================================
-- 15. Quotation write paths (supplier side + requester decision)
-- ===========================================================================
-- Supplier creates a quotation against a submitted RFQ; lines are SEEDED from the
-- RFQ items at unit_price 0 (supplier then prices them). Enforces one live
-- quotation per RFQ (partial unique index).
create or replace function public.create_quotation(
  p_rfq_id       uuid,
  p_note         text default null,
  p_validity_date date default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_r public.rfqs; v_id uuid;
begin
  select * into v_r from public.rfqs where id = p_rfq_id for update;
  if not found then raise exception 'RFQ not found'; end if;
  if not app.is_org_member(v_r.supplier_org_id) then
    raise exception 'not a member of the supplier organization' using errcode = '42501';
  end if;
  if not app.can_respond_rfq(v_r.supplier_org_id) then
    raise exception 'rfq.respond required' using errcode = '42501';
  end if;
  if v_r.status not in ('submitted', 'quoted') then
    raise exception 'only a submitted RFQ can be quoted' using errcode = '22023';
  end if;
  begin
    insert into public.quotations (rfq_id, supplier_org_id, requester_org_id, note, validity_date, created_by)
    values (p_rfq_id, v_r.supplier_org_id, v_r.requester_org_id, p_note, p_validity_date, (select auth.uid()))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'a live quotation already exists for this RFQ' using errcode = '23505';
  end;
  -- Seed the priced lines from the RFQ items (price 0 until the supplier sets it).
  insert into public.quotation_items (quotation_id, rfq_item_id, product_name, unit, quantity, unit_price)
  select v_id, ri.id, ri.product_name, ri.unit, ri.quantity, 0
  from public.rfq_items ri where ri.rfq_id = p_rfq_id;
  perform app.recompute_quotation_totals(v_id);
  perform app.record_audit_event('quotation.created', 'quotation', v_id, v_r.supplier_org_id,
    jsonb_build_object('rfq_id', p_rfq_id));
  return v_id;
end;
$$;

-- Guard: caller may mutate this quotation's draft (supplier member with respond).
create or replace function app.assert_can_edit_quotation_draft(p_q public.quotations)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.can_respond_rfq(p_q.supplier_org_id) then
    raise exception 'rfq.respond required' using errcode = '42501';
  end if;
  if p_q.status <> 'draft' then
    raise exception 'only a draft quotation can be edited' using errcode = '22023';
  end if;
end;
$$;
revoke execute on function app.assert_can_edit_quotation_draft(public.quotations) from public;
grant execute on function app.assert_can_edit_quotation_draft(public.quotations) to authenticated;

create or replace function public.set_quotation_item_price(
  p_item_id    uuid,
  p_unit_price numeric
) returns void language plpgsql security definer set search_path = '' as $$
declare v_q public.quotations; v_qid uuid;
begin
  select quotation_id into v_qid from public.quotation_items where id = p_item_id;
  if not found then raise exception 'quotation item not found'; end if;
  select * into v_q from public.quotations where id = v_qid for update;
  perform app.assert_can_edit_quotation_draft(v_q);
  if p_unit_price is null or p_unit_price < 0 then
    raise exception 'unit price must be zero or positive' using errcode = '22023';
  end if;
  update public.quotation_items set unit_price = round(p_unit_price, 2) where id = p_item_id;
  perform app.recompute_quotation_totals(v_qid);
end;
$$;

create or replace function public.update_quotation(
  p_quotation_id     uuid,
  p_expected_version integer,
  p_note             text default null,
  p_validity_date    date default null,
  p_clear_note       boolean default false,
  p_clear_validity   boolean default false
) returns integer language plpgsql security definer set search_path = '' as $$
declare v_q public.quotations;
begin
  select * into v_q from public.quotations where id = p_quotation_id for update;
  if not found then raise exception 'quotation not found'; end if;
  perform app.assert_can_edit_quotation_draft(v_q);
  if v_q.version <> p_expected_version then
    raise exception 'quotation was modified concurrently' using errcode = '40001';
  end if;
  update public.quotations set
    note          = case when p_clear_note then null else coalesce(p_note, note) end,
    validity_date = case when p_clear_validity then null else coalesce(p_validity_date, validity_date) end,
    version       = version + 1
  where id = p_quotation_id;
  perform app.record_audit_event('quotation.updated', 'quotation', p_quotation_id, v_q.supplier_org_id, '{}'::jsonb);
  return v_q.version + 1;
end;
$$;

-- draft → submitted. Requires a priced quotation (subtotal > 0). Moves the RFQ to
-- 'quoted' and makes the quotation visible to the requester.
create or replace function public.submit_quotation(
  p_quotation_id     uuid,
  p_expected_version integer
) returns integer language plpgsql security definer set search_path = '' as $$
declare v_q public.quotations; v_zero integer;
begin
  select * into v_q from public.quotations where id = p_quotation_id for update;
  if not found then raise exception 'quotation not found'; end if;
  if not app.can_respond_rfq(v_q.supplier_org_id) then
    raise exception 'rfq.respond required' using errcode = '42501';
  end if;
  if v_q.status <> 'draft' then
    raise exception 'only a draft quotation can be submitted' using errcode = '22023';
  end if;
  if v_q.version <> p_expected_version then
    raise exception 'quotation was modified concurrently' using errcode = '40001';
  end if;
  perform app.recompute_quotation_totals(p_quotation_id);
  select subtotal into v_q.subtotal from public.quotations where id = p_quotation_id;
  if v_q.subtotal <= 0 then
    raise exception 'price every line before submitting the quotation' using errcode = '22023';
  end if;
  select count(*) into v_zero from public.quotation_items where quotation_id = p_quotation_id and unit_price <= 0;
  if v_zero > 0 then
    raise exception 'every line must have a price before the quotation can be submitted' using errcode = '22023';
  end if;
  update public.quotations set status = 'submitted', submitted_at = now(), version = version + 1
  where id = p_quotation_id;
  -- Reflect on the RFQ (only if still open — do not disturb a cancelled RFQ).
  update public.rfqs set status = 'quoted', version = version + 1
  where id = v_q.rfq_id and status in ('submitted', 'quoted');
  perform app.record_audit_event('quotation.submitted', 'quotation', p_quotation_id, v_q.supplier_org_id,
    jsonb_build_object('rfq_id', v_q.rfq_id, 'total', v_q.total));
  return v_q.version + 1;
end;
$$;

-- Requester decision: submitted → accepted / rejected. On accept the RFQ closes
-- (READY FOR ORDER — no order row is created; Orders are Sprint 10). On reject the
-- RFQ returns to 'quoted' so the supplier may revise with a new quotation.
create or replace function public.decide_quotation(
  p_quotation_id     uuid,
  p_accept           boolean,
  p_expected_version integer
) returns integer language plpgsql security definer set search_path = '' as $$
declare v_q public.quotations;
begin
  select * into v_q from public.quotations where id = p_quotation_id for update;
  if not found then raise exception 'quotation not found'; end if;
  if not app.is_org_member(v_q.requester_org_id) then
    raise exception 'not a member of the requester organization' using errcode = '42501';
  end if;
  if not app.can_decide_quote(v_q.requester_org_id) then
    raise exception 'quote.decide required' using errcode = '42501';
  end if;
  if v_q.status <> 'submitted' then
    raise exception 'only a submitted quotation can be decided' using errcode = '22023';
  end if;
  if v_q.version <> p_expected_version then
    raise exception 'quotation was modified concurrently' using errcode = '40001';
  end if;
  update public.quotations set
    status = case when p_accept then 'accepted'::public.quotation_status else 'rejected'::public.quotation_status end,
    decided_at = now(), decided_by = (select auth.uid()), version = version + 1
  where id = p_quotation_id;
  if p_accept then
    -- READY FOR ORDER: close the RFQ (terminal). No order created (Sprint 10).
    update public.rfqs set status = 'closed', closed_at = now(), version = version + 1
    where id = v_q.rfq_id;
    perform app.record_audit_event('quotation.accepted', 'quotation', p_quotation_id, v_q.requester_org_id,
      jsonb_build_object('rfq_id', v_q.rfq_id, 'total', v_q.total));
    perform app.record_audit_event('rfq.closed', 'rfq', v_q.rfq_id, v_q.requester_org_id,
      jsonb_build_object('quotation_id', p_quotation_id));
  else
    -- Reopen the RFQ for revision (supplier may create a fresh quotation).
    update public.rfqs set status = 'quoted', version = version + 1
    where id = v_q.rfq_id and status not in ('closed', 'cancelled');
    perform app.record_audit_event('quotation.rejected', 'quotation', p_quotation_id, v_q.requester_org_id,
      jsonb_build_object('rfq_id', v_q.rfq_id));
  end if;
  return v_q.version + 1;
end;
$$;

-- ===========================================================================
-- 16. Execute grants — authenticated only (a service-role key is not a business
--     authorization path, ADR-0008/D17).
-- ===========================================================================
revoke execute on function
  public.create_product(uuid, text, public.product_category, public.product_unit, text, text, text, text),
  public.update_product(uuid, integer, text, public.product_category, public.product_unit, text, text, text, text, boolean, boolean, boolean),
  public.set_product_published(uuid, boolean, integer),
  public.create_rfq(uuid, uuid, text, text, date, uuid),
  public.add_rfq_item(uuid, uuid, numeric, text),
  public.remove_rfq_item(uuid),
  public.update_rfq(uuid, integer, text, text, date, boolean, boolean),
  public.submit_rfq(uuid, integer),
  public.cancel_rfq(uuid),
  public.create_quotation(uuid, text, date),
  public.set_quotation_item_price(uuid, numeric),
  public.update_quotation(uuid, integer, text, date, boolean, boolean),
  public.submit_quotation(uuid, integer),
  public.decide_quotation(uuid, boolean, integer)
  from public;

grant execute on function
  public.create_product(uuid, text, public.product_category, public.product_unit, text, text, text, text),
  public.update_product(uuid, integer, text, public.product_category, public.product_unit, text, text, text, text, boolean, boolean, boolean),
  public.set_product_published(uuid, boolean, integer),
  public.create_rfq(uuid, uuid, text, text, date, uuid),
  public.add_rfq_item(uuid, uuid, numeric, text),
  public.remove_rfq_item(uuid),
  public.update_rfq(uuid, integer, text, text, date, boolean, boolean),
  public.submit_rfq(uuid, integer),
  public.cancel_rfq(uuid),
  public.create_quotation(uuid, text, date),
  public.set_quotation_item_price(uuid, numeric),
  public.update_quotation(uuid, integer, text, date, boolean, boolean),
  public.submit_quotation(uuid, integer),
  public.decide_quotation(uuid, boolean, integer)
  to authenticated;

-- ===========================================================================
-- 17. Read models — security_invoker views so RLS scopes rows to the caller.
--     Counterparty org NAME is resolved via a security-definer scalar so a
--     requester can read the supplier's display name (and vice versa) WITHOUT a
--     cross-tenant read on the organizations base table. It only ever yields a
--     name for an org that already appears on an RFQ/quotation the caller can see
--     (the row itself stays RLS-gated by the base rfqs/quotations policies).
-- ===========================================================================
create or replace function app.org_display_name(p_org_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select name from public.organizations where id = p_org_id;
$$;
revoke execute on function app.org_display_name(uuid) from public;
grant execute on function app.org_display_name(uuid) to authenticated;

create view public.rfq_list with (security_invoker = true) as
  select
    r.id, r.requester_org_id, r.supplier_org_id, r.requester_branch_id,
    r.title, r.status, r.required_date, r.submitted_at, r.created_at, r.updated_at, r.version,
    app.org_display_name(r.requester_org_id) as requester_name,
    app.org_display_name(r.supplier_org_id)  as supplier_name,
    (select count(*) from public.rfq_items ri where ri.rfq_id = r.id) as item_count
  from public.rfqs r;
comment on view public.rfq_list is 'RFQ list projection (RLS-scoped) with supplier/requester names and item counts.';

create view public.quotation_list with (security_invoker = true) as
  select
    q.id, q.rfq_id, q.supplier_org_id, q.requester_org_id, q.status,
    q.subtotal, q.total, q.validity_date, q.submitted_at, q.decided_at,
    q.created_at, q.updated_at, q.version,
    r.title as rfq_title,
    app.org_display_name(q.supplier_org_id)  as supplier_name,
    app.org_display_name(q.requester_org_id) as requester_name,
    (select count(*) from public.quotation_items qi where qi.quotation_id = q.id) as item_count
  from public.quotations q
  join public.rfqs r on r.id = q.rfq_id;
comment on view public.quotation_list is 'Quotation list projection (RLS-scoped) with RFQ title, org names, and item counts.';

grant select on public.rfq_list       to authenticated;
grant select on public.quotation_list to authenticated;
