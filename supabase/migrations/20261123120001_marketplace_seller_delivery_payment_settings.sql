-- ===========================================================================
-- Marketplace PR 8 — seller delivery and payment settings
-- ===========================================================================
-- WHAT THIS IS. The seller-side data behind the delivery estimate, free shipping and the payment
-- methods that the public catalogue (PR 9) and the new checkout (PR 12) will read. Owner decisions,
-- Part 4A of docs/product/marketplace-requirements-walkthrough-20261119.md:
--
--   * preparation days (one number per showroom) + per-area delivery duration (min..max days):
--     the site will show "arrives in X-Y days" = preparation + duration.
--   * per-area next-day option with its own extra fee.
--   * NO daily order cut-off (owner decision 2026-11-23): the Marketplace runs 24 hours, so the estimate is
--     always preparation_days + the place's duration, with no "after the cut-off counts from tomorrow" rule.
--   * free shipping: a minimum order value (for all areas, or overridden per area) and/or a per-product flag.
--   * pickup: the existing pickup switch plus free-text pickup instructions.
--   * payment methods per showroom: cash on delivery, InstaPay (full), InstaPay deposit. DATA ONLY: the
--     checkout that reads them is a later PR.
--   * a showroom with missing delivery or payment data cannot publish: this migration only EXPOSES
--     whether the configuration is complete (app.marketplace_seller_commerce_missing and
--     public.marketplace_seller_commerce_readiness). It does NOT edit the publication gate; PR 7 owns the
--     gate and consumes that function.
--
-- EVERYTHING IS ADDITIVE. New columns are nullable or have defaults; the existing RPCs keep their
-- signatures and their old result keys (new keys are added). Nothing existing is dropped.
--
-- SECURITY. Every new table has RLS on and NO client write grant. All writes go through SECURITY
-- DEFINER RPCs that re-check authenticated + member with catalogue authority + enabled seller (payment
-- settings additionally require org.manage, as before). Every settings change appends a row to the
-- append-only marketplace_seller_settings_events trail (actor carries no foreign key: audit outlives
-- accounts).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Showroom-level delivery settings
-- ---------------------------------------------------------------------------
create table public.marketplace_seller_delivery_settings (
  seller_organization_id uuid        primary key references public.organizations (id) on delete cascade,
  -- days the showroom needs to prepare an order (0 = ships the same day). null = not set yet.
  preparation_days       smallint,
  -- orders at or above this value (EGP, excl. VAT) ship free to every covered place that has no threshold of its own
  free_shipping_min_egp  numeric(10,2),
  pickup_instructions    text,
  updated_by             uuid        references public.users (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint ck_mp_delivery_settings_prep check (preparation_days is null or preparation_days between 0 and 30),
  constraint ck_mp_delivery_settings_free check (free_shipping_min_egp is null or (free_shipping_min_egp > 0 and free_shipping_min_egp <= 1000000)),
  constraint ck_mp_delivery_settings_pickup check (pickup_instructions is null or char_length(btrim(pickup_instructions)) between 1 and 300)
);
comment on table public.marketplace_seller_delivery_settings is
  'Per-showroom delivery settings: preparation days, free-shipping minimum order value, pickup instructions. No client write grant; written only by marketplace_seller_delivery_terms_save.';
create trigger set_mp_delivery_settings_updated_at
  before update on public.marketplace_seller_delivery_settings
  for each row execute function app.set_updated_at();

alter table public.marketplace_seller_delivery_settings enable row level security;
revoke all on public.marketplace_seller_delivery_settings from public, anon, authenticated, service_role;
grant select on public.marketplace_seller_delivery_settings to authenticated, service_role;
create policy mp_delivery_settings_select_owner on public.marketplace_seller_delivery_settings
  for select to authenticated using (app.is_org_member(seller_organization_id));
create policy mp_delivery_settings_select_staff on public.marketplace_seller_delivery_settings
  for select to authenticated using (app.is_admin_staff());

-- ---------------------------------------------------------------------------
-- 2. Per-area delivery terms (extends the price list of Migration 12)
-- ---------------------------------------------------------------------------
alter table public.marketplace_delivery_rates
  add column duration_min_days    smallint,
  add column duration_max_days    smallint,
  add column next_day_available   boolean       not null default false,
  add column next_day_fee_egp     numeric(10,2),
  add column free_shipping_min_egp numeric(10,2);

alter table public.marketplace_delivery_rates
  add constraint ck_mp_delivery_rates_duration check (
    (duration_min_days is null and duration_max_days is null)
    or (duration_min_days is not null and duration_max_days is not null
        and duration_min_days between 0 and 30 and duration_max_days between duration_min_days and 30)),
  add constraint ck_mp_delivery_rates_next_day check (
    (not next_day_available and next_day_fee_egp is null)
    or (next_day_available and next_day_fee_egp is not null and next_day_fee_egp between 0 and 100000)),
  add constraint ck_mp_delivery_rates_free check (
    free_shipping_min_egp is null or (free_shipping_min_egp > 0 and free_shipping_min_egp <= 1000000));

comment on column public.marketplace_delivery_rates.duration_min_days is
  'Delivery duration to this place in days (min..max), counted after preparation. Both null = not set.';
comment on column public.marketplace_delivery_rates.next_day_available is
  'The showroom offers next-day delivery to this place for next_day_fee_egp on top of fee_egp.';
comment on column public.marketplace_delivery_rates.free_shipping_min_egp is
  'Free shipping to this place for orders at or above this value (EGP, excl. VAT). null = use the showroom-wide minimum, if any.';

-- ---------------------------------------------------------------------------
-- 3. Per-product free shipping (a row = the product always ships free)
-- ---------------------------------------------------------------------------
create table public.marketplace_free_shipping_products (
  product_id             uuid        primary key,
  seller_organization_id uuid        not null,
  created_by             uuid        references public.users (id) on delete set null,
  created_at             timestamptz not null default now(),
  constraint fk_mp_free_shipping_product foreign key (product_id, seller_organization_id)
    references public.marketplace_products (id, seller_organization_id) on delete cascade
);
comment on table public.marketplace_free_shipping_products is
  'Products the showroom ships free (the per-product free-shipping flag). A row exists = free shipping. Written only by marketplace_seller_product_free_shipping_set.';
create index ix_mp_free_shipping_products_seller on public.marketplace_free_shipping_products (seller_organization_id);

alter table public.marketplace_free_shipping_products enable row level security;
revoke all on public.marketplace_free_shipping_products from public, anon, authenticated, service_role;
grant select on public.marketplace_free_shipping_products to authenticated, service_role;
create policy mp_free_shipping_select_owner on public.marketplace_free_shipping_products
  for select to authenticated using (app.is_org_member(seller_organization_id));
create policy mp_free_shipping_select_staff on public.marketplace_free_shipping_products
  for select to authenticated using (app.is_admin_staff());

-- ---------------------------------------------------------------------------
-- 4. Payment: InstaPay (full) next to the existing InstaPay deposit
-- ---------------------------------------------------------------------------
-- instapay_enabled keeps meaning "InstaPay deposit" (it needs the deposit share). instapay_full_enabled is
-- paying the whole order by InstaPay; it needs the InstaPay address and account name, not a share.
alter table public.marketplace_seller_payment_settings
  add column instapay_full_enabled boolean not null default false;
alter table public.marketplace_seller_payment_settings
  add constraint ck_mp_pay_full_complete check (not instapay_full_enabled
    or (instapay_address is not null and instapay_account_name is not null));
comment on column public.marketplace_seller_payment_settings.instapay_full_enabled is
  'The buyer may pay the full order amount by InstaPay (needs instapay_address and instapay_account_name). instapay_enabled remains the InstaPay DEPOSIT method.';

-- ---------------------------------------------------------------------------
-- 5. Append-only audit trail of settings changes
-- ---------------------------------------------------------------------------
create table public.marketplace_seller_settings_events (
  id                     bigint      generated always as identity primary key,
  at                     timestamptz not null default now(),
  seller_organization_id uuid        not null,
  kind                   text        not null,
  actor_id               uuid,
  summary                jsonb       not null default '{}'::jsonb,
  constraint ck_mp_settings_events_kind check (kind in ('delivery_areas', 'delivery_prices', 'delivery_terms', 'pickup', 'payment', 'free_shipping_product'))
);
comment on table public.marketplace_seller_settings_events is
  'Append-only history of showroom delivery / payment settings changes. No foreign keys on organization or actor: audit outlives accounts. summary holds the new values (no personal data).';
create index ix_mp_settings_events_seller on public.marketplace_seller_settings_events (seller_organization_id, at desc);

create or replace function app.marketplace_settings_events_append_only()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = '23514';
end;
$$;
revoke all on function app.marketplace_settings_events_append_only() from public, anon, authenticated, service_role;
create trigger mp_settings_events_append_only
  before update or delete on public.marketplace_seller_settings_events
  for each row execute function app.marketplace_settings_events_append_only();

alter table public.marketplace_seller_settings_events enable row level security;
revoke all on public.marketplace_seller_settings_events from public, anon, authenticated, service_role;
grant select on public.marketplace_seller_settings_events to authenticated, service_role;
create policy mp_settings_events_select_owner on public.marketplace_seller_settings_events
  for select to authenticated using (app.is_org_member(seller_organization_id));
create policy mp_settings_events_select_staff on public.marketplace_seller_settings_events
  for select to authenticated using (app.is_admin_staff());

create or replace function app.marketplace_settings_event(p_org uuid, p_kind text, p_summary jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.marketplace_seller_settings_events (seller_organization_id, kind, actor_id, summary)
  values (p_org, p_kind, (select auth.uid()), coalesce(p_summary, '{}'::jsonb));
$$;
revoke all on function app.marketplace_settings_event(uuid, text, jsonb) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Is the showroom's delivery + payment configuration complete?
-- ---------------------------------------------------------------------------
-- CONTRACT (consumed by the publication gate, PR 7). Returns the list of missing-data codes; an empty
-- array = complete. Codes:
--   preparation_days_missing        preparation days not set
--   delivery_option_missing         no covered place and pickup is off (the buyer could not receive anything)
--   delivery_area_unpriced          at least one covered place has no delivery fee
--   delivery_area_duration_missing  at least one covered place has no delivery duration
--   payment_method_missing          none of COD / InstaPay / InstaPay deposit is enabled
-- Free shipping, next-day options and pickup instructions are optional.
create or replace function app.marketplace_seller_commerce_missing(p_org uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select array_remove(array[
    case when not exists (select 1 from public.marketplace_seller_delivery_settings s
                          where s.seller_organization_id = p_org and s.preparation_days is not null)
         then 'preparation_days_missing' end,
    case when not exists (select 1 from public.marketplace_delivery_rates r where r.seller_organization_id = p_org)
          and not exists (select 1 from public.marketplace_stock_locations l
                          where l.organization_id = p_org and l.is_active and l.supports_pickup)
         then 'delivery_option_missing' end,
    case when exists (select 1 from public.marketplace_delivery_rates r
                      where r.seller_organization_id = p_org and r.fee_egp is null)
         then 'delivery_area_unpriced' end,
    case when exists (select 1 from public.marketplace_delivery_rates r
                      where r.seller_organization_id = p_org and r.duration_min_days is null)
         then 'delivery_area_duration_missing' end,
    case when not exists (select 1 from public.marketplace_seller_payment_settings ps
                          where ps.seller_organization_id = p_org
                            and (ps.cod_enabled or ps.instapay_enabled or ps.instapay_full_enabled))
         then 'payment_method_missing' end
  ], null);
$$;
revoke all on function app.marketplace_seller_commerce_missing(uuid) from public, anon, authenticated, service_role;
comment on function app.marketplace_seller_commerce_missing(uuid) is
  'Missing delivery / payment configuration codes for a showroom (empty = complete). Internal: called by the publication gate and marketplace_seller_commerce_readiness; no client grant.';

create or replace function public.marketplace_seller_commerce_readiness(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_missing text[];
begin
  perform app.marketplace_assert_seller_reader(p_organization_id);
  v_missing := app.marketplace_seller_commerce_missing(p_organization_id);
  return jsonb_build_object(
    'complete', cardinality(v_missing) = 0,
    'delivery_complete', not exists (select 1 from unnest(v_missing) m where m <> 'payment_method_missing'),
    'payment_complete', not ('payment_method_missing' = any (v_missing)),
    'missing', to_jsonb(v_missing));
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Delivery read (superset of Migration 12's result)
-- ---------------------------------------------------------------------------
create or replace function public.marketplace_seller_delivery_get(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.marketplace_seller_delivery_settings;
begin
  perform app.marketplace_assert_seller_reader(p_organization_id);
  select * into s from public.marketplace_seller_delivery_settings where seller_organization_id = p_organization_id;
  return jsonb_build_object(
    'rates', coalesce((
      select jsonb_agg(jsonb_build_object(
               'governorate_key', r.governorate_key, 'area_key', r.area_key, 'fee_egp', r.fee_egp,
               'duration_min_days', r.duration_min_days, 'duration_max_days', r.duration_max_days,
               'next_day_available', r.next_day_available, 'next_day_fee_egp', r.next_day_fee_egp,
               'free_shipping_min_egp', r.free_shipping_min_egp)
             order by r.governorate_key, (r.area_key is not null), r.area_key)
      from public.marketplace_delivery_rates r where r.seller_organization_id = p_organization_id), '[]'::jsonb),
    'pickup_available', exists (
      select 1 from public.marketplace_stock_locations l
      where l.organization_id = p_organization_id and l.is_active and l.supports_pickup),
    'settings', jsonb_build_object(
      'preparation_days', s.preparation_days,
      'free_shipping_min_egp', s.free_shipping_min_egp,
      'pickup_instructions', s.pickup_instructions),
    'free_shipping_product_count', (select count(*) from public.marketplace_free_shipping_products f where f.seller_organization_id = p_organization_id),
    'missing', to_jsonb(app.marketplace_seller_commerce_missing(p_organization_id)));
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Delivery terms save: showroom settings + per-place fee / duration / next-day / free-shipping minimum
-- ---------------------------------------------------------------------------
-- p_settings (object; a missing key keeps the stored value, an explicit null clears it):
--   { preparation_days: 0..30, free_shipping_min_egp: >0..1000000, pickup_instructions: text<=300 }
-- p_areas (array or null = leave places untouched). Each element REPLACES that place's terms (a missing key = cleared):
--   { governorate_key, area_key?, fee_egp, duration_min_days, duration_max_days, next_day_available, next_day_fee_egp, free_shipping_min_egp }
-- A place that is not covered is refused (this call can never widen the coverage). One transaction: any refusal
-- rolls back everything.
create or replace function public.marketplace_seller_delivery_terms_save(p_organization_id uuid, p_settings jsonb, p_areas jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid;
  s       public.marketplace_seller_delivery_settings;
  v_prep  smallint;
  v_free  numeric;
  v_note  text;
  e       jsonb;
  i       integer := 0;
  v_gov   text;
  v_area  text;
  v_fee   text;
  v_min   text;
  v_max   text;
  v_nd    boolean;
  v_ndfee text;
  v_afree text;
  v_seen  text[] := '{}';
  v_key   text;
  v_n     integer := 0;
begin
  v_uid := app.marketplace_assert_seller_writer(p_organization_id);
  p_settings := coalesce(p_settings, '{}'::jsonb);
  if jsonb_typeof(p_settings) <> 'object' or (p_areas is not null and jsonb_typeof(p_areas) <> 'array') then
    raise exception 'mp:delivery_invalid' using errcode = '22023';
  end if;
  if p_areas is not null and jsonb_array_length(p_areas) > 2000 then
    raise exception 'mp:delivery_too_many' using errcode = '22023';
  end if;

  select * into s from public.marketplace_seller_delivery_settings where seller_organization_id = p_organization_id;
  v_prep := s.preparation_days;
  v_free := s.free_shipping_min_egp;
  v_note := s.pickup_instructions;

  if p_settings ? 'preparation_days' then
    if jsonb_typeof(p_settings -> 'preparation_days') = 'null' then v_prep := null;
    elsif (p_settings ->> 'preparation_days') ~ '^[0-9]{1,2}$' and (p_settings ->> 'preparation_days')::integer <= 30 then
      v_prep := (p_settings ->> 'preparation_days')::smallint;
    else raise exception 'mp:preparation_days_invalid' using errcode = '22023';
    end if;
  end if;
  if p_settings ? 'free_shipping_min_egp' then
    if jsonb_typeof(p_settings -> 'free_shipping_min_egp') = 'null' then v_free := null;
    elsif (p_settings ->> 'free_shipping_min_egp') ~ '^[0-9]{1,7}(\.[0-9]{1,2})?$'
          and (p_settings ->> 'free_shipping_min_egp')::numeric between 0.01 and 1000000 then
      v_free := (p_settings ->> 'free_shipping_min_egp')::numeric;
    else raise exception 'mp:free_shipping_invalid' using errcode = '22023';
    end if;
  end if;
  if p_settings ? 'pickup_instructions' then
    if jsonb_typeof(p_settings -> 'pickup_instructions') = 'null' then v_note := null;
    elsif jsonb_typeof(p_settings -> 'pickup_instructions') = 'string' then
      v_note := nullif(btrim(p_settings ->> 'pickup_instructions'), '');
      if v_note is not null and char_length(v_note) > 300 then
        raise exception 'mp:pickup_instructions_invalid' using errcode = '22023';
      end if;
    else raise exception 'mp:pickup_instructions_invalid' using errcode = '22023';
    end if;
  end if;

  insert into public.marketplace_seller_delivery_settings as t
    (seller_organization_id, preparation_days, free_shipping_min_egp, pickup_instructions, updated_by)
  values (p_organization_id, v_prep, v_free, v_note, v_uid)
  on conflict (seller_organization_id) do update set
    preparation_days = excluded.preparation_days,
    free_shipping_min_egp = excluded.free_shipping_min_egp, pickup_instructions = excluded.pickup_instructions,
    updated_by = excluded.updated_by;

  if p_areas is not null then
    for e in select * from jsonb_array_elements(p_areas) loop
      i := i + 1;
      if jsonb_typeof(e) <> 'object' then
        raise exception 'mp:delivery_invalid:%', i using errcode = '22023';
      end if;
      v_gov  := nullif(btrim(lower(e ->> 'governorate_key')), '');
      v_area := nullif(btrim(lower(e ->> 'area_key')), '');
      v_fee  := e ->> 'fee_egp';
      v_min  := e ->> 'duration_min_days';
      v_max  := e ->> 'duration_max_days';
      v_ndfee := e ->> 'next_day_fee_egp';
      v_afree := e ->> 'free_shipping_min_egp';
      if e ? 'next_day_available' and jsonb_typeof(e -> 'next_day_available') not in ('boolean', 'null') then
        raise exception 'mp:next_day_invalid:%', i using errcode = '22023';
      end if;
      v_nd := coalesce((e ->> 'next_day_available')::boolean, false);
      if v_gov is null or not exists (select 1 from app.place_governorates g where g.key = v_gov) then
        raise exception 'mp:delivery_location_invalid:%', coalesce(v_gov, '') using errcode = '22023';
      end if;
      if v_area is not null and not exists (select 1 from app.place_cities c where c.governorate_key = v_gov and c.key = v_area) then
        raise exception 'mp:delivery_location_invalid:%/%', v_gov, v_area using errcode = '22023';
      end if;
      v_key := v_gov || '/' || coalesce(v_area, '');
      if v_key = any (v_seen) then
        raise exception 'mp:delivery_duplicate:%', v_key using errcode = '23505';
      end if;
      v_seen := array_append(v_seen, v_key);
      if v_fee is not null and (v_fee !~ '^[0-9]{1,6}(\.[0-9]{1,2})?$' or v_fee::numeric > 100000) then
        raise exception 'mp:delivery_fee_invalid:%', i using errcode = '22023';
      end if;
      if (v_min is null) <> (v_max is null)
         or (v_min is not null and (v_min !~ '^[0-9]{1,2}$' or v_max !~ '^[0-9]{1,2}$'
                                    or v_min::integer > 30 or v_max::integer > 30 or v_min::integer > v_max::integer)) then
        raise exception 'mp:duration_invalid:%', i using errcode = '22023';
      end if;
      if v_nd and (v_ndfee is null or v_ndfee !~ '^[0-9]{1,6}(\.[0-9]{1,2})?$' or v_ndfee::numeric > 100000) then
        raise exception 'mp:next_day_fee_invalid:%', i using errcode = '22023';
      end if;
      if not v_nd and v_ndfee is not null then
        raise exception 'mp:next_day_fee_invalid:%', i using errcode = '22023';
      end if;
      if v_afree is not null and (v_afree !~ '^[0-9]{1,7}(\.[0-9]{1,2})?$' or v_afree::numeric not between 0.01 and 1000000) then
        raise exception 'mp:free_shipping_invalid:%', i using errcode = '22023';
      end if;
      update public.marketplace_delivery_rates r set
        fee_egp = v_fee::numeric,
        duration_min_days = v_min::smallint, duration_max_days = v_max::smallint,
        next_day_available = v_nd, next_day_fee_egp = v_ndfee::numeric,
        free_shipping_min_egp = v_afree::numeric
       where r.seller_organization_id = p_organization_id and r.governorate_key = v_gov
         and coalesce(r.area_key, '') = coalesce(v_area, '');
      if not found then
        raise exception 'mp:delivery_area_unknown:%', v_key using errcode = '22023';
      end if;
      v_n := v_n + 1;
    end loop;
  end if;

  perform app.marketplace_settings_event(p_organization_id, 'delivery_terms', jsonb_build_object(
    'preparation_days', v_prep,
    'free_shipping_min_egp', v_free, 'places_updated', v_n));
  return public.marketplace_seller_delivery_get(p_organization_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. Per-product free shipping
-- ---------------------------------------------------------------------------
create or replace function public.marketplace_seller_free_shipping_products_get(p_organization_id uuid, p_search text default null, p_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_search text := nullif(btrim(p_search), '');
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  perform app.marketplace_assert_seller_reader(p_organization_id);
  if v_search is not null and char_length(v_search) > 100 then
    raise exception 'mp:search_invalid' using errcode = '22023';
  end if;
  if v_search is not null then
    v_search := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  return jsonb_build_object(
    'flagged_count', (select count(*) from public.marketplace_free_shipping_products f where f.seller_organization_id = p_organization_id),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object('id', x.id, 'name_ar', x.name_ar, 'name_en', x.name_en, 'status', x.status,
                                          'free_shipping', x.free_shipping) order by x.free_shipping desc, x.name_en, x.id)
      from (
        select p.id, p.name_ar, p.name_en, p.status, (f.product_id is not null) as free_shipping
        from public.marketplace_products p
        left join public.marketplace_free_shipping_products f on f.product_id = p.id
        where p.seller_organization_id = p_organization_id and p.status <> 'archived'
          and (v_search is null or p.name_ar ilike v_search or p.name_en ilike v_search)
        order by (f.product_id is not null) desc, p.name_en, p.id
        limit v_limit) x), '[]'::jsonb));
end;
$$;

create or replace function public.marketplace_seller_product_free_shipping_set(p_organization_id uuid, p_product_id uuid, p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
begin
  v_uid := app.marketplace_assert_seller_writer(p_organization_id);
  if p_enabled is null or p_product_id is null then
    raise exception 'mp:free_shipping_invalid' using errcode = '22023';
  end if;
  if not exists (select 1 from public.marketplace_products p
                 where p.id = p_product_id and p.seller_organization_id = p_organization_id) then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  if p_enabled then
    insert into public.marketplace_free_shipping_products (product_id, seller_organization_id, created_by)
    values (p_product_id, p_organization_id, v_uid)
    on conflict (product_id) do nothing;
  else
    delete from public.marketplace_free_shipping_products where product_id = p_product_id;
  end if;
  perform app.marketplace_settings_event(p_organization_id, 'free_shipping_product',
    jsonb_build_object('product_id', p_product_id, 'free_shipping', p_enabled));
  return jsonb_build_object('product_id', p_product_id, 'free_shipping', p_enabled);
end;
$$;

-- ---------------------------------------------------------------------------
-- 10. Existing writers: same behaviour, now audited
-- ---------------------------------------------------------------------------
create or replace function public.marketplace_seller_delivery_areas_save(p_organization_id uuid, p_areas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  e      jsonb;
  i      integer := 0;
  v_gov  text;
  v_area text;
  v_seen text[] := '{}';
  v_key  text;
begin
  perform app.marketplace_assert_seller_writer(p_organization_id);
  if p_areas is null or jsonb_typeof(p_areas) <> 'array' then
    raise exception 'mp:delivery_invalid' using errcode = '22023';
  end if;
  if jsonb_array_length(p_areas) > 2000 then
    raise exception 'mp:delivery_too_many' using errcode = '22023';
  end if;

  for e in select * from jsonb_array_elements(p_areas) loop
    i := i + 1;
    if jsonb_typeof(e) <> 'object' then
      raise exception 'mp:delivery_invalid:%', i using errcode = '22023';
    end if;
    v_gov := nullif(btrim(lower(e ->> 'governorate_key')), '');
    v_area := nullif(btrim(lower(e ->> 'area_key')), '');
    if v_gov is null or not exists (select 1 from app.place_governorates g where g.key = v_gov) then
      raise exception 'mp:delivery_location_invalid:%', coalesce(v_gov, '') using errcode = '22023';
    end if;
    if v_area is not null and not exists (select 1 from app.place_cities c where c.governorate_key = v_gov and c.key = v_area) then
      raise exception 'mp:delivery_location_invalid:%/%', v_gov, v_area using errcode = '22023';
    end if;
    v_key := v_gov || '/' || coalesce(v_area, '');
    if v_key = any (v_seen) then
      raise exception 'mp:delivery_duplicate:%', v_key using errcode = '23505';
    end if;
    v_seen := array_append(v_seen, v_key);
  end loop;

  delete from public.marketplace_delivery_rates r
   where r.seller_organization_id = p_organization_id
     and (r.governorate_key || '/' || coalesce(r.area_key, '')) <> all (v_seen);
  insert into public.marketplace_delivery_rates (seller_organization_id, governorate_key, area_key, fee_egp)
  select p_organization_id, lower(btrim(x ->> 'governorate_key')), nullif(lower(btrim(x ->> 'area_key')), ''), null
  from jsonb_array_elements(p_areas) x
  on conflict (seller_organization_id, governorate_key, (coalesce(area_key, ''))) do nothing;
  perform app.marketplace_settings_event(p_organization_id, 'delivery_areas', jsonb_build_object('places', jsonb_array_length(p_areas)));
  return jsonb_build_object('saved', jsonb_array_length(p_areas));
end;
$$;

create or replace function public.marketplace_seller_delivery_prices_save(p_organization_id uuid, p_prices jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  e      jsonb;
  i      integer := 0;
  v_gov  text;
  v_area text;
  v_fee  text;
  v_seen text[] := '{}';
  v_key  text;
begin
  perform app.marketplace_assert_seller_writer(p_organization_id);
  if p_prices is null or jsonb_typeof(p_prices) <> 'array' then
    raise exception 'mp:delivery_invalid' using errcode = '22023';
  end if;
  if jsonb_array_length(p_prices) > 2000 then
    raise exception 'mp:delivery_too_many' using errcode = '22023';
  end if;

  for e in select * from jsonb_array_elements(p_prices) loop
    i := i + 1;
    if jsonb_typeof(e) <> 'object' then
      raise exception 'mp:delivery_invalid:%', i using errcode = '22023';
    end if;
    v_gov := nullif(btrim(lower(e ->> 'governorate_key')), '');
    v_area := nullif(btrim(lower(e ->> 'area_key')), '');
    v_fee := e ->> 'fee_egp';
    if v_fee is not null and (v_fee !~ '^[0-9]{1,6}(\.[0-9]{1,2})?$' or v_fee::numeric > 100000) then
      raise exception 'mp:delivery_fee_invalid:%', i using errcode = '22023';
    end if;
    if v_gov is null or not exists (select 1 from app.place_governorates g where g.key = v_gov) then
      raise exception 'mp:delivery_location_invalid:%', coalesce(v_gov, '') using errcode = '22023';
    end if;
    if v_area is not null and not exists (select 1 from app.place_cities c where c.governorate_key = v_gov and c.key = v_area) then
      raise exception 'mp:delivery_location_invalid:%/%', v_gov, v_area using errcode = '22023';
    end if;
    v_key := v_gov || '/' || coalesce(v_area, '');
    if v_key = any (v_seen) then
      raise exception 'mp:delivery_duplicate:%', v_key using errcode = '23505';
    end if;
    v_seen := array_append(v_seen, v_key);
    update public.marketplace_delivery_rates r set fee_egp = v_fee::numeric
     where r.seller_organization_id = p_organization_id and r.governorate_key = v_gov and coalesce(r.area_key, '') = coalesce(v_area, '');
    if not found then
      raise exception 'mp:delivery_area_unknown:%', v_key using errcode = '22023';
    end if;
  end loop;
  perform app.marketplace_settings_event(p_organization_id, 'delivery_prices', jsonb_build_object('places', jsonb_array_length(p_prices)));
  return jsonb_build_object('saved', jsonb_array_length(p_prices));
end;
$$;

create or replace function public.marketplace_seller_pickup_set(p_organization_id uuid, p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_location uuid;
begin
  perform app.marketplace_assert_seller_writer(p_organization_id);
  if p_enabled is null then
    raise exception 'mp:pickup_invalid' using errcode = '22023';
  end if;
  if p_enabled then
    v_location := public.marketplace_seller_default_location(p_organization_id);
    update public.marketplace_stock_locations set supports_pickup = true where id = v_location;
  else
    update public.marketplace_stock_locations set supports_pickup = false
     where organization_id = p_organization_id and supports_pickup;
  end if;
  perform app.marketplace_settings_event(p_organization_id, 'pickup', jsonb_build_object('enabled', p_enabled));
  return jsonb_build_object('pickup_available', p_enabled);
end;
$$;

-- ---------------------------------------------------------------------------
-- 11. Payment settings: InstaPay (full) + audit
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
    'instapay_full_enabled', coalesce(s.instapay_full_enabled, false),
    'instapay_address', s.instapay_address,
    'instapay_account_name', s.instapay_account_name,
    'instapay_deposit_percent', s.instapay_deposit_percent,
    'can_edit', app.has_capability(p_organization_id, 'org.manage'));
end;
$$;

-- p_settings: { cod_enabled, instapay_enabled (deposit), instapay_full_enabled, instapay_address, instapay_account_name,
--               instapay_deposit_percent }. instapay_full_enabled is optional: a caller that does not send it keeps the stored value.
create or replace function public.marketplace_seller_payment_settings_save(p_organization_id uuid, p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid;
  v_old  public.marketplace_seller_payment_settings;
  k      text;
  v_cod  boolean;
  v_ip   boolean;
  v_full boolean;
  v_addr text;
  v_name text;
  v_pct  integer;
begin
  v_uid := app.marketplace_assert_seller_writer(p_organization_id);
  if not app.has_capability(p_organization_id, 'org.manage') then
    raise exception 'mp:not_permitted' using errcode = '42501';
  end if;
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    raise exception 'mp:invalid_payload' using errcode = '22023';
  end if;
  foreach k in array array['cod_enabled', 'instapay_enabled', 'instapay_full_enabled'] loop
    if p_settings ? k and jsonb_typeof(p_settings -> k) not in ('boolean', 'null') then
      raise exception 'mp:invalid_payload' using errcode = '22023';
    end if;
  end loop;
  select * into v_old from public.marketplace_seller_payment_settings where seller_organization_id = p_organization_id;
  v_cod  := coalesce((p_settings ->> 'cod_enabled')::boolean, false);
  v_ip   := coalesce((p_settings ->> 'instapay_enabled')::boolean, false);
  v_full := case when p_settings ? 'instapay_full_enabled' then coalesce((p_settings ->> 'instapay_full_enabled')::boolean, false)
                 else coalesce(v_old.instapay_full_enabled, false) end;
  v_addr := nullif(btrim(p_settings ->> 'instapay_address'), '');
  v_name := nullif(btrim(p_settings ->> 'instapay_account_name'), '');
  if coalesce(p_settings ->> 'instapay_deposit_percent', '') ~ '^[0-9]{1,3}$' then
    v_pct := (p_settings ->> 'instapay_deposit_percent')::integer;
  end if;
  if (v_ip or v_full) and (v_addr is null or char_length(v_addr) not between 3 and 100) then
    raise exception 'mp:instapay_address_required' using errcode = '23514';
  end if;
  if (v_ip or v_full) and (v_name is null or char_length(v_name) not between 2 and 100) then
    raise exception 'mp:instapay_name_required' using errcode = '23514';
  end if;
  if v_ip and (v_pct is null or v_pct not between 1 and 100) then
    raise exception 'mp:deposit_percent_invalid' using errcode = '23514';
  end if;
  insert into public.marketplace_seller_payment_settings as s
    (seller_organization_id, cod_enabled, instapay_enabled, instapay_full_enabled, instapay_address, instapay_account_name, instapay_deposit_percent, updated_by)
  values (p_organization_id, v_cod, v_ip, v_full, v_addr, v_name, v_pct, v_uid)
  on conflict (seller_organization_id) do update set
    cod_enabled = excluded.cod_enabled, instapay_enabled = excluded.instapay_enabled,
    instapay_full_enabled = excluded.instapay_full_enabled,
    instapay_address = excluded.instapay_address, instapay_account_name = excluded.instapay_account_name,
    instapay_deposit_percent = excluded.instapay_deposit_percent, updated_by = excluded.updated_by;
  perform app.marketplace_settings_event(p_organization_id, 'payment', jsonb_build_object(
    'cod_enabled', v_cod, 'instapay_enabled', v_ip, 'instapay_full_enabled', v_full, 'instapay_deposit_percent', v_pct));
  return public.marketplace_seller_payment_settings_get(p_organization_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. Grants (authenticated only; the internal helpers have none)
-- ---------------------------------------------------------------------------
revoke all on function
  public.marketplace_seller_commerce_readiness(uuid),
  public.marketplace_seller_delivery_terms_save(uuid, jsonb, jsonb),
  public.marketplace_seller_free_shipping_products_get(uuid, text, integer),
  public.marketplace_seller_product_free_shipping_set(uuid, uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.marketplace_seller_commerce_readiness(uuid) to authenticated;
grant execute on function public.marketplace_seller_delivery_terms_save(uuid, jsonb, jsonb) to authenticated;
grant execute on function public.marketplace_seller_free_shipping_products_get(uuid, text, integer) to authenticated;
grant execute on function public.marketplace_seller_product_free_shipping_set(uuid, uuid, boolean) to authenticated;
