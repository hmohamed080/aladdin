-- pgTAP: Marketplace Migration 14 — checkout, orders and showroom payment methods
-- (20261112100014_marketplace_orders.sql).
--
--   A. SHAPE       RPC-only tables, authenticated-only RPCs, append-only timeline.
--   B. SETTINGS    only an org.manage member saves payment methods; InstaPay needs address, name, deposit.
--   C. CART        the public cart tells which payment methods each showroom accepts.
--   D. CHECKOUT    signed-in buyer; prices from the database; one order per showroom; stock reserved;
--                  idempotent replay; refusals for unavailable delivery / payment / stock / changed cart.
--   E. COD         confirm consumes the reservation; ship -> deliver -> collect; illegal steps refused.
--   F. INSTAPAY    receipt through the central media system (buyer's documents folder); reject ->
--                  re-upload -> accept; confirm only after acceptance; 100 % deposit = collected.
--   G. CANCEL      buyer cancels while pending (units released); showroom cancels with a reason
--                  after confirmation (units come back); delivery_failed -> returned restocks.
--   H. ISOLATION   another showroom, a member without order rights, and other buyers see nothing.
--
-- Fixtures (seed-pilot): showroom A 9c000000-…001 (owner 70000001, org.manage + order.manage;
-- 70000002 sales-only member), showroom B 91000005-…005 (owner 71000005), buyer 70000009.
create extension if not exists pgtap;

begin;
select no_plan();

update auth.users set email_confirmed_at = now()
  where id in ('70000001-0000-4000-8000-000000000001', '70000002-0000-4000-8000-000000000002',
               '71000005-0000-4000-8000-000000000005', '70000009-0000-4000-8000-000000000009');
select set_config('t.a', '9c000000-cccc-4ccc-8ccc-000000000001', true);
select set_config('t.b', '91000005-1111-4111-8111-000000000005', true);
select set_config('t.seller', '70000001-0000-4000-8000-000000000001', true);
select set_config('t.buyer', '70000009-0000-4000-8000-000000000009', true);

select set_config('app.marketplace_seller_write', 'on', true);
insert into public.marketplace_seller_accounts (organization_id, status, approved_at)
values (current_setting('t.a')::uuid, 'approved', now()), (current_setting('t.b')::uuid, 'approved', now())
on conflict (organization_id) do update set status = 'approved', approved_at = now();
select set_config('app.marketplace_seller_write', 'off', true);

create function pg_temp.as_user(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.order_stock(p_sku text) returns text language sql as $$
  select l.on_hand || '/' || l.reserved from public.marketplace_inventory_levels l
  join public.marketplace_product_variants v on v.id = l.variant_id
  where v.sku = p_sku and v.seller_organization_id = current_setting('t.a')::uuid;
$$;

-- ---------------------------------------------------------------------------
-- fixture: two published products of showroom A with stock, delivery prices and pickup
-- ---------------------------------------------------------------------------
set local role authenticated;
select pg_temp.as_user(current_setting('t.seller'));
select set_config('t.p1', (public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'), 'product_type_key', 'wallpaper', 'name_ar', 'ورق طلبات', 'name_en', 'Order paper',
  'variants', jsonb_build_array(jsonb_build_object('sku', 'ORD-1', 'selling_unit', 'roll', 'price_egp', 100)))) ->> 'id'), true);
select set_config('t.p2', (public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'), 'product_type_key', 'wallpaper', 'name_ar', 'ورق ثاني', 'name_en', 'Second paper',
  'variants', jsonb_build_array(jsonb_build_object('sku', 'ORD-2', 'selling_unit', 'roll', 'price_egp', 250)))) ->> 'id'), true);
select set_config('t.loc', public.marketplace_seller_default_location(current_setting('t.a')::uuid)::text, true);
select public.marketplace_seller_stock_adjust((select id from public.marketplace_product_variants where sku = 'ORD-1'),
  current_setting('t.loc')::uuid, 10, 'ord-stock-0001');
select public.marketplace_seller_stock_adjust((select id from public.marketplace_product_variants where sku = 'ORD-2'),
  current_setting('t.loc')::uuid, 5, 'ord-stock-0002');
