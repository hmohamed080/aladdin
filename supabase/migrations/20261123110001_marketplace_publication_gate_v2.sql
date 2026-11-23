-- Marketplace PR 7: publication gate v2 + product form (owner decisions 2026-11-19 Part 3, 2026-11-21).
--
-- WHAT CHANGES
--   1. GATE.   Missing publish conditions are now real, form-collectable facts: the seller must have a payment
--              method enabled and a way to deliver (a priced delivery place or pickup). They join the blocker list
--              (`seller_no_payment_method`, `seller_no_delivery`); the UI shows them as required fields, not as a
--              blocker table. Reads the existing settings tables only; it does not write them (PR 8 owns them).
--              They are required only at the moment a product becomes published, never retroactively: a published
--              product is NOT unpublished (on save or otherwise) because its seller lacks them.
--   2. MEDIA.  A product holds at most 5 live images (1 video + 4 images once the Marketplace video path exists).
--   3. TYPE.   The product type is changeable; the category follows it (the category is derived from the type).
--   4. STOCK.  Per-product low-stock threshold; in-app notifications to the showroom owner for low stock and out of
--              stock (templates marketplace.stock.low / marketplace.stock.out). A product with nothing to sell is
--              WITHDRAWN from the listing surfaces (catalog, facets, product page), not shown as sold out. The
--              withdrawal is computed, so restocking brings the product back with no manual step.
--   5. SUSPENSION. When a seller leaves 'approved' (suspended / revoked / ...), every published product is
--              unpublished at once by a trigger on marketplace_seller_accounts (so app.marketplace_seller_transition
--              is untouched). Reinstatement does NOT republish.
--   6. SWITCH. Platform flag `marketplace_open` (default open): when closed every public read and the checkout answer
--              as if no seller were enabled. Changed only by admin_marketplace_set_open (permission
--              marketplace_platform.manage, Super Admin), with a mandatory reason, audited with the acting admin.
--   7. LIST.   marketplace_seller_products_page returns a review state (approved / pending_review / rejected /
--              no_image) beside the price and uses the per-product low-stock threshold.
--
-- PERMISSION DECISION: a NEW permission marketplace_platform.manage. Opening or closing the whole public Marketplace is
-- a different power from approving one seller (marketplace_sellers.manage) or moderating images
-- (marketplace_media.moderate); it is Super Admin only and locked.

-- ---------------------------------------------------------------------------
-- 0. Helper: add values to an `x in (...)` CHECK without forgetting what other migrations added
-- ---------------------------------------------------------------------------
create or replace function pg_temp.extend_in_check(p_table regclass, p_constraint text, p_column text, p_new text[])
returns void language plpgsql as $f$
declare
  v_def  text;
  v_vals text[];
