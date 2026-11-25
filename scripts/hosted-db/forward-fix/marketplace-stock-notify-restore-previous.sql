-- Forward-fix "marketplace-stock-notify": restore what 20261124120001_marketplace_stock_notify_localized.sql changed.
-- NOT a down migration and NOT applied anywhere. Use only with the owner's explicit approval, on a hosted database, through the Supabase migration path
-- as a NEW migration (never the SQL Editor), and only if the localized stock notification must be undone.
--
-- Restores: app.marketplace_stock_notify() to its pre-plan definition (20261123130001: one variable product_name = coalesce(name_ar, name_en); the text below is
-- pg_get_functiondef read on the scratch pre-state, which has no function comment; proven: after this script md5 of pg_get_functiondef equals the pre-plan one, line endings
-- normalized; the ACL is unchanged because the migration used CREATE OR REPLACE with the same signature) and the DEFAULT texts + `variables` of the two templates
-- marketplace.stock.low / marketplace.stock.out.
-- The restored defaults put the Arabic product name in the English text again (the bug this plan fixes): that is the previous behaviour.
--
-- NOT touched: the admin override columns (title_*/body_*), version, updated_by, notification rows already written (a stored notification never changes).
--
-- Combined undo ORDER: this file FIRST (marketplace-stock-notify), THEN marketplace-slug (Acceptance plan marketplace-slug); for Production
-- marketplace-stock-notify, marketplace-slug, THEN marketplace-v2. Idempotent.
--
-- SAFETY: RAISES (nothing is changed) when an admin-edited text of either template uses {product_name_ar} or {product_name_en}: after the restore those names are no longer
-- an allowed variable, so the edit would render empty. Edited texts that only use {product_name} are fine. A template that is missing (marketplace-v2 already undone) is skipped.
begin;

do $guard$
declare n bigint;
begin
  select count(*) into n from public.notification_templates t
   where t.key in ('marketplace.stock.low', 'marketplace.stock.out')
     and (coalesce(t.title_ar, '') || ' ' || coalesce(t.body_ar, '') || ' ' || coalesce(t.title_en, '') || ' ' || coalesce(t.body_en, '')) ~ '\{product_name_(ar|en)\}';
  if n <> 0 then
    raise exception 'marketplace-stock-notify forward-fix refused: % stock template(s) were edited to use product_name_ar / product_name_en; reset or rewrite them first', n;
  end if;
end
$guard$;

-- app.marketplace_stock_notify()
CREATE OR REPLACE FUNCTION app.marketplace_stock_notify()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

update public.notification_templates set
  variables = array['product_name', 'quantity', 'showroom_name'],
  default_body_ar = 'المنتج {product_name} تبقّى منه {quantity} فقط. أضف كمية لتجنّب سحبه من المتجر.',
  default_body_en = '{product_name} has only {quantity} left. Add stock to keep it on the Marketplace.'
 where key = 'marketplace.stock.low';
update public.notification_templates set
  variables = array['product_name', 'showroom_name'],
  default_body_ar = 'نفدت كمية المنتج {product_name} وتم سحبه من المتجر. سيعود تلقائيًا عند إضافة كمية.',
  default_body_en = '{product_name} is out of stock and was withdrawn from the Marketplace. It returns automatically when you add stock.'
 where key = 'marketplace.stock.out';

commit;
