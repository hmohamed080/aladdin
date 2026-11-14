-- ===========================================================================
-- Marketplace — Migration 14: checkout, orders and showroom payment methods
-- ===========================================================================
-- WHAT THIS ADDS (owner decisions, 2026-11-14)
--   * Each showroom chooses how it is paid (marketplace_seller_payment_settings):
--       cod       cash on delivery / at pickup handover;
--       instapay  the buyer transfers a DEPOSIT (a percentage of the order total the showroom sets;
--                 100 = the full amount) by InstaPay and uploads a photo of the receipt; the showroom
--                 reviews it and only then continues the order;
--       online gateway: "coming soon" in the UI (no column, no code until the gateway exists).
--   * Checkout requires a signed-in, active account. One cart becomes one order PER SHOWROOM
--     (same checkout_id), each with its own fulfilment (delivery / pickup) and payment method.
--     Prices, delivery fees and availability are re-read from the database; the browser sends
--     only {slug, sku, qty}.
--   * Stock is RESERVED when the order is placed and held with no time limit until the showroom
--     confirms (reservation consumed: deduct) or the order is cancelled (released). Cancelling or
--     returning after confirmation puts the units back (replenish).
--   * Two independent state machines (docs/marketplace/MARKETPLACE.md §8):
--       order    pending_confirmation -> confirmed -> processing -> shipped | ready_for_pickup
--                -> delivered; cancelled; delivery_failed -> returned
--       payment  cod:      pending -> collected | not_collected
--                instapay: awaiting_deposit -> deposit_submitted -> deposit_accepted | deposit_rejected
--                          (-> collected at delivery, or at acceptance when the deposit is 100 %);
--                          refund_due when an accepted deposit's order is cancelled.
--   * InstaPay receipts are documents the buyer uploads: they use the central media system
--     (namespace 'marketplace', key proofs/<order>/<id>.<ext>) and are stored in the buyer's
--     documents folder u/<buyer>/certificates/<id>/original.<ext> (media architecture v3). Only
--     the buyer and the showroom's order managers can read them; they are never public.
--
-- No client gains a table grant; every read and write is a SECURITY DEFINER RPC that re-checks
-- the caller. Every order change is recorded in an append-only event trail.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Showroom payment methods
-- ---------------------------------------------------------------------------
create table public.marketplace_seller_payment_settings (
  seller_organization_id   uuid        primary key references public.organizations(id) on delete cascade,
  cod_enabled              boolean     not null default false,
  instapay_enabled         boolean     not null default false,
  instapay_address         text,
  instapay_account_name    text,
  instapay_deposit_percent integer,
  updated_by               uuid        references public.users(id) on delete set null,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  constraint ck_mp_pay_instapay_address check (instapay_address is null or char_length(instapay_address) between 3 and 100),
  constraint ck_mp_pay_instapay_name check (instapay_account_name is null or char_length(instapay_account_name) between 2 and 100),
  constraint ck_mp_pay_deposit check (instapay_deposit_percent is null or instapay_deposit_percent between 1 and 100),
  constraint ck_mp_pay_instapay_complete check (not instapay_enabled
    or (instapay_address is not null and instapay_account_name is not null and instapay_deposit_percent is not null))
);
comment on table public.marketplace_seller_payment_settings is
  'How a showroom is paid on the Marketplace: cash on delivery and/or an InstaPay deposit (percentage of the order total). Written only through marketplace_seller_payment_settings_save.';
create trigger set_marketplace_seller_payment_settings_updated_at before update on public.marketplace_seller_payment_settings
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Orders, items, events, payment proofs
-- ---------------------------------------------------------------------------
create sequence public.marketplace_order_number_seq;

create table public.marketplace_orders (
  id                       uuid          primary key default gen_random_uuid(),
  order_number             text          not null unique default ('MP-' || lpad(nextval('public.marketplace_order_number_seq')::text, 6, '0')),
  checkout_id              uuid          not null,
  idempotency_key          text          not null,
  buyer_user_id            uuid          not null references public.users(id) on delete restrict,
  seller_organization_id   uuid          not null references public.organizations(id) on delete restrict,
  status                   text          not null default 'pending_confirmation',
  payment_method           text          not null,
  payment_status           text          not null,
  fulfilment               text          not null,
  governorate_key          text,
  area_key                 text,
  address_text             text,
  buyer_name               text          not null,
  buyer_phone              text          not null,
  buyer_note               text,
  subtotal_egp             numeric(14,2) not null,
  delivery_fee_egp         numeric(14,2) not null default 0,
  total_egp                numeric(14,2) not null,
  deposit_percent          integer,
  deposit_egp              numeric(14,2),
  instapay_address         text,
  instapay_account_name    text,
  cancel_reason            text,
  created_at               timestamptz   not null default now(),
  updated_at               timestamptz   not null default now(),
  confirmed_at             timestamptz,
  delivered_at             timestamptz,
  cancelled_at             timestamptz,
  constraint uq_marketplace_orders_checkout_seller unique (buyer_user_id, idempotency_key, seller_organization_id),
  constraint ck_mp_orders_status check (status in ('pending_confirmation', 'confirmed', 'processing', 'shipped',
    'ready_for_pickup', 'delivered', 'cancelled', 'delivery_failed', 'returned')),
  constraint ck_mp_orders_payment_method check (payment_method in ('cod', 'instapay')),
  constraint ck_mp_orders_payment_status check (
    (payment_method = 'cod' and payment_status in ('pending', 'collected', 'not_collected'))
    or (payment_method = 'instapay' and payment_status in ('awaiting_deposit', 'deposit_submitted', 'deposit_accepted',
      'deposit_rejected', 'collected', 'not_collected', 'refund_due'))),
  constraint ck_mp_orders_fulfilment check (fulfilment in ('delivery', 'pickup')),
  constraint ck_mp_orders_delivery_address check (fulfilment = 'pickup'
    or (governorate_key is not null and char_length(address_text) between 5 and 300)),
  constraint ck_mp_orders_money check (subtotal_egp > 0 and delivery_fee_egp >= 0 and total_egp = subtotal_egp + delivery_fee_egp),
  constraint ck_mp_orders_deposit check ((payment_method = 'instapay') = (deposit_percent is not null and deposit_egp is not null
    and instapay_address is not null and instapay_account_name is not null)),
  constraint ck_mp_orders_buyer check (char_length(buyer_name) between 2 and 100 and buyer_phone ~ '^\+?[0-9]{8,15}$'
    and (buyer_note is null or char_length(buyer_note) <= 500)),
  constraint ck_mp_orders_idempotency check (char_length(idempotency_key) between 8 and 128),
  constraint ck_mp_orders_cancel_reason check (cancel_reason is null or char_length(cancel_reason) <= 300)
);
comment on table public.marketplace_orders is
  'One Marketplace order per showroom per checkout (checkout_id groups the orders of one cart). Order status and payment status are independent; written only through the order RPCs.';
