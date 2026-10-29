-- ===========================================================================
-- Marketplace — Migration 06: trusted seller product writes
-- ===========================================================================
-- WHAT THIS IS. The write interfaces an approved Marketplace seller uses from
-- the workspace UI, so product data is entered through the database's own
-- rules instead of direct table writes:
--
--   marketplace_seller_product_save        create / update a product, its
--                                          variants and dynamic attributes
--                                          (one atomic call, always a draft on
--                                          create, never a publication)
--   marketplace_seller_product_get         the seller's own product for editing
--   marketplace_seller_product_readiness   the publication blockers, for the UI
--   marketplace_seller_default_location    ensure the seller's main stock location
--   marketplace_seller_stock_adjust        +/- stock through the ledger
--   marketplace_seller_image_request_upload / _confirm_upload / _update / _remove
--                                          product images through a pending-row,
--                                          server-confirmed storage workflow
--
-- AUTHORISATION (every function, re-checked on every call)
--   * an authenticated caller (auth.uid());
--   * an ACTIVE member of the product's organization holding catalogue authority
--     (catalog.write, catalog.publish or org.manage);
--   * an ENABLED Marketplace seller (approved account + still an eligible live
--     showroom) — a suspended or revoked seller cannot write anything.
--   Reads (`_get`, `_readiness`) need membership only, so a suspended seller can
--   still see what it has.
--
-- WHAT STAYS CLOSED. Nothing here publishes: publication remains the Migration
-- 04 publish RPC behind the full blocker list (media verification is still OFF).
-- Uploading an image never verifies it: a confirmed upload is stored as
-- `status = pending` until a verification pipeline exists. No client gains a
-- table write grant; storage access is limited by policies that require a
-- server-created pending image row.
--
-- ERRORS. Validation failures raise `mp:<code>[:detail]` messages (errcode
-- 22023 / 23505 / 23514 / 42501) so the UI can show a precise, translated reason.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Image upload state + private bucket
-- ---------------------------------------------------------------------------
alter table public.marketplace_product_images
  add column upload_state text not null default 'confirmed',
  add constraint ck_marketplace_images_upload_state check (upload_state in ('awaiting_upload', 'confirmed'));
comment on column public.marketplace_product_images.upload_state is
  'awaiting_upload: a server-created key the seller may upload to, bytes not yet confirmed. confirmed: the object was found in storage by marketplace_seller_image_confirm_upload. Independent of `status` (pending / verified / rejected), which is the CONTENT review and is never set by an upload.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('marketplace-product-images', 'marketplace-product-images', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Authorisation helpers (internal)