begin
  select pg_get_constraintdef(c.oid) into v_def from pg_constraint c where c.conrelid = p_table and c.conname = p_constraint;
  if v_def is null then raise exception 'constraint % not found', p_constraint; end if;
  select coalesce(array_agg(distinct m[1]), '{}') into v_vals from regexp_matches(v_def, '''([^'']+)''::text', 'g') as m;
  v_vals := (select array_agg(distinct x order by x) from unnest(v_vals || p_new) x);
  execute format('alter table %s drop constraint %I', p_table, p_constraint);
  execute format('alter table %s add constraint %I check (%I in (%s))', p_table, p_constraint, p_column,
                 (select string_agg(quote_literal(x), ', ' order by x) from unnest(v_vals) x));
end;
$f$;

-- ---------------------------------------------------------------------------
-- 1. Permission + platform switch
-- ---------------------------------------------------------------------------
insert into public.admin_permissions (key, resource, action, description, sort_order) values
  ('marketplace_platform.manage', 'marketplace_platform', 'manage',
   'Open or close the public Marketplace (Super Admin only; every change is audited with the acting admin).', 113)
on conflict (key) do nothing;
insert into public.admin_role_permissions (role_id, permission_key, is_locked)
select r.id, 'marketplace_platform.manage', true from public.admin_roles r where r.is_system and r.key = 'super_admin'
on conflict do nothing;

alter table public.marketplace_platform_settings add column marketplace_open boolean not null default true;
comment on column public.marketplace_platform_settings.marketplace_open is
  'FALSE closes the public Marketplace: public catalog, product pages, images, cart and checkout answer as if no seller were enabled. Sellers can still prepare products. Changed only by admin_marketplace_set_open.';

select pg_temp.extend_in_check('public.marketplace_platform_events'::regclass, 'ck_marketplace_platform_action', 'action',
  array['media_verification_enabled', 'media_verification_disabled', 'marketplace_opened', 'marketplace_closed']);

create or replace function app.marketplace_is_open()
returns boolean language sql stable set search_path = '' as $$
  select coalesce((select s.marketplace_open from public.marketplace_platform_settings s where s.singleton), true);
$$;

-- "may this seller's products be SEEN by the public": enabled AND the Marketplace is open.
create or replace function app.marketplace_seller_is_public(p_organization_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select app.marketplace_is_open() and app.marketplace_seller_is_enabled(p_organization_id);
$$;

-- "is the product on the shelf": at least one active variant has units to sell. A product with none is withdrawn.
create or replace function app.marketplace_product_is_listed(p_product_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from public.marketplace_product_variants v
                 where v.product_id = p_product_id and v.status = 'active' and app.marketplace_variant_available(v.id) > 0);
$$;

revoke all on function app.marketplace_is_open(), app.marketplace_seller_is_public(uuid), app.marketplace_product_is_listed(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.admin_marketplace_set_open(p_open boolean, p_reason text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid;
begin
  v_uid := app.marketplace_assert_admin_permission('marketplace_platform.manage');
  if p_open is null or p_reason is null or char_length(btrim(p_reason)) not between 3 and 300 then
    raise exception 'mp:reason_required' using errcode = '22023';
  end if;
  if app.marketplace_is_open() = p_open then
    return p_open;
  end if;
  update public.marketplace_platform_settings set marketplace_open = p_open where singleton;
  insert into public.marketplace_platform_events (action, detail, actor_user_id)
  values (case when p_open then 'marketplace_opened' else 'marketplace_closed' end,
          jsonb_build_object('reason', btrim(p_reason)), v_uid);
  return p_open;
end;
$$;

create or replace function public.admin_marketplace_platform_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'mp:auth_required' using errcode = '42501';
  end if;
  if not (app.has_admin_permission('marketplace_platform.manage') or app.has_admin_permission('marketplace_sellers.read')
          or app.has_admin_permission('marketplace_sellers.manage')) then
    raise exception 'mp:not_permitted' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'open', app.marketplace_is_open(),
    'can_manage', app.has_admin_permission('marketplace_platform.manage'),
    'last_change', (select jsonb_build_object('action', e.action, 'at', e.created_at, 'reason', e.detail ->> 'reason',
                                              'actor_user_id', e.actor_user_id,
                                              'actor_name', (select coalesce(pr.display_name, pr.display_name_en, pr.display_name_ar)
                                                             from public.profiles pr where pr.user_id = e.actor_user_id limit 1))
                    from public.marketplace_platform_events e where e.action in ('marketplace_opened', 'marketplace_closed')
                    order by e.sequence desc limit 1));
end;
$$;

revoke all on function public.admin_marketplace_set_open(boolean, text), public.admin_marketplace_platform_status()
  from public, anon, authenticated, service_role;
grant execute on function public.admin_marketplace_set_open(boolean, text), public.admin_marketplace_platform_status() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Public surfaces honour the switch (and the stock withdrawal on listing surfaces)
-- ---------------------------------------------------------------------------
-- The public functions are large and owned by earlier migrations; their definitions are patched in place so nothing
-- else about them changes. Every patch is asserted, so a drifted definition fails the migration instead of silently
-- leaving the Marketplace open. tests/144 re-asserts it, so a later PR that redefines one of them must keep the gate.
do $patch$
declare
  v_oid regprocedure;
  v_def text;
  v_new text;
  v_stock_gate text[] := array['marketplace_public_catalog', 'marketplace_public_catalog_page', 'marketplace_public_facets', 'marketplace_public_product'];
  v_n integer := 0;
begin
  for v_oid in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app') and p.prosrc like '%app.marketplace_seller_is_enabled(p.seller_organization_id)%'
      and p.prosrc like '%p.status = ''published''%'
  loop
    v_def := pg_get_functiondef(v_oid);
    v_new := replace(v_def, 'app.marketplace_seller_is_enabled(p.seller_organization_id)', 'app.marketplace_seller_is_public(p.seller_organization_id)');
    if (select p.proname from pg_proc p where p.oid = v_oid) = any (v_stock_gate) then
      v_new := replace(v_new, 'p.status = ''published''', 'p.status = ''published'' and app.marketplace_product_is_listed(p.id)');
      if v_new not like '%marketplace_product_is_listed(p.id)%' then raise exception 'stock gate patch failed for %', v_oid; end if;
    end if;
    if v_new = v_def or v_new not like '%marketplace_seller_is_public(%' then raise exception 'open gate patch failed for %', v_oid; end if;
    execute v_new;
    v_n := v_n + 1;
  end loop;
  if v_n < 7 then raise exception 'expected to gate 7 public functions, gated %', v_n; end if;