create index ix_marketplace_orders_seller_status on public.marketplace_orders (seller_organization_id, status, created_at desc);
create index ix_marketplace_orders_buyer on public.marketplace_orders (buyer_user_id, created_at desc);
create index ix_marketplace_orders_checkout on public.marketplace_orders (checkout_id);
create trigger set_marketplace_orders_updated_at before update on public.marketplace_orders
  for each row execute function app.set_updated_at();

create table public.marketplace_order_items (
  id                 uuid          primary key default gen_random_uuid(),
  order_id           uuid          not null references public.marketplace_orders(id) on delete cascade,
  product_id         uuid          not null references public.marketplace_products(id) on delete restrict,
  variant_id         uuid          not null references public.marketplace_product_variants(id) on delete restrict,
  location_id        uuid          not null references public.marketplace_stock_locations(id) on delete restrict,
  sku                text          not null,
  name_ar            text          not null,
  name_en            text          not null,
  selling_unit       text          not null,
  unit_price_egp     numeric(14,2) not null,
  quantity           integer       not null,
  line_total_egp     numeric(14,2) generated always as (round(unit_price_egp * quantity, 2)) stored,
  created_at         timestamptz   not null default now(),
  constraint uq_marketplace_order_items_variant unique (order_id, variant_id),
  constraint ck_mp_order_items_qty check (quantity between 1 and 9999 and unit_price_egp > 0)
);
comment on table public.marketplace_order_items is 'Order lines: a snapshot of what was sold (name, unit, price) and the stock location the units were reserved at.';
create index ix_marketplace_order_items_order on public.marketplace_order_items (order_id);
create index ix_marketplace_order_items_variant on public.marketplace_order_items (variant_id);

create table public.marketplace_order_events (
  id             uuid        primary key default gen_random_uuid(),
  sequence       bigint      generated always as identity,
  order_id       uuid        not null references public.marketplace_orders(id) on delete cascade,
  action         text        not null,
  from_status    text,
  to_status      text,
  from_payment   text,
  to_payment     text,
  actor_user_id  uuid,
  actor_role     text        not null,
  note           text,
  created_at     timestamptz not null default now(),
  constraint ck_mp_order_events_role check (actor_role in ('buyer', 'seller', 'system')),
  constraint ck_mp_order_events_note check (note is null or char_length(note) <= 300)
);
comment on table public.marketplace_order_events is 'Append-only timeline of every order and payment change, with its actor.';
create index ix_marketplace_order_events_order on public.marketplace_order_events (order_id, sequence);
create trigger marketplace_order_events_append_only before update or delete on public.marketplace_order_events
  for each row execute function app.marketplace_append_only();

create table public.marketplace_payment_proofs (
  id             uuid        primary key default gen_random_uuid(),
  order_id       uuid        not null references public.marketplace_orders(id) on delete cascade,
  object_key     text        not null unique,
  mime_type      text        not null,
  created_by     uuid        not null references public.users(id) on delete restrict,
  upload_state   text        not null default 'awaiting_upload',
  status         text        not null default 'submitted',
  byte_size      bigint,
  checksum_sha256 text,
  reviewed_by    uuid        references public.users(id) on delete set null,
  reviewed_at    timestamptz,
  review_note    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint ck_mp_proofs_mime check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  constraint ck_mp_proofs_upload_state check (upload_state in ('awaiting_upload', 'confirmed', 'deleting')),
  constraint ck_mp_proofs_status check (status in ('submitted', 'accepted', 'rejected')),
  constraint ck_mp_proofs_note check (review_note is null or char_length(review_note) <= 300)
);
comment on table public.marketplace_payment_proofs is
  'InstaPay transfer receipts the buyer uploads for an order. Bytes live in the central media system (namespace marketplace, key proofs/<order>/<id>.<ext>); readable only by the buyer and the showroom''s order managers.';
create index ix_marketplace_payment_proofs_order on public.marketplace_payment_proofs (order_id, created_at);
create trigger set_marketplace_payment_proofs_updated_at before update on public.marketplace_payment_proofs
  for each row execute function app.set_updated_at();

alter table public.marketplace_seller_payment_settings enable row level security;
alter table public.marketplace_orders enable row level security;
alter table public.marketplace_order_items enable row level security;
alter table public.marketplace_order_events enable row level security;
alter table public.marketplace_payment_proofs enable row level security;
revoke all on public.marketplace_seller_payment_settings, public.marketplace_orders, public.marketplace_order_items,
  public.marketplace_order_events, public.marketplace_payment_proofs from public, anon, authenticated, service_role;
