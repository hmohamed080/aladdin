-- ===========================================================================
-- Marketplace — Migration 04: seller enablement, publication, safe public catalog
-- ===========================================================================
-- WHAT THIS IS.
--   1. Seller accounts: an organization is a Marketplace seller only through an
--      explicit, admin-approved row — never automatically because it is a Showroom.
--   2. Admin RPCs (approve / suspend / revoke / reinstate) gated by two NEW,
--      specific RBAC permissions, each leaving an append-only event.
--   3. Publication: the real blockers (seller approved, organization still an
--      eligible live Showroom, required fields, stock, image, media verification)
--      and trusted publish / unpublish RPCs for seller members.
--   4. A strictly controlled public read path (two functions) for published
--      products — fixed projection, no storage keys, no stock numbers, no admin data.
--
-- WHAT THIS IS NOT. No Showroom dashboard / registration change, no checkout,
-- order reservation, payment, bulk import or R2 integration. No real seller is
-- created and no production organization id appears anywhere.
--
-- FAIL CLOSED, STILL.
--   * Nothing is approved by default. The seed approves nobody.
--   * Media delivery / verification does not exist yet, and a database status
--     field alone is not proof an image exists or is safely deliverable. A single
--     platform flag (marketplace_platform_settings.media_verification_ready,
--     default FALSE) keeps the blocker `media_verification_not_available` in force
--     until a verification pipeline is signed off. While it is false no product
--     can be published through any path.
--
-- SECURITY MODEL
--   * New tables: RLS on, no write grant or policy for any client role.
--     Seller members read ONLY the safe columns of their own account row (column
--     grant); the reason and admin identities are reachable only through the
--     permission-checked admin RPCs below.
--   * Admin RPCs: SECURITY DEFINER, empty search_path, EXECUTE for authenticated,
--     each re-checks app.has_admin_permission() itself. Eligibility is
--     REVALIDATED at every transition and by every publication / public read.
--   * Public reads are SECURITY DEFINER *functions*, not views: the repo's
--     Advisor guard (test 29) forbids definer views in `public`, and a function
--     lets the projection be a reviewed, fixed column list. They return rows only
--     for status = published AND seller enabled AND organization eligible.
--   * Publication RPCs authorise through the existing catalogue capability
--     (app.can_publish_catalog: catalog.publish or org.manage) so no capability
--     key is added to the Showroom permission machinery.
--
-- DEFERRED (documented, not built): order-specific reservations. The aggregate
-- `reserved` counter cannot tell WHICH order holds units, so a future order flow
-- must hold per-order reservation rows and only release/deduct its own; checkout,
-- reservation expiry and the seller-facing product / variant / image / inventory
-- write RPCs are likewise later work.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. RBAC permissions (additive rows in the existing permission catalogue)
-- ---------------------------------------------------------------------------
insert into public.admin_permissions (key, resource, action, description, sort_order) values
  ('marketplace_sellers.read',   'marketplace_sellers', 'read',
   'Read Marketplace seller accounts and their approval history.', 110),
  ('marketplace_sellers.manage', 'marketplace_sellers', 'manage',
   'Approve, suspend, revoke and reinstate Marketplace sellers.', 111)
on conflict (key) do nothing;

-- manage: Super Admin (locked, like every core permission) and Administrator only.
-- read:   additionally Moderator. Support receives neither.
insert into public.admin_role_permissions (role_id, permission_key, is_locked)
select r.id, p.key, r.key = 'super_admin'
from public.admin_roles r
join public.admin_permissions p on p.key in ('marketplace_sellers.read', 'marketplace_sellers.manage')
where r.is_system
  and (r.key in ('super_admin', 'administrator')
       or (r.key = 'moderator' and p.key = 'marketplace_sellers.read'))
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------
create table public.marketplace_seller_accounts (
  organization_id   uuid        primary key references public.organizations (id) on delete restrict,
  status            text        not null default 'pending',
  status_reason     text,
  requested_at      timestamptz not null default now(),
  approved_at       timestamptz,
  approved_by       uuid,
  suspended_at      timestamptz,
  suspended_by      uuid,
  revoked_at        timestamptz,
  revoked_by        uuid,
  status_changed_at timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint ck_marketplace_sellers_status check (status in ('pending', 'approved', 'suspended', 'revoked')),
  constraint ck_marketplace_sellers_approved check (status <> 'approved' or approved_at is not null),
  constraint ck_marketplace_sellers_reason check (status_reason is null or char_length(status_reason) <= 500)
);