end
$patch$;

-- ---------------------------------------------------------------------------
-- 3. Product: per-product low-stock threshold; the type may change
-- ---------------------------------------------------------------------------
alter table public.marketplace_products
  add column low_stock_threshold integer not null default 5,
  add constraint ck_marketplace_products_low_stock check (low_stock_threshold between 0 and 100000);
comment on column public.marketplace_products.low_stock_threshold is
  'Units at or below which the showroom owner is notified once (0 = never). Set per product by the seller.';

-- product_type_id may change only inside marketplace_seller_product_save (flag), never by a direct write
do $patch$
declare
  v_def text := pg_get_functiondef('app.marketplace_product_guard()'::regprocedure);
  v_new text;
begin
  v_new := replace(v_def,
    E'if new.seller_organization_id is distinct from old.seller_organization_id\n       or new.product_type_id is distinct from old.product_type_id then\n      raise exception ''marketplace product seller and product type are immutable'' using errcode = ''23514'';\n    end if;',
    E'if new.seller_organization_id is distinct from old.seller_organization_id then\n      raise exception ''marketplace product seller is immutable'' using errcode = ''23514'';\n    end if;\n    if new.product_type_id is distinct from old.product_type_id\n       and current_setting(''app.marketplace_type_change'', true) is distinct from ''on'' then\n      raise exception ''marketplace product type changes only through the seller save'' using errcode = ''23514'';\n    end if;');
  if v_new = v_def then raise exception 'product guard patch failed'; end if;
  execute v_new;
end
$patch$;

-- ---------------------------------------------------------------------------
-- 4. Image limit: 5 live slots per product
-- ---------------------------------------------------------------------------
do $patch$
declare
  v_oid regprocedure;
  v_def text;
  v_new text;
begin
  v_def := pg_get_functiondef('public.marketplace_seller_image_request_upload(uuid,text,uuid)'::regprocedure);
  v_new := replace(v_def, 'if v_open >= 30 then', 'if v_open >= 5 then');
  if v_new = v_def then raise exception 'image limit patch failed (request_upload)'; end if;
  execute v_new;
  v_def := pg_get_functiondef('public.marketplace_seller_images_update(uuid,jsonb)'::regprocedure);
  v_new := replace(v_def, 'jsonb_array_length(p_images) > 30', 'jsonb_array_length(p_images) > 5');
  if v_new = v_def then raise exception 'image limit patch failed (images_update)'; end if;
  execute v_new;
end
$patch$;

-- ---------------------------------------------------------------------------
-- 5. Gate: payment method + delivery are publish conditions (data that exists today)
-- ---------------------------------------------------------------------------
create or replace function app.marketplace_seller_payment_ready(p_organization_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from public.marketplace_seller_payment_settings s
                 where s.seller_organization_id = p_organization_id and (s.cod_enabled or s.instapay_enabled));
$$;

create or replace function app.marketplace_seller_delivery_ready(p_organization_id uuid)
returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from public.marketplace_delivery_rates r where r.seller_organization_id = p_organization_id and r.fee_egp is not null)
      or exists (select 1 from public.marketplace_stock_locations l
                 where l.organization_id = p_organization_id and l.is_active and l.supports_pickup);
$$;
revoke all on function app.marketplace_seller_payment_ready(uuid), app.marketplace_seller_delivery_ready(uuid)
  from public, anon, authenticated, service_role;