revoke all on sequence public.marketplace_order_number_seq from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Helpers (internal)
-- ---------------------------------------------------------------------------
-- A member of the showroom who may handle its Marketplace orders.
create or replace function app.marketplace_can_manage_orders(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and app.is_org_member(p_org)
     and (app.has_capability(p_org, 'order.manage') or app.has_capability(p_org, 'org.manage'));
$$;

create or replace function app.marketplace_order_event(p_order uuid, p_action text, p_from_status text, p_to_status text,
  p_from_payment text, p_to_payment text, p_role text, p_note text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.marketplace_order_events (order_id, action, from_status, to_status, from_payment, to_payment,
    actor_user_id, actor_role, note)
  values (p_order, p_action, p_from_status, p_to_status, p_from_payment, p_to_payment,
    (select auth.uid()), p_role, left(nullif(btrim(p_note), ''), 300));
$$;

-- Moves every line's stock: reserve / release / deduct, or replenish (units come back after confirmation).
create or replace function app.marketplace_order_stock(p_order uuid, p_movement text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.marketplace_orders;
  it record;
begin
  select * into o from public.marketplace_orders where id = p_order;
  for it in select * from public.marketplace_order_items where order_id = p_order order by sku loop
    perform 1 from public.marketplace_stock_apply(o.seller_organization_id, it.variant_id, it.location_id, p_movement,
      it.quantity, 'order:' || o.id || ':' || p_movement || ':' || it.variant_id, 'Marketplace order ' || o.order_number,
      'order', 'marketplace_order', o.id::text, (select auth.uid()));
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Showroom payment settings
-- ---------------------------------------------------------------------------
create or replace function public.marketplace_seller_payment_settings_get(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.marketplace_seller_payment_settings;
begin
  perform app.marketplace_assert_seller_reader(p_organization_id);
  select * into s from public.marketplace_seller_payment_settings where seller_organization_id = p_organization_id;
  return jsonb_build_object(
    'cod_enabled', coalesce(s.cod_enabled, false),
    'instapay_enabled', coalesce(s.instapay_enabled, false),
    'instapay_address', s.instapay_address,
    'instapay_account_name', s.instapay_account_name,
    'instapay_deposit_percent', s.instapay_deposit_percent,
    'can_edit', app.has_capability(p_organization_id, 'org.manage'));
end;
$$;

-- p_settings: { cod_enabled, instapay_enabled, instapay_address, instapay_account_name, instapay_deposit_percent }
create or replace function public.marketplace_seller_payment_settings_save(p_organization_id uuid, p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid;
  v_ip   boolean := coalesce((p_settings ->> 'instapay_enabled')::boolean, false);
  v_addr text := nullif(btrim(p_settings ->> 'instapay_address'), '');
  v_name text := nullif(btrim(p_settings ->> 'instapay_account_name'), '');
  v_pct  integer;
begin
  v_uid := app.marketplace_assert_seller_writer(p_organization_id);
  if not app.has_capability(p_organization_id, 'org.manage') then
    raise exception 'mp:not_permitted' using errcode = '42501';
  end if;
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    raise exception 'mp:invalid_payload' using errcode = '22023';
  end if;
  if coalesce(p_settings ->> 'instapay_deposit_percent', '') ~ '^[0-9]{1,3}$' then
    v_pct := (p_settings ->> 'instapay_deposit_percent')::integer;
  end if;
  if v_ip and (v_addr is null or char_length(v_addr) not between 3 and 100) then
    raise exception 'mp:instapay_address_required' using errcode = '23514';
  end if;
  if v_ip and (v_name is null or char_length(v_name) not between 2 and 100) then
    raise exception 'mp:instapay_name_required' using errcode = '23514';
  end if;
  if v_ip and (v_pct is null or v_pct not between 1 and 100) then
    raise exception 'mp:deposit_percent_invalid' using errcode = '23514';
  end if;
  insert into public.marketplace_seller_payment_settings as s
    (seller_organization_id, cod_enabled, instapay_enabled, instapay_address, instapay_account_name, instapay_deposit_percent, updated_by)
  values (p_organization_id, coalesce((p_settings ->> 'cod_enabled')::boolean, false), v_ip, v_addr, v_name, v_pct, v_uid)
  on conflict (seller_organization_id) do update set
    cod_enabled = excluded.cod_enabled, instapay_enabled = excluded.instapay_enabled,
    instapay_address = excluded.instapay_address, instapay_account_name = excluded.instapay_account_name,
    instapay_deposit_percent = excluded.instapay_deposit_percent, updated_by = excluded.updated_by;
  return public.marketplace_seller_payment_settings_get(p_organization_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. The public cart also tells the buyer how each showroom can be paid
-- ---------------------------------------------------------------------------
create or replace function public.marketplace_public_cart(p_lines jsonb, p_governorate text default null, p_area text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_media boolean := app.marketplace_media_verification_ready();
  v_gov   text := nullif(btrim(lower(p_governorate)), '');
  v_area  text := nullif(btrim(lower(p_area)), '');
  v_result jsonb;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'mp:invalid_lines' using errcode = '22023';
  end if;
  if jsonb_array_length(p_lines) > 50 then
    raise exception 'mp:too_many_lines' using errcode = '22023';
  end if;
  if (v_gov is not null and v_gov !~ '^[a-z0-9][a-z0-9-]{0,63}$') or (v_area is not null and v_area !~ '^[a-z0-9][a-z0-9-]{0,63}$') then
    raise exception 'mp:invalid_location' using errcode = '22023';
  end if;

  with resolved as (
    select t.ord::int as ord, req.slug, req.sku, p.id as product_id, pv.id as variant_id, p.seller_organization_id as seller_id
    from jsonb_array_elements(p_lines) with ordinality as t(x, ord)
    cross join lateral (select btrim(t.x ->> 'slug') as slug, btrim(t.x ->> 'sku') as sku) req
    left join public.marketplace_products p
      on req.slug ~ '^[a-z0-9-]{1,120}$' and p.slug = req.slug and p.status = 'published'
     and app.marketplace_seller_is_enabled(p.seller_organization_id)
     and exists (select 1 from public.marketplace_product_types pt
                 join public.marketplace_categories pc on pc.id = pt.category_id
                 where pt.id = p.product_type_id and pt.is_active and pc.is_active)
    left join public.marketplace_product_variants pv
      on pv.product_id = p.id and req.sku ~ '^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$' and pv.sku = req.sku and pv.status = 'active'
  ), sellers as (
    select r.seller_id, row_number() over (order by min(r.ord))::int as idx
    from resolved r where r.variant_id is not null group by r.seller_id
  )
  select jsonb_build_object(
    'lines', coalesce((
      select jsonb_agg(
        case when r.variant_id is null
          then jsonb_build_object('slug', r.slug, 'sku', r.sku, 'status', 'unavailable')
          else jsonb_build_object(
            'slug', r.slug, 'sku', r.sku, 'status', 'ok',
            'name_ar', p.name_ar, 'name_en', p.name_en, 'brand', p.brand,
            'selling_unit', pv.selling_unit, 'price_egp', pv.price_egp,
            -- availability is capped: the cart needs "how many may I buy", not the showroom's stock
            'available', least(app.marketplace_variant_available(pv.id), 9999),
            'seller', s.idx,
            'image_id', case when v_media then app.marketplace_product_cover_image(p.id) end,
            'attributes', coalesce((
              select jsonb_agg(jsonb_build_object(
                       'key', d.key, 'name_ar', d.name_ar, 'name_en', d.name_en, 'data_type', vv.data_type, 'unit_kind', d.unit_kind,
                       'unit_ar', d.display_unit_ar, 'unit_en', d.display_unit_en,
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
        end order by r.ord)
      from resolved r
      left join public.marketplace_products p on p.id = r.product_id
      left join public.marketplace_product_variants pv on pv.id = r.variant_id
      left join sellers s on s.seller_id = r.seller_id and r.variant_id is not null), '[]'::jsonb),
    'sellers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'index', s.idx,
               'name', o.name,
               'pickup_available', exists (select 1 from public.marketplace_stock_locations l
                                           where l.organization_id = s.seller_id and l.is_active and l.supports_pickup),
               'payment_methods', jsonb_build_object(
                 'cod', coalesce(ps.cod_enabled, false),
                 'instapay', case when coalesce(ps.instapay_enabled, false)
                   then jsonb_build_object('deposit_percent', ps.instapay_deposit_percent) end),
               'delivery', case
                 when v_gov is null then jsonb_build_object('status', 'needs_area')
                 else coalesce((
                   select jsonb_build_object('status', 'available', 'fee_egp', dr.fee_egp)
                   from public.marketplace_delivery_rates dr
                   where dr.seller_organization_id = s.seller_id and dr.governorate_key = v_gov and dr.fee_egp is not null
                     and (dr.area_key = v_area or dr.area_key is null)
                   order by (dr.area_key is null)
                   limit 1), jsonb_build_object('status', 'not_available'))
               end) order by s.idx)
      from sellers s join public.organizations o on o.id = s.seller_id
      left join public.marketplace_seller_payment_settings ps on ps.seller_organization_id = s.seller_id), '[]'::jsonb))
  into v_result;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Checkout: place the orders of one cart
-- ---------------------------------------------------------------------------
-- p_lines    [ { "slug", "sku", "qty" } ]   (at most 50)
-- p_contact  { "name", "phone", "note"?, "governorate"?, "area"?, "address"? }
-- p_sellers  [ { "index", "fulfilment": "delivery"|"pickup", "payment": "cod"|"instapay" } ]
--            index = the showroom's position in marketplace_public_cart.sellers (first-appearance order)
-- Returns { checkout_id, orders: [ { id, order_number, total_egp, payment_method, deposit_egp } ] }.
-- Replaying the same idempotency key returns the orders already placed and changes nothing.
create or replace function public.marketplace_checkout_place(p_lines jsonb, p_contact jsonb, p_sellers jsonb, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_checkout uuid := gen_random_uuid();
  v_name     text := nullif(btrim(p_contact ->> 'name'), '');
  v_phone    text := regexp_replace(coalesce(p_contact ->> 'phone', ''), '[\s-]', '', 'g');
  v_note     text := nullif(btrim(p_contact ->> 'note'), '');
  v_gov      text := nullif(btrim(lower(p_contact ->> 'governorate')), '');
  v_area     text := nullif(btrim(lower(p_contact ->> 'area')), '');
  v_address  text := nullif(btrim(p_contact ->> 'address'), '');
  s          record;
  ln         record;
  v_choice   jsonb;
  v_fulfil   text;
  v_payment  text;
  v_fee      numeric(14,2);
  v_subtotal numeric(14,2);
  v_total    numeric(14,2);
  v_settings public.marketplace_seller_payment_settings;
  v_order    public.marketplace_orders;
  v_loc      uuid;
  v_out      jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'mp:auth_required' using errcode = '42501';
  end if;
  if not app.account_is_active(v_uid) then
    raise exception 'mp:account_inactive' using errcode = '42501';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 128 then
    raise exception 'mp:invalid_payload' using errcode = '22023';
  end if;
  -- a replay returns what was placed the first time
  if exists (select 1 from public.marketplace_orders where buyer_user_id = v_uid and idempotency_key = p_idempotency_key) then
    return (select jsonb_build_object('checkout_id', min(o.checkout_id::text), 'replayed', true,
              'orders', jsonb_agg(jsonb_build_object('id', o.id, 'order_number', o.order_number, 'total_egp', o.total_egp,
                'payment_method', o.payment_method, 'deposit_egp', o.deposit_egp) order by o.order_number))
            from public.marketplace_orders o where o.buyer_user_id = v_uid and o.idempotency_key = p_idempotency_key);
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 50 then
    raise exception 'mp:invalid_lines' using errcode = '22023';
  end if;
  if p_sellers is null or jsonb_typeof(p_sellers) <> 'array' then
    raise exception 'mp:invalid_payload' using errcode = '22023';
  end if;
  if v_name is null or char_length(v_name) not between 2 and 100 then
    raise exception 'mp:buyer_name_required' using errcode = '23514';
  end if;
  if v_phone !~ '^\+?[0-9]{8,15}$' then
    raise exception 'mp:buyer_phone_invalid' using errcode = '23514';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'mp:note_too_long' using errcode = '23514';
  end if;

  -- resolve every line now (published, enabled seller, active variant), quantities validated
  create temporary table if not exists pg_temp.mp_checkout_lines (
    ord int, seller_id uuid, product_id uuid, variant_id uuid, sku text, name_ar text, name_en text,
    selling_unit text, price numeric(14,2), qty int) on commit drop;
  delete from pg_temp.mp_checkout_lines;
  insert into pg_temp.mp_checkout_lines
  select t.ord::int, p.seller_organization_id, p.id, pv.id, pv.sku, p.name_ar, p.name_en, pv.selling_unit, pv.price_egp,
         (t.x ->> 'qty')::int
  from jsonb_array_elements(p_lines) with ordinality as t(x, ord)
  left join public.marketplace_products p
    on p.slug = btrim(t.x ->> 'slug') and p.status = 'published' and app.marketplace_seller_is_enabled(p.seller_organization_id)
   and exists (select 1 from public.marketplace_product_types pt join public.marketplace_categories pc on pc.id = pt.category_id
               where pt.id = p.product_type_id and pt.is_active and pc.is_active)
  left join public.marketplace_product_variants pv
    on pv.product_id = p.id and pv.sku = btrim(t.x ->> 'sku') and pv.status = 'active'
  where coalesce(t.x ->> 'qty', '') ~ '^[0-9]{1,4}$';
  if (select count(*) from pg_temp.mp_checkout_lines) <> jsonb_array_length(p_lines)
     or exists (select 1 from pg_temp.mp_checkout_lines where variant_id is null) then
    raise exception 'mp:cart_changed' using errcode = '23514';
  end if;
  if exists (select 1 from pg_temp.mp_checkout_lines where qty < 1) then
    raise exception 'mp:invalid_quantity' using errcode = '22023';
  end if;
  if exists (select 1 from pg_temp.mp_checkout_lines group by variant_id having count(*) > 1) then
    raise exception 'mp:duplicate_line' using errcode = '22023';
  end if;

  for s in
    select l.seller_id, row_number() over (order by min(l.ord))::int as idx
    from pg_temp.mp_checkout_lines l group by l.seller_id order by idx
  loop
    select x into v_choice from jsonb_array_elements(p_sellers) x where (x ->> 'index') = s.idx::text limit 1;
    if v_choice is null then
      raise exception 'mp:choice_missing:%', s.idx using errcode = '22023';
    end if;
    v_fulfil := v_choice ->> 'fulfilment';
    v_payment := v_choice ->> 'payment';
    select * into v_settings from public.marketplace_seller_payment_settings where seller_organization_id = s.seller_id;

    if v_fulfil = 'pickup' then
      if not exists (select 1 from public.marketplace_stock_locations l
                     where l.organization_id = s.seller_id and l.is_active and l.supports_pickup) then
        raise exception 'mp:pickup_not_available:%', s.idx using errcode = '23514';
      end if;
      v_fee := 0;
    elsif v_fulfil = 'delivery' then
      if v_gov is null or v_address is null or char_length(v_address) not between 5 and 300 then
        raise exception 'mp:address_required' using errcode = '23514';
      end if;
      select dr.fee_egp into v_fee from public.marketplace_delivery_rates dr
       where dr.seller_organization_id = s.seller_id and dr.governorate_key = v_gov and dr.fee_egp is not null
         and (dr.area_key = v_area or dr.area_key is null)
       order by (dr.area_key is null) limit 1;
      if v_fee is null then
        raise exception 'mp:delivery_not_available:%', s.idx using errcode = '23514';
      end if;
    else
      raise exception 'mp:invalid_fulfilment' using errcode = '22023';
    end if;

    if v_payment = 'cod' then
      if not coalesce(v_settings.cod_enabled, false) then
        raise exception 'mp:payment_not_available:%', s.idx using errcode = '23514';
      end if;
    elsif v_payment = 'instapay' then
      if not coalesce(v_settings.instapay_enabled, false) then
        raise exception 'mp:payment_not_available:%', s.idx using errcode = '23514';
      end if;
    else
      raise exception 'mp:invalid_payment' using errcode = '22023';
    end if;

    select sum(round(l.price * l.qty, 2)) into v_subtotal from pg_temp.mp_checkout_lines l where l.seller_id = s.seller_id;
    v_total := v_subtotal + v_fee;

    insert into public.marketplace_orders
      (checkout_id, idempotency_key, buyer_user_id, seller_organization_id, status, payment_method, payment_status,
       fulfilment, governorate_key, area_key, address_text, buyer_name, buyer_phone, buyer_note,
       subtotal_egp, delivery_fee_egp, total_egp, deposit_percent, deposit_egp, instapay_address, instapay_account_name)
    values
      (v_checkout, p_idempotency_key, v_uid, s.seller_id, 'pending_confirmation', v_payment,
       case v_payment when 'cod' then 'pending' else 'awaiting_deposit' end,
       v_fulfil, case when v_fulfil = 'delivery' then v_gov end, case when v_fulfil = 'delivery' then v_area end,
       case when v_fulfil = 'delivery' then v_address end, v_name, v_phone, v_note,
       v_subtotal, v_fee, v_total,
       case when v_payment = 'instapay' then v_settings.instapay_deposit_percent end,
       case when v_payment = 'instapay' then round(v_total * v_settings.instapay_deposit_percent / 100.0, 2) end,
       case when v_payment = 'instapay' then v_settings.instapay_address end,
       case when v_payment = 'instapay' then v_settings.instapay_account_name end)
    returning * into v_order;

    for ln in select * from pg_temp.mp_checkout_lines l where l.seller_id = s.seller_id order by l.ord loop
      -- reserve at the showroom's location that has the units (the main location first)
      select lv.location_id into v_loc
      from public.marketplace_inventory_levels lv
      join public.marketplace_stock_locations sl on sl.id = lv.location_id and sl.is_active
      where lv.variant_id = ln.variant_id and lv.available >= ln.qty
      order by (sl.key = 'main') desc, lv.available desc
      limit 1;
      if v_loc is null then
        raise exception 'mp:insufficient_stock:%', ln.sku using errcode = '23514';
      end if;
      insert into public.marketplace_order_items
        (order_id, product_id, variant_id, location_id, sku, name_ar, name_en, selling_unit, unit_price_egp, quantity)
      values (v_order.id, ln.product_id, ln.variant_id, v_loc, ln.sku, ln.name_ar, ln.name_en, ln.selling_unit, ln.price, ln.qty);
    end loop;

    perform app.marketplace_order_stock(v_order.id, 'reserve');
    perform app.marketplace_order_event(v_order.id, 'placed', null, v_order.status, null, v_order.payment_status, 'buyer', null);
    v_out := v_out || jsonb_build_object('id', v_order.id, 'order_number', v_order.order_number, 'total_egp', v_order.total_egp,
      'payment_method', v_order.payment_method, 'deposit_egp', v_order.deposit_egp);
  end loop;

  return jsonb_build_object('checkout_id', v_checkout, 'replayed', false, 'orders', v_out);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Reading orders
-- ---------------------------------------------------------------------------
-- One order as its buyer or its showroom sees it (items, timeline, receipts, payment details).
create or replace function app.marketplace_order_document(p_order uuid, p_for text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', o.id, 'order_number', o.order_number, 'checkout_id', o.checkout_id,
    'status', o.status, 'payment_method', o.payment_method, 'payment_status', o.payment_status,
    'fulfilment', o.fulfilment, 'governorate_key', o.governorate_key, 'area_key', o.area_key, 'address_text', o.address_text,
    'buyer_name', o.buyer_name, 'buyer_phone', o.buyer_phone, 'buyer_note', o.buyer_note,
    'subtotal_egp', o.subtotal_egp, 'delivery_fee_egp', o.delivery_fee_egp, 'total_egp', o.total_egp,
    'deposit_percent', o.deposit_percent, 'deposit_egp', o.deposit_egp,
    'instapay_address', o.instapay_address, 'instapay_account_name', o.instapay_account_name,
    'cancel_reason', o.cancel_reason, 'created_at', o.created_at, 'confirmed_at', o.confirmed_at,
    'delivered_at', o.delivered_at, 'cancelled_at', o.cancelled_at,
    'seller_name', org.name,
    'pickup_address', case when o.fulfilment = 'pickup' then (
      select coalesce(b.address_ar, b.address_en) from public.marketplace_stock_locations sl
      join public.branches b on b.id = sl.branch_id
      where sl.organization_id = o.seller_organization_id and sl.is_active and sl.supports_pickup
      order by (sl.key = 'main') desc limit 1) end,
    'viewer', p_for,
    'items', coalesce((select jsonb_agg(jsonb_build_object('sku', i.sku, 'name_ar', i.name_ar, 'name_en', i.name_en,
               'selling_unit', i.selling_unit, 'unit_price_egp', i.unit_price_egp, 'quantity', i.quantity,
               'line_total_egp', i.line_total_egp) order by i.created_at, i.sku)
             from public.marketplace_order_items i where i.order_id = o.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(jsonb_build_object('action', e.action, 'to_status', e.to_status,
               'to_payment', e.to_payment, 'actor_role', e.actor_role, 'note', e.note, 'at', e.created_at) order by e.sequence)
             from public.marketplace_order_events e where e.order_id = o.id), '[]'::jsonb),
    'proofs', coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'object_key', pr.object_key, 'status', pr.status,
               'review_note', pr.review_note, 'created_at', pr.created_at) order by pr.created_at)
             from public.marketplace_payment_proofs pr where pr.order_id = o.id and pr.upload_state = 'confirmed'), '[]'::jsonb))
  from public.marketplace_orders o join public.organizations org on org.id = o.seller_organization_id
  where o.id = p_order;
$$;

create or replace function public.marketplace_buyer_orders(p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'mp:auth_required' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'total', (select count(*) from public.marketplace_orders where buyer_user_id = v_uid),
    'items', coalesce((select jsonb_agg(x order by x ->> 'created_at' desc) from (
      select jsonb_build_object('id', o.id, 'order_number', o.order_number, 'status', o.status,
        'payment_method', o.payment_method, 'payment_status', o.payment_status, 'total_egp', o.total_egp,
        'deposit_egp', o.deposit_egp, 'fulfilment', o.fulfilment, 'seller_name', org.name, 'created_at', o.created_at,
        'item_count', (select coalesce(sum(i.quantity), 0) from public.marketplace_order_items i where i.order_id = o.id)) x
      from public.marketplace_orders o join public.organizations org on org.id = o.seller_organization_id
      where o.buyer_user_id = v_uid
      order by o.created_at desc
      limit least(greatest(coalesce(p_limit, 50), 1), 100) offset greatest(coalesce(p_offset, 0), 0)) q), '[]'::jsonb));
end;
$$;

create or replace function public.marketplace_buyer_order_get(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'mp:auth_required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.marketplace_orders where id = p_order_id and buyer_user_id = (select auth.uid())) then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  return app.marketplace_order_document(p_order_id, 'buyer');
end;
$$;

-- p_status: null = all; returns { total, counts: {status: n}, items: [...] }
create or replace function public.marketplace_seller_orders_page(p_organization_id uuid, p_status text default null,
  p_limit integer default 50, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.marketplace_can_manage_orders(p_organization_id) then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'total', (select count(*) from public.marketplace_orders o
              where o.seller_organization_id = p_organization_id and (p_status is null or o.status = p_status)),
    'counts', coalesce((select jsonb_object_agg(status, n) from (
       select o.status, count(*) n from public.marketplace_orders o where o.seller_organization_id = p_organization_id
       group by o.status) c), '{}'::jsonb),
    'awaiting_review', (select count(*) from public.marketplace_orders o
       where o.seller_organization_id = p_organization_id and o.payment_status = 'deposit_submitted'),
    'items', coalesce((select jsonb_agg(x order by x ->> 'created_at' desc) from (
      select jsonb_build_object('id', o.id, 'order_number', o.order_number, 'status', o.status,
        'payment_method', o.payment_method, 'payment_status', o.payment_status, 'fulfilment', o.fulfilment,
        'total_egp', o.total_egp, 'buyer_name', o.buyer_name, 'governorate_key', o.governorate_key, 'created_at', o.created_at,
        'item_count', (select coalesce(sum(i.quantity), 0) from public.marketplace_order_items i where i.order_id = o.id)) x
      from public.marketplace_orders o
      where o.seller_organization_id = p_organization_id and (p_status is null or o.status = p_status)
      order by o.created_at desc
      limit least(greatest(coalesce(p_limit, 50), 1), 100) offset greatest(coalesce(p_offset, 0), 0)) q), '[]'::jsonb));
end;
$$;

create or replace function public.marketplace_seller_order_get(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select seller_organization_id into v_org from public.marketplace_orders where id = p_order_id;
  if v_org is null or not app.marketplace_can_manage_orders(v_org) then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  return app.marketplace_order_document(p_order_id, 'seller');
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Order changes
-- ---------------------------------------------------------------------------
-- Buyer: cancel while the showroom has not confirmed yet (the reserved units are released).
create or replace function public.marketplace_buyer_order_cancel(p_order_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.marketplace_orders;
  v_pay text;
begin
  select * into o from public.marketplace_orders where id = p_order_id and buyer_user_id = (select auth.uid()) for update;
  if not found then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  if o.status <> 'pending_confirmation' then
    raise exception 'mp:order_not_cancellable' using errcode = '23514';
  end if;
  v_pay := case when o.payment_method = 'cod' then 'not_collected'
                when o.payment_status in ('deposit_accepted', 'collected') then 'refund_due'
                else 'not_collected' end;
  perform app.marketplace_order_stock(o.id, 'release');
  update public.marketplace_orders set status = 'cancelled', payment_status = v_pay, cancelled_at = now(),
    cancel_reason = left(nullif(btrim(p_reason), ''), 300) where id = o.id;
  perform app.marketplace_order_event(o.id, 'cancelled_by_buyer', o.status, 'cancelled', o.payment_status, v_pay, 'buyer', p_reason);
  return app.marketplace_order_document(o.id, 'buyer');
end;
$$;

-- Showroom: one entry point for every fulfilment step, re-checking the order's current state.
--   confirm   pending_confirmation -> confirmed   (InstaPay: only after the deposit was accepted);
--             the reservation is consumed (units leave stock)
--   process   confirmed -> processing
--   ship      processing -> shipped              (delivery orders)
--   ready     processing -> ready_for_pickup     (pickup orders)
--   deliver   shipped | ready_for_pickup -> delivered
--   collect   delivered: payment pending / deposit_accepted -> collected
--   fail      shipped | ready_for_pickup -> delivery_failed (unpaid amount: not_collected)
--   return    delivery_failed -> returned        (units come back to stock)
--   cancel    pending_confirmation | confirmed | processing -> cancelled (reason required; units come back)
create or replace function public.marketplace_seller_order_transition(p_order_id uuid, p_action text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o      public.marketplace_orders;
  v_to   text;
  v_pay  text;
begin
  select * into o from public.marketplace_orders where id = p_order_id for update;
  if not found or not app.marketplace_can_manage_orders(o.seller_organization_id) then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  v_pay := o.payment_status;

  if p_action = 'confirm' and o.status = 'pending_confirmation' then
    if o.payment_method = 'instapay' and o.payment_status not in ('deposit_accepted', 'collected') then
      raise exception 'mp:deposit_not_accepted' using errcode = '23514';
    end if;
    v_to := 'confirmed';
    perform app.marketplace_order_stock(o.id, 'deduct');
  elsif p_action = 'process' and o.status = 'confirmed' then
    v_to := 'processing';
  elsif p_action = 'ship' and o.status = 'processing' and o.fulfilment = 'delivery' then
    v_to := 'shipped';
  elsif p_action = 'ready' and o.status = 'processing' and o.fulfilment = 'pickup' then
    v_to := 'ready_for_pickup';
  elsif p_action = 'deliver' and o.status in ('shipped', 'ready_for_pickup') then
    v_to := 'delivered';
  elsif p_action = 'collect' and o.status = 'delivered' and o.payment_status in ('pending', 'deposit_accepted') then
    v_to := o.status;
    v_pay := 'collected';
  elsif p_action = 'fail' and o.status in ('shipped', 'ready_for_pickup') then
    v_to := 'delivery_failed';
    if o.payment_status in ('pending', 'deposit_accepted') and o.payment_method = 'cod' then v_pay := 'not_collected'; end if;
  elsif p_action = 'return' and o.status = 'delivery_failed' then
    v_to := 'returned';
    perform app.marketplace_order_stock(o.id, 'replenish');
  elsif p_action = 'cancel' and o.status in ('pending_confirmation', 'confirmed', 'processing') then
    if p_note is null or char_length(btrim(p_note)) < 3 then
      raise exception 'mp:reason_required' using errcode = '22023';
    end if;
    v_to := 'cancelled';
    perform app.marketplace_order_stock(o.id, case when o.status = 'pending_confirmation' then 'release' else 'replenish' end);
    v_pay := case when o.payment_method = 'cod' then 'not_collected'
                  when o.payment_status in ('deposit_accepted', 'collected') then 'refund_due'
                  else 'not_collected' end;
  else
    raise exception 'mp:invalid_transition' using errcode = '23514';
  end if;

  update public.marketplace_orders set status = v_to, payment_status = v_pay,
    confirmed_at = case when v_to = 'confirmed' then now() else confirmed_at end,
    delivered_at = case when v_to = 'delivered' then now() else delivered_at end,
    cancelled_at = case when v_to = 'cancelled' then now() else cancelled_at end,
    cancel_reason = case when v_to = 'cancelled' then left(btrim(p_note), 300) else cancel_reason end
  where id = o.id;
  perform app.marketplace_order_event(o.id, p_action, o.status, v_to, o.payment_status, v_pay, 'seller', p_note);
  return app.marketplace_order_document(o.id, 'seller');
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. InstaPay receipts (central media system)
-- ---------------------------------------------------------------------------
-- The buyer asks to upload a receipt for an InstaPay order that is waiting for (or had rejected) its deposit.
create or replace function public.marketplace_buyer_proof_request_upload(p_order_id uuid, p_content_type text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o     public.marketplace_orders;
  v_id  uuid := gen_random_uuid();
  v_ext text;
  v_key text;
begin
  select * into o from public.marketplace_orders where id = p_order_id and buyer_user_id = (select auth.uid()) for update;
  if not found then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  if o.payment_method <> 'instapay' or o.status <> 'pending_confirmation'
     or o.payment_status not in ('awaiting_deposit', 'deposit_rejected') then
    raise exception 'mp:proof_not_expected' using errcode = '23514';
  end if;
  v_ext := case p_content_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' end;
  if v_ext is null then
    raise exception 'mp:image_type_invalid' using errcode = '22023';
  end if;
  if (select count(*) from public.marketplace_payment_proofs where order_id = o.id and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'mp:upload_rate_limited' using errcode = 'P0001';
  end if;
  v_key := 'proofs/' || o.id || '/' || v_id || '.' || v_ext;
  insert into public.marketplace_payment_proofs (id, order_id, object_key, mime_type, created_by)
  values (v_id, o.id, v_key, p_content_type, (select auth.uid()));
  return jsonb_build_object('proof_id', v_id, 'object_key', v_key);
end;
$$;

-- After the central verifier attested the bytes, the receipt is submitted for the showroom's review.
create or replace function public.marketplace_buyer_proof_confirm(p_proof_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pr public.marketplace_payment_proofs;
  o  public.marketplace_orders;
  l  public.media_storage_locations;
begin
  select * into pr from public.marketplace_payment_proofs where id = p_proof_id and created_by = (select auth.uid()) for update;
  if not found then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  select * into o from public.marketplace_orders where id = pr.order_id for update;
  if pr.upload_state = 'confirmed' then
    return app.marketplace_order_document(o.id, 'buyer');
  end if;
  if pr.upload_state <> 'awaiting_upload' or o.status <> 'pending_confirmation'
     or o.payment_status not in ('awaiting_deposit', 'deposit_rejected') then
    raise exception 'mp:proof_not_expected' using errcode = '23514';
  end if;
  select * into l from public.media_storage_locations
   where namespace = 'marketplace' and object_key = pr.object_key and verified_at is not null;
  if not found then
    raise exception 'mp:upload_not_found' using errcode = '23514';
  end if;
  update public.marketplace_payment_proofs set upload_state = 'confirmed', status = 'submitted',
    byte_size = l.size_bytes, checksum_sha256 = l.sha256 where id = pr.id;
  update public.marketplace_orders set payment_status = 'deposit_submitted' where id = o.id;
  perform app.marketplace_order_event(o.id, 'deposit_submitted', o.status, o.status, o.payment_status, 'deposit_submitted', 'buyer', null);
  return app.marketplace_order_document(o.id, 'buyer');
end;
$$;

-- The showroom accepts or rejects the latest submitted receipt. A 100 % deposit accepted = fully paid.
create or replace function public.marketplace_seller_proof_review(p_proof_id uuid, p_accept boolean, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  pr    public.marketplace_payment_proofs;
  o     public.marketplace_orders;
  v_pay text;
begin
  select * into pr from public.marketplace_payment_proofs where id = p_proof_id for update;
  if not found then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  select * into o from public.marketplace_orders where id = pr.order_id for update;
  if not app.marketplace_can_manage_orders(o.seller_organization_id) then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  if pr.upload_state <> 'confirmed' or pr.status <> 'submitted' or o.payment_status <> 'deposit_submitted'
     or o.status <> 'pending_confirmation' then
    raise exception 'mp:proof_not_reviewable' using errcode = '23514';
  end if;
  if p_accept is null or (not p_accept and (p_note is null or char_length(btrim(p_note)) < 3)) then
    raise exception 'mp:reason_required' using errcode = '22023';
  end if;
  v_pay := case when not p_accept then 'deposit_rejected' when o.deposit_percent = 100 then 'collected' else 'deposit_accepted' end;
  update public.marketplace_payment_proofs set status = case when p_accept then 'accepted' else 'rejected' end,
    reviewed_by = (select auth.uid()), reviewed_at = now(), review_note = left(nullif(btrim(p_note), ''), 300)
  where id = pr.id;
  update public.marketplace_orders set payment_status = v_pay where id = o.id;
  perform app.marketplace_order_event(o.id, case when p_accept then 'deposit_accepted' else 'deposit_rejected' end,
    o.status, o.status, o.payment_status, v_pay, 'seller', p_note);
  return app.marketplace_order_document(o.id, 'seller');
end;
$$;

-- awaiting_upload -> confirmed requires the central verification receipt for that key and owner.
create or replace function app.marketplace_proof_require_verified_media()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.upload_state = 'awaiting_upload' and new.upload_state = 'confirmed'
     and not exists (select 1 from public.media_storage_locations l
       where l.namespace = 'marketplace' and l.object_key = new.object_key
         and l.owner_user_id = new.created_by and l.content_type = new.mime_type
         and l.verified_at > now() - interval '10 minutes' and l.size_bytes > 0 and l.sha256 is not null) then
    raise exception 'stored object has not been verified' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger marketplace_proof_verified_before_confirmed before update on public.marketplace_payment_proofs
  for each row execute function app.marketplace_proof_require_verified_media();

-- The Marketplace media helpers (Migration 13) learn the receipt kind. Product photos are unchanged.
create or replace function app.marketplace_media_metadata(p_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('owner', i.created_by, 'organization', p.seller_organization_id, 'contentType', i.mime_type,
    'state', case i.upload_state when 'awaiting_upload' then 'pending' when 'confirmed' then 'ready' else 'deleted' end,
    'createdAt', i.created_at)
  from public.marketplace_product_images i join public.marketplace_products p on p.id = i.product_id
  where i.object_key = p_key
  union all
  select jsonb_build_object('owner', pr.created_by, 'organization', o.seller_organization_id, 'contentType', pr.mime_type,
    'state', case pr.upload_state when 'awaiting_upload' then 'pending' when 'confirmed' then 'ready' else 'deleted' end,
    'createdAt', pr.created_at)
  from public.marketplace_payment_proofs pr join public.marketplace_orders o on o.id = pr.order_id
  where pr.object_key = p_key;
$$;

-- Receipts: proofs/<order>/<id>.<ext> -> the buyer's documents folder u/<buyer>/certificates/<id>/original.<ext>.
create or replace function app.marketplace_media_storage_key(p_key text, p_owner uuid, p_org uuid)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  u constant text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  f text[];
begin
  f := regexp_match(p_key, '^proofs/' || u || '/(' || u || ')\.([a-z0-9]{2,5})$');
  if f is not null then
    if p_owner is null then raise exception 'unexpected media key' using errcode = '22023'; end if;
    return 'u/' || p_owner || '/certificates/' || f[1] || '/original.' || f[2];
  end if;
  f := regexp_match(p_key, '^' || u || '/(' || u || ')/(' || u || ')\.([a-z0-9]{2,5})$');
  if f is null or p_org is null then raise exception 'unexpected media key' using errcode = '22023'; end if;
  return 'o/' || p_org || '/products/' || f[1] || '/' || f[2] || '/original.' || f[3];
end;
$$;

create or replace function app.marketplace_media_cleanup_rows()
returns table (key text, owner uuid, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select i.object_key, i.created_by, i.created_at from public.marketplace_product_images i
  where i.created_by is not null
    and (i.upload_state = 'deleting' or (i.upload_state = 'awaiting_upload' and i.created_at < now() - interval '24 hours'))
  union all
  select pr.object_key, pr.created_by, pr.created_at from public.marketplace_payment_proofs pr
  where pr.upload_state = 'deleting' or (pr.upload_state = 'awaiting_upload' and pr.created_at < now() - interval '24 hours');
$$;

create or replace function app.marketplace_media_retire(p_key text, p_owner uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.marketplace_product_images set upload_state = 'deleting', status = 'rejected', is_primary = false
   where object_key = p_key and created_by = p_owner
     and (upload_state = 'deleting' or (upload_state = 'awaiting_upload' and created_at < now() - interval '24 hours'));
  if found then return true; end if;
  update public.marketplace_payment_proofs set upload_state = 'deleting'
   where object_key = p_key and created_by = p_owner
     and (upload_state = 'deleting' or (upload_state = 'awaiting_upload' and created_at < now() - interval '24 hours'));
  return found;
end;
$$;

-- Upload: product photo (Migration 13 rule) or the buyer's own, still-fresh receipt slot.
create or replace function app.marketplace_media_can_upload(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.marketplace_product_images i
    join public.marketplace_products p on p.id = i.product_id
    where i.object_key = p_key
      and i.upload_state = 'awaiting_upload'
      and i.created_at > now() - interval '1 hour'
      and app.marketplace_can_manage_catalog(p.seller_organization_id)
      and app.marketplace_seller_is_enabled(p.seller_organization_id))
  or exists (
    select 1 from public.marketplace_payment_proofs pr
    where pr.object_key = p_key and pr.upload_state = 'awaiting_upload'
      and pr.created_at > now() - interval '1 hour' and pr.created_by = (select auth.uid()));
$$;

-- Read: product photos (members, media moderators); receipts (the buyer, the showroom's order managers).
create or replace function app.marketplace_media_can_read(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.marketplace_product_images i
    join public.marketplace_products p on p.id = i.product_id
    where i.object_key = p_key and i.upload_state = 'confirmed'
      and (app.is_org_member(p.seller_organization_id) or app.has_admin_permission('marketplace_media.moderate')))
  or exists (
    select 1 from public.marketplace_payment_proofs pr join public.marketplace_orders o on o.id = pr.order_id
    where pr.object_key = p_key and pr.upload_state = 'confirmed'
      and (pr.created_by = (select auth.uid()) or app.marketplace_can_manage_orders(o.seller_organization_id)));
$$;

-- Delete: withdrawn product photos (catalogue managers) or the buyer's own unfinished receipt.
create or replace function app.marketplace_media_can_delete(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.marketplace_product_images i
    join public.marketplace_products p on p.id = i.product_id
    where i.object_key = p_key and i.upload_state in ('awaiting_upload', 'deleting')
      and app.marketplace_can_manage_catalog(p.seller_organization_id))
  or exists (
    select 1 from public.marketplace_payment_proofs pr
    where pr.object_key = p_key and pr.upload_state in ('awaiting_upload', 'deleting') and pr.created_by = (select auth.uid()));
$$;

-- ---------------------------------------------------------------------------
-- 10. Grants
-- ---------------------------------------------------------------------------
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname in ('marketplace_can_manage_orders', 'marketplace_order_event',
      'marketplace_order_stock', 'marketplace_order_document', 'marketplace_proof_require_verified_media')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.sig);
  end loop;
end;
$$;

revoke all on function
  public.marketplace_seller_payment_settings_get(uuid),
  public.marketplace_seller_payment_settings_save(uuid, jsonb),
  public.marketplace_checkout_place(jsonb, jsonb, jsonb, text),
  public.marketplace_buyer_orders(integer, integer),
  public.marketplace_buyer_order_get(uuid),
  public.marketplace_buyer_order_cancel(uuid, text),
  public.marketplace_seller_orders_page(uuid, text, integer, integer),
  public.marketplace_seller_order_get(uuid),
  public.marketplace_seller_order_transition(uuid, text, text),
  public.marketplace_buyer_proof_request_upload(uuid, text),
  public.marketplace_buyer_proof_confirm(uuid),
  public.marketplace_seller_proof_review(uuid, boolean, text)
  from public, anon, authenticated, service_role;
grant execute on function
  public.marketplace_seller_payment_settings_get(uuid),
  public.marketplace_seller_payment_settings_save(uuid, jsonb),
  public.marketplace_checkout_place(jsonb, jsonb, jsonb, text),
  public.marketplace_buyer_orders(integer, integer),
  public.marketplace_buyer_order_get(uuid),
  public.marketplace_buyer_order_cancel(uuid, text),
  public.marketplace_seller_orders_page(uuid, text, integer, integer),
  public.marketplace_seller_order_get(uuid),
  public.marketplace_seller_order_transition(uuid, text, text),
  public.marketplace_buyer_proof_request_upload(uuid, text),
  public.marketplace_buyer_proof_confirm(uuid),
  public.marketplace_seller_proof_review(uuid, boolean, text)
  to authenticated;
