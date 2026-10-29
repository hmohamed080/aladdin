-- ===========================================================================
-- Marketplace — Migration 03: inventory
-- ===========================================================================
-- WHAT THIS IS. Stock for the sellable variants of Migration 02:
--
--   marketplace_stock_locations     where stock is held (showroom / warehouse)
--   marketplace_inventory_levels    on-hand and reserved per (variant, location)
--   marketplace_stock_movements     append-only ledger of every stock change
--   public.marketplace_stock_apply  the ONE trusted write path
--
-- WHAT THIS IS NOT. No cart, checkout, order, payment, reservation expiry,
-- fulfilment or delivery logic. `reserve` / `release` / `deduct` exist as
-- operations the future order flow will call; nothing here calls them.
-- Publication stays CLOSED: seller enablement is still a blocker (Migration 04).
--
-- STOCK FORMULA
--   available = on_hand - reserved        (a stored generated column)
--   0 <= reserved <= on_hand              (CHECK)  => available is never negative
--
-- WHY A STOCK-LOCATION TABLE (and how it relates to existing entities)
--   Pickup from a showroom, delivery from a warehouse and "several branches" all
--   need stock to be addressed by WHERE it is. Putting a bare on-hand number on
--   the variant would force a structural change the day a second place appears.
--   A location is Marketplace-owned and references only:
--     * organizations (ON DELETE RESTRICT)  — the owner of the stock;
--     * branches      (ON DELETE RESTRICT, optional) — "this location IS that
--       showroom branch", so pickup can name a real branch. A trigger checks the
--       branch belongs to the same organization.
--   Neither existing table is altered; both foreign keys only ever BLOCK a hard
--   delete of an organization/branch that owns marketplace stock (none exist,
--   and the platform soft-deletes organizations).
--
-- CONCURRENCY AND IDEMPOTENCY
--   * Every mutation takes `SELECT ... FOR UPDATE` on the (variant, location) row
--     and re-checks the rules under that lock, so two sessions cannot both pass
--     "enough stock" for the same units. CHECK constraints are the backstop.
--   * Every call carries an idempotency key, unique per seller. Replaying a key
--     returns the original result without touching stock; reusing a key for a
--     DIFFERENT operation is an error. A race between two first uses of the same
--     key is resolved by the unique index (the loser rolls back and replays).
--
-- SECURITY
--   * RLS on all three tables. Members of the owning organization read their own
--     locations, levels and ledger; platform staff read all; anon reads nothing.
--     There is NO write grant and NO write policy for any client role.
--   * marketplace_stock_apply is SECURITY DEFINER (it must write tables no client
--     can), with an empty search_path, validates ownership itself, and is
--     executable ONLY by service_role — a trusted backend / future audited RPC.
--     It is the only code that sets the transaction-local flag that lets level
--     rows change, so a stray UPDATE cannot desynchronise levels from the ledger.
--   * The ledger is append-only (UPDATE/DELETE raise) and its foreign keys are
--     RESTRICT, so history cannot be erased by deleting a variant or location.
--   * Hardening: the app.marketplace_* trigger/helper functions from Migrations
--     01-02 held default EXECUTE for anon/authenticated. Trigger functions do not
--     need it (a trigger's function is authorised at CREATE TRIGGER), so it is
--     revoked here for every app.marketplace_* function.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0. composite key on variants (Migration 02's own table)
-- ---------------------------------------------------------------------------
-- Lets inventory rows carry (variant_id, seller_organization_id) and prove, with
-- a composite foreign key, that stock cannot be attached to another seller.
alter table public.marketplace_product_variants
  add constraint uq_marketplace_variants_id_seller unique (id, seller_organization_id);

-- ---------------------------------------------------------------------------
-- 1. marketplace_stock_locations
-- ---------------------------------------------------------------------------
create table public.marketplace_stock_locations (
  id                uuid        primary key default gen_random_uuid(),
  organization_id   uuid        not null references public.organizations (id) on delete restrict,
  branch_id         uuid        references public.branches (id) on delete restrict,
  key               text        not null,
  name_ar           text        not null,
  name_en           text        not null,
  kind              text        not null default 'showroom',
  supports_pickup   boolean     not null default false,
  supports_delivery boolean     not null default true,
  is_active         boolean     not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint uq_marketplace_stock_locations_org_key unique (organization_id, key),
  constraint uq_marketplace_stock_locations_id_org unique (id, organization_id),
  constraint ck_marketplace_stock_locations_key
    check (char_length(key) between 2 and 64 and key ~ '^[a-z][a-z0-9_]*$'),
  constraint ck_marketplace_stock_locations_name_ar check (char_length(btrim(name_ar)) between 1 and 120),
  constraint ck_marketplace_stock_locations_name_en check (char_length(btrim(name_en)) between 1 and 120),
  constraint ck_marketplace_stock_locations_kind check (kind in ('showroom', 'warehouse'))
);

comment on table public.marketplace_stock_locations is
  'A place where a seller organization holds Marketplace stock (showroom or warehouse). Marketplace-owned; optionally mirrors an existing branch so pickup can name it. Owned by an organization (RESTRICT) — never alters organizations or branches.';
comment on column public.marketplace_stock_locations.branch_id is
  'Optional link to the showroom branch this location represents (must belong to the same organization — trigger). RESTRICT: a branch that holds marketplace stock cannot be hard-deleted.';

create index ix_marketplace_stock_locations_branch on public.marketplace_stock_locations (branch_id) where branch_id is not null;
create index ix_marketplace_stock_locations_org on public.marketplace_stock_locations (organization_id, is_active);

create trigger set_marketplace_stock_locations_updated_at
  before update on public.marketplace_stock_locations
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. marketplace_inventory_levels
-- ---------------------------------------------------------------------------
create table public.marketplace_inventory_levels (
  variant_id             uuid        not null,
  location_id            uuid        not null,
  seller_organization_id uuid        not null,
  on_hand                integer     not null default 0,
  reserved               integer     not null default 0,
  available              integer     generated always as (on_hand - reserved) stored,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  primary key (variant_id, location_id),
  constraint fk_marketplace_levels_variant_seller
    foreign key (variant_id, seller_organization_id)
    references public.marketplace_product_variants (id, seller_organization_id) on delete restrict,
  constraint fk_marketplace_levels_location_seller
    foreign key (location_id, seller_organization_id)
    references public.marketplace_stock_locations (id, organization_id) on delete restrict,
  constraint ck_marketplace_levels_on_hand check (on_hand between 0 and 100000000),
  constraint ck_marketplace_levels_reserved check (reserved >= 0),
  -- the no-oversell invariant, enforced by the table itself
  constraint ck_marketplace_levels_reserved_le_on_hand check (reserved <= on_hand)
);

comment on table public.marketplace_inventory_levels is
  'On-hand and reserved units of one variant at one location. available = on_hand - reserved (generated), never negative. Changed ONLY by public.marketplace_stock_apply (a trigger refuses any other write), so it always equals the sum of its ledger.';

create index ix_marketplace_levels_location on public.marketplace_inventory_levels (location_id);
create index ix_marketplace_levels_org on public.marketplace_inventory_levels (seller_organization_id);
-- "is this variant in stock anywhere" — partial, only the rows that count.
create index ix_marketplace_levels_variant_in_stock on public.marketplace_inventory_levels (variant_id) where available > 0;

create trigger set_marketplace_levels_updated_at
  before update on public.marketplace_inventory_levels
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. marketplace_stock_movements — append-only ledger
-- ---------------------------------------------------------------------------
create table public.marketplace_stock_movements (
  id                     uuid        primary key default gen_random_uuid(),
  -- Total order of the ledger (created_at is the transaction time, so several
  -- movements of one transaction share it).
  sequence               bigint      generated always as identity,
  variant_id             uuid        not null,
  location_id            uuid        not null,
  seller_organization_id uuid        not null,
  movement_type          text        not null,
  delta_on_hand          integer     not null,
  delta_reserved         integer     not null,
  on_hand_after          integer     not null,
  reserved_after         integer     not null,
  -- Deterministic fingerprint of the requested operation; lets a replayed
  -- idempotency key be told apart from a key reused for something else.
  request_quantity       integer     not null,
  idempotency_key        text        not null,
  reason                 text        not null,
  source                 text        not null,
  reference_type         text,
  reference_id           text,
  -- Recorded, deliberately WITHOUT a foreign key: an audit row must outlive the
  -- account that caused it.
  actor_user_id          uuid,
  created_at             timestamptz not null default now(),
  constraint fk_marketplace_movements_variant_seller
    foreign key (variant_id, seller_organization_id)
    references public.marketplace_product_variants (id, seller_organization_id) on delete restrict,
  constraint fk_marketplace_movements_location_seller
    foreign key (location_id, seller_organization_id)
    references public.marketplace_stock_locations (id, organization_id) on delete restrict,
  constraint ck_marketplace_movements_type
    check (movement_type in ('initial', 'replenish', 'correction', 'reserve', 'release', 'deduct')),
  -- the shape of each operation
  constraint ck_marketplace_movements_shape check (
    (movement_type in ('initial', 'replenish') and delta_on_hand > 0 and delta_reserved = 0) or
    (movement_type = 'correction'              and delta_on_hand <> 0 and delta_reserved = 0) or
    (movement_type = 'reserve'                 and delta_on_hand = 0 and delta_reserved > 0) or
    (movement_type = 'release'                 and delta_on_hand = 0 and delta_reserved < 0) or
    (movement_type = 'deduct'                  and delta_on_hand < 0 and delta_reserved = delta_on_hand)
  ),
  constraint ck_marketplace_movements_after
    check (on_hand_after >= 0 and reserved_after >= 0 and reserved_after <= on_hand_after),
  constraint ck_marketplace_movements_key check (char_length(idempotency_key) between 8 and 128),
  constraint ck_marketplace_movements_reason check (char_length(btrim(reason)) between 1 and 300),
  constraint ck_marketplace_movements_source check (source in ('manual', 'import', 'order', 'system')),
  constraint ck_marketplace_movements_reference
    check ((reference_type is null) = (reference_id is null)
           and (reference_type is null or char_length(reference_type) between 1 and 40)
           and (reference_id is null or char_length(reference_id) between 1 and 120))
);

comment on table public.marketplace_stock_movements is
  'Append-only ledger: every change to marketplace_inventory_levels, with type, deltas, resulting balances, reason, source, optional business reference and actor. UPDATE and DELETE raise. Unique idempotency key per seller prevents a duplicate application. Private to the owning organization and platform staff.';
comment on column public.marketplace_stock_movements.actor_user_id is
  'Who caused it, when known. No foreign key on purpose: the audit row outlives the account.';
comment on column public.marketplace_stock_movements.reference_type is
  'What business object caused it (e.g. a future order id). Free text key pair, not a foreign key: orders do not exist yet.';

create unique index ux_marketplace_movements_idempotency
  on public.marketplace_stock_movements (seller_organization_id, idempotency_key);
-- exactly one opening balance per variant and location
create unique index ux_marketplace_movements_initial
  on public.marketplace_stock_movements (variant_id, location_id) where movement_type = 'initial';
create index ix_marketplace_movements_variant_time
  on public.marketplace_stock_movements (variant_id, location_id, sequence desc);
create index ix_marketplace_movements_org_time
  on public.marketplace_stock_movements (seller_organization_id, created_at desc);
create index ix_marketplace_movements_reference
  on public.marketplace_stock_movements (reference_type, reference_id) where reference_id is not null;

-- ---------------------------------------------------------------------------
-- 4. Integrity triggers
-- ---------------------------------------------------------------------------
create or replace function app.marketplace_stock_location_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_branch_org uuid;
begin
  if tg_op = 'UPDATE' and new.organization_id is distinct from old.organization_id then
    raise exception 'a stock location cannot move to another organization' using errcode = '23514';
  end if;
  if new.branch_id is not null then
    select b.organization_id into v_branch_org from public.branches b where b.id = new.branch_id;
    if v_branch_org is distinct from new.organization_id then
      raise exception 'the branch of a stock location must belong to the same organization' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger marketplace_stock_location_guard
  before insert or update on public.marketplace_stock_locations
  for each row execute function app.marketplace_stock_location_guard();

-- Levels change only inside marketplace_stock_apply (which sets this flag), so a
-- direct UPDATE can never leave levels out of step with the ledger.
create or replace function app.marketplace_inventory_level_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.marketplace_stock_write', true) is distinct from 'on' then
    raise exception 'inventory levels are changed only through marketplace_stock_apply'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger marketplace_inventory_level_guard
  before insert or update on public.marketplace_inventory_levels
  for each row execute function app.marketplace_inventory_level_guard();

create or replace function app.marketplace_stock_movement_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'marketplace stock movements are append-only' using errcode = '23514';
end;
$$;

create trigger marketplace_stock_movement_append_only
  before update or delete on public.marketplace_stock_movements
  for each row execute function app.marketplace_stock_movement_append_only();

-- ---------------------------------------------------------------------------
-- 5. public.marketplace_stock_apply — the single trusted mutation
-- ---------------------------------------------------------------------------
-- movement_type -> quantity meaning
--   initial / replenish : +quantity on hand
--   correction          : signed delta on hand (non-zero), never below reserved
--   reserve             : +quantity reserved, needs available >= quantity
--   release             : -quantity reserved, needs reserved  >= quantity
--   deduct              : -quantity on hand AND reserved (consumes a reservation)
create or replace function public.marketplace_stock_apply(
  p_seller_organization_id uuid,
  p_variant_id             uuid,
  p_location_id            uuid,
  p_movement_type          text,
  p_quantity               integer,
  p_idempotency_key        text,
  p_reason                 text,
  p_source                 text default 'system',
  p_reference_type         text default null,
  p_reference_id           text default null,
  p_actor_user_id          uuid default null
)
returns table (movement_id uuid, applied boolean, on_hand integer, reserved integer, available integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_level    public.marketplace_inventory_levels;
  v_existing public.marketplace_stock_movements;
  v_d_on     integer := 0;
  v_d_res    integer := 0;
  v_new_on   integer;
  v_new_res  integer;
  v_id       uuid;
begin
  -- 1. argument validation (before anything is read or locked)
  if p_movement_type is null or p_movement_type not in ('initial', 'replenish', 'correction', 'reserve', 'release', 'deduct') then
    raise exception 'unknown movement type' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity = 0 or (p_movement_type <> 'correction' and p_quantity < 0) then
    raise exception 'invalid quantity for %', p_movement_type using errcode = '22023';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 128 then
    raise exception 'an idempotency key of 8-128 characters is required' using errcode = '22023';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 300 then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  if p_source is null or p_source not in ('manual', 'import', 'order', 'system') then
    raise exception 'unknown source' using errcode = '22023';
  end if;

  -- 2. ownership: the variant and the location must both belong to this seller
  if not exists (select 1 from public.marketplace_product_variants v
                 where v.id = p_variant_id and v.seller_organization_id = p_seller_organization_id) then
    raise exception 'the variant does not belong to this seller' using errcode = '23503';
  end if;
  if not exists (select 1 from public.marketplace_stock_locations l
                 where l.id = p_location_id and l.organization_id = p_seller_organization_id and l.is_active) then
    raise exception 'the stock location does not belong to this seller or is inactive' using errcode = '23503';
  end if;

  -- 3. idempotent replay (cheap path, before taking the row lock)
  select m.* into v_existing from public.marketplace_stock_movements m
   where m.seller_organization_id = p_seller_organization_id and m.idempotency_key = p_idempotency_key;
  if found then
    if v_existing.variant_id <> p_variant_id or v_existing.location_id <> p_location_id
       or v_existing.movement_type <> p_movement_type or v_existing.request_quantity <> p_quantity then
      raise exception 'idempotency key was already used for a different operation' using errcode = '23505';
    end if;
    return query select v_existing.id, false, v_existing.on_hand_after, v_existing.reserved_after,
                        v_existing.on_hand_after - v_existing.reserved_after;
    return;
  end if;

  -- 4. take the row lock (creating the level row for stock-adding operations)
  perform set_config('app.marketplace_stock_write', 'on', true);
  if p_movement_type in ('initial', 'replenish', 'correction') then
    insert into public.marketplace_inventory_levels (variant_id, location_id, seller_organization_id)
    values (p_variant_id, p_location_id, p_seller_organization_id)
    on conflict (variant_id, location_id) do nothing;
  end if;
  select l.* into v_level from public.marketplace_inventory_levels l
   where l.variant_id = p_variant_id and l.location_id = p_location_id
   for update;
  if not found then
    perform set_config('app.marketplace_stock_write', 'off', true);
    raise exception 'there is no stock record for this variant at this location' using errcode = '23503';
  end if;

  -- 5. re-check the replay under the lock (a concurrent first use may have just committed)
  select m.* into v_existing from public.marketplace_stock_movements m
   where m.seller_organization_id = p_seller_organization_id and m.idempotency_key = p_idempotency_key;
  if found then
    perform set_config('app.marketplace_stock_write', 'off', true);
    if v_existing.variant_id <> p_variant_id or v_existing.location_id <> p_location_id
       or v_existing.movement_type <> p_movement_type or v_existing.request_quantity <> p_quantity then
      raise exception 'idempotency key was already used for a different operation' using errcode = '23505';
    end if;
    return query select v_existing.id, false, v_existing.on_hand_after, v_existing.reserved_after,
                        v_existing.on_hand_after - v_existing.reserved_after;
    return;
  end if;

  -- 6. the rules, evaluated against the locked row
  case p_movement_type
    when 'initial', 'replenish' then v_d_on := p_quantity;
    when 'correction'           then v_d_on := p_quantity;
    when 'reserve' then
      if v_level.available < p_quantity then
        perform set_config('app.marketplace_stock_write', 'off', true);
        raise exception 'insufficient stock: % available, % requested', v_level.available, p_quantity using errcode = '23514';
      end if;
      v_d_res := p_quantity;
    when 'release' then
      if v_level.reserved < p_quantity then
        perform set_config('app.marketplace_stock_write', 'off', true);
        raise exception 'cannot release % units: only % are reserved', p_quantity, v_level.reserved using errcode = '23514';
      end if;
      v_d_res := -p_quantity;
    when 'deduct' then
      if v_level.reserved < p_quantity then
        perform set_config('app.marketplace_stock_write', 'off', true);
        raise exception 'cannot deduct % units: only % are reserved', p_quantity, v_level.reserved using errcode = '23514';
      end if;
      v_d_on := -p_quantity;
      v_d_res := -p_quantity;
  end case;

  v_new_on  := v_level.on_hand + v_d_on;
  v_new_res := v_level.reserved + v_d_res;
  if v_new_on < v_new_res or v_new_on < 0 then
    perform set_config('app.marketplace_stock_write', 'off', true);
    raise exception 'the change would leave on-hand (%) below reserved (%)', v_new_on, v_new_res using errcode = '23514';
  end if;

  -- 7. apply: level update and ledger row in one subtransaction, so a lost race
  --    on the idempotency key rolls BOTH back and becomes a clean replay.
  begin
    update public.marketplace_inventory_levels l
       set on_hand = v_new_on, reserved = v_new_res
     where l.variant_id = p_variant_id and l.location_id = p_location_id;

    insert into public.marketplace_stock_movements (
      variant_id, location_id, seller_organization_id, movement_type, delta_on_hand, delta_reserved,
      on_hand_after, reserved_after, request_quantity, idempotency_key, reason, source,
      reference_type, reference_id, actor_user_id)
    values (
      p_variant_id, p_location_id, p_seller_organization_id, p_movement_type, v_d_on, v_d_res,
      v_new_on, v_new_res, p_quantity, p_idempotency_key, btrim(p_reason), p_source,
      p_reference_type, p_reference_id, coalesce(p_actor_user_id, (select auth.uid())))
    returning id into v_id;
  exception when unique_violation then
    perform set_config('app.marketplace_stock_write', 'off', true);
    select m.* into v_existing from public.marketplace_stock_movements m
     where m.seller_organization_id = p_seller_organization_id and m.idempotency_key = p_idempotency_key;
    if found and v_existing.variant_id = p_variant_id and v_existing.location_id = p_location_id
       and v_existing.movement_type = p_movement_type and v_existing.request_quantity = p_quantity then
      return query select v_existing.id, false, v_existing.on_hand_after, v_existing.reserved_after,
                          v_existing.on_hand_after - v_existing.reserved_after;
      return;
    end if;
    raise;
  end;

  perform set_config('app.marketplace_stock_write', 'off', true);
  return query select v_id, true, v_new_on, v_new_res, v_new_on - v_new_res;
end;
$$;

comment on function public.marketplace_stock_apply(uuid, uuid, uuid, text, integer, text, text, text, text, text, uuid) is
  'The ONLY way marketplace stock changes. SECURITY DEFINER with an empty search_path; validates seller ownership of variant and location; locks the (variant, location) row; applies one of initial / replenish / correction / reserve / release / deduct; writes the ledger row in the same transaction; idempotent per (seller, key). Executable by service_role only — seller-facing RPCs (Migration 04+) wrap it with membership checks.';

revoke all on function public.marketplace_stock_apply(uuid, uuid, uuid, text, integer, text, text, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.marketplace_stock_apply(uuid, uuid, uuid, text, integer, text, text, text, text, text, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 6. Availability helper + publication blockers
-- ---------------------------------------------------------------------------
-- Units a variant can be sold from: available stock over its ACTIVE locations.
create or replace function app.marketplace_variant_available(p_variant_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(l.available), 0)::integer
  from public.marketplace_inventory_levels l
  join public.marketplace_stock_locations loc on loc.id = l.location_id and loc.is_active
  where l.variant_id = p_variant_id;
$$;

-- Migration 02's function with ONE change: the constant `inventory_not_available`
-- becomes a real check (some active variant has stock). The seller-enablement
-- blocker stays a constant, so publication remains unreachable until Migration 04.
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

  if not exists (select 1 from public.marketplace_product_images i
                 where i.product_id = p_product_id and i.variant_id is null
                   and i.is_primary and i.status = 'verified') then
    v_blockers := array_append(v_blockers, 'no_verified_primary_image'::text);
  end if;

  -- Migration 03: inventory is now a real rule — at least one active variant must be in stock.
  if v_count > 0 and not exists (
       select 1 from public.marketplace_product_variants pv
       where pv.product_id = p_product_id and pv.status = 'active'
         and app.marketplace_variant_available(pv.id) > 0) then
    v_blockers := array_append(v_blockers, 'no_available_stock'::text);
  end if;

  -- STILL DEFERRED (Migration 04): explicit seller enablement. Keeps publication closed.
  v_blockers := array_append(v_blockers, 'seller_enablement_not_available'::text);

  return v_blockers;
end;
$$;

comment on function app.marketplace_publication_blockers(uuid) is
  'Every reason a marketplace product cannot be published now. Reads the live required-field mapping and the live stock. Always includes seller_enablement_not_available until Migration 04 replaces that constant, which keeps publication closed (fail closed). Internal: no role has EXECUTE.';

-- ---------------------------------------------------------------------------
-- 7. RLS + privileges
-- ---------------------------------------------------------------------------
alter table public.marketplace_stock_locations  enable row level security;
alter table public.marketplace_inventory_levels enable row level security;
alter table public.marketplace_stock_movements  enable row level security;

revoke all on public.marketplace_stock_locations  from public, anon, authenticated, service_role;
revoke all on public.marketplace_inventory_levels from public, anon, authenticated, service_role;
revoke all on public.marketplace_stock_movements  from public, anon, authenticated, service_role;

grant select on public.marketplace_stock_locations  to authenticated, service_role;
grant select on public.marketplace_inventory_levels to authenticated, service_role;
grant select on public.marketplace_stock_movements  to authenticated, service_role;

create policy marketplace_stock_locations_select_owner on public.marketplace_stock_locations
  for select to authenticated using (app.is_org_member(organization_id));
create policy marketplace_levels_select_owner on public.marketplace_inventory_levels
  for select to authenticated using (app.is_org_member(seller_organization_id));
create policy marketplace_movements_select_owner on public.marketplace_stock_movements
  for select to authenticated using (app.is_org_member(seller_organization_id));

create policy marketplace_stock_locations_select_staff on public.marketplace_stock_locations
  for select to authenticated using (app.is_admin_staff());
create policy marketplace_levels_select_staff on public.marketplace_inventory_levels
  for select to authenticated using (app.is_admin_staff());
create policy marketplace_movements_select_staff on public.marketplace_stock_movements
  for select to authenticated using (app.is_admin_staff());

-- NO insert / update / delete policy and NO such grant, in any role.

-- ---------------------------------------------------------------------------
-- 8. Hardening: no client role needs EXECUTE on any app.marketplace_* function
-- ---------------------------------------------------------------------------
-- Trigger functions are authorised when the trigger is created, not when it
-- fires, so revoking EXECUTE cannot break them; the helpers are internal.
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