-- Same definition as 20261116100009 plus the two seller-level conditions (appended last, so existing consumers that
-- read the first reasons keep their order).
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

  if not app.marketplace_seller_is_eligible(v_seller) then
    v_blockers := array_append(v_blockers, 'seller_organization_not_eligible'::text);
  end if;
  if not exists (select 1 from public.marketplace_seller_accounts a where a.organization_id = v_seller and a.status = 'approved') then
    v_blockers := array_append(v_blockers, 'seller_not_approved'::text);
  end if;

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

  if exists (select 1 from public.marketplace_product_variants
             where product_id = p_product_id and status = 'active' and (price_egp is null or price_egp <= 0)) then
    v_blockers := array_append(v_blockers, 'invalid_variant_price'::text);
  end if;

  if v_count > 0 and not exists (
       select 1 from public.marketplace_product_variants pv
       where pv.product_id = p_product_id and pv.status = 'active'
         and app.marketplace_variant_available(pv.id) > 0) then
    v_blockers := array_append(v_blockers, 'no_available_stock'::text);
  end if;

  if not app.marketplace_product_has_publishable_image(p_product_id) then
    v_blockers := array_append(v_blockers, 'no_verified_primary_image'::text);
  end if;
  if not app.marketplace_media_verification_ready() then
    v_blockers := array_append(v_blockers, 'media_verification_not_available'::text);
  end if;

  if not app.marketplace_seller_payment_ready(v_seller) then
    v_blockers := array_append(v_blockers, 'seller_no_payment_method'::text);
  end if;
  if not app.marketplace_seller_delivery_ready(v_seller) then
    v_blockers := array_append(v_blockers, 'seller_no_delivery'::text);
  end if;

  return v_blockers;
end;
$$;