select public.marketplace_seller_delivery_areas_save(current_setting('t.a')::uuid, '[{"governorate_key":"cairo"}]'::jsonb);
select public.marketplace_seller_delivery_prices_save(current_setting('t.a')::uuid, '[{"governorate_key":"cairo","fee_egp":50}]'::jsonb);
select public.marketplace_seller_pickup_set(current_setting('t.a')::uuid, true);
reset role;
set local session_replication_role = replica;
update public.marketplace_products set status = 'published', published_at = now()
 where id in (current_setting('t.p1')::uuid, current_setting('t.p2')::uuid);
set local session_replication_role = origin;
select set_config('t.slug1', (select slug from public.marketplace_products where id = current_setting('t.p1')::uuid), true);
select set_config('t.slug2', (select slug from public.marketplace_products where id = current_setting('t.p2')::uuid), true);

-- ===========================================================================
-- A. Shape
-- ===========================================================================
select is((select count(*)::int from information_schema.role_table_grants
           where table_name in ('marketplace_orders', 'marketplace_order_items', 'marketplace_order_events',
                                'marketplace_payment_proofs', 'marketplace_seller_payment_settings')
             and grantee in ('anon', 'authenticated', 'service_role')), 0,
  'A1. order tables have no client grant (RPC-only)');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('marketplace_checkout_place', 'marketplace_buyer_orders',
             'marketplace_buyer_order_get', 'marketplace_buyer_order_cancel', 'marketplace_seller_orders_page',
             'marketplace_seller_order_get', 'marketplace_seller_order_transition', 'marketplace_buyer_proof_request_upload',
             'marketplace_buyer_proof_confirm', 'marketplace_seller_proof_review', 'marketplace_seller_payment_settings_get',
             'marketplace_seller_payment_settings_save')
             and p.prosecdef and has_function_privilege('authenticated', p.oid, 'execute')
             and not has_function_privilege('anon', p.oid, 'execute')), 12,
  'A2. the twelve order RPCs are SECURITY DEFINER and authenticated-only (never anon)');

-- ===========================================================================
-- B. Payment settings
-- ===========================================================================
set local role authenticated;
select pg_temp.as_user('70000002-0000-4000-8000-000000000002');
select throws_like($$ select public.marketplace_seller_payment_settings_save(current_setting('t.a')::uuid, '{"cod_enabled":true}'::jsonb) $$,
  'mp:not_permitted%', 'B1. a sales-only member cannot change payment methods');
select pg_temp.as_user(current_setting('t.seller'));
select throws_like($$ select public.marketplace_seller_payment_settings_save(current_setting('t.a')::uuid, '{"instapay_enabled":true}'::jsonb) $$,
  'mp:instapay_address_required%', 'B2. InstaPay needs an InstaPay address');
select throws_like($$ select public.marketplace_seller_payment_settings_save(current_setting('t.a')::uuid,
  '{"instapay_enabled":true,"instapay_address":"decore@instapay","instapay_account_name":"Decore Store","instapay_deposit_percent":0}'::jsonb) $$,
  'mp:deposit_percent_invalid%', 'B3. the deposit is 1-100 % of the order');
select is((public.marketplace_seller_payment_settings_save(current_setting('t.a')::uuid,
  '{"cod_enabled":true,"instapay_enabled":true,"instapay_address":"decore@instapay","instapay_account_name":"Decore Store","instapay_deposit_percent":30}'::jsonb)
  ->> 'instapay_deposit_percent'), '30', 'B4. the owner enables cash on delivery and a 30 % InstaPay deposit');

-- ===========================================================================
-- C. The cart shows the payment methods
-- ===========================================================================
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((public.marketplace_public_cart(jsonb_build_array(jsonb_build_object('slug', current_setting('t.slug1'), 'sku', 'ORD-1')), 'cairo')
           -> 'sellers' -> 0 -> 'payment_methods'),
  '{"cod": true, "instapay": {"deposit_percent": 30}}'::jsonb, 'C1. the cart names cash on delivery and the InstaPay deposit percentage');
select throws_ok($$ select public.marketplace_checkout_place('[]'::jsonb, '{}'::jsonb, '[]'::jsonb, 'anon-key-0001') $$, '42501', null,
  'C2. anon cannot place an order');