comment on table public.marketplace_seller_accounts is
  'One row per organization that has been put through Marketplace seller enablement. Being a Showroom is eligibility, never authorization: only status = approved (and a still-eligible organization) can sell. Changed only by the admin RPCs (a trigger refuses any other write); every change appends a marketplace_seller_account_events row. Actor columns carry no foreign key: audit outlives accounts.';
comment on column public.marketplace_seller_accounts.status is
  'pending | approved | suspended | revoked. revoked is terminal in V1.';

create trigger set_marketplace_seller_accounts_updated_at
  before update on public.marketplace_seller_accounts
  for each row execute function app.set_updated_at();
create index ix_marketplace_seller_accounts_status on public.marketplace_seller_accounts (status);

create table public.marketplace_seller_account_events (
  id                  uuid        primary key default gen_random_uuid(),
  sequence            bigint      generated always as identity,
  organization_id     uuid        not null references public.marketplace_seller_accounts (organization_id) on delete restrict,
  action              text        not null,
  from_status         text,
  to_status           text        not null,
  reason              text        not null,
  actor_user_id       uuid,
  org_type_at_event   text,
  org_status_at_event text,
  created_at          timestamptz not null default now(),
  constraint ck_marketplace_seller_events_action check (action in ('requested', 'approved', 'suspended', 'revoked', 'reinstated')),
  constraint ck_marketplace_seller_events_reason check (char_length(btrim(reason)) between 3 and 500)
);
comment on table public.marketplace_seller_account_events is
  'Append-only administrative history of seller enablement: who did what, from which status to which, why, and the organization''s type/status at that moment. No client access; read through admin_marketplace_seller_history().';
create index ix_marketplace_seller_events_org on public.marketplace_seller_account_events (organization_id, sequence desc);

create table public.marketplace_product_status_events (
  id              uuid        primary key default gen_random_uuid(),
  sequence        bigint      generated always as identity,
  product_id      uuid        not null references public.marketplace_products (id) on delete restrict,
  organization_id uuid        not null,
  action          text        not null,
  from_status     text        not null,
  to_status       text        not null,
  actor_user_id   uuid,
  created_at      timestamptz not null default now(),
  constraint ck_marketplace_product_events_action check (action in ('published', 'unpublished', 'archived'))
);
comment on table public.marketplace_product_status_events is
  'Append-only history of publication state changes made through the trusted publish / unpublish RPCs.';
create index ix_marketplace_product_events_product on public.marketplace_product_status_events (product_id, sequence desc);

create table public.marketplace_platform_settings (
  singleton                boolean     primary key default true,
  media_verification_ready boolean     not null default false,
  updated_at               timestamptz not null default now(),
  constraint ck_marketplace_platform_settings_singleton check (singleton)
);
comment on table public.marketplace_platform_settings is
  'Single-row platform controls for the Marketplace. media_verification_ready stays FALSE until a media verification and public delivery pipeline exists: while false, publication is refused and public responses carry no image reference.';
insert into public.marketplace_platform_settings default values;
create trigger set_marketplace_platform_settings_updated_at
  before update on public.marketplace_platform_settings
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Eligibility helpers (internal; re-evaluated live, never cached)
-- ---------------------------------------------------------------------------
create or replace function app.marketplace_seller_is_eligible(p_organization_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.organizations o
    where o.id = p_organization_id
      and o.deleted_at is null
      and o.status::text = 'active'
      and o.org_type::text = 'showroom_dealer');
$$;

create or replace function app.marketplace_seller_is_enabled(p_organization_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.marketplace_seller_accounts a
    where a.organization_id = p_organization_id and a.status = 'approved')
  and app.marketplace_seller_is_eligible(p_organization_id);