-- What the product page needs besides the product itself: no blocker list, just the facts that drive the required
-- fields, the review record and whether Publish is available.
create or replace function public.marketplace_seller_product_publication_state(p_product_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  p public.marketplace_products;
  v_blockers text[];
  v_review text;
begin
  select * into p from public.marketplace_products where id = p_product_id;
  if not found then
    raise exception 'mp:not_found' using errcode = '42501';
  end if;
  perform app.marketplace_assert_seller_reader(p.seller_organization_id);
  v_blockers := app.marketplace_publication_blockers(p_product_id);
  v_review := app.marketplace_product_review_state(p_product_id);
  return jsonb_build_object(
    'status', p.status,
    'low_stock_threshold', p.low_stock_threshold,
    'review_state', v_review,
    'payment_ready', app.marketplace_seller_payment_ready(p.seller_organization_id),
    'delivery_ready', app.marketplace_seller_delivery_ready(p.seller_organization_id),
    'listed', app.marketplace_product_is_listed(p_product_id),
    'blockers', to_jsonb(v_blockers),
    'can_publish', p.status in ('draft', 'unpublished') and cardinality(v_blockers) = 0);
end;
$$;

create or replace function app.marketplace_product_review_state(p_product_id uuid)
returns text language sql stable set search_path = '' as $$
  select case
    when app.marketplace_product_has_publishable_image(p_product_id) then 'approved'
    when exists (select 1 from public.marketplace_product_images i
                 where i.product_id = p_product_id and i.status = 'pending' and i.upload_state = 'confirmed') then 'pending_review'
    when exists (select 1 from public.marketplace_product_images i
                 where i.product_id = p_product_id and i.status = 'rejected' and i.upload_state = 'confirmed') then 'rejected'
    else 'no_image' end;
$$;
revoke all on function app.marketplace_product_review_state(uuid) from public, anon, authenticated, service_role;
revoke all on function public.marketplace_seller_product_publication_state(uuid) from public, anon, authenticated, service_role;
grant execute on function public.marketplace_seller_product_publication_state(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Seller save: changeable type (category follows) + low-stock threshold
-- ---------------------------------------------------------------------------
-- Payload additions: "low_stock_threshold"?: integer 0..100000; "product_type_key" on an existing product now CHANGES
-- the type (attributes are replaced by the payload's, validated against the new type).
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
  v_low      integer;
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

  -- product type: chosen on create, freely changeable afterwards (the category is derived from it)
  if v_id is null or (nullif(p_payload ->> 'product_type_key', '') is not null
        and not exists (select 1 from public.marketplace_product_types t
                        where t.id = v_type_id and t.key = p_payload ->> 'product_type_key')) then
    select t.id into v_type_id
    from public.marketplace_product_types t join public.marketplace_categories c on c.id = t.category_id
    where t.key = p_payload ->> 'product_type_key' and t.is_active and c.is_active;
    if v_type_id is null then
      raise exception 'mp:product_type_invalid' using errcode = '22023';
    end if;
  end if;

  if p_payload ? 'low_stock_threshold' and nullif(p_payload ->> 'low_stock_threshold', '') is not null then
    if (p_payload ->> 'low_stock_threshold') !~ '^[0-9]{1,6}$' then
      raise exception 'mp:low_stock_invalid' using errcode = '22023';
    end if;
    v_low := (p_payload ->> 'low_stock_threshold')::integer;
    if v_low > 100000 then
      raise exception 'mp:low_stock_invalid' using errcode = '22023';
    end if;
  end if;

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
  if exists (select 1 from jsonb_array_elements(v_variants) x
             group by upper(btrim(x ->> 'sku')) having count(*) > 1) then
    raise exception 'mp:duplicate_sku_in_form' using errcode = '23505';
  end if;

  begin
    if v_id is null then
      v_id := gen_random_uuid();
      insert into public.marketplace_products
        (id, seller_organization_id, product_type_id, slug, name_ar, name_en, description_ar, description_en, brand, external_ref, status, low_stock_threshold)
      values (v_id, v_org, v_type_id,
              coalesce(v_slug, app.marketplace_import_slug(v_name_en, v_org, coalesce(v_ref, v_id::text))),
              v_name_ar, v_name_en, v_desc_ar, v_desc_en, v_brand, v_ref, 'draft', coalesce(v_low, 5));
      v_created := true;
    else
      perform set_config('app.marketplace_type_change', 'on', true);
      update public.marketplace_products set
        product_type_id = v_type_id,
        name_ar = v_name_ar, name_en = v_name_en, description_ar = v_desc_ar, description_en = v_desc_en,
        brand = v_brand, external_ref = v_ref, slug = coalesce(v_slug, slug),
        low_stock_threshold = coalesce(v_low, low_stock_threshold)
      where id = v_id;
      perform set_config('app.marketplace_type_change', 'off', true);
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

    update public.marketplace_product_variants set status = 'inactive'
     where product_id = v_id and status = 'active' and not (id = any (v_keep));
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name, v_msg = message_text;
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

  select status into v_status from public.marketplace_products where id = v_id;
  v_blockers := app.marketplace_publication_blockers(v_id);
  -- Payment method and delivery are conditions for BECOMING published only (owner decision 2026-11-23): a store that
  -- later loses them keeps its published products, so they never count in the save-time unpublish decision.
  if v_status = 'published' and cardinality(array(
       select b from unnest(v_blockers) b where b not in ('seller_no_payment_method', 'seller_no_delivery'))) > 0 then
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
-- 7. Seller product list: review record beside the price, per-product low stock
-- ---------------------------------------------------------------------------
create or replace function public.marketplace_seller_products_page(
  p_organization_id uuid, p_query text default null, p_type text default null, p_status text default null,
  p_stock text default null, p_limit integer default 20, p_offset integer default 0)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit  integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_q      text := nullif(lower(btrim(coalesce(p_query, ''))), '');
  v_result jsonb;
begin
  perform app.marketplace_assert_seller_reader(p_organization_id);
  with base as (
    select p.id, p.slug, p.name_ar, p.name_en, p.description_ar, p.description_en, p.status, p.created_at,
           p.low_stock_threshold as low_threshold,
           app.marketplace_product_review_state(p.id) as review_state,
           t.key as type_key, t.name_ar as type_name_ar, t.name_en as type_name_en,
           coalesce((select array_agg(v.sku order by v.created_at, v.sku) from public.marketplace_product_variants v
                     where v.product_id = p.id and v.status = 'active'), '{}') as skus,
           coalesce((select array_agg(v.id order by v.created_at, v.sku) from public.marketplace_product_variants v
                     where v.product_id = p.id and v.status = 'active'), '{}') as variant_ids,
           (select min(v.price_egp) from public.marketplace_product_variants v where v.product_id = p.id and v.status = 'active') as from_price,
           coalesce((select sum(greatest(l.available, 0)) from public.marketplace_inventory_levels l
                     join public.marketplace_product_variants v on v.id = l.variant_id and v.status = 'active'
                     join public.marketplace_stock_locations sl on sl.id = l.location_id and sl.is_active
                     where v.product_id = p.id), 0) as quantity
    from public.marketplace_products p
    join public.marketplace_product_types t on t.id = p.product_type_id
    where p.seller_organization_id = p_organization_id
  ),
  filtered as (
    select b.* from base b
    where (coalesce(p_type, '') = '' or b.type_key = p_type)
      and (coalesce(p_status, '') = '' or b.status = p_status)
      and (coalesce(p_stock, '') = ''
           or (p_stock = 'out' and b.quantity <= 0)
           or (p_stock = 'low' and b.quantity > 0 and b.quantity <= b.low_threshold)
           or (p_stock = 'in' and b.quantity > b.low_threshold))
      and (v_q is null or position(v_q in lower(b.name_ar)) > 0 or position(v_q in lower(b.name_en)) > 0
           or exists (select 1 from unnest(b.skus) k where position(v_q in lower(k)) > 0))
  ),
  page as (
    select f.* from filtered f order by f.created_at desc, f.id limit v_limit offset v_offset
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'limit', v_limit, 'offset', v_offset,
    'stats', (select jsonb_build_object(
                'total', count(*),
                'published', count(*) filter (where status = 'published'),
                'draft', count(*) filter (where status = 'draft'),
                'low_stock', count(*) filter (where status <> 'archived' and quantity > 0 and quantity <= low_threshold),
                'out_of_stock', count(*) filter (where status <> 'archived' and quantity <= 0),
                'variants', coalesce(sum(cardinality(skus)), 0)) from base),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'slug', s.slug, 'name_ar', s.name_ar, 'name_en', s.name_en,
               'description_ar', s.description_ar, 'description_en', s.description_en, 'status', s.status,
               'review_state', s.review_state, 'low_stock_threshold', s.low_threshold,
               'type_key', s.type_key, 'type_name_ar', s.type_name_ar, 'type_name_en', s.type_name_en,
               'skus', to_jsonb(s.skus[1:3]), 'variant_count', cardinality(s.skus),
               'from_price', s.from_price, 'quantity', s.quantity,
               'inline_stock', case when cardinality(s.variant_ids) = 1 then (
                  select case
                    when count(*) = 0 then jsonb_build_object('variant_id', s.variant_ids[1], 'location_id', null,
                                                              'on_hand', 0, 'reserved', 0, 'available', 0)
                    when count(*) = 1 then jsonb_build_object('variant_id', s.variant_ids[1], 'location_id', min(l.location_id::text),
                                                              'on_hand', min(l.on_hand), 'reserved', min(l.reserved), 'available', min(l.available))
                  end
                  from public.marketplace_inventory_levels l
                  join public.marketplace_stock_locations sl on sl.id = l.location_id and sl.is_active
                  where l.variant_id = s.variant_ids[1]) end,
               'cover_key', (select x.object_key from public.marketplace_product_images x
                             where x.product_id = s.id and x.upload_state = 'confirmed' and x.status <> 'rejected'
                             order by (x.variant_id is not null), (not x.is_primary), x.sort_order limit 1))
             order by s.created_at desc, s.id)
      from page s), '[]'::jsonb))
  into v_result;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. Suspended / revoked seller: products leave the shelf at once