reset role;

-- ===========================================================================
-- D. Checkout
-- ===========================================================================
set local role authenticated;
select pg_temp.as_user(current_setting('t.buyer'));
select set_config('t.lines', jsonb_build_array(
  jsonb_build_object('slug', current_setting('t.slug1'), 'sku', 'ORD-1', 'qty', 3),
  jsonb_build_object('slug', current_setting('t.slug2'), 'sku', 'ORD-2', 'qty', 1))::text, true);
select set_config('t.contact', '{"name":"Test Buyer","phone":"01012345678","governorate":"cairo","address":"12 Nasr Road, Cairo"}', true);
select throws_like(format($$ select public.marketplace_checkout_place(%L::jsonb, %L::jsonb, '[{"index":1,"fulfilment":"delivery","payment":"cod"}]'::jsonb, 'ord-key-bad1') $$,
  current_setting('t.lines'), '{"name":"Test Buyer","phone":"01012345678","governorate":"giza","address":"12 Nasr Road, Cairo"}'),
  'mp:delivery_not_available%', 'D1. delivery to a place the showroom does not price is refused');
select throws_like(format($$ select public.marketplace_checkout_place(%L::jsonb, %L::jsonb, '[{"index":1,"fulfilment":"delivery","payment":"cod"}]'::jsonb, 'ord-key-bad2') $$,
  jsonb_build_array(jsonb_build_object('slug', current_setting('t.slug1'), 'sku', 'ORD-1', 'qty', 11))::text, current_setting('t.contact')),
  'mp:insufficient_stock:ORD-1%', 'D2. more than the available stock is refused');
select throws_like(format($$ select public.marketplace_checkout_place(%L::jsonb, %L::jsonb, '[{"index":1,"fulfilment":"delivery","payment":"cod"}]'::jsonb, 'ord-key-bad3') $$,
  jsonb_build_array(jsonb_build_object('slug', current_setting('t.slug1'), 'sku', 'NOPE-1', 'qty', 1))::text, current_setting('t.contact')),
  'mp:cart_changed%', 'D3. a line that is no longer for sale is refused (cart changed)');
select throws_like(format($$ select public.marketplace_checkout_place(%L::jsonb, %L::jsonb, '[{"index":1,"fulfilment":"delivery","payment":"cod"}]'::jsonb, 'ord-key-bad4') $$,
  current_setting('t.lines'), '{"name":"Test Buyer","phone":"abc","governorate":"cairo","address":"12 Nasr Road, Cairo"}'),
  'mp:buyer_phone_invalid%', 'D4. an invalid phone is refused');
select set_config('t.cod', (public.marketplace_checkout_place(current_setting('t.lines')::jsonb, current_setting('t.contact')::jsonb,
  '[{"index":1,"fulfilment":"delivery","payment":"cod"}]'::jsonb, 'ord-key-cod-0001') -> 'orders' -> 0 ->> 'id'), true);
reset role;
select is((select status || '/' || payment_status || '/' || subtotal_egp || '/' || delivery_fee_egp || '/' || total_egp
           from public.marketplace_orders where id = current_setting('t.cod')::uuid),
  'pending_confirmation/pending/550.00/50.00/600.00', 'D5. prices and the delivery fee come from the database (3 x 100 + 250 + 50)');
select is(pg_temp.order_stock('ORD-1'), '10/3', 'D6. the ordered units are RESERVED (on hand unchanged)');
select is((select count(*)::int from public.marketplace_order_items where order_id = current_setting('t.cod')::uuid), 2,
  'D7. both lines are snapshotted on the order');
set local role authenticated;
select pg_temp.as_user(current_setting('t.buyer'));
select is((public.marketplace_checkout_place(current_setting('t.lines')::jsonb, current_setting('t.contact')::jsonb,
  '[{"index":1,"fulfilment":"delivery","payment":"cod"}]'::jsonb, 'ord-key-cod-0001') ->> 'replayed')::boolean, true,
  'D8. replaying the same checkout key returns the placed order');