$$;

create or replace function app.marketplace_media_verification_ready()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((select s.media_verification_ready from public.marketplace_platform_settings s where s.singleton), false);
$$;

-- ---------------------------------------------------------------------------
-- 4. Guards
-- ---------------------------------------------------------------------------
create or replace function app.marketplace_seller_account_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.marketplace_seller_write', true) is distinct from 'on' then
    raise exception 'seller accounts change only through the admin seller RPCs' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.organization_id is distinct from old.organization_id then
    raise exception 'a seller account cannot move to another organization' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and not app.marketplace_seller_is_eligible(new.organization_id) then
    raise exception 'the organization is not an eligible, active showroom' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger marketplace_seller_account_guard
  before insert or update on public.marketplace_seller_accounts
  for each row execute function app.marketplace_seller_account_guard();

create or replace function app.marketplace_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '23514';
end;
$$;
create trigger marketplace_seller_events_append_only
  before update or delete on public.marketplace_seller_account_events
  for each row execute function app.marketplace_append_only();
create trigger marketplace_product_events_append_only
  before update or delete on public.marketplace_product_status_events
  for each row execute function app.marketplace_append_only();

-- Units can only be RESERVED against a seller that is currently enabled, so a
-- suspension stops new sales immediately. (release / deduct stay possible so
-- existing orders can be wound down.)
create or replace function app.marketplace_movement_seller_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.movement_type = 'reserve' and not app.marketplace_seller_is_enabled(new.seller_organization_id) then
    raise exception 'the seller is not enabled for the Marketplace' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger marketplace_movement_seller_guard
  before insert on public.marketplace_stock_movements
  for each row execute function app.marketplace_movement_seller_guard();

-- ---------------------------------------------------------------------------
-- 5. The single seller-state transition (internal)
-- ---------------------------------------------------------------------------
create or replace function app.marketplace_seller_transition(
  p_organization_id uuid,
  p_action          text,        -- approve | suspend | revoke | reinstate
  p_reason          text,
  p_actor           uuid
)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_acct   public.marketplace_seller_accounts;
  v_from   text;
  v_to     text;
  v_event  text;
  v_org    record;
begin
  if p_reason is null or char_length(btrim(p_reason)) not between 3 and 500 then
    raise exception 'a reason of 3-500 characters is required' using errcode = '22023';
  end if;

  select o.org_type::text as org_type, o.status::text as org_status, o.deleted_at
    into v_org from public.organizations o where o.id = p_organization_id;
  if not found then
    raise exception 'unknown organization' using errcode = '23503';
  end if;

  select a.* into v_acct from public.marketplace_seller_accounts a
   where a.organization_id = p_organization_id for update;
  v_from := case when found then v_acct.status else null end;

  -- transition table
  case p_action
    when 'approve' then
      if v_from is not null and v_from <> 'pending' then
        raise exception 'cannot approve a seller that is %', v_from using errcode = '23514';
      end if;
      v_to := 'approved'; v_event := 'approved';
    when 'suspend' then
      if v_from is distinct from 'approved' then
        raise exception 'only an approved seller can be suspended' using errcode = '23514';
      end if;
      v_to := 'suspended'; v_event := 'suspended';
    when 'revoke' then
      if v_from is null or v_from = 'revoked' then
        raise exception 'there is no active seller account to revoke' using errcode = '23514';
      end if;
      v_to := 'revoked'; v_event := 'revoked';
    when 'reinstate' then
      if v_from is distinct from 'suspended' then
        raise exception 'only a suspended seller can be reinstated (a revoked seller cannot)' using errcode = '23514';
      end if;
      v_to := 'approved'; v_event := 'reinstated';
    else
      raise exception 'unknown action' using errcode = '22023';
  end case;

  -- Eligibility is re-validated every time a seller is (re)enabled — never
  -- trusted from the original approval.
  if v_to = 'approved' and not app.marketplace_seller_is_eligible(p_organization_id) then
    raise exception 'the organization is not an eligible, active showroom (type %, status %, deleted %)',
      v_org.org_type, v_org.org_status, v_org.deleted_at is not null using errcode = '23514';
  end if;

  perform set_config('app.marketplace_seller_write', 'on', true);
  if v_from is null then
    insert into public.marketplace_seller_accounts (organization_id, status, status_reason, approved_at, approved_by, status_changed_at)
    values (p_organization_id, v_to, btrim(p_reason), now(), p_actor, now());
  else
    update public.marketplace_seller_accounts a set
      status = v_to,
      status_reason = btrim(p_reason),
      status_changed_at = now(),
      approved_at  = case when v_to = 'approved'  then now() else a.approved_at end,
      approved_by  = case when v_to = 'approved'  then p_actor else a.approved_by end,
      suspended_at = case when v_to = 'suspended' then now() else a.suspended_at end,
      suspended_by = case when v_to = 'suspended' then p_actor else a.suspended_by end,
      revoked_at   = case when v_to = 'revoked'   then now() else a.revoked_at end,
      revoked_by   = case when v_to = 'revoked'   then p_actor else a.revoked_by end
    where a.organization_id = p_organization_id;
  end if;
  perform set_config('app.marketplace_seller_write', 'off', true);

  insert into public.marketplace_seller_account_events
    (organization_id, action, from_status, to_status, reason, actor_user_id, org_type_at_event, org_status_at_event)
  values (p_organization_id, v_event, v_from, v_to, btrim(p_reason), p_actor, v_org.org_type, v_org.org_status);

  return v_to;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Admin RPCs (permission-checked, audited)
