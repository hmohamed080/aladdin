-- Marketplace stock notifications: the English text carried the ARABIC product name (found on Acceptance 2026-11-24).
--
-- CAUSE: app.marketplace_stock_notify() passed ONE variable product_name = coalesce(name_ar, name_en), and
-- app.notify_from_template renders the same variable set into both languages.
--
-- FIX (EXPAND-only, same function signature, no drop):
--   * the trigger function now passes product_name (unchanged value, so a template an admin edited that still uses
--     {product_name} keeps working), product_name_ar = coalesce(name_ar, name_en) and
--     product_name_en = coalesce(name_en, name_ar);
--   * the two seeded templates' DEFAULT texts use {product_name_ar} / {product_name_en}, and their `variables` list
--     declares the new names. Admin override columns (title_*/body_*), version and updated_by are NOT touched: an edit
--     made by an admin stays exactly as saved, and the editor contract (version-checked saves) is unaffected.
-- The update is guarded on the old default text so a re-run, or a default that was changed some other way, is left alone.
-- No new permission, no new table or column.

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
      jsonb_build_object('product_name', coalesce(v_name_ar, v_name_en),
                         'product_name_ar', coalesce(v_name_ar, v_name_en),
                         'product_name_en', coalesce(v_name_en, v_name_ar),
                         'quantity', v_new,
                         'showroom_name', (select o.name from public.organizations o where o.id = v_org)));
  end loop;
  return null;
end;
$$;
revoke all on function app.marketplace_stock_notify() from public, anon, authenticated, service_role;

-- Default texts only (guarded on the previous default so nothing else is overwritten).
update public.notification_templates set
  variables = array['product_name', 'product_name_ar', 'product_name_en', 'quantity', 'showroom_name'],
  default_body_ar = 'المنتج {product_name_ar} تبقّى منه {quantity} فقط. أضف كمية لتجنّب سحبه من المتجر.',
  default_body_en = '{product_name_en} has only {quantity} left. Add stock to keep it on the Marketplace.'
 where key = 'marketplace.stock.low'
   and default_body_ar = 'المنتج {product_name} تبقّى منه {quantity} فقط. أضف كمية لتجنّب سحبه من المتجر.'
   and default_body_en = '{product_name} has only {quantity} left. Add stock to keep it on the Marketplace.';

update public.notification_templates set
  variables = array['product_name', 'product_name_ar', 'product_name_en', 'showroom_name'],
  default_body_ar = 'نفدت كمية المنتج {product_name_ar} وتم سحبه من المتجر. سيعود تلقائيًا عند إضافة كمية.',
  default_body_en = '{product_name_en} is out of stock and was withdrawn from the Marketplace. It returns automatically when you add stock.'
 where key = 'marketplace.stock.out'
   and default_body_ar = 'نفدت كمية المنتج {product_name} وتم سحبه من المتجر. سيعود تلقائيًا عند إضافة كمية.'
   and default_body_en = '{product_name} is out of stock and was withdrawn from the Marketplace. It returns automatically when you add stock.';