reset role;
select is(pg_temp.order_stock('ORD-1'), '10/3', 'D9. ...and reserves nothing twice');
select is((select count(*)::int from public.marketplace_order_events where order_id = current_setting('t.cod')::uuid and action = 'placed'), 1,
  'D10. the placement is on the timeline');

-- ===========================================================================
-- E. Cash on delivery
-- ===========================================================================
set local role authenticated;
select pg_temp.as_user(current_setting('t.seller'));
select throws_like(format($$ select public.marketplace_seller_order_transition(%L::uuid, 'ship') $$, current_setting('t.cod')),
  'mp:invalid_transition%', 'E1. an order cannot be shipped before it is confirmed');
select is(public.marketplace_seller_order_transition(current_setting('t.cod')::uuid, 'confirm') ->> 'status', 'confirmed',
  'E2. the showroom confirms a cash order');
reset role;
select is(pg_temp.order_stock('ORD-1'), '7/0', 'E3. confirmation consumes the reservation (units leave stock)');
set local role authenticated;
select pg_temp.as_user(current_setting('t.seller'));
select public.marketplace_seller_order_transition(current_setting('t.cod')::uuid, 'process');
select throws_like(format($$ select public.marketplace_seller_order_transition(%L::uuid, 'ready') $$, current_setting('t.cod')),
  'mp:invalid_transition%', 'E4. a delivery order cannot be marked ready for pickup');
select public.marketplace_seller_order_transition(current_setting('t.cod')::uuid, 'ship');
select throws_like(format($$ select public.marketplace_seller_order_transition(%L::uuid, 'collect') $$, current_setting('t.cod')),
  'mp:invalid_transition%', 'E5. cash cannot be collected before delivery');
select public.marketplace_seller_order_transition(current_setting('t.cod')::uuid, 'deliver');
select is(public.marketplace_seller_order_transition(current_setting('t.cod')::uuid, 'collect', 'paid at the door') ->> 'payment_status', 'collected',
  'E6. after delivery the showroom records the cash as collected');
reset role;
select is((select array_agg(action order by sequence) from public.marketplace_order_events where order_id = current_setting('t.cod')::uuid),
  array['placed', 'confirm', 'process', 'ship', 'deliver', 'collect'], 'E7. every step is on the timeline');
select throws_ok($$ update public.marketplace_order_events set note = 'x' $$, '23514', null, 'E8. the timeline is append-only');

-- ===========================================================================
-- F. InstaPay deposit
-- ===========================================================================
set local role authenticated;
select pg_temp.as_user(current_setting('t.buyer'));
select set_config('t.ip', (public.marketplace_checkout_place(
  jsonb_build_array(jsonb_build_object('slug', current_setting('t.slug2'), 'sku', 'ORD-2', 'qty', 2))::jsonb,
  current_setting('t.contact')::jsonb, '[{"index":1,"fulfilment":"pickup","payment":"instapay"}]'::jsonb, 'ord-key-ip-0001')
  -> 'orders' -> 0 ->> 'id'), true);
reset role;
select is((select payment_status || '/' || total_egp || '/' || deposit_egp || '/' || instapay_address from public.marketplace_orders
           where id = current_setting('t.ip')::uuid),
  'awaiting_deposit/500.00/150.00/decore@instapay', 'F1. pickup is free; the deposit is 30 % of 500 and the InstaPay address is on the order');
set local role authenticated;
select pg_temp.as_user(current_setting('t.seller'));
select throws_like(format($$ select public.marketplace_seller_order_transition(%L::uuid, 'confirm') $$, current_setting('t.ip')),
  'mp:deposit_not_accepted%', 'F2. an InstaPay order cannot be confirmed before its deposit is accepted');
select pg_temp.as_user(current_setting('t.buyer'));
select set_config('t.pr1', (public.marketplace_buyer_proof_request_upload(current_setting('t.ip')::uuid, 'image/png') ->> 'proof_id'), true);
reset role;
select set_config('t.k1', (select object_key from public.marketplace_payment_proofs where id = current_setting('t.pr1')::uuid), true);
select ok(current_setting('t.k1') like 'proofs/' || current_setting('t.ip') || '/%.png', 'F3. the receipt key is proofs/<order>/<id>.png');
select is(app.media_storage_key_for('marketplace', current_setting('t.k1'), current_setting('t.buyer')::uuid, current_setting('t.a')::uuid),
  'u/' || current_setting('t.buyer') || '/certificates/' || current_setting('t.pr1') || '/original.png',
  'F4. it is stored in the BUYER''s documents folder u/<buyer>/certificates/ (media architecture v3)');