-- ---------------------------------------------------------------------------
create or replace function app.marketplace_assert_seller_admin(p_manage boolean)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_manage then
    if not app.has_admin_permission('marketplace_sellers.manage') then
      raise exception 'permission marketplace_sellers.manage is required' using errcode = '42501';
    end if;
  elsif not (app.has_admin_permission('marketplace_sellers.read') or app.has_admin_permission('marketplace_sellers.manage')) then
    raise exception 'permission marketplace_sellers.read is required' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

create or replace function public.admin_marketplace_seller_approve(p_organization_id uuid, p_reason text)
returns text language plpgsql security definer set search_path = '' as $$
begin
  return app.marketplace_seller_transition(p_organization_id, 'approve', p_reason, app.marketplace_assert_seller_admin(true));
end;
$$;
create or replace function public.admin_marketplace_seller_suspend(p_organization_id uuid, p_reason text)
returns text language plpgsql security definer set search_path = '' as $$
begin
  return app.marketplace_seller_transition(p_organization_id, 'suspend', p_reason, app.marketplace_assert_seller_admin(true));
end;
$$;
create or replace function public.admin_marketplace_seller_revoke(p_organization_id uuid, p_reason text)
returns text language plpgsql security definer set search_path = '' as $$
begin
  return app.marketplace_seller_transition(p_organization_id, 'revoke', p_reason, app.marketplace_assert_seller_admin(true));
end;
$$;
create or replace function public.admin_marketplace_seller_reinstate(p_organization_id uuid, p_reason text)
returns text language plpgsql security definer set search_path = '' as $$
begin
  return app.marketplace_seller_transition(p_organization_id, 'reinstate', p_reason, app.marketplace_assert_seller_admin(true));
end;
$$;

