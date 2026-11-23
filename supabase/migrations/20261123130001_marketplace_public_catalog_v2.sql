-- ===========================================================================
-- Marketplace PR 9 — public catalog and product page v2 (browse-only first launch)
-- ===========================================================================
-- WHAT THIS IS. The public read side behind the new Amazon-sized card, the product page's delivery-details
-- block, the seller storefront and the closed state. Owner decisions, Part 4A of
-- docs/product/marketplace-requirements-walkthrough-20261119.md.
--
-- ORDER OF MERGE. PR 7 (#241, 20261123110001: open/close switch, seller visibility and on-shelf rule) MUST be applied
--   before this one; this migration calls its app.marketplace_is_open / marketplace_seller_is_public /
--   marketplace_product_is_listed directly. PR 8 (#240, 20261123120001, delivery + payment settings) should be
--   applied before too; without it the delivery columns/tables do not exist and the delivery terms say
--   configured = false (fee and pickup only), detected at run time (to_regclass / pg_attribute).
--   PR 5 / PR 6 : not read here (seller approval is behind marketplace_seller_is_public; media verification is
--   app.marketplace_media_verification_ready(), unconditional since PR 6).
--
-- COMPATIBILITY. Nothing is dropped. marketplace_public_facets(text), marketplace_public_product(text) and
-- marketplace_public_catalog_page(...10 args) keep their signatures, grants and old result keys (new keys added),
-- so the application that is promoted before this migration keeps working. The new storefront calls the new
-- marketplace_public_browse. PR 7 patches the public functions in place by text; this migration REPLACES the
-- three above with definitions that already carry the open/close gate and the stock withdrawal, and
-- marketplace_public_catalog and marketplace_public_cart (not redefined here) keep PR 7's patched bodies.
--
-- BROWSE ONLY. Nothing here prices a cart or places an order. The delivery block only informs.
-- Buyer contact with a showroom is NOT decided by the owner, so no function here returns a showroom phone/e-mail.
--
-- DELIVERY ESTIMATE (rules from PR 8's contract, applied as written there):
--   row         = the buyer's area row, else the governorate row, and it must carry a fee;
--   estimate    = today (Africa/Cairo) + preparation_days + duration_min..max (calendar days); NO order cut-off (24h Marketplace);
--   next day    = the row's optional next-day option arrives the day after today, for its extra fee;
--   free ship   = product flagged, OR the chosen row's fee is 0, OR order value >= the row's free_shipping_min_egp,
--                 else the showroom-wide minimum. A card/page judges one unit of the product.
--   no area yet = a range over all the showroom's covered places (fastest..slowest) and a fee range.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Internal helpers (no client grant). The open switch, seller visibility and the on-shelf rule are PR 7's
--    app.marketplace_is_open / marketplace_seller_is_public / marketplace_product_is_listed (hard dependency: #241 first).
-- ---------------------------------------------------------------------------
-- Units left across the active variants, only when 3 or fewer (a card says "Only N left"; larger stock is never published).
create or replace function app.marketplace_public_stock_left(p_product_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when s.n between 1 and 3 then s.n::integer end
  from (select coalesce(sum(greatest(app.marketplace_variant_available(v.id), 0)), 0) as n
        from public.marketplace_product_variants v
        where v.product_id = p_product_id and v.status = 'active') s;
$$;

-- The per-product free-shipping flag (PR 8). False when PR 8 is not applied.
create or replace function app.marketplace_product_ships_free(p_product_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if to_regclass('public.marketplace_free_shipping_products') is null then
    return false;
  end if;
  return exists (select 1 from public.marketplace_free_shipping_products f where f.product_id = p_product_id);
end;
$$;

-- What a showroom offers a buyer in one place (or, with no place, across all the places it covers).
-- status: available | not_available | needs_area | pickup_only | none. Never exposes an organization id.
create or replace function app.marketplace_delivery_terms(p_seller uuid, p_governorate text, p_area text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_gov      text := case when p_governorate ~ '^[a-z0-9][a-z0-9-]{0,63}$' then p_governorate end;
  v_area     text := case when p_area ~ '^[a-z0-9][a-z0-9-]{0,63}$' then p_area end;
  v_pickup   boolean := exists (select 1 from public.marketplace_stock_locations l
                                where l.organization_id = p_seller and l.is_active and l.supports_pickup);
  v_ready    boolean;
  v_prep     smallint;
  v_free_min numeric;
  v_pick_txt text;
  v_now      timestamp := (now() at time zone 'Africa/Cairo');
  v_status   text;
  v_fee      numeric;
  v_fee_min  numeric;
  v_fee_max  numeric;
  v_dmin     integer;
  v_dmax     integer;
  v_nd       boolean := false;
  v_nd_fee   numeric;
  v_row_free numeric;
  v_found    boolean := false;
  v_covered  boolean;
begin
  v_covered := exists (select 1 from public.marketplace_delivery_rates r where r.seller_organization_id = p_seller and r.fee_egp is not null);
  v_ready := to_regclass('public.marketplace_seller_delivery_settings') is not null
         and exists (select 1 from pg_attribute a where a.attrelid = 'public.marketplace_delivery_rates'::regclass
                     and a.attname = 'duration_min_days' and not a.attisdropped);

  if v_ready then
    select s.preparation_days, s.free_shipping_min_egp, s.pickup_instructions
      into v_prep, v_free_min, v_pick_txt
      from public.marketplace_seller_delivery_settings s where s.seller_organization_id = p_seller;
  end if;

  if v_gov is not null then
    if v_ready then
      select r.fee_egp, r.duration_min_days, r.duration_max_days, r.next_day_available, r.next_day_fee_egp, r.free_shipping_min_egp, true
        into v_fee, v_dmin, v_dmax, v_nd, v_nd_fee, v_row_free, v_found
        from public.marketplace_delivery_rates r
       where r.seller_organization_id = p_seller and r.governorate_key = v_gov and r.fee_egp is not null
         and (r.area_key = v_area or r.area_key is null)
       order by (r.area_key is null)
       limit 1;
    else
      select r.fee_egp, true into v_fee, v_found
        from public.marketplace_delivery_rates r
       where r.seller_organization_id = p_seller and r.governorate_key = v_gov and r.fee_egp is not null
         and (r.area_key = v_area or r.area_key is null)
       order by (r.area_key is null)
       limit 1;
    end if;
    v_status := case when coalesce(v_found, false) then 'available' else 'not_available' end;
  else
    if v_ready then
      select min(r.fee_egp), max(r.fee_egp), min(r.duration_min_days), max(r.duration_max_days)
        into v_fee_min, v_fee_max, v_dmin, v_dmax
        from public.marketplace_delivery_rates r
       where r.seller_organization_id = p_seller and r.fee_egp is not null and r.duration_min_days is not null;
    else
      select min(r.fee_egp), max(r.fee_egp) into v_fee_min, v_fee_max
        from public.marketplace_delivery_rates r where r.seller_organization_id = p_seller and r.fee_egp is not null;
    end if;
    v_status := case when v_covered then 'needs_area' when v_pickup then 'pickup_only' else 'none' end;
  end if;

  v_row_free := coalesce(v_row_free, v_free_min);

  return jsonb_build_object(
    'configured', v_ready and v_prep is not null,
    'status', v_status,
    'fee_egp', v_fee,
    'fee_min_egp', v_fee_min,
    'fee_max_egp', v_fee_max,
    'prep_days', v_prep,
    'min_days', case when v_ready and v_prep is not null and v_dmin is not null then v_prep + v_dmin end,
    'max_days', case when v_ready and v_prep is not null and v_dmax is not null then v_prep + v_dmax end,
    'earliest', case when v_ready and v_prep is not null and v_dmin is not null then to_char(v_now::date + (v_prep + v_dmin), 'YYYY-MM-DD') end,
    'latest',   case when v_ready and v_prep is not null and v_dmax is not null then to_char(v_now::date + (v_prep + v_dmax), 'YYYY-MM-DD') end,
    'free_min_egp', v_row_free,
    'next_day', case when v_gov is not null and coalesce(v_nd, false)
                     then jsonb_build_object('fee_egp', v_nd_fee, 'arrival', to_char(v_now::date + 1, 'YYYY-MM-DD')) end,
    'pickup_available', v_pickup,
    'pickup_instructions', v_pick_txt);
end;
$$;

-- Does one unit of the product ship free under those terms? (value = the unit price, excl. VAT)
create or replace function app.marketplace_free_shipping(p_product_id uuid, p_terms jsonb, p_value numeric)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.marketplace_product_ships_free(p_product_id)
      or coalesce((p_terms ->> 'fee_egp')::numeric = 0, false)
      or coalesce((p_terms ->> 'fee_max_egp')::numeric = 0, false)
      or (p_terms ->> 'free_min_egp' is not null and p_value is not null and p_value >= (p_terms ->> 'free_min_egp')::numeric);
$$;

revoke all on function
  app.marketplace_is_open(), app.marketplace_public_stock_left(uuid),
  app.marketplace_product_ships_free(uuid), app.marketplace_delivery_terms(uuid, text, text),
  app.marketplace_free_shipping(uuid, jsonb, numeric)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Open / closed status (the pages show a closed state; the catalog answers as if nothing were published)
-- ---------------------------------------------------------------------------
create or replace function public.marketplace_public_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('open', app.marketplace_is_open());
$$;

-- ---------------------------------------------------------------------------
-- 3. The browse read: cards, filters, seller storefront
-- ---------------------------------------------------------------------------
-- p_attrs: {"<attribute key>": ["<option key>", ...]} as before. p_free_shipping keeps only products that ship free
-- (see rules above); p_max_days keeps only products whose estimate starts within N days; p_governorate / p_area pick the
-- buyer's place (without them the estimate is the showroom's fastest..slowest range); p_seller limits to one showroom
-- (its public slug). Sorting: newest | price_asc | price_desc.
create or replace function public.marketplace_public_browse(
  p_category text default null, p_type text default null, p_query text default null,
  p_sort text default 'newest', p_limit integer default 24, p_offset integer default 0,
  p_price_min numeric default null, p_price_max numeric default null, p_attrs jsonb default null,
  p_free_shipping boolean default false, p_max_days integer default null,
  p_governorate text default null, p_area text default null, p_seller text default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with params as (
    select least(greatest(coalesce(p_limit, 24), 1), 60) as lim,
           greatest(coalesce(p_offset, 0), 0) as off,
           nullif(lower(btrim(coalesce(p_query, ''))), '') as q,
           app.marketplace_media_verification_ready() as media,
           app.marketplace_is_open() as is_open,
           case when jsonb_typeof(p_attrs) = 'object' then p_attrs else '{}'::jsonb end as attrs,
           nullif(lower(btrim(p_governorate)), '') as gov,
           nullif(lower(btrim(p_area)), '') as area,
           nullif(lower(btrim(p_seller)), '') as seller
  ),
  base as (
    select p.id, p.slug, p.name_ar, p.name_en, p.brand, p.published_at,
           t.key as type_key, t.name_ar as type_name_ar, t.name_en as type_name_en,
           c.key as category_key, c.name_ar as category_name_ar, c.name_en as category_name_en,
           o.name as seller_name, o.slug as seller_slug, (o.business_verified_at is not null) as official,
           (select min(v.price_egp) from public.marketplace_product_variants v where v.product_id = p.id and v.status = 'active') as from_price,
           d.terms
    from public.marketplace_products p
    join public.marketplace_product_types t on t.id = p.product_type_id and t.is_active
    join public.marketplace_categories c on c.id = t.category_id and c.is_active
    join public.organizations o on o.id = p.seller_organization_id
    cross join params pr
    cross join lateral (select app.marketplace_delivery_terms(p.seller_organization_id, pr.gov, pr.area) as terms) d
    where pr.is_open
      and p.status = 'published'
      and app.marketplace_seller_is_public(p.seller_organization_id)
      and app.marketplace_product_is_listed(p.id)
      and (pr.seller is null or o.slug = pr.seller)
      and (coalesce(p_category, '') = '' or c.key = p_category)
      and (coalesce(p_type, '') = '' or t.key = p_type)
      and (pr.q is null
           or position(pr.q in lower(p.name_en)) > 0 or position(pr.q in lower(p.name_ar)) > 0
           or position(pr.q in lower(coalesce(p.brand, ''))) > 0
           or exists (select 1 from public.marketplace_product_variants v
                      where v.product_id = p.id and v.status = 'active' and position(pr.q in lower(v.sku)) > 0))
      and (p_price_min is null and p_price_max is null
           or exists (select 1 from public.marketplace_product_variants v
                      where v.product_id = p.id and v.status = 'active'
                        and (p_price_min is null or v.price_egp >= p_price_min)
                        and (p_price_max is null or v.price_egp <= p_price_max)))
      and not exists (
        select 1 from jsonb_each(pr.attrs) f
        where jsonb_typeof(f.value) = 'array' and jsonb_array_length(f.value) > 0
          and not exists (
            select 1 from public.marketplace_product_attribute_values av
            join public.marketplace_attribute_definitions d2 on d2.id = av.attribute_id and d2.key = f.key
            join public.marketplace_attribute_options op on op.id = av.option_id
            where av.product_id = p.id and f.value ? op.key)
          and not exists (
            select 1 from public.marketplace_product_variants v
            join public.marketplace_variant_attribute_values vv on vv.variant_id = v.id
            join public.marketplace_attribute_definitions d2 on d2.id = vv.attribute_id and d2.key = f.key
            join public.marketplace_attribute_options op on op.id = vv.option_id
            where v.product_id = p.id and v.status = 'active' and f.value ? op.key))
  ),
  scored as (
    select b.*, app.marketplace_free_shipping(b.id, b.terms, b.from_price) as free
    from base b
  ),
  filtered as (
    select s.* from scored s
    where (not coalesce(p_free_shipping, false) or s.free)
      and (p_max_days is null or ((s.terms ->> 'min_days') is not null and (s.terms ->> 'min_days')::integer <= p_max_days))
  ),
  page as (
    select b.*,
           row_number() over (order by
             case when p_sort = 'price_asc' then b.from_price end asc nulls last,
             case when p_sort = 'price_desc' then b.from_price end desc nulls last,
             b.published_at desc, b.slug) as ord
    from filtered b
    order by ord
    limit (select lim from params) offset (select off from params)
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'limit', (select lim from params), 'offset', (select off from params),
    'open', (select is_open from params),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'slug', x.slug, 'name_ar', x.name_ar, 'name_en', x.name_en, 'brand', x.brand,
               'product_type_key', x.type_key, 'product_type_name_ar', x.type_name_ar, 'product_type_name_en', x.type_name_en,
               'category_key', x.category_key, 'category_name_ar', x.category_name_ar, 'category_name_en', x.category_name_en,
               'seller_name', x.seller_name, 'seller_slug', x.seller_slug, 'seller_official', x.official,
               'from_price_egp', x.from_price,
               'in_stock', true,
               'stock_left', app.marketplace_public_stock_left(x.id),
               'variant_count', (select count(*) from public.marketplace_product_variants v where v.product_id = x.id and v.status = 'active'),
               'cart_sku', (select min(v.sku) from public.marketplace_product_variants v
                            where v.product_id = x.id and v.status = 'active' having count(*) = 1),
               'colors', coalesce((select jsonb_agg(distinct op.swatch_hex)
                                   from public.marketplace_product_variants v
                                   join public.marketplace_variant_attribute_values vv on vv.variant_id = v.id
                                   join public.marketplace_attribute_definitions d on d.id = vv.attribute_id and d.key = 'color'
                                   join public.marketplace_attribute_options op on op.id = vv.option_id
                                   where v.product_id = x.id and v.status = 'active' and op.swatch_hex is not null), '[]'::jsonb),
               'published_at', x.published_at,
               'free_shipping', x.free,
               'delivery', jsonb_build_object(
                 'status', x.terms ->> 'status', 'configured', (x.terms ->> 'configured')::boolean,
                 'min_days', (x.terms ->> 'min_days')::integer, 'max_days', (x.terms ->> 'max_days')::integer,
                 'fee_egp', (x.terms ->> 'fee_egp')::numeric, 'pickup_available', (x.terms ->> 'pickup_available')::boolean),
               'image_id', case when (select media from params) then app.marketplace_product_cover_image(x.id) end)
             order by x.ord)
      from page x), '[]'::jsonb));
$$;

-- The old signature keeps answering (the application promoted before this migration calls it): same filters, the
-- old result keys plus the new ones, and the same gates. "In stock only" is now always true (stock-out is withdrawn).
create or replace function public.marketplace_public_catalog_page(
  p_category text default null, p_type text default null, p_query text default null,
  p_sort text default 'newest', p_limit integer default 24, p_offset integer default 0,
  p_price_min numeric default null, p_price_max numeric default null,
  p_in_stock boolean default false, p_attrs jsonb default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  -- Delegates to browse, which already applies app.marketplace_product_is_listed(p.id) (products with nothing to sell are withdrawn)
  -- and app.marketplace_seller_is_public(...) (open switch + approved seller).
  select public.marketplace_public_browse(p_category, p_type, p_query, p_sort, p_limit, p_offset, p_price_min, p_price_max,
                                          p_attrs, false, null, null, null, null);
$$;

-- ---------------------------------------------------------------------------
-- 4. Facets (same signature; open switch + stock withdrawal)
-- ---------------------------------------------------------------------------
create or replace function public.marketplace_public_facets(p_type text default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with visible as (
    select p.id, t.id as type_id, t.key as type_key
    from public.marketplace_products p
    join public.marketplace_product_types t on t.id = p.product_type_id and t.is_active
    join public.marketplace_categories c on c.id = t.category_id and c.is_active
    where app.marketplace_is_open()
      and p.status = 'published'
      and app.marketplace_seller_is_public(p.seller_organization_id)
      and app.marketplace_product_is_listed(p.id)
  ),
  scoped as (
    select * from visible where coalesce(p_type, '') = '' or type_key = p_type
  ),
  vals as (
    select s.id as product_id, av.attribute_id, av.option_id
    from scoped s join public.marketplace_product_attribute_values av on av.product_id = s.id
    where av.option_id is not null
    union
    select s.id, vv.attribute_id, vv.option_id
    from scoped s
    join public.marketplace_product_variants v on v.product_id = s.id and v.status = 'active'
    join public.marketplace_variant_attribute_values vv on vv.variant_id = v.id
    where vv.option_id is not null
  ),
  filter_attrs as (
    select d.id, d.key, coalesce(ta.name_ar_override, d.name_ar) as name_ar, coalesce(ta.name_en_override, d.name_en) as name_en,
           ta.sort_order
    from public.marketplace_product_types t
    join public.marketplace_product_type_attributes ta on ta.product_type_id = t.id and ta.is_active and ta.is_filterable
    join public.marketplace_attribute_definitions d on d.id = ta.attribute_id and d.is_active
      and d.data_type in ('option', 'multi_option')
    where coalesce(p_type, '') <> '' and t.key = p_type and t.is_active
    union all
    select d.id, d.key, d.name_ar, d.name_en, 0
    from public.marketplace_attribute_definitions d
    where coalesce(p_type, '') = '' and d.key = 'color' and d.is_active
  )
  select jsonb_build_object(
    'open', app.marketplace_is_open(),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', c.key, 'name_ar', c.name_ar, 'name_en', c.name_en,
               'count', (select count(*) from visible vi join public.marketplace_product_types t2 on t2.id = vi.type_id where t2.category_id = c.id),
               'types', coalesce((select jsonb_agg(jsonb_build_object('key', t2.key, 'name_ar', t2.name_ar, 'name_en', t2.name_en,
                                                                     'count', (select count(*) from visible vi where vi.type_id = t2.id))
                                                  order by t2.sort_order)
                                  from public.marketplace_product_types t2 where t2.category_id = c.id and t2.is_active), '[]'::jsonb))
             order by c.sort_order)
      from public.marketplace_categories c
      where c.is_active and exists (select 1 from public.marketplace_product_types t where t.category_id = c.id and t.is_active)), '[]'::jsonb),
    'price', (select jsonb_build_object('min', min(v.price_egp), 'max', max(v.price_egp))
              from scoped s join public.marketplace_product_variants v on v.product_id = s.id and v.status = 'active'),
    'filters', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', fa.key, 'name_ar', fa.name_ar, 'name_en', fa.name_en,
               'options', (select jsonb_agg(jsonb_build_object('key', op.key, 'name_ar', op.name_ar, 'name_en', op.name_en,
                                                               'swatch_hex', op.swatch_hex, 'count', n.cnt)
                                            order by op.sort_order, op.key)
                           from (select vals.option_id, count(distinct vals.product_id) as cnt from vals
                                 where vals.attribute_id = fa.id group by vals.option_id) n
                           join public.marketplace_attribute_options op on op.id = n.option_id and op.is_active))
             order by fa.sort_order, fa.key)
      from filter_attrs fa
      where exists (select 1 from vals where vals.attribute_id = fa.id)), '[]'::jsonb));
