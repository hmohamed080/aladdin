-- pgTAP: Marketplace PR 9 — delivery estimate, cut-off, next day and free-shipping rules
-- (app.marketplace_delivery_terms / public.marketplace_public_delivery, 20261123130001).
--
-- The rules come from PR 8 (delivery + payment settings, 20261123120001). Without PR 8's tables the migration degrades to
-- "configured = false" (asserted in G); every rich assertion is skipped then. Dates are asserted relative to today in
-- Africa/Cairo so the file never depends on the day it runs.
create extension if not exists pgtap;

begin;
select plan(28);

select set_config('t.pr8', (to_regclass('public.marketplace_seller_delivery_settings') is not null
                            and exists (select 1 from pg_attribute a where a.attrelid = 'public.marketplace_delivery_rates'::regclass and a.attname = 'duration_min_days'))::text, true);
select set_config('t.a', '9c000000-cccc-4ccc-8ccc-000000000001', true);
select set_config('t.today', to_char(now() at time zone 'Africa/Cairo', 'YYYY-MM-DD'), true);
update auth.users set email_confirmed_at = now() where id = '70000001-0000-4000-8000-000000000001';
select set_config('app.marketplace_seller_write', 'on', true);
insert into public.marketplace_seller_accounts (organization_id, status, approved_at)
values (current_setting('t.a')::uuid, 'approved', now())
on conflict (organization_id) do update set status = 'approved', approved_at = now();
select set_config('app.marketplace_seller_write', 'off', true);
update public.organizations set slug = 'mkt9-showroom-a' where id = current_setting('t.a')::uuid;

set local role authenticated;
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}';
select set_config('t.p1', (public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'), 'product_type_key', 'wallpaper', 'name_ar', 'ورق حائط توصيل', 'name_en', 'Mkt9 delivery wallpaper',
  'slug', 'mkt9-delivery-wallpaper', 'attributes', jsonb_build_object('material_wallpaper', 'vinyl'),
  'variants', jsonb_build_array(jsonb_build_object('sku', 'MKT9-D-1', 'selling_unit', 'roll', 'price_egp', 450,
    'attributes', jsonb_build_object('color', 'beige', 'roll_width', 53, 'roll_length', 1000))))) ->> 'id'), true);
select set_config('t.p2', (public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'), 'product_type_key', 'wallpaper', 'name_ar', 'ورق حائط مجاني', 'name_en', 'Mkt9 free wallpaper',
  'slug', 'mkt9-free-wallpaper', 'attributes', jsonb_build_object('material_wallpaper', 'vinyl'),
  'variants', jsonb_build_array(jsonb_build_object('sku', 'MKT9-D-2', 'selling_unit', 'roll', 'price_egp', 90,
    'attributes', jsonb_build_object('color', 'cream', 'roll_width', 53, 'roll_length', 1000))))) ->> 'id'), true);
select set_config('t.loc', public.marketplace_seller_default_location(current_setting('t.a')::uuid)::text, true);
select public.marketplace_seller_stock_adjust((select id from public.marketplace_product_variants where sku = 'MKT9-D-1'), current_setting('t.loc')::uuid, 50, 'mkt9-d-stock-0001');
select public.marketplace_seller_stock_adjust((select id from public.marketplace_product_variants where sku = 'MKT9-D-2'), current_setting('t.loc')::uuid, 50, 'mkt9-d-stock-0002');
select public.marketplace_seller_delivery_areas_save(current_setting('t.a')::uuid, jsonb_build_array(
  jsonb_build_object('governorate_key', 'cairo'), jsonb_build_object('governorate_key', 'giza')));
select public.marketplace_seller_delivery_prices_save(current_setting('t.a')::uuid, jsonb_build_array(
  jsonb_build_object('governorate_key', 'cairo', 'fee_egp', 80), jsonb_build_object('governorate_key', 'giza', 'fee_egp', 120)));
reset role;
set local session_replication_role = replica;
update public.marketplace_products set status = 'published', published_at = now() where id in (current_setting('t.p1')::uuid, current_setting('t.p2')::uuid);
set local session_replication_role = origin;

-- ===========================================================================
-- G. Without PR 8: fee and pickup only
-- ===========================================================================
select case when not current_setting('t.pr8')::boolean
  then is(public.marketplace_public_delivery('mkt9-delivery-wallpaper', 'cairo') ->> 'configured', 'false', 'G1. without PR 8 the terms say configured = false')
  else skip(1, 'PR 8 applied') end;
select is(public.marketplace_public_delivery('mkt9-delivery-wallpaper', 'cairo') ->> 'fee_egp', '80.00', 'G2. the chosen place''s fee is always answered');