create or replace function public.admin_marketplace_sellers()
returns table (
  organization_id uuid, organization_name text, org_type text, org_status text, organization_deleted boolean,
  eligible boolean, status text, status_reason text, requested_at timestamptz,
  approved_at timestamptz, approved_by uuid, suspended_at timestamptz, suspended_by uuid,
  revoked_at timestamptz, revoked_by uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.marketplace_assert_seller_admin(false);
  return query
    select a.organization_id, o.name, o.org_type::text, o.status::text, o.deleted_at is not null,
           app.marketplace_seller_is_eligible(a.organization_id), a.status, a.status_reason, a.requested_at,
           a.approved_at, a.approved_by, a.suspended_at, a.suspended_by, a.revoked_at, a.revoked_by
    from public.marketplace_seller_accounts a join public.organizations o on o.id = a.organization_id
    order by a.status_changed_at desc;
end;
$$;

create or replace function public.admin_marketplace_seller_history(p_organization_id uuid)
returns table (sequence bigint, action text, from_status text, to_status text, reason text, actor_user_id uuid,
               org_type_at_event text, org_status_at_event text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.marketplace_assert_seller_admin(false);
  return query
    select e.sequence, e.action, e.from_status, e.to_status, e.reason, e.actor_user_id,
           e.org_type_at_event, e.org_status_at_event, e.created_at
    from public.marketplace_seller_account_events e
    where e.organization_id = p_organization_id order by e.sequence desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Publication blockers (replaces Migration 03's: the constant is now real)
-- ---------------------------------------------------------------------------
create or replace function app.marketplace_publication_blockers(p_product_id uuid)
returns text[]
language plpgsql
stable
set search_path = ''
as $$
declare
  v_blockers text[] := '{}';
  v_type_id  uuid;
  v_seller   uuid;
  v_count    integer;
  r          record;
begin
  select p.product_type_id, p.seller_organization_id into v_type_id, v_seller
  from public.marketplace_products p where p.id = p_product_id;
  if v_type_id is null then
    return array['product_not_found'];
  end if;

  -- seller: still an eligible live Showroom, AND explicitly approved
  if not app.marketplace_seller_is_eligible(v_seller) then
    v_blockers := array_append(v_blockers, 'seller_organization_not_eligible'::text);
  end if;
  if not exists (select 1 from public.marketplace_seller_accounts a where a.organization_id = v_seller and a.status = 'approved') then
    v_blockers := array_append(v_blockers, 'seller_not_approved'::text);
  end if;

  -- the product type itself must still be offered
  if not exists (select 1 from public.marketplace_product_types t
                 join public.marketplace_categories c on c.id = t.category_id
                 where t.id = v_type_id and t.is_active and c.is_active) then
    v_blockers := array_append(v_blockers, 'product_type_inactive'::text);
  end if;

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

  select count(*) into v_count from public.marketplace_product_variants
   where product_id = p_product_id and status = 'active';
  if v_count = 0 then
    v_blockers := array_append(v_blockers, 'no_active_variant'::text);
  end if;

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

  if v_count > 1 and exists (
       select 1 from public.marketplace_product_variants
       where product_id = p_product_id and status = 'active' and option_signature is null) then
    v_blockers := array_append(v_blockers, 'variant_without_option_combination'::text);
  end if;

  -- an active variant must have a usable price (the CHECK already forbids <= 0;
  -- this guards a future relaxation of that constraint)
  if exists (select 1 from public.marketplace_product_variants
             where product_id = p_product_id and status = 'active' and (price_egp is null or price_egp <= 0)) then
    v_blockers := array_append(v_blockers, 'invalid_variant_price'::text);
  end if;

  -- stock: some active variant is sellable now, at an active location
  if v_count > 0 and not exists (
       select 1 from public.marketplace_product_variants pv
       where pv.product_id = p_product_id and pv.status = 'active'
         and app.marketplace_variant_available(pv.id) > 0) then
    v_blockers := array_append(v_blockers, 'no_available_stock'::text);
  end if;

  -- media: a verified primary image AND a verification / delivery pipeline.
  if not exists (select 1 from public.marketplace_product_images i
                 where i.product_id = p_product_id and i.variant_id is null
                   and i.is_primary and i.status = 'verified') then
    v_blockers := array_append(v_blockers, 'no_verified_primary_image'::text);
  end if;
  if not app.marketplace_media_verification_ready() then
    v_blockers := array_append(v_blockers, 'media_verification_not_available'::text);
  end if;

  return v_blockers;
end;
$$;

comment on function app.marketplace_publication_blockers(uuid) is
  'Every reason a marketplace product cannot be published now: seller eligibility and approval, product type, required fields, variants and prices, live stock, verified primary image, and the platform media-verification flag (false by default => publication closed). Internal: no role has EXECUTE.';

-- ---------------------------------------------------------------------------
-- 8. Trusted publication RPCs (seller side)
-- ---------------------------------------------------------------------------
-- Authorisation: an authenticated caller who is a member of the SELLER
-- organization with the existing catalogue publish authority
-- (app.can_publish_catalog = catalog.publish or org.manage).
create or replace function public.marketplace_product_publish(p_product_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_org     uuid;
  v_status  text;
  v_blocked text[];
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select p.seller_organization_id, p.status into v_org, v_status
  from public.marketplace_products p where p.id = p_product_id for update;
  -- not found and not-yours are indistinguishable to the caller
  if v_org is null or not app.can_publish_catalog(v_org) then
    raise exception 'product not found or not permitted' using errcode = '42501';
  end if;
  if v_status = 'archived' then
    raise exception 'an archived product cannot be published' using errcode = '23514';
  end if;
  if v_status = 'published' then
    return 'published';
  end if;
  v_blocked := app.marketplace_publication_blockers(p_product_id);
  if cardinality(v_blocked) > 0 then
    raise exception 'publication blocked: %', array_to_string(v_blocked, ', ') using errcode = '23514';
  end if;
  update public.marketplace_products set status = 'published', published_at = coalesce(published_at, now())
   where id = p_product_id;
  insert into public.marketplace_product_status_events (product_id, organization_id, action, from_status, to_status, actor_user_id)
  values (p_product_id, v_org, 'published', v_status, 'published', v_uid);
  return 'published';
end;
$$;

create or replace function public.marketplace_product_unpublish(p_product_id uuid, p_archive boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_org    uuid;
  v_status text;
  v_to     text := case when p_archive then 'archived' else 'unpublished' end;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select p.seller_organization_id, p.status into v_org, v_status
  from public.marketplace_products p where p.id = p_product_id for update;
  if v_org is null or not app.can_publish_catalog(v_org) then
    raise exception 'product not found or not permitted' using errcode = '42501';
  end if;
  if v_status = v_to then
    return v_to;
  end if;
  if v_status = 'archived' then
    raise exception 'an archived product cannot change state' using errcode = '23514';
  end if;
  if not p_archive and v_status <> 'published' then
    raise exception 'only a published product can be unpublished' using errcode = '23514';
  end if;
  update public.marketplace_products set status = v_to where id = p_product_id;
  insert into public.marketplace_product_status_events (product_id, organization_id, action, from_status, to_status, actor_user_id)
  values (p_product_id, v_org, case when p_archive then 'archived' else 'unpublished' end, v_status, v_to, v_uid);
  return v_to;
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Safe public catalogue (functions, fixed projection)
-- ---------------------------------------------------------------------------
-- A product is public only while ALL of: status = published; the seller account
-- is approved; the organization is still an eligible live showroom; its type and
-- category are active. Suspension / revocation / deactivation therefore hide it
-- on the very next call. A stock-out does NOT hide it — variants simply report
-- purchasable = false.
create or replace function public.marketplace_public_catalog(
  p_type_key text default null,
  p_query    text default null,
  p_limit    integer default 24,
  p_offset   integer default 0)
returns table (
  slug text, name_ar text, name_en text, description_ar text, description_en text, brand text,
  product_type_key text, category_key text, from_price_egp numeric, in_stock boolean,
  primary_image_id uuid, published_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select p.slug, p.name_ar, p.name_en, p.description_ar, p.description_en, p.brand,
         t.key, c.key,
         (select min(v.price_egp) from public.marketplace_product_variants v
           where v.product_id = p.id and v.status = 'active'),
         exists (select 1 from public.marketplace_product_variants v
                  where v.product_id = p.id and v.status = 'active'
                    and app.marketplace_variant_available(v.id) > 0),
         case when app.marketplace_media_verification_ready() then
           (select i.id from public.marketplace_product_images i
             where i.product_id = p.id and i.variant_id is null and i.is_primary and i.status = 'verified' limit 1)
         end,
         p.published_at
  from public.marketplace_products p
  join public.marketplace_product_types t on t.id = p.product_type_id and t.is_active
  join public.marketplace_categories c on c.id = t.category_id and c.is_active
  where p.status = 'published'
    and app.marketplace_seller_is_enabled(p.seller_organization_id)
    and exists (select 1 from public.marketplace_product_variants v where v.product_id = p.id and v.status = 'active')
    and (p_type_key is null or t.key = p_type_key)
    and (p_query is null or btrim(p_query) = ''
         or position(lower(btrim(p_query)) in lower(p.name_en)) > 0
         or position(lower(btrim(p_query)) in lower(p.name_ar)) > 0
         or position(lower(btrim(p_query)) in lower(coalesce(p.brand, ''))) > 0)
  order by p.published_at desc, p.slug
  limit least(greatest(coalesce(p_limit, 24), 1), 60)
  offset greatest(coalesce(p_offset, 0), 0);
$$;

create or replace function public.marketplace_public_product(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_p       public.marketplace_products;
  v_type    text;
  v_media   boolean := app.marketplace_media_verification_ready();
  v_result  jsonb;
begin
  select p.* into v_p
  from public.marketplace_products p
  join public.marketplace_product_types t on t.id = p.product_type_id and t.is_active
  join public.marketplace_categories c on c.id = t.category_id and c.is_active
  where p.slug = p_slug and p.status = 'published'
    and app.marketplace_seller_is_enabled(p.seller_organization_id);
  if not found then
    return null;
  end if;
  select t.key into v_type from public.marketplace_product_types t where t.id = v_p.product_type_id;

  select jsonb_build_object(
    'slug', v_p.slug,
    'name_ar', v_p.name_ar, 'name_en', v_p.name_en,
    'description_ar', v_p.description_ar, 'description_en', v_p.description_en,
    'brand', v_p.brand,
    'product_type_key', v_type,
    'published_at', v_p.published_at,
    'attributes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', d.key, 'name_ar', d.name_ar, 'name_en', d.name_en, 'data_type', v.data_type, 'unit_kind', d.unit_kind,
               'value', case
                 when v.option_id is not null then jsonb_build_object('key', o.key, 'name_ar', o.name_ar, 'name_en', o.name_en, 'swatch_hex', o.swatch_hex)
                 when v.value_number is not null then to_jsonb(v.value_number)
                 when v.value_boolean is not null then to_jsonb(v.value_boolean)
                 else to_jsonb(v.value_text) end)
             order by d.key)
      from public.marketplace_product_attribute_values v
      join public.marketplace_attribute_definitions d on d.id = v.attribute_id and d.is_active
      left join public.marketplace_attribute_options o on o.id = v.option_id
      where v.product_id = v_p.id), '[]'::jsonb),
    'variants', coalesce((
      select jsonb_agg(jsonb_build_object(
               'sku', pv.sku, 'selling_unit', pv.selling_unit, 'price_egp', pv.price_egp,
               'purchasable', app.marketplace_variant_available(pv.id) > 0,
               'attributes', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'key', d.key, 'name_ar', d.name_ar, 'name_en', d.name_en, 'data_type', vv.data_type, 'unit_kind', d.unit_kind,
                          'value', case
                            when vv.option_id is not null then jsonb_build_object('key', o.key, 'name_ar', o.name_ar, 'name_en', o.name_en, 'swatch_hex', o.swatch_hex)
                            when vv.value_number is not null then to_jsonb(vv.value_number)
                            when vv.value_boolean is not null then to_jsonb(vv.value_boolean)
                            else to_jsonb(vv.value_text) end)
                        order by d.key)
                 from public.marketplace_variant_attribute_values vv
                 join public.marketplace_attribute_definitions d on d.id = vv.attribute_id and d.is_active
                 left join public.marketplace_attribute_options o on o.id = vv.option_id
                 where vv.variant_id = pv.id), '[]'::jsonb))
             order by pv.sku)
      from public.marketplace_product_variants pv
      where pv.product_id = v_p.id and pv.status = 'active'), '[]'::jsonb),
    'images', case when v_media then coalesce((
      select jsonb_agg(jsonb_build_object(
               'image_id', i.id, 'sort_order', i.sort_order, 'is_primary', i.is_primary,
               'alt_text_ar', i.alt_text_ar, 'alt_text_en', i.alt_text_en,
               'variant_sku', (select pv.sku from public.marketplace_product_variants pv where pv.id = i.variant_id))
             order by i.sort_order)
      from public.marketplace_product_images i
      where i.product_id = v_p.id and i.status = 'verified'), '[]'::jsonb) else '[]'::jsonb end
  ) into v_result;
  return v_result;