set local role authenticated;
select pg_temp.as_user(current_setting('t.buyer'));
select is(public.media_storage_resolve('marketplace', current_setting('t.k1'), 'upload') ->> 'state', 'pending',
  'F5. the buyer may upload to the issued receipt key');
select throws_like(format($$ select public.marketplace_buyer_proof_confirm(%L::uuid) $$, current_setting('t.pr1')),
  'mp:upload_not_found%', 'F6. a receipt is not submitted before its bytes are verified');
reset role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.media_storage_reserve('marketplace', current_setting('t.k1'), 'r2', current_setting('t.buyer')::uuid);
select public.media_storage_attest('marketplace', current_setting('t.k1'), current_setting('t.buyer')::uuid, 'r2', 900, 'image/png', repeat('e', 64));
select ok((select storage_key from public.media_storage_locations where namespace = 'marketplace' and object_key = current_setting('t.k1'))
          = 'u/' || current_setting('t.buyer') || '/certificates/' || current_setting('t.pr1') || '/original.png',
  'F7. the reserved R2 key is the buyer documents path');
set local role authenticated;
select pg_temp.as_user(current_setting('t.buyer'));
select is(public.marketplace_buyer_proof_confirm(current_setting('t.pr1')::uuid) ->> 'payment_status', 'deposit_submitted',
  'F8. the verified receipt is submitted to the showroom');
select pg_temp.as_user(current_setting('t.seller'));
select is(public.media_storage_resolve('marketplace', current_setting('t.k1'), 'read') ->> 'state', 'ready',
  'F9. the showroom''s order manager can view the receipt');
select pg_temp.as_user('71000005-0000-4000-8000-000000000005');
select is(public.media_storage_resolve('marketplace', current_setting('t.k1'), 'read'), null, 'F10. another showroom cannot');
select pg_temp.as_user('70000002-0000-4000-8000-000000000002');
select is(public.media_storage_resolve('marketplace', current_setting('t.k1'), 'read'), null, 'F11. nor a member without order rights');
select pg_temp.as_user(current_setting('t.seller'));
select throws_like(format($$ select public.marketplace_seller_proof_review(%L::uuid, false) $$, current_setting('t.pr1')),
  'mp:reason_required%', 'F12. rejecting a receipt needs a reason');
select is(public.marketplace_seller_proof_review(current_setting('t.pr1')::uuid, false, 'amount does not match') ->> 'payment_status',
  'deposit_rejected', 'F13. the showroom rejects the receipt');
select pg_temp.as_user(current_setting('t.buyer'));
select set_config('t.pr2', (public.marketplace_buyer_proof_request_upload(current_setting('t.ip')::uuid, 'image/jpeg') ->> 'proof_id'), true);
reset role;
select set_config('t.k2', (select object_key from public.marketplace_payment_proofs where id = current_setting('t.pr2')::uuid), true);
set local request.jwt.claims = '{"role":"service_role"}';
select public.media_storage_reserve('marketplace', current_setting('t.k2'), 'r2', current_setting('t.buyer')::uuid);
select public.media_storage_attest('marketplace', current_setting('t.k2'), current_setting('t.buyer')::uuid, 'r2', 950, 'image/jpeg', repeat('f', 64));
set local role authenticated;
select pg_temp.as_user(current_setting('t.buyer'));
select public.marketplace_buyer_proof_confirm(current_setting('t.pr2')::uuid);
select pg_temp.as_user(current_setting('t.seller'));
select is(public.marketplace_seller_proof_review(current_setting('t.pr2')::uuid, true) ->> 'payment_status', 'deposit_accepted',
  'F14. after a new receipt, the showroom accepts the deposit');
select is(public.marketplace_seller_order_transition(current_setting('t.ip')::uuid, 'confirm') ->> 'status', 'confirmed',
  'F15. ...and can now confirm the order');