-- ---------------------------------------------------------------------------
create or replace function app.marketplace_seller_unpublish_all()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  p record;
  v_actor uuid := (select auth.uid());
begin
  for p in select id from public.marketplace_products where seller_organization_id = new.organization_id and status = 'published' for update loop
    update public.marketplace_products set status = 'unpublished' where id = p.id;
    insert into public.marketplace_product_status_events (product_id, organization_id, action, from_status, to_status, actor_user_id)
    values (p.id, new.organization_id, 'unpublished', 'published', 'unpublished', v_actor);
  end loop;
  return null;
end;
$$;
revoke all on function app.marketplace_seller_unpublish_all() from public, anon, authenticated, service_role;
create trigger marketplace_seller_unpublish_all
  after update of status on public.marketplace_seller_accounts
  for each row when (old.status = 'approved' and new.status is distinct from 'approved')
  execute function app.marketplace_seller_unpublish_all();

-- ---------------------------------------------------------------------------
-- 9. Low-stock / out-of-stock notifications to the showroom owner (sale notifications: orders PR)
-- ---------------------------------------------------------------------------
select pg_temp.extend_in_check('public.notifications'::regclass, 'ck_notifications_event_type_known', 'event_type',
  array['marketplace.stock.low', 'marketplace.stock.out']);