$$;

-- ---------------------------------------------------------------------------
-- 5. Product page (same signature; adds seller, official badge, stock-left and the free-shipping flag)
-- ---------------------------------------------------------------------------
create or replace function public.marketplace_public_product(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_p      public.marketplace_products;
  t        public.marketplace_product_types;
  c        public.marketplace_categories;
  o        public.organizations;
  v_media  boolean := app.marketplace_media_verification_ready();
  v_result jsonb;
begin
  if not app.marketplace_is_open() then
    return null;
  end if;
  select p.* into v_p
  from public.marketplace_products p
  join public.marketplace_product_types tt on tt.id = p.product_type_id and tt.is_active
  join public.marketplace_categories cc on cc.id = tt.category_id and cc.is_active
  where p.slug = p_slug and p.status = 'published'
    and app.marketplace_seller_is_public(p.seller_organization_id)
    and app.marketplace_product_is_listed(p.id);
  if not found then
    return null;
  end if;
  select * into t from public.marketplace_product_types where id = v_p.product_type_id;
  select * into c from public.marketplace_categories where id = t.category_id;
  select * into o from public.organizations where id = v_p.seller_organization_id;

  select jsonb_build_object(
    'slug', v_p.slug,
    'name_ar', v_p.name_ar, 'name_en', v_p.name_en,
    'description_ar', v_p.description_ar, 'description_en', v_p.description_en,
    'brand', v_p.brand,
    'product_type_key', t.key, 'product_type_name_ar', t.name_ar, 'product_type_name_en', t.name_en,
    'category_key', c.key, 'category_name_ar', c.name_ar, 'category_name_en', c.name_en,
    'seller_name', o.name,
    'seller_slug', o.slug,
    'seller_official', o.business_verified_at is not null,
    'published_at', v_p.published_at,
    'stock_left', app.marketplace_public_stock_left(v_p.id),
    'ships_free', app.marketplace_product_ships_free(v_p.id),
    'cover_image_id', case when v_media then app.marketplace_product_cover_image(v_p.id) end,
    'attributes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'key', d.key, 'name_ar', d.name_ar, 'name_en', d.name_en, 'data_type', av.data_type, 'unit_kind', d.unit_kind,
               'unit_ar', d.display_unit_ar, 'unit_en', d.display_unit_en,
               'value', case
                 when av.option_id is not null then jsonb_build_object('key', op.key, 'name_ar', op.name_ar, 'name_en', op.name_en, 'swatch_hex', op.swatch_hex)
                 when av.value_number is not null then to_jsonb(av.value_number)
                 when av.value_boolean is not null then to_jsonb(av.value_boolean)
                 else to_jsonb(av.value_text) end)
             order by d.key)
      from public.marketplace_product_attribute_values av
      join public.marketplace_attribute_definitions d on d.id = av.attribute_id and d.is_active
      left join public.marketplace_attribute_options op on op.id = av.option_id
      where av.product_id = v_p.id), '[]'::jsonb),
    'variants', coalesce((
      select jsonb_agg(jsonb_build_object(
               'sku', pv.sku, 'selling_unit', pv.selling_unit, 'price_egp', pv.price_egp,
               'purchasable', app.marketplace_variant_available(pv.id) > 0,
               'stock_left', case when app.marketplace_variant_available(pv.id) between 1 and 3 then app.marketplace_variant_available(pv.id) end,
               'attributes', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'key', d.key, 'name_ar', d.name_ar, 'name_en', d.name_en, 'data_type', vv.data_type, 'unit_kind', d.unit_kind,
                          'unit_ar', d.display_unit_ar, 'unit_en', d.display_unit_en,
                          'value', case
                            when vv.option_id is not null then jsonb_build_object('key', op.key, 'name_ar', op.name_ar, 'name_en', op.name_en, 'swatch_hex', op.swatch_hex)
                            when vv.value_number is not null then to_jsonb(vv.value_number)
                            when vv.value_boolean is not null then to_jsonb(vv.value_boolean)
                            else to_jsonb(vv.value_text) end)
                        order by d.key)
                 from public.marketplace_variant_attribute_values vv
                 join public.marketplace_attribute_definitions d on d.id = vv.attribute_id and d.is_active
                 left join public.marketplace_attribute_options op on op.id = vv.option_id
                 where vv.variant_id = pv.id), '[]'::jsonb))
             order by pv.sku)
      from public.marketplace_product_variants pv
      where pv.product_id = v_p.id and pv.status = 'active'), '[]'::jsonb),
    'images', case when v_media then coalesce((
      select jsonb_agg(jsonb_build_object(
               'image_id', i.id, 'sort_order', i.sort_order, 'is_primary', i.is_primary,
               'alt_text_ar', i.alt_text_ar, 'alt_text_en', i.alt_text_en,
               'variant_sku', pv.sku)
             order by (i.variant_id is not null), (not i.is_primary), i.sort_order)
      from public.marketplace_product_images i
      left join public.marketplace_product_variants pv on pv.id = i.variant_id
      where i.product_id = v_p.id and i.status = 'verified' and i.upload_state = 'confirmed'
        and i.content_valid is true and (i.variant_id is null or pv.status = 'active')), '[]'::jsonb) else '[]'::jsonb end
  ) into v_result;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Delivery-details block of the product page