select public.marketplace_seller_order_transition(current_setting('t.ip')::uuid, 'process');
select throws_like(format($$ select public.marketplace_seller_order_transition(%L::uuid, 'ship') $$, current_setting('t.ip')),
  'mp:invalid_transition%', 'F16. a pickup order is not shipped');
select public.marketplace_seller_order_transition(current_setting('t.ip')::uuid, 'ready');
select public.marketplace_seller_order_transition(current_setting('t.ip')::uuid, 'deliver');
select is(public.marketplace_seller_order_transition(current_setting('t.ip')::uuid, 'collect') ->> 'payment_status', 'collected',
  'F17. the rest is collected at handover');
reset role;
-- a 100 % deposit is a full payment once accepted
update public.marketplace_seller_payment_settings set instapay_deposit_percent = 100 where seller_organization_id = current_setting('t.a')::uuid;
set local role authenticated;
select pg_temp.as_user(current_setting('t.buyer'));
select set_config('t.full', (public.marketplace_checkout_place(
  jsonb_build_array(jsonb_build_object('slug', current_setting('t.slug1'), 'sku', 'ORD-1', 'qty', 1))::jsonb,
  current_setting('t.contact')::jsonb, '[{"index":1,"fulfilment":"pickup","payment":"instapay"}]'::jsonb, 'ord-key-full-001')
  -> 'orders' -> 0 ->> 'id'), true);
select set_config('t.pr3', (public.marketplace_buyer_proof_request_upload(current_setting('t.full')::uuid, 'image/png') ->> 'proof_id'), true);
reset role;
select set_config('t.k3', (select object_key from public.marketplace_payment_proofs where id = current_setting('t.pr3')::uuid), true);
set local request.jwt.claims = '{"role":"service_role"}';
select public.media_storage_reserve('marketplace', current_setting('t.k3'), 'r2', current_setting('t.buyer')::uuid);
select public.media_storage_attest('marketplace', current_setting('t.k3'), current_setting('t.buyer')::uuid, 'r2', 800, 'image/png', repeat('a', 64));
set local role authenticated;
select pg_temp.as_user(current_setting('t.buyer'));
select public.marketplace_buyer_proof_confirm(current_setting('t.pr3')::uuid);
select pg_temp.as_user(current_setting('t.seller'));
select is(public.marketplace_seller_proof_review(current_setting('t.pr3')::uuid, true) ->> 'payment_status', 'collected',
  'F18. an accepted 100 % deposit is a full payment');
reset role;

-- ===========================================================================
-- G. Cancellations
-- ===========================================================================
select is(pg_temp.order_stock('ORD-1'), '7/1', 'G0. fixture: one unit of ORD-1 is reserved by the pending full-deposit order');
set local role authenticated;
select pg_temp.as_user(current_setting('t.buyer'));
select is(public.marketplace_buyer_order_cancel(current_setting('t.full')::uuid, 'changed my mind') ->> 'payment_status', 'refund_due',
  'G1. the buyer cancels a pending order; an accepted payment becomes refund_due');
reset role;
select is(pg_temp.order_stock('ORD-1'), '7/0', 'G2. ...and its reserved unit is released');
set local role authenticated;
select pg_temp.as_user(current_setting('t.buyer'));
select throws_like(format($$ select public.marketplace_buyer_order_cancel(%L::uuid) $$, current_setting('t.ip')),
  'mp:order_not_cancellable%', 'G3. the buyer cannot cancel a delivered order');
select set_config('t.c2', (public.marketplace_checkout_place(
  jsonb_build_array(jsonb_build_object('slug', current_setting('t.slug1'), 'sku', 'ORD-1', 'qty', 2))::jsonb,
  current_setting('t.contact')::jsonb, '[{"index":1,"fulfilment":"delivery","payment":"cod"}]'::jsonb, 'ord-key-cod-0002')
  -> 'orders' -> 0 ->> 'id'), true);
select pg_temp.as_user(current_setting('t.seller'));
select public.marketplace_seller_order_transition(current_setting('t.c2')::uuid, 'confirm');
reset role;
select is(pg_temp.order_stock('ORD-1'), '5/0', 'G4. fixture: a confirmed order took 2 units');
set local role authenticated;
select pg_temp.as_user(current_setting('t.seller'));
select throws_like(format($$ select public.marketplace_seller_order_transition(%L::uuid, 'cancel') $$, current_setting('t.c2')),
  'mp:reason_required%', 'G5. the showroom must give a reason to cancel');
