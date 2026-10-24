-- =============================================================================
-- Marketplace Migration 10 — public catalog filters
--
-- The public catalog (Migration 09) could only filter by category, type and a
-- text search. The storefront needs the filters the approved design shows:
-- price range, "in stock only", colour and the filterable option fields of a
-- product type (material, pattern, …). Both public read functions are replaced
-- (same names, same callers, same grants); the visibility rule is unchanged:
-- published products of currently enabled sellers, active type / category, at
-- least one active variant. No table, policy or write path changes.
-- =============================================================================

drop function if exists public.marketplace_public_catalog_page(text, text, text, text, integer, integer);
drop function if exists public.marketplace_public_facets();

-- p_attrs: {"<attribute key>": ["<option key>", …], …}. A product matches when,
-- for EVERY key, the product itself or one of its active variants carries one of
-- the listed options. Unknown keys simply match nothing.
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
  with params as (
    select least(greatest(coalesce(p_limit, 24), 1), 60) as lim,
           greatest(coalesce(p_offset, 0), 0) as off,
           nullif(lower(btrim(coalesce(p_query, ''))), '') as q,
           app.marketplace_media_verification_ready() as media,
           case when jsonb_typeof(p_attrs) = 'object' then p_attrs else '{}'::jsonb end as attrs
  ),
  base as (
    select p.id, p.slug, p.name_ar, p.name_en, p.brand, p.published_at,
           t.key as type_key, t.name_ar as type_name_ar, t.name_en as type_name_en,
           c.key as category_key, c.name_ar as category_name_ar, c.name_en as category_name_en, o.name as seller_name,
           (select min(v.price_egp) from public.marketplace_product_variants v where v.product_id = p.id and v.status = 'active') as from_price
    from public.marketplace_products p
    join public.marketplace_product_types t on t.id = p.product_type_id and t.is_active
    join public.marketplace_categories c on c.id = t.category_id and c.is_active
    join public.organizations o on o.id = p.seller_organization_id
    cross join params pr
    where p.status = 'published'
      and app.marketplace_seller_is_enabled(p.seller_organization_id)
      and exists (select 1 from public.marketplace_product_variants v where v.product_id = p.id and v.status = 'active')
      and (coalesce(p_category, '') = '' or c.key = p_category)
      and (coalesce(p_type, '') = '' or t.key = p_type)
      and (pr.q is null
           or position(pr.q in lower(p.name_en)) > 0 or position(pr.q in lower(p.name_ar)) > 0
           or position(pr.q in lower(coalesce(p.brand, ''))) > 0
           or exists (select 1 from public.marketplace_product_variants v
                      where v.product_id = p.id and v.status = 'active' and position(pr.q in lower(v.sku)) > 0))
      -- price: some active variant inside the range
      and (p_price_min is null and p_price_max is null
           or exists (select 1 from public.marketplace_product_variants v
                      where v.product_id = p.id and v.status = 'active'
                        and (p_price_min is null or v.price_egp >= p_price_min)
                        and (p_price_max is null or v.price_egp <= p_price_max)))
      and (not coalesce(p_in_stock, false)
           or exists (select 1 from public.marketplace_product_variants v
                      where v.product_id = p.id and v.status = 'active' and app.marketplace_variant_available(v.id) > 0))
      -- every requested attribute key must match (product level or an active variant)
      and not exists (
        select 1 from jsonb_each(pr.attrs) f
        where jsonb_typeof(f.value) = 'array' and jsonb_array_length(f.value) > 0
          and not exists (
            select 1 from public.marketplace_product_attribute_values av
            join public.marketplace_attribute_definitions d on d.id = av.attribute_id and d.key = f.key
            join public.marketplace_attribute_options op on op.id = av.option_id
            where av.product_id = p.id and f.value ? op.key)
          and not exists (
            select 1 from public.marketplace_product_variants v
            join public.marketplace_variant_attribute_values vv on vv.variant_id = v.id
            join public.marketplace_attribute_definitions d on d.id = vv.attribute_id and d.key = f.key
            join public.marketplace_attribute_options op on op.id = vv.option_id
            where v.product_id = p.id and v.status = 'active' and f.value ? op.key))
  ),
  page as (
    select b.*,
           row_number() over (order by
             case when p_sort = 'price_asc' then b.from_price end asc nulls last,
             case when p_sort = 'price_desc' then b.from_price end desc nulls last,
             b.published_at desc, b.slug) as ord
    from base b
    order by ord
    limit (select lim from params) offset (select off from params)
  )
  select jsonb_build_object(
    'total', (select count(*) from base),
    'limit', (select lim from params), 'offset', (select off from params),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'slug', x.slug, 'name_ar', x.name_ar, 'name_en', x.name_en, 'brand', x.brand,
               'product_type_key', x.type_key, 'product_type_name_ar', x.type_name_ar, 'product_type_name_en', x.type_name_en,
               'category_key', x.category_key, 'category_name_ar', x.category_name_ar, 'category_name_en', x.category_name_en,
               'seller_name', x.seller_name, 'from_price_egp', x.from_price,
               'in_stock', exists (select 1 from public.marketplace_product_variants v
                                   where v.product_id = x.id and v.status = 'active' and app.marketplace_variant_available(v.id) > 0),
               'variant_count', (select count(*) from public.marketplace_product_variants v where v.product_id = x.id and v.status = 'active'),
               'colors', coalesce((select jsonb_agg(distinct op.swatch_hex)
                                   from public.marketplace_product_variants v
                                   join public.marketplace_variant_attribute_values vv on vv.variant_id = v.id
                                   join public.marketplace_attribute_definitions d on d.id = vv.attribute_id and d.key = 'color'
                                   join public.marketplace_attribute_options op on op.id = vv.option_id
                                   where v.product_id = x.id and v.status = 'active' and op.swatch_hex is not null), '[]'::jsonb),
               'published_at', x.published_at,
               'image_id', case when (select media from params) then app.marketplace_product_cover_image(x.id) end)
             order by x.ord)
      from page x), '[]'::jsonb));
$$;

-- Categories / types with published counts (as before) plus, for the storefront
-- side panel: the price bounds and the option filters (with counts) of the
-- chosen type — or, with no type, the colour filter across everything.
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
    where p.status = 'published'
      and app.marketplace_seller_is_enabled(p.seller_organization_id)
      and exists (select 1 from public.marketplace_product_variants v where v.product_id = p.id and v.status = 'active')
  ),
  scoped as (
    select * from visible where coalesce(p_type, '') = '' or type_key = p_type
  ),
  -- (product, attribute, option) triples from product AND active-variant values
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

revoke all on function public.marketplace_public_catalog_page(text, text, text, text, integer, integer, numeric, numeric, boolean, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.marketplace_public_facets(text) from public, anon, authenticated, service_role;
grant execute on function public.marketplace_public_catalog_page(text, text, text, text, integer, integer, numeric, numeric, boolean, jsonb) to anon, authenticated;
grant execute on function public.marketplace_public_facets(text) to anon, authenticated;