insert into public.notification_templates
  (key, event_type, variables, default_title_ar, default_body_ar, default_title_en, default_body_en) values
  ('marketplace.stock.low', 'marketplace.stock.low', array['product_name', 'quantity', 'showroom_name'],
   'المخزون على وشك النفاد',
   'المنتج {product_name} تبقّى منه {quantity} فقط. أضف كمية لتجنّب سحبه من المتجر.',
   'Stock is running low',
   '{product_name} has only {quantity} left. Add stock to keep it on the Marketplace.'),
  ('marketplace.stock.out', 'marketplace.stock.out', array['product_name', 'showroom_name'],
   'نفد مخزون منتجك',
   'نفدت كمية المنتج {product_name} وتم سحبه من المتجر. سيعود تلقائيًا عند إضافة كمية.',
   'A product is out of stock',
   '{product_name} is out of stock and was withdrawn from the Marketplace. It returns automatically when you add stock.')
on conflict (key) do nothing;

create or replace function app.marketplace_stock_notify()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_product uuid;
  v_status  text;
  v_org     uuid;
  v_thr     integer;
  v_name_ar text;
  v_name_en text;
  v_active  boolean;
  v_new     integer;
  v_old     integer;
  v_tpl     text;
  v_owner   uuid;
begin
  select v.product_id, (v.status = 'active') into v_product, v_active from public.marketplace_product_variants v where v.id = new.variant_id;
  if v_product is null or not v_active then return null; end if;
  if not exists (select 1 from public.marketplace_stock_locations l where l.id = new.location_id and l.is_active) then return null; end if;
  select p.status, p.seller_organization_id, p.low_stock_threshold, p.name_ar, p.name_en
    into v_status, v_org, v_thr, v_name_ar, v_name_en from public.marketplace_products p where p.id = v_product;
  if v_status = 'archived' then return null; end if;

  select coalesce(sum(greatest(l.available, 0)), 0)::integer into v_new
    from public.marketplace_inventory_levels l
    join public.marketplace_product_variants v on v.id = l.variant_id and v.status = 'active'
    join public.marketplace_stock_locations sl on sl.id = l.location_id and sl.is_active
   where v.product_id = v_product;
  v_old := greatest(v_new - (new.available - old.available), 0);

  if v_old > 0 and v_new <= 0 then
    v_tpl := 'marketplace.stock.out';
  elsif v_thr > 0 and v_old > v_thr and v_new > 0 and v_new <= v_thr then
    v_tpl := 'marketplace.stock.low';
  else
    return null;
  end if;

  for v_owner in
    select m.user_id from public.memberships m
      join public.membership_capabilities c on c.membership_id = m.id and c.capability_key = 'org.manage'
     where m.organization_id = v_org and m.status = 'active'
  loop
    perform app.notify_from_template(v_owner, v_org, v_tpl, 'marketplace_product', v_product,
      '/showroom/marketplace/products/' || v_product::text || '/edit',
      jsonb_build_object('product_name', coalesce(v_name_ar, v_name_en), 'quantity', v_new,
                         'showroom_name', (select o.name from public.organizations o where o.id = v_org)));
  end loop;
  return null;
end;
$$;
revoke all on function app.marketplace_stock_notify() from public, anon, authenticated, service_role;
create trigger marketplace_stock_notify
  after update of on_hand, reserved on public.marketplace_inventory_levels
  for each row when (old.available is distinct from new.available)
  execute function app.marketplace_stock_notify();