-- PR 8 data: preparation 2 days, giza slower, cairo has a next-day option and its own free-shipping threshold
do $$ begin
  if current_setting('t.pr8')::boolean then
    insert into public.marketplace_seller_delivery_settings (seller_organization_id, preparation_days, order_cutoff_time, free_shipping_min_egp, pickup_instructions)
    values (current_setting('t.a')::uuid, 2, '23:59:59', 1000, 'Ask for the front desk')
    on conflict (seller_organization_id) do update set preparation_days = 2, order_cutoff_time = '23:59:59', free_shipping_min_egp = 1000, pickup_instructions = 'Ask for the front desk';
    update public.marketplace_delivery_rates set duration_min_days = 1, duration_max_days = 2, next_day_available = true, next_day_fee_egp = 60, free_shipping_min_egp = 400
      where seller_organization_id = current_setting('t.a')::uuid and governorate_key = 'cairo';
    update public.marketplace_delivery_rates set duration_min_days = 3, duration_max_days = 5
      where seller_organization_id = current_setting('t.a')::uuid and governorate_key = 'giza';
    insert into public.marketplace_free_shipping_products (product_id, seller_organization_id)
    values (current_setting('t.p2')::uuid, current_setting('t.a')::uuid);
  end if;
end $$;

-- ===========================================================================
-- H. Estimate = [cut-off shift] + preparation + duration
-- ===========================================================================
select set_config('t.cairo', public.marketplace_public_delivery('mkt9-delivery-wallpaper', 'cairo')::text, true);
select case when current_setting('t.pr8')::boolean then is(current_setting('t.cairo')::jsonb ->> 'configured', 'true', 'H1. configured once PR 8 data is complete') else skip(1, 'PR 8 not applied') end;
select case when current_setting('t.pr8')::boolean then is((current_setting('t.cairo')::jsonb ->> 'min_days')::int, 3, 'H2. Cairo: prep 2 + 1 day = 3 (before cut-off)') else skip(1, 'PR 8 not applied') end;
select case when current_setting('t.pr8')::boolean then is((current_setting('t.cairo')::jsonb ->> 'max_days')::int, 4, 'H3. ...to prep 2 + 2 days = 4') else skip(1, 'PR 8 not applied') end;
select case when current_setting('t.pr8')::boolean then is(current_setting('t.cairo')::jsonb ->> 'earliest', to_char(current_setting('t.today')::date + 3, 'YYYY-MM-DD'), 'H4. the earliest date is today + 3') else skip(1, 'PR 8 not applied') end;
select case when current_setting('t.pr8')::boolean then is(current_setting('t.cairo')::jsonb ->> 'latest', to_char(current_setting('t.today')::date + 4, 'YYYY-MM-DD'), 'H5. the latest date is today + 4') else skip(1, 'PR 8 not applied') end;
select case when current_setting('t.pr8')::boolean then is((public.marketplace_public_delivery('mkt9-delivery-wallpaper', 'giza') ->> 'min_days')::int, 5, 'H6. Giza is slower: 2 + 3 = 5') else skip(1, 'PR 8 not applied') end;
select case when current_setting('t.pr8')::boolean then is(public.marketplace_public_delivery('mkt9-delivery-wallpaper') ->> 'min_days', '3', 'H7. no place chosen: the fastest place sets the low end') else skip(1, 'PR 8 not applied') end;
select case when current_setting('t.pr8')::boolean then is(public.marketplace_public_delivery('mkt9-delivery-wallpaper') ->> 'max_days', '7', 'H8. ...and the slowest place the high end (2 + 5)') else skip(1, 'PR 8 not applied') end;
select case when current_setting('t.pr8')::boolean then is(public.marketplace_public_delivery('mkt9-delivery-wallpaper') ->> 'fee_max_egp', '120.00', 'H9. ...with a fee range') else skip(1, 'PR 8 not applied') end;
select case when current_setting('t.pr8')::boolean then is(public.marketplace_public_delivery('mkt9-delivery-wallpaper', 'alexandria') ->> 'min_days', null, 'H10. a place the showroom does not cover has no estimate') else skip(1, 'PR 8 not applied') end;