-- ---------------------------------------------------------------------------
-- One product, optionally one buyer place, optionally one variant (its price decides the free-shipping threshold; else the
-- cheapest active variant). Returns the terms of app.marketplace_delivery_terms plus free_shipping / free_reason.
-- null when the product is not publicly visible.
create or replace function public.marketplace_public_delivery(
  p_slug text, p_governorate text default null, p_area text default null, p_sku text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_p     public.marketplace_products;
  v_gov   text := nullif(btrim(lower(p_governorate)), '');
  v_area  text := nullif(btrim(lower(p_area)), '');
  v_price numeric;
  v_terms jsonb;
  v_flag  boolean;
  v_free  boolean;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9-]{1,120}$' or not app.marketplace_is_open() then
    return null;
  end if;
  select p.* into v_p
  from public.marketplace_products p
  join public.marketplace_product_types tt on tt.id = p.product_type_id and tt.is_active
  join public.marketplace_categories cc on cc.id = tt.category_id and cc.is_active
  where p.slug = p_slug and p.status = 'published'
    and app.marketplace_seller_is_public(p.seller_organization_id)
    and app.marketplace_product_is_listed(p.id);
  if not found then
    return null;
  end if;
  select v.price_egp into v_price
  from public.marketplace_product_variants v
  where v.product_id = v_p.id and v.status = 'active' and (p_sku is null or v.sku = p_sku)
  order by v.price_egp limit 1;
  v_terms := app.marketplace_delivery_terms(v_p.seller_organization_id, v_gov, v_area);
  v_flag := app.marketplace_product_ships_free(v_p.id);
  v_free := app.marketplace_free_shipping(v_p.id, v_terms, v_price);
  return v_terms || jsonb_build_object(
    'free_shipping', v_free,
    'free_reason', case when not v_free then null
                        when v_flag then 'product'
                        when coalesce((v_terms ->> 'fee_egp')::numeric = 0, false) or coalesce((v_terms ->> 'fee_max_egp')::numeric = 0, false) then 'free_delivery'
                        else 'threshold' end,
    'product_free', v_flag);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Seller storefront header