select is(public.marketplace_seller_order_transition(current_setting('t.c2')::uuid, 'cancel', 'out of this colour') ->> 'payment_status',
  'not_collected', 'G6. the showroom cancels a confirmed cash order');
reset role;
select is(pg_temp.order_stock('ORD-1'), '7/0', 'G7. ...and the units come back to stock');
set local role authenticated;
select pg_temp.as_user(current_setting('t.buyer'));
select set_config('t.c3', (public.marketplace_checkout_place(
  jsonb_build_array(jsonb_build_object('slug', current_setting('t.slug1'), 'sku', 'ORD-1', 'qty', 1))::jsonb,
  current_setting('t.contact')::jsonb, '[{"index":1,"fulfilment":"delivery","payment":"cod"}]'::jsonb, 'ord-key-cod-0003')
  -> 'orders' -> 0 ->> 'id'), true);
select pg_temp.as_user(current_setting('t.seller'));
select public.marketplace_seller_order_transition(current_setting('t.c3')::uuid, 'confirm');
select public.marketplace_seller_order_transition(current_setting('t.c3')::uuid, 'process');
select public.marketplace_seller_order_transition(current_setting('t.c3')::uuid, 'ship');
select is(public.marketplace_seller_order_transition(current_setting('t.c3')::uuid, 'fail', 'customer refused') ->> 'payment_status',
  'not_collected', 'G8. a refused delivery is not collected');
select public.marketplace_seller_order_transition(current_setting('t.c3')::uuid, 'return');
reset role;
select is(pg_temp.order_stock('ORD-1'), '7/0', 'G9. a returned order restocks its units');

-- ===========================================================================
-- H. Isolation
-- ===========================================================================
set local role authenticated;
select pg_temp.as_user('71000005-0000-4000-8000-000000000005');
select throws_like(format($$ select public.marketplace_seller_order_get(%L::uuid) $$, current_setting('t.cod')),
  'mp:not_found%', 'H1. another showroom cannot read the order');
select throws_like($$ select public.marketplace_seller_orders_page('9c000000-cccc-4ccc-8ccc-000000000001'::uuid) $$,
  'mp:not_found%', 'H2. ...nor list showroom A''s orders');
select throws_like(format($$ select public.marketplace_seller_order_transition(%L::uuid, 'cancel', 'not mine at all') $$, current_setting('t.c3')),
  'mp:not_found%', 'H3. ...nor change them');
select pg_temp.as_user('70000002-0000-4000-8000-000000000002');
select throws_like($$ select public.marketplace_seller_orders_page('9c000000-cccc-4ccc-8ccc-000000000001'::uuid) $$,
  'mp:not_found%', 'H4. a member without order rights sees no orders');
select pg_temp.as_user(current_setting('t.seller'));
select is((public.marketplace_buyer_orders() ->> 'total')::int, 0, 'H5. the showroom owner has no buyer orders of their own');
select throws_like(format($$ select public.marketplace_buyer_order_get(%L::uuid) $$, current_setting('t.cod')),
  'mp:not_found%', 'H6. a buyer reads only their own orders');
select pg_temp.as_user(current_setting('t.buyer'));
select is((public.marketplace_buyer_orders() ->> 'total')::int, 5, 'H7. the buyer lists their five orders');
select throws_like($$ select public.marketplace_seller_orders_page('9c000000-cccc-4ccc-8ccc-000000000001'::uuid) $$,
  'mp:not_found%', 'H8. the buyer cannot open the showroom''s order list');
reset role;

-- I. PostgREST runs RPCs with pg-safeupdate, which refuses DELETE / UPDATE without WHERE (psql here does not).
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname in ('public', 'app') and p.proname like 'marketplace%'
             and p.prosrc ~* '(delete\s+from|update)\s+[a-z_.]+\s*;'), 0,
  'I1. no marketplace function has a DELETE or UPDATE without WHERE (PostgREST safeupdate)');

select * from finish();
rollback;