end;
$$;

comment on function public.marketplace_public_catalog(text, text, integer, integer) is
  'Public product listing. SECURITY DEFINER with a fixed projection: slug, names, descriptions, brand, type and category keys, from-price (EXCL. VAT), in_stock flag, primary image ID (null while media verification is not ready). Only published products of an approved, still-eligible seller. Never returns storage keys, stock counts, seller identity or admin metadata.';
comment on function public.marketplace_public_product(text) is
  'Public product detail as jsonb. Same visibility rule and projection discipline as marketplace_public_catalog; variants carry purchasable (boolean), never a stock number. Image entries are IDs only; the bucket and object key are never returned.';

-- ---------------------------------------------------------------------------
-- 10. RLS, grants
-- ---------------------------------------------------------------------------
alter table public.marketplace_seller_accounts       enable row level security;
alter table public.marketplace_seller_account_events enable row level security;
alter table public.marketplace_product_status_events enable row level security;
alter table public.marketplace_platform_settings     enable row level security;

revoke all on public.marketplace_seller_accounts        from public, anon, authenticated, service_role;
revoke all on public.marketplace_seller_account_events  from public, anon, authenticated, service_role;
revoke all on public.marketplace_product_status_events  from public, anon, authenticated, service_role;
revoke all on public.marketplace_platform_settings      from public, anon, authenticated, service_role;