-- ---------------------------------------------------------------------------
create or replace function app.marketplace_can_manage_catalog(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
     and app.is_org_member(p_org)
     and (app.has_capability(p_org, 'catalog.write') or app.has_capability(p_org, 'catalog.publish')
          or app.has_capability(p_org, 'org.manage'));
$$;

-- Raises unless the caller may WRITE Marketplace data for this organization.
create or replace function app.marketplace_assert_seller_writer(p_org uuid)
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
    raise exception 'mp:auth_required' using errcode = '42501';
  end if;
  if p_org is null or not app.marketplace_can_manage_catalog(p_org) then
    raise exception 'mp:not_permitted' using errcode = '42501';
  end if;
  if not app.marketplace_seller_is_enabled(p_org) then
    raise exception 'mp:seller_not_enabled' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;

-- Raises unless the caller may READ this organization's seller data.
create or replace function app.marketplace_assert_seller_reader(p_org uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'mp:auth_required' using errcode = '42501';
  end if;
  if p_org is null or not app.is_org_member(p_org) then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  return (select auth.uid());
end;
$$;

-- Validates one dynamic attribute value against its definition (no writes).
create or replace function app.marketplace_attribute_value_ok(p_attribute_id uuid, p_data_type text, p_value jsonb)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  v_num numeric;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return false;
  end if;
  if p_data_type = 'option' then
    return jsonb_typeof(p_value) = 'string' and exists (
      select 1 from public.marketplace_attribute_options o
      where o.attribute_id = p_attribute_id and o.key = (p_value #>> '{}') and o.is_active);
  elsif p_data_type = 'multi_option' then
    return jsonb_typeof(p_value) = 'array' and jsonb_array_length(p_value) between 1 and 20 and not exists (
      select 1 from jsonb_array_elements(p_value) e
      where jsonb_typeof(e) <> 'string' or not exists (
        select 1 from public.marketplace_attribute_options o
        where o.attribute_id = p_attribute_id and o.key = (e #>> '{}') and o.is_active));
  elsif p_data_type in ('number', 'measurement') then
    if not (jsonb_typeof(p_value) = 'number'
            or (jsonb_typeof(p_value) = 'string' and (p_value #>> '{}') ~ '^[0-9]{1,9}(\.[0-9]{1,4})?$')) then
      return false;
    end if;
    v_num := (p_value #>> '{}')::numeric;
    return v_num >= 0 and v_num < 1000000000 and (p_data_type = 'number' or v_num > 0);
  elsif p_data_type = 'boolean' then
    return jsonb_typeof(p_value) = 'boolean';
  elsif p_data_type = 'text' then
    return jsonb_typeof(p_value) = 'string' and char_length(btrim(p_value #>> '{}')) between 1 and 500;
  end if;
  return false;
end;
$$;

-- Replaces the full attribute set at one level for one owner (product or variant).
-- Keys must be active fields of the product type at that level; values are
-- validated; fields absent from the payload are removed.
create or replace function app.marketplace_seller_apply_attributes(
  p_level text, p_owner uuid, p_type_id uuid, p_attributes jsonb, p_label text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_key   text;
  v_val   jsonb;
  d       record;
  v_keep  uuid[] := '{}';
begin
  if p_attributes is null or jsonb_typeof(p_attributes) = 'null' then
    p_attributes := '{}'::jsonb;
  end if;
  if jsonb_typeof(p_attributes) <> 'object' then
    raise exception 'mp:invalid_attributes:%', p_label using errcode = '22023';
  end if;

  for v_key, v_val in select * from jsonb_each(p_attributes) loop
    -- an empty value means "not set"
    continue when v_val is null or jsonb_typeof(v_val) = 'null'
               or (jsonb_typeof(v_val) = 'string' and btrim(v_val #>> '{}') = '')
               or (jsonb_typeof(v_val) = 'array' and jsonb_array_length(v_val) = 0);
    select ad.id, ad.data_type into d
    from public.marketplace_attribute_definitions ad
    join public.marketplace_product_type_attributes ta on ta.attribute_id = ad.id
      and ta.product_type_id = p_type_id and ta.level = p_level and ta.is_active
    where ad.key = v_key and ad.is_active;
    if not found then
      raise exception 'mp:attribute_unknown:%', v_key using errcode = '22023';
    end if;
    if not app.marketplace_attribute_value_ok(d.id, d.data_type, v_val) then
      raise exception 'mp:attribute_invalid:%', v_key using errcode = '22023';
    end if;
    perform app.marketplace_import_apply_attribute(p_level, p_owner, d.id, d.data_type, v_val);
    v_keep := array_append(v_keep, d.id);
  end loop;

  if p_level = 'product' then
    delete from public.marketplace_product_attribute_values v
     where v.product_id = p_owner and not (v.attribute_id = any (v_keep));
  else
    delete from public.marketplace_variant_attribute_values v
     where v.variant_id = p_owner and not (v.attribute_id = any (v_keep));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Product read (for editing)
-- ---------------------------------------------------------------------------
create or replace function app.marketplace_attribute_json(p_data_type text, p_option_key text, p_num numeric, p_bool boolean, p_text text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when p_data_type in ('option', 'multi_option') then to_jsonb(p_option_key)
    when p_data_type in ('number', 'measurement') then to_jsonb(p_num)
    when p_data_type = 'boolean' then to_jsonb(p_bool)
    else to_jsonb(p_text) end;
$$;

create or replace function public.marketplace_seller_product_get(p_product_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.marketplace_products;
  v jsonb;
begin
  select * into p from public.marketplace_products where id = p_product_id;
  if not found then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  perform app.marketplace_assert_seller_reader(p.seller_organization_id);

  select jsonb_build_object(
    'id', p.id,
    'organization_id', p.seller_organization_id,
    'product_type_key', t.key,
    'category_key', c.key,
    'name_ar', p.name_ar, 'name_en', p.name_en,
    'description_ar', p.description_ar, 'description_en', p.description_en,
    'brand', p.brand, 'external_ref', p.external_ref, 'slug', p.slug,
    'status', p.status, 'published_at', p.published_at, 'updated_at', p.updated_at,
    'attributes', coalesce((
      select jsonb_object_agg(x.key, x.val) from (
        select d.key,
               case when d.data_type = 'multi_option'
                    then jsonb_agg(o.key order by o.sort_order)
                    else (array_agg(app.marketplace_attribute_json(d.data_type, o.key, av.value_number, av.value_boolean, av.value_text)))[1]
               end as val
        from public.marketplace_product_attribute_values av
        join public.marketplace_attribute_definitions d on d.id = av.attribute_id
        left join public.marketplace_attribute_options o on o.id = av.option_id
        where av.product_id = p.id
        group by d.key, d.data_type) x), '{}'::jsonb),
    'variants', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', pv.id, 'sku', pv.sku, 'selling_unit', pv.selling_unit, 'price_egp', pv.price_egp,
               'status', pv.status,
               'attributes', coalesce((
                 select jsonb_object_agg(x.key, x.val) from (
                   select d.key,
                          case when d.data_type = 'multi_option'
                               then jsonb_agg(o.key order by o.sort_order)
                               else (array_agg(app.marketplace_attribute_json(d.data_type, o.key, vv.value_number, vv.value_boolean, vv.value_text)))[1]
                          end as val
                   from public.marketplace_variant_attribute_values vv
                   join public.marketplace_attribute_definitions d on d.id = vv.attribute_id
                   left join public.marketplace_attribute_options o on o.id = vv.option_id
                   where vv.variant_id = pv.id
                   group by d.key, d.data_type) x), '{}'::jsonb),
               'stock', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'location_id', l.id, 'location_name_ar', l.name_ar, 'location_name_en', l.name_en,
                          'location_active', l.is_active,
                          'on_hand', il.on_hand, 'reserved', il.reserved, 'available', il.available)
                        order by l.name_en)
                 from public.marketplace_inventory_levels il
                 join public.marketplace_stock_locations l on l.id = il.location_id
                 where il.variant_id = pv.id), '[]'::jsonb))
             order by pv.created_at, pv.sku)
      from public.marketplace_product_variants pv where pv.product_id = p.id), '[]'::jsonb),
    'images', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'variant_id', i.variant_id, 'storage_bucket', i.storage_bucket, 'object_key', i.object_key,
               'sort_order', i.sort_order, 'is_primary', i.is_primary, 'status', i.status,
               'upload_state', i.upload_state, 'mime_type', i.mime_type, 'byte_size', i.byte_size,
               'alt_text_ar', i.alt_text_ar, 'alt_text_en', i.alt_text_en)
             order by (i.variant_id is not null), i.sort_order)
      from public.marketplace_product_images i where i.product_id = p.id and i.status <> 'rejected'), '[]'::jsonb),
    'blockers', to_jsonb(app.marketplace_publication_blockers(p.id))
  ) into v
  from public.marketplace_product_types t
  join public.marketplace_categories c on c.id = t.category_id
  where t.id = p.product_type_id;
  return v;
end;
$$;

create or replace function public.marketplace_seller_product_readiness(p_product_id uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select seller_organization_id into v_org from public.marketplace_products where id = p_product_id;
  if v_org is null then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  perform app.marketplace_assert_seller_reader(v_org);
  return app.marketplace_publication_blockers(p_product_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Product save (create or update) — one atomic call
-- ---------------------------------------------------------------------------
-- Payload:
-- { "id"?: uuid, "organization_id": uuid (create only), "product_type_key": text (create only),
--   "name_ar", "name_en", "description_ar"?, "description_en"?, "brand"?, "external_ref"?, "slug"?,
--   "attributes": { key: value },
--   "variants": [ { "id"?: uuid, "sku", "selling_unit", "price_egp", "status"?: active|inactive,
--                   "attributes": { key: value } } ] }
-- The variants array is the FULL set: an existing variant that is not listed is
-- deactivated (never deleted — stock history references it).
create or replace function public.marketplace_seller_product_save(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid;
  v_id       uuid := nullif(p_payload ->> 'id', '')::uuid;
  v_org      uuid;
  v_type_id  uuid;
  v_status   text;
  v_name_ar  text := nullif(btrim(p_payload ->> 'name_ar'), '');
  v_name_en  text := nullif(btrim(p_payload ->> 'name_en'), '');
  v_desc_ar  text := nullif(btrim(p_payload ->> 'description_ar'), '');
  v_desc_en  text := nullif(btrim(p_payload ->> 'description_en'), '');
  v_brand    text := nullif(btrim(p_payload ->> 'brand'), '');
  v_ref      text := nullif(btrim(p_payload ->> 'external_ref'), '');
  v_slug     text := nullif(lower(btrim(p_payload ->> 'slug')), '');
  v_variants jsonb := coalesce(p_payload -> 'variants', '[]'::jsonb);
  e          jsonb;
  v_vid      uuid;
  v_sku      text;
  v_unit     text;
  v_price    numeric;
  v_vstatus  text;
  v_keep     uuid[] := '{}';
  v_constraint text;
  v_msg      text;
  v_blockers text[];
  v_created  boolean := false;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'mp:invalid_payload' using errcode = '22023';
  end if;

  -- ownership: an existing product decides its own organization; a payload
  -- organization id is only consulted on create.
  if v_id is not null then
    select seller_organization_id, product_type_id, status into v_org, v_type_id, v_status
    from public.marketplace_products where id = v_id for update;
    if v_org is null then
      raise exception 'mp:not_found' using errcode = '42501';
    end if;
    if v_status = 'archived' then
      raise exception 'mp:archived' using errcode = '23514';
    end if;
  else
    v_org := nullif(p_payload ->> 'organization_id', '')::uuid;
  end if;
  v_uid := app.marketplace_assert_seller_writer(v_org);

  -- product type: chosen on create, immutable afterwards
  if v_id is null then
    select t.id into v_type_id
    from public.marketplace_product_types t join public.marketplace_categories c on c.id = t.category_id
    where t.key = p_payload ->> 'product_type_key' and t.is_active and c.is_active;
    if v_type_id is null then
      raise exception 'mp:product_type_invalid' using errcode = '22023';
    end if;
  elsif p_payload ? 'product_type_key' and nullif(p_payload ->> 'product_type_key', '') is not null
        and not exists (select 1 from public.marketplace_product_types t
                        where t.id = v_type_id and t.key = p_payload ->> 'product_type_key') then
    raise exception 'mp:product_type_immutable' using errcode = '23514';
  end if;

  -- basic fields (the table CHECKs are the backstop; these give precise reasons)
  if v_name_ar is null or char_length(v_name_ar) > 200 then
    raise exception 'mp:name_ar_invalid' using errcode = '22023';
  end if;
  if v_name_en is null or char_length(v_name_en) > 200 then
    raise exception 'mp:name_en_invalid' using errcode = '22023';
  end if;
  if char_length(coalesce(v_desc_ar, '')) > 5000 or char_length(coalesce(v_desc_en, '')) > 5000 then
    raise exception 'mp:description_too_long' using errcode = '22023';
  end if;
  if char_length(coalesce(v_brand, '')) > 80 then
    raise exception 'mp:brand_too_long' using errcode = '22023';
  end if;
  if char_length(coalesce(v_ref, '')) > 80 then
    raise exception 'mp:external_ref_too_long' using errcode = '22023';
  end if;
  if v_slug is not null and (char_length(v_slug) not between 3 and 120 or v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$') then
    raise exception 'mp:slug_invalid' using errcode = '22023';
  end if;

  if jsonb_typeof(v_variants) <> 'array' or jsonb_array_length(v_variants) > 50 then
    raise exception 'mp:variants_invalid' using errcode = '22023';
  end if;
  -- the same SKU twice in one form
  if exists (select 1 from jsonb_array_elements(v_variants) x
             group by upper(btrim(x ->> 'sku')) having count(*) > 1) then
    raise exception 'mp:duplicate_sku_in_form' using errcode = '23505';
  end if;

  begin
    if v_id is null then
      v_id := gen_random_uuid();
      insert into public.marketplace_products
        (id, seller_organization_id, product_type_id, slug, name_ar, name_en, description_ar, description_en, brand, external_ref, status)
      values (v_id, v_org, v_type_id,
              coalesce(v_slug, app.marketplace_import_slug(v_name_en, v_org, coalesce(v_ref, v_id::text))),
              v_name_ar, v_name_en, v_desc_ar, v_desc_en, v_brand, v_ref, 'draft');
      v_created := true;
    else
      update public.marketplace_products set
        name_ar = v_name_ar, name_en = v_name_en, description_ar = v_desc_ar, description_en = v_desc_en,
        brand = v_brand, external_ref = v_ref, slug = coalesce(v_slug, slug)
      where id = v_id;
    end if;

    perform app.marketplace_seller_apply_attributes('product', v_id, v_type_id, p_payload -> 'attributes', 'product');

    for e in select * from jsonb_array_elements(v_variants) loop
      v_vid := nullif(e ->> 'id', '')::uuid;
      v_sku := nullif(btrim(e ->> 'sku'), '');
      v_unit := nullif(lower(btrim(e ->> 'selling_unit')), '');
      v_vstatus := coalesce(nullif(e ->> 'status', ''), 'active');
      if v_sku is null or char_length(v_sku) > 64 or v_sku !~ '^[A-Za-z0-9][A-Za-z0-9._/-]*$' then
        raise exception 'mp:sku_invalid:%', coalesce(v_sku, '') using errcode = '22023';
      end if;
      if v_unit is null or v_unit not in ('piece', 'roll', 'board', 'bar', 'linear_meter', 'square_meter', 'pack') then
        raise exception 'mp:selling_unit_invalid:%', v_sku using errcode = '22023';
      end if;
      if (e ->> 'price_egp') is null or (e ->> 'price_egp') !~ '^[0-9]{1,10}(\.[0-9]{1,2})?$' then
        raise exception 'mp:price_invalid:%', v_sku using errcode = '22023';
      end if;
      v_price := (e ->> 'price_egp')::numeric;
      if v_price <= 0 then
        raise exception 'mp:price_invalid:%', v_sku using errcode = '22023';
      end if;
      if v_vstatus not in ('active', 'inactive') then
        raise exception 'mp:variant_status_invalid:%', v_sku using errcode = '22023';
      end if;

      if v_vid is null then
        -- a SKU already owned by ANOTHER product of the seller is a conflict
        if exists (select 1 from public.marketplace_product_variants
                   where seller_organization_id = v_org and sku = v_sku and product_id <> v_id) then
          raise exception 'mp:sku_taken:%', v_sku using errcode = '23505';
        end if;
        select id into v_vid from public.marketplace_product_variants where product_id = v_id and sku = v_sku;
        if v_vid is null then
          insert into public.marketplace_product_variants (product_id, seller_organization_id, sku, selling_unit, price_egp, status)
          values (v_id, v_org, v_sku, v_unit, v_price, v_vstatus)
          returning id into v_vid;
        end if;
      end if;
      if not exists (select 1 from public.marketplace_product_variants where id = v_vid and product_id = v_id) then
        raise exception 'mp:variant_not_found' using errcode = '42501';
      end if;
      update public.marketplace_product_variants
         set sku = v_sku, selling_unit = v_unit, price_egp = v_price, status = v_vstatus
       where id = v_vid;
      perform app.marketplace_seller_apply_attributes('variant', v_vid, v_type_id, e -> 'attributes', v_sku);
      v_keep := array_append(v_keep, v_vid);
    end loop;

    -- variants no longer in the form are deactivated, never deleted
    update public.marketplace_product_variants set status = 'inactive'
     where product_id = v_id and status = 'active' and not (id = any (v_keep));
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name, v_msg = message_text;
      -- our own precise conflicts (mp:sku_taken:..., mp:duplicate_sku_in_form) pass through unchanged
      if v_msg like 'mp:%' then
        raise exception '%', v_msg using errcode = '23505';
      end if;
      raise exception '%', case
        when v_constraint = 'ux_marketplace_products_slug' then 'mp:slug_taken'
        when v_constraint = 'ux_marketplace_products_seller_external_ref' then 'mp:external_ref_taken'
        when v_constraint = 'ux_marketplace_variants_seller_sku' then 'mp:sku_taken'
        when v_constraint = 'ux_marketplace_variants_product_signature' then 'mp:duplicate_variant_combination'
        else 'mp:duplicate' end using errcode = '23505';
  end;

  -- a published product edited into an unpublishable state leaves the shelf
  select status into v_status from public.marketplace_products where id = v_id;
  v_blockers := app.marketplace_publication_blockers(v_id);
  if v_status = 'published' and cardinality(v_blockers) > 0 then
    update public.marketplace_products set status = 'unpublished' where id = v_id;
    insert into public.marketplace_product_status_events (product_id, organization_id, action, from_status, to_status, actor_user_id)
    values (v_id, v_org, 'unpublished', 'published', 'unpublished', v_uid);
    v_status := 'unpublished';
  end if;

  return jsonb_build_object('id', v_id, 'created', v_created, 'status', v_status, 'blockers', to_jsonb(v_blockers),
    'variants', coalesce((select jsonb_agg(jsonb_build_object('id', pv.id, 'sku', pv.sku, 'status', pv.status) order by pv.created_at, pv.sku)
                         from public.marketplace_product_variants pv where pv.product_id = v_id), '[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Stock: main location + adjustments through the ledger
-- ---------------------------------------------------------------------------
create or replace function public.marketplace_seller_default_location(p_organization_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform app.marketplace_assert_seller_writer(p_organization_id);
  select id into v_id from public.marketplace_stock_locations
   where organization_id = p_organization_id and is_active order by (key = 'main') desc, created_at limit 1;
  if v_id is not null then
    return v_id;
  end if;
  insert into public.marketplace_stock_locations (organization_id, key, name_ar, name_en, kind, supports_pickup)
  values (p_organization_id, 'main', 'المخزن الرئيسي', 'Main stock', 'warehouse', false)
  on conflict (organization_id, key) do update set is_active = true
  returning id into v_id;
  return v_id;
end;
$$;

-- +/- stock for one variant at one location. Idempotent per key (a repeated
-- click with the same key changes nothing). `p_expected_on_hand`, when given,
-- refuses the change if someone else moved the stock since the caller looked.
create or replace function public.marketplace_seller_stock_adjust(
  p_variant_id uuid, p_location_id uuid, p_delta integer, p_idempotency_key text,
  p_reason text default null, p_expected_on_hand integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid;
  v_org  uuid;
  v_loc  public.marketplace_stock_locations;
  v_lvl  public.marketplace_inventory_levels;
  v_type text;
  r      record;
begin
  select seller_organization_id into v_org from public.marketplace_product_variants where id = p_variant_id;
  if v_org is null then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  v_uid := app.marketplace_assert_seller_writer(v_org);

  select * into v_loc from public.marketplace_stock_locations where id = p_location_id;
  if not found or v_loc.organization_id <> v_org then
    raise exception 'mp:location_invalid' using errcode = '42501';
  end if;
  if not v_loc.is_active then
    raise exception 'mp:location_inactive' using errcode = '23514';
  end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 100000 then
    raise exception 'mp:delta_invalid' using errcode = '22023';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 100 then
    raise exception 'mp:idempotency_key_invalid' using errcode = '22023';
  end if;

  select * into v_lvl from public.marketplace_inventory_levels
   where variant_id = p_variant_id and location_id = p_location_id for update;
  if p_expected_on_hand is not null and coalesce(v_lvl.on_hand, 0) <> p_expected_on_hand then
    -- a replay of an already-applied key is not a conflict
    if not exists (select 1 from public.marketplace_stock_movements
                   where seller_organization_id = v_org and idempotency_key = 'seller:' || p_idempotency_key) then
      -- NOT a serialization-failure SQLSTATE: PostgREST transparently retries those, which
      -- would turn this immediate refusal into a long hang.
      raise exception 'mp:stock_changed' using errcode = 'P0001';
    end if;
  end if;

  if v_lvl.variant_id is null then
    if p_delta < 0 then
      raise exception 'mp:insufficient_stock' using errcode = '23514';
    end if;
    v_type := 'initial';
  elsif p_delta > 0 then
    v_type := 'replenish';
  else
    v_type := 'correction';
  end if;

  begin
    select * into r from public.marketplace_stock_apply(
      v_org, p_variant_id, p_location_id, v_type, p_delta, 'seller:' || p_idempotency_key,
      coalesce(nullif(btrim(p_reason), ''), 'seller stock adjustment'), 'manual', null, null, v_uid);
  exception
    when check_violation then
      raise exception 'mp:insufficient_stock' using errcode = '23514';
  end;
  return jsonb_build_object('applied', r.applied, 'on_hand', r.on_hand, 'reserved', r.reserved, 'available', r.available);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Images: request -> upload -> confirm (server-checked) -> arrange / remove
-- ---------------------------------------------------------------------------
create or replace function app.marketplace_storage_can_upload_image(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.marketplace_product_images i
    join public.marketplace_products p on p.id = i.product_id
    where i.storage_bucket = 'marketplace-product-images' and i.object_key = p_key
      and i.upload_state = 'awaiting_upload'
      and app.marketplace_can_manage_catalog(p.seller_organization_id)
      and app.marketplace_seller_is_enabled(p.seller_organization_id));
$$;

create or replace function app.marketplace_storage_owns_image(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.marketplace_product_images i
    join public.marketplace_products p on p.id = i.product_id
    where i.storage_bucket = 'marketplace-product-images' and i.object_key = p_key
      and app.is_org_member(p.seller_organization_id));
$$;

-- the object may be deleted by a catalogue manager once its row is gone or still awaiting upload
create or replace function app.marketplace_storage_can_delete_image(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
     and split_part(p_key, '/', 1) ~ '^[0-9a-f-]{36}$'
     and app.marketplace_can_manage_catalog(split_part(p_key, '/', 1)::uuid)
     and not exists (select 1 from public.marketplace_product_images i
                     where i.storage_bucket = 'marketplace-product-images' and i.object_key = p_key
                       and i.upload_state = 'confirmed');
$$;

create policy marketplace_images_insert_authorized on storage.objects
  for insert to authenticated
  with check (bucket_id = 'marketplace-product-images' and app.marketplace_storage_can_upload_image(name));
create policy marketplace_images_select_member on storage.objects
  for select to authenticated
  using (bucket_id = 'marketplace-product-images' and app.marketplace_storage_owns_image(name));
create policy marketplace_images_delete_unreferenced on storage.objects
  for delete to authenticated
  using (bucket_id = 'marketplace-product-images' and app.marketplace_storage_can_delete_image(name));
-- No UPDATE policy: an object key is immutable; a replacement is a new object.

create or replace function public.marketplace_seller_image_request_upload(
  p_product_id uuid, p_content_type text, p_variant_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org  uuid;
  v_ext  text;
  v_id   uuid := gen_random_uuid();
  v_key  text;
  v_sort integer;
  v_open integer;
begin
  select seller_organization_id into v_org from public.marketplace_products where id = p_product_id;
  if v_org is null then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  perform app.marketplace_assert_seller_writer(v_org);
  v_ext := case p_content_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' end;
  if v_ext is null then
    raise exception 'mp:image_type_invalid' using errcode = '22023';
  end if;
  if p_variant_id is not null and not exists (
       select 1 from public.marketplace_product_variants where id = p_variant_id and product_id = p_product_id) then
    raise exception 'mp:variant_not_found' using errcode = '42501';
  end if;
  select count(*) into v_open from public.marketplace_product_images where product_id = p_product_id and status <> 'rejected';
  if v_open >= 30 then
    raise exception 'mp:too_many_images' using errcode = '23514';
  end if;

  v_key := v_org::text || '/' || p_product_id::text || '/' || v_id::text || '.' || v_ext;
  select coalesce(max(sort_order) + 1, 0) into v_sort from public.marketplace_product_images
   where product_id = p_product_id and variant_id is not distinct from p_variant_id;
  insert into public.marketplace_product_images
    (id, product_id, variant_id, storage_provider, storage_bucket, object_key, sort_order, is_primary, status, mime_type, upload_state)
  values (v_id, p_product_id, p_variant_id, 'supabase_storage', 'marketplace-product-images', v_key, v_sort, false,
          'pending', p_content_type, 'awaiting_upload');
  return jsonb_build_object('image_id', v_id, 'bucket', 'marketplace-product-images', 'object_key', v_key);
end;
$$;

-- Confirms an upload ONLY when the object really exists in storage, and records
-- its real size and type from the storage metadata. Content stays `pending`
-- (unverified): uploading is not verification.
create or replace function public.marketplace_seller_image_confirm_upload(p_image_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  i      public.marketplace_product_images;
  v_org  uuid;
  o      record;
  v_primary boolean;
begin
  select * into i from public.marketplace_product_images where id = p_image_id for update;
  if not found then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  select seller_organization_id into v_org from public.marketplace_products where id = i.product_id;
  perform app.marketplace_assert_seller_writer(v_org);
  if i.upload_state = 'confirmed' then
    return jsonb_build_object('image_id', i.id, 'upload_state', 'confirmed', 'status', i.status);
  end if;

  select so.metadata into o from storage.objects so
   where so.bucket_id = i.storage_bucket and so.name = i.object_key;
  if not found then
    raise exception 'mp:upload_not_found' using errcode = '23514';
  end if;

  -- the first confirmed product-level image becomes the primary one
  v_primary := i.variant_id is null and not exists (
    select 1 from public.marketplace_product_images x
    where x.product_id = i.product_id and x.variant_id is null and x.is_primary and x.status <> 'rejected');
  update public.marketplace_product_images set
    upload_state = 'confirmed',
    is_primary = v_primary,
    byte_size = nullif(o.metadata ->> 'size', '')::bigint,
    mime_type = coalesce(nullif(o.metadata ->> 'mimetype', ''), i.mime_type)
  where id = i.id;
  return jsonb_build_object('image_id', i.id, 'upload_state', 'confirmed', 'status', 'pending', 'is_primary', v_primary);
end;
$$;

-- Arrange the product's confirmed images: order, primary, variant association, alt text.
-- p_images: [ { "id", "sort_order", "is_primary", "variant_id"?, "alt_text_ar"?, "alt_text_en"? } ]
create or replace function public.marketplace_seller_images_update(p_product_id uuid, p_images jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  e     jsonb;
  v_primaries integer;
begin
  select seller_organization_id into v_org from public.marketplace_products where id = p_product_id;
  if v_org is null then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  perform app.marketplace_assert_seller_writer(v_org);
  if p_images is null or jsonb_typeof(p_images) <> 'array' or jsonb_array_length(p_images) > 30 then
    raise exception 'mp:images_invalid' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_images) x
             where not exists (select 1 from public.marketplace_product_images i
                               where i.id = (x ->> 'id')::uuid and i.product_id = p_product_id)) then
    raise exception 'mp:image_not_found' using errcode = '42501';
  end if;
  if exists (select 1 from jsonb_array_elements(p_images) x
             where nullif(x ->> 'variant_id', '') is not null and not exists (
               select 1 from public.marketplace_product_variants v
               where v.id = (x ->> 'variant_id')::uuid and v.product_id = p_product_id)) then
    raise exception 'mp:variant_not_found' using errcode = '42501';
  end if;
  select count(*) into v_primaries from jsonb_array_elements(p_images) x
   where coalesce((x ->> 'is_primary')::boolean, false) and nullif(x ->> 'variant_id', '') is null;
  if v_primaries > 1 then
    raise exception 'mp:one_primary_image' using errcode = '23514';
  end if;

  -- two phases so a reorder never collides with the unique (product, order) index
  update public.marketplace_product_images i set sort_order = i.sort_order + 100000, is_primary = false
   where i.product_id = p_product_id and i.id in (select (x ->> 'id')::uuid from jsonb_array_elements(p_images) x);
  for e in select * from jsonb_array_elements(p_images) loop
    update public.marketplace_product_images set
      variant_id = nullif(e ->> 'variant_id', '')::uuid,
      sort_order = greatest(coalesce((e ->> 'sort_order')::integer, 0), 0),
      is_primary = coalesce((e ->> 'is_primary')::boolean, false) and nullif(e ->> 'variant_id', '') is null
                   and upload_state = 'confirmed',
      alt_text_ar = left(nullif(btrim(e ->> 'alt_text_ar'), ''), 300),
      alt_text_en = left(nullif(btrim(e ->> 'alt_text_en'), ''), 300)
    where id = (e ->> 'id')::uuid;
  end loop;
end;
$$;

-- Removes the image row and returns its object key so the caller deletes the
-- bytes (Postgres cannot delete a storage object itself).
create or replace function public.marketplace_seller_image_remove(p_image_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  i     public.marketplace_product_images;
  v_org uuid;
begin
  select * into i from public.marketplace_product_images where id = p_image_id for update;
  if not found then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  select seller_organization_id into v_org from public.marketplace_products where id = i.product_id;
  perform app.marketplace_assert_seller_writer(v_org);
  delete from public.marketplace_product_images where id = i.id;
  return i.object_key;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Grants & hardening
-- ---------------------------------------------------------------------------
revoke all on function
  public.marketplace_seller_product_save(jsonb),
  public.marketplace_seller_product_get(uuid),
  public.marketplace_seller_product_readiness(uuid),
  public.marketplace_seller_default_location(uuid),
  public.marketplace_seller_stock_adjust(uuid, uuid, integer, text, text, integer),
  public.marketplace_seller_image_request_upload(uuid, text, uuid),
  public.marketplace_seller_image_confirm_upload(uuid),
  public.marketplace_seller_images_update(uuid, jsonb),
  public.marketplace_seller_image_remove(uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  public.marketplace_seller_product_save(jsonb),
  public.marketplace_seller_product_get(uuid),
  public.marketplace_seller_product_readiness(uuid),
  public.marketplace_seller_default_location(uuid),
  public.marketplace_seller_stock_adjust(uuid, uuid, integer, text, text, integer),
  public.marketplace_seller_image_request_upload(uuid, text, uuid),
  public.marketplace_seller_image_confirm_upload(uuid),
  public.marketplace_seller_images_update(uuid, jsonb),
  public.marketplace_seller_image_remove(uuid)
  to authenticated;

-- Storage policies call their predicates as the querying role, so the three
-- `app.marketplace_storage_*` predicates are the ONLY app.marketplace_* functions
-- a client role may execute. They are SECURITY DEFINER and answer only yes/no
-- about the caller's own access to one object key.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname like 'marketplace\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.sig);
  end loop;
end;
$$;
grant execute on function app.marketplace_storage_can_upload_image(text) to authenticated;
grant execute on function app.marketplace_storage_owns_image(text) to authenticated;
grant execute on function app.marketplace_storage_can_delete_image(text) to authenticated;
