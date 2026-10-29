-- ===========================================================================
-- Marketplace — Migration 12: delivery prices by area + the public cart read
-- ===========================================================================
-- WHAT THIS IS. Two things the Marketplace cart needs (docs/marketplace/MARKETPLACE.md,
-- DL-12 "Showroom sets delivery fee per zone", DL-16 "delivery fee shown separately"):
--
--   1. marketplace_delivery_rates     what each showroom charges to deliver to a
--                                     governorate (default) or to one area of it
--   2. marketplace_seller_delivery_get / _areas_save / _prices_save, marketplace_seller_pickup_set
--                                     the showroom reads its coverage + prices, chooses WHERE it delivers
--                                     (areas), sets WHAT it charges there (prices) and turns
--                                     "pick up from the showroom" on or off
--   3. marketplace_public_cart        resolves a guest's cart lines (slug + sku) against the
--                                     LIVE catalogue and prices the delivery per showroom for
--                                     the governorate / area the buyer chose
--
-- RULES (decided with the product owner)
--   * The showroom first adds the places it delivers to (areas), then prices them. A place that is
--     not added, or is added but has no price yet, is reported as "not_available" — never silently
--     priced at zero. A free delivery is an explicit 0.
--   * Resolution: the area's own price, else the governorate's default price, else not available.
--   * A cart may hold products of several showrooms: each showroom has its own delivery price for the
--     chosen area, reported per showroom; the totals are summed by the page.
--   * Pickup from the showroom is offered when the showroom has an active stock location that supports
--     pickup (marketplace_stock_locations.supports_pickup).
--   * Prices are exclusive of VAT (DL-16): the 14 % VAT line is computed by the page, not stored here.
--
-- SECURITY
--   * The price list is tenant data: RLS on, members and platform staff may SELECT; NO client write
--     grant. It changes only through marketplace_seller_delivery_areas_save / _prices_save, which re-checks authenticated +
--     active member with catalogue authority + enabled seller (the same rules as every seller write).
--   * marketplace_public_cart is granted to anon like the other public reads. It returns only what the
--     public product page already shows (published product, enabled seller, active variant, price) plus a
--     capped availability number and the per-showroom delivery answer. It exposes no organization id,
--     no stock count above a cap, and nothing about a draft / suspended / archived product — those lines
--     come back as "unavailable" with nothing else.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Delivery price list
-- ---------------------------------------------------------------------------
create table public.marketplace_delivery_rates (
  id                     uuid          primary key default gen_random_uuid(),
  seller_organization_id uuid          not null references public.organizations (id) on delete restrict,
  governorate_key        text          not null,
  -- null = the governorate's default price; otherwise the key of a city / area inside it
  area_key               text,
  -- null = the place is covered but has NO price yet (a buyer cannot choose delivery there until one is set)
  fee_egp                numeric(10,2),
  created_at             timestamptz   not null default now(),
  updated_at             timestamptz   not null default now(),
  constraint ck_marketplace_delivery_rates_fee check (fee_egp is null or (fee_egp >= 0 and fee_egp <= 100000)),
  constraint ck_marketplace_delivery_rates_gov check (governorate_key ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  constraint ck_marketplace_delivery_rates_area check (area_key is null or area_key ~ '^[a-z0-9][a-z0-9-]{0,63}$')
);
comment on table public.marketplace_delivery_rates is
  'What a showroom charges to deliver to a governorate (area_key null) or to one area of it. A row is a place the showroom covers; its price may still be unset (null). No row = the showroom does not deliver there. Keys come from app.place_governorates / app.place_cities. Written only by marketplace_seller_delivery_areas_save (places) and marketplace_seller_delivery_prices_save (prices).';
comment on column public.marketplace_delivery_rates.fee_egp is
  'EGP, exclusive of VAT. 0 is an explicit free delivery; an absent row is "does not deliver".';

create unique index ux_marketplace_delivery_rates_place
  on public.marketplace_delivery_rates (seller_organization_id, governorate_key, coalesce(area_key, ''));

create trigger set_marketplace_delivery_rates_updated_at
  before update on public.marketplace_delivery_rates
  for each row execute function app.set_updated_at();

alter table public.marketplace_delivery_rates enable row level security;
revoke all on public.marketplace_delivery_rates from public, anon, authenticated, service_role;
grant select on public.marketplace_delivery_rates to authenticated, service_role;
create policy marketplace_delivery_rates_select_owner on public.marketplace_delivery_rates
  for select to authenticated using (app.is_org_member(seller_organization_id));
create policy marketplace_delivery_rates_select_staff on public.marketplace_delivery_rates
  for select to authenticated using (app.is_admin_staff());
-- NO insert / update / delete policy and NO such grant, in any role.

-- ---------------------------------------------------------------------------
-- 2. The showroom's own price list
-- ---------------------------------------------------------------------------
create or replace function public.marketplace_seller_delivery_get(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.marketplace_assert_seller_reader(p_organization_id);
  return jsonb_build_object(
    'rates', coalesce((
      select jsonb_agg(jsonb_build_object('governorate_key', r.governorate_key, 'area_key', r.area_key, 'fee_egp', r.fee_egp)
                       order by r.governorate_key, (r.area_key is not null), r.area_key)
      from public.marketplace_delivery_rates r where r.seller_organization_id = p_organization_id), '[]'::jsonb),
    'pickup_available', exists (
      select 1 from public.marketplace_stock_locations l
      where l.organization_id = p_organization_id and l.is_active and l.supports_pickup));
end;
$$;

-- Sets WHERE the showroom delivers: replaces the set of places (a governorate, or one area inside it) in one call.
-- A place that stays keeps the price it already has; a new place starts with NO price (it is covered but cannot
-- be chosen by a buyer until a price is set); a place that is left out is removed with its price.
-- p_areas: [ { "governorate_key", "area_key"?: null | key } ]   (an empty array = delivers nowhere)
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
  return jsonb_build_object('saved', jsonb_array_length(p_areas));
end;
$$;

-- Sets WHAT the showroom charges for places it already covers (added with marketplace_seller_delivery_areas_save).
-- A null / missing fee clears the price (the place stays covered but cannot be chosen); 0 is an explicit free
-- delivery. Places that are not listed keep their price. A place that is not covered is refused, so this call can
-- never widen the showroom's coverage — and a stale price screen can never remove a place.
-- p_prices: [ { "governorate_key", "area_key"?: null | key, "fee_egp": null | 0..100000 } ]
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

  -- one transaction: a refusal anywhere rolls back every price set before it
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
  return jsonb_build_object('saved', jsonb_array_length(p_prices));
end;
$$;

-- Turns "pick up from the showroom" on or off. Pickup is a property of the showroom's stock location:
-- on = the main (default) location supports pickup; off = none of the showroom's locations does.
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
  return jsonb_build_object('pickup_available', p_enabled);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The public cart read
-- ---------------------------------------------------------------------------
-- p_lines: [ { "slug", "sku" } ]  (at most 50). The buyer's quantities stay in the browser; this
-- answers what each line is NOW (price, availability) and what delivery costs per showroom.
-- Returns { lines: [...], sellers: [...] }; a line carries `seller` = the index of its showroom in
-- `sellers`, so no organization id ever leaves the database.
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
      from sellers s join public.organizations o on o.id = s.seller_id), '[]'::jsonb))
  into v_result;
  return v_result;
end;
$$;
-- ---------------------------------------------------------------------------
-- 4. Grants
-- ---------------------------------------------------------------------------
revoke all on function
  public.marketplace_seller_delivery_get(uuid),
  public.marketplace_seller_delivery_areas_save(uuid, jsonb),
  public.marketplace_seller_delivery_prices_save(uuid, jsonb),
  public.marketplace_seller_pickup_set(uuid, boolean),
  public.marketplace_public_cart(jsonb, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.marketplace_seller_delivery_get(uuid) to authenticated;
grant execute on function public.marketplace_seller_delivery_areas_save(uuid, jsonb) to authenticated;
grant execute on function public.marketplace_seller_delivery_prices_save(uuid, jsonb) to authenticated;
grant execute on function public.marketplace_seller_pickup_set(uuid, boolean) to authenticated;
grant execute on function public.marketplace_public_cart(jsonb, text, text) to anon, authenticated;