-- Members see ONLY the safe columns of their own account; reason and admin
-- identities are reachable through the permission-checked admin RPCs only.
grant select (organization_id, status, requested_at, status_changed_at)
  on public.marketplace_seller_accounts to authenticated;
create policy marketplace_seller_accounts_select_member on public.marketplace_seller_accounts
  for select to authenticated using (app.is_org_member(organization_id));

-- the three internal tables: RLS on, no grant, no policy.

revoke all on function public.admin_marketplace_seller_approve(uuid, text)   from public, anon, authenticated, service_role;
revoke all on function public.admin_marketplace_seller_suspend(uuid, text)   from public, anon, authenticated, service_role;
revoke all on function public.admin_marketplace_seller_revoke(uuid, text)    from public, anon, authenticated, service_role;
revoke all on function public.admin_marketplace_seller_reinstate(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.admin_marketplace_sellers()                    from public, anon, authenticated, service_role;
revoke all on function public.admin_marketplace_seller_history(uuid)         from public, anon, authenticated, service_role;
grant execute on function public.admin_marketplace_seller_approve(uuid, text)   to authenticated;
grant execute on function public.admin_marketplace_seller_suspend(uuid, text)   to authenticated;
grant execute on function public.admin_marketplace_seller_revoke(uuid, text)    to authenticated;
grant execute on function public.admin_marketplace_seller_reinstate(uuid, text) to authenticated;
grant execute on function public.admin_marketplace_sellers()                    to authenticated;
grant execute on function public.admin_marketplace_seller_history(uuid)         to authenticated;

revoke all on function public.marketplace_product_publish(uuid)            from public, anon, authenticated, service_role;
revoke all on function public.marketplace_product_unpublish(uuid, boolean) from public, anon, authenticated, service_role;
grant execute on function public.marketplace_product_publish(uuid)            to authenticated;
grant execute on function public.marketplace_product_unpublish(uuid, boolean) to authenticated;

revoke all on function public.marketplace_public_catalog(text, text, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.marketplace_public_product(text)                          from public, anon, authenticated, service_role;
grant execute on function public.marketplace_public_catalog(text, text, integer, integer) to anon, authenticated;
grant execute on function public.marketplace_public_product(text)                          to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 11. Hardening (same loop as Migration 03, now covering the new helpers)
-- ---------------------------------------------------------------------------
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname like 'marketplace\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.sig);
  end loop;
end;
$$;