-- ===========================================================================
-- I. Cut-off
-- ===========================================================================
select case when current_setting('t.pr8')::boolean then is(current_setting('t.cairo')::jsonb ->> 'cutoff_time', '23:59', 'I1. the cut-off is published as HH:MM') else skip(1, 'PR 8 not applied') end;
select case when current_setting('t.pr8')::boolean then is((current_setting('t.cairo')::jsonb ->> 'seconds_to_cutoff')::int > 0, true, 'I2. before the cut-off a countdown is available') else skip(1, 'PR 8 not applied') end;
update public.marketplace_seller_delivery_settings set order_cutoff_time = '00:00:00' where seller_organization_id = current_setting('t.a')::uuid and current_setting('t.pr8')::boolean;
select case when current_setting('t.pr8')::boolean then is((public.marketplace_public_delivery('mkt9-delivery-wallpaper', 'cairo') ->> 'min_days')::int, 4, 'I3. after the cut-off the order counts from tomorrow (+1)') else skip(1, 'PR 8 not applied') end;
select case when current_setting('t.pr8')::boolean then is(public.marketplace_public_delivery('mkt9-delivery-wallpaper', 'cairo') ->> 'seconds_to_cutoff', null, 'I4. ...and there is no countdown') else skip(1, 'PR 8 not applied') end;
update public.marketplace_seller_delivery_settings set order_cutoff_time = null where seller_organization_id = current_setting('t.a')::uuid and current_setting('t.pr8')::boolean;
select case when current_setting('t.pr8')::boolean then is((public.marketplace_public_delivery('mkt9-delivery-wallpaper', 'cairo') ->> 'min_days')::int, 3, 'I5. no cut-off: no shift') else skip(1, 'PR 8 not applied') end;

-- ===========================================================================
-- J. Next-day option and pickup
-- ===========================================================================
select case when current_setting('t.pr8')::boolean then is((current_setting('t.cairo')::jsonb -> 'next_day' ->> 'fee_egp')::numeric, 60.00, 'J1. Cairo offers next day for its extra fee') else skip(1, 'PR 8 not applied') end;
select case when current_setting('t.pr8')::boolean then is(current_setting('t.cairo')::jsonb -> 'next_day' ->> 'arrival', to_char(current_setting('t.today')::date + 1, 'YYYY-MM-DD'), 'J2. ...arriving tomorrow') else skip(1, 'PR 8 not applied') end;
select case when current_setting('t.pr8')::boolean then is(public.marketplace_public_delivery('mkt9-delivery-wallpaper', 'giza') ->> 'next_day', null, 'J3. Giza has no next-day option') else skip(1, 'PR 8 not applied') end;
select case when current_setting('t.pr8')::boolean then is(current_setting('t.cairo')::jsonb ->> 'pickup_instructions', 'Ask for the front desk', 'J4. pickup instructions are published only as text, no phone or address') else skip(1, 'PR 8 not applied') end;

-- ===========================================================================
-- K. Free shipping
-- ===========================================================================
select case when current_setting('t.pr8')::boolean then is(public.marketplace_public_delivery('mkt9-delivery-wallpaper', 'cairo') ->> 'free_shipping', 'true', 'K1. Cairo: the row threshold (400) is met by a 450 unit') else skip(1, 'PR 8 not applied') end;
select case when current_setting('t.pr8')::boolean then is(public.marketplace_public_delivery('mkt9-delivery-wallpaper', 'giza') ->> 'free_shipping', 'false', 'K2. Giza uses the showroom-wide threshold (1000): a 450 unit does not qualify') else skip(1, 'PR 8 not applied') end;
select case when current_setting('t.pr8')::boolean then is(public.marketplace_public_delivery('mkt9-free-wallpaper', 'giza') ->> 'free_reason', 'product', 'K3. a product flagged free ships free anywhere') else skip(1, 'PR 8 not applied') end;
select case when current_setting('t.pr8')::boolean then is((select (i -> 'free_shipping')::text from jsonb_array_elements(public.marketplace_public_browse(p_query => 'free wallpaper') -> 'items') i limit 1), 'true', 'K4. ...and its card carries the free-shipping badge') else skip(1, 'PR 8 not applied') end;
select case when current_setting('t.pr8')::boolean then is((select (i -> 'delivery' ->> 'min_days')::int from jsonb_array_elements(public.marketplace_public_browse(p_query => 'delivery wallpaper') -> 'items') i limit 1), 3, 'K5. the card carries the delivery estimate') else skip(1, 'PR 8 not applied') end;
select case when current_setting('t.pr8')::boolean then is((public.marketplace_public_browse(p_query => 'wallpaper', p_max_days => 3) ->> 'total')::int, 2, 'K6. the delivery-speed filter keeps products arriving within 3 days (both)') else skip(1, 'PR 8 not applied') end;
select case when current_setting('t.pr8')::boolean then is((public.marketplace_public_browse(p_query => 'delivery wallpaper', p_governorate => 'giza', p_max_days => 3) ->> 'total')::int, 0, 'K7. ...and drops a product whose estimate for the chosen place is slower') else skip(1, 'PR 8 not applied') end;

select * from finish();
rollback;
