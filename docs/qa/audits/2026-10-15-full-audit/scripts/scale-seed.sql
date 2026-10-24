-- DISPOSABLE audit stack ONLY (aladdin-audit-tmp). Synthetic scale data, triggers bypassed.
-- usage: psql -v n=5000 -f scale-seed.sql
\set ON_ERROR_STOP on
set session_replication_role = replica;
begin;
insert into public.marketplace_seller_accounts (organization_id, status, approved_at)
values ('9c000000-cccc-4ccc-8ccc-000000000001', 'approved', now())
on conflict (organization_id) do update set status = 'approved';
update public.marketplace_platform_settings set media_verification_ready = true;
insert into public.marketplace_stock_locations (organization_id, key, name_ar, name_en)
values ('9c000000-cccc-4ccc-8ccc-000000000001', 'main', 'الرئيسي', 'Main')
on conflict do nothing;

with t as (select id from public.marketplace_product_types where key = 'wallpaper'),
     base as (select coalesce(max((regexp_match(slug, 'scale-(\d+)'))[1]::int), 0) as start from public.marketplace_products where slug like 'scale-%'),
     p as (
  insert into public.marketplace_products (seller_organization_id, product_type_id, slug, name_ar, name_en, status, published_at, external_ref)
  select '9c000000-cccc-4ccc-8ccc-000000000001', t.id, 'scale-' || (base.start + g), 'منتج تجريبي ' || (base.start + g), 'Scale product ' || (base.start + g), 'published', now() - (g || ' seconds')::interval, 'SCALE-' || (base.start + g)
  from t, base, generate_series(1, :n) g
  returning id, external_ref),
  v as (
  insert into public.marketplace_product_variants (product_id, seller_organization_id, sku, selling_unit, price_egp)
  select p.id, '9c000000-cccc-4ccc-8ccc-000000000001', p.external_ref || '-' || k, 'roll', 300 + (abs(hashtext(p.external_ref)) % 900) + k
  from p, generate_series(1, 2) k
  returning id, product_id),
  img as (
  insert into public.marketplace_product_images (product_id, storage_provider, storage_bucket, object_key, status, upload_state, is_primary, content_valid, sort_order)
  select p.id, 'supabase_storage', 'marketplace-product-images', 'scale/' || p.id || '.jpg', 'verified', 'confirmed', true, true, 0 from p
  returning 1),
  inv as (
  insert into public.marketplace_inventory_levels (variant_id, location_id, seller_organization_id, on_hand)
  select v.id, (select id from public.marketplace_stock_locations where organization_id = '9c000000-cccc-4ccc-8ccc-000000000001' limit 1), '9c000000-cccc-4ccc-8ccc-000000000001', 10 from v
  returning 1)
insert into public.marketplace_variant_attribute_values (variant_id, attribute_id, data_type, option_id)
select v.id, d.id, 'option', (select o.id from public.marketplace_attribute_options o where o.attribute_id = d.id order by (hashtext(v.id::text) % 7 + o.sort_order) limit 1)
from v, public.marketplace_attribute_definitions d where d.key = 'color';
commit;
set session_replication_role = origin;
analyze public.marketplace_products, public.marketplace_product_variants, public.marketplace_product_images, public.marketplace_inventory_levels, public.marketplace_variant_attribute_values;
select count(*) as products from public.marketplace_products;