-- ---------------------------------------------------------------------------
-- By the organization's public slug. null when the Marketplace is closed, the slug is unknown or the showroom is not an
-- enabled seller. Returns only the public name, the official-store flag and how many products are on the shelf.
create or replace function public.marketplace_public_seller(p_slug text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  o public.organizations;
begin
  if p_slug is null or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(p_slug) > 120 or not app.marketplace_is_open() then
    return null;
  end if;
  select * into o from public.organizations where slug = p_slug and deleted_at is null;
  if not found or not app.marketplace_seller_is_public(o.id) then
    return null;
  end if;
  return jsonb_build_object(
    'slug', o.slug, 'name', o.name, 'official', o.business_verified_at is not null,
    'product_count', (select count(*) from public.marketplace_products p
                      where p.seller_organization_id = o.id and p.status = 'published' and app.marketplace_product_is_listed(p.id)));
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Grants
-- ---------------------------------------------------------------------------
revoke all on function
  public.marketplace_public_status(),
  public.marketplace_public_browse(text, text, text, text, integer, integer, numeric, numeric, jsonb, boolean, integer, text, text, text),
  public.marketplace_public_delivery(text, text, text, text),
  public.marketplace_public_seller(text),
  public.marketplace_public_catalog_page(text, text, text, text, integer, integer, numeric, numeric, boolean, jsonb),
  public.marketplace_public_facets(text),
  public.marketplace_public_product(text)
  from public, anon, authenticated, service_role;
grant execute on function
  public.marketplace_public_status(),
  public.marketplace_public_browse(text, text, text, text, integer, integer, numeric, numeric, jsonb, boolean, integer, text, text, text),
  public.marketplace_public_delivery(text, text, text, text),
  public.marketplace_public_seller(text),
  public.marketplace_public_catalog_page(text, text, text, text, integer, integer, numeric, numeric, boolean, jsonb),
  public.marketplace_public_facets(text),
  public.marketplace_public_product(text)
  to anon, authenticated;
