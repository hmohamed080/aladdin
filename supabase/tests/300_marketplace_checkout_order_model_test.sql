-- pgTAP: Marketplace PR 12 — new checkout and order model (20261124120001_marketplace_checkout_order_model.sql)
-- Contract: docs/product/marketplace-order-model-contract-20261124.md
--
--   A. SHAPE        RPC-only tables, function privileges, hooks, the state guard.
--   B. PREPARE      server repricing (the client sends no price), delivery / pickup / next day / free shipping,
--                   phone and address readiness, own showroom, closed Marketplace, one seller, unknown lines.
--   C. CONFIRM      COD order: status new, stock PENDING, timer, seller notification, idempotent replay,
--                   idempotency conflict, quote changed, expiry, cart cleared.
--   D. INSTAPAY     receipt BEFORE confirm bound to the session (verify, limit, remove), attached at confirm,
--                   deposit and full amounts, no receipt for COD.
--   E. MACHINE      start_preparing -> mark_ready (DEDUCT) -> ship -> deliver -> collect; replays are no-ops;
--                   illegal steps refused; confirm/reject no longer exist; the legacy RPC cannot move a v2 order.
--   F. CANCEL       buyer (new only), seller with preset or custom reason, stock release / restock, payment effect.
--   G. RECEIPT      accept, «لم تصلني الفلوس», dispute freezes progress, resubmit, supersede.
--   H. STOCK        stock_state agrees with the stock ledger; last unit refused; the lock order.
--   I. ISOLATION    other buyer, other showroom, member without order rights, anon, receipts and media access.
--
-- Fixtures (seed-pilot): showroom A 9c000000-…001 (owner 70000001 with order.manage; 70000002 sales-only member),
-- showroom B 91000005-…005 (owner 71000005), buyer 70000009, second buyer 70000003.
create extension if not exists pgtap;

begin;
select no_plan();

update auth.users set email_confirmed_at = now()
  where id in ('70000001-0000-4000-8000-000000000001', '70000002-0000-4000-8000-000000000002',
               '71000005-0000-4000-8000-000000000005', '70000009-0000-4000-8000-000000000009',
               '70000003-0000-4000-8000-000000000003');
select set_config('t.a', '9c000000-cccc-4ccc-8ccc-000000000001', true);
select set_config('t.b', '91000005-1111-4111-8111-000000000005', true);
select set_config('t.seller', '70000001-0000-4000-8000-000000000001', true);
select set_config('t.sales', '70000002-0000-4000-8000-000000000002', true);
select set_config('t.sellerb', '71000005-0000-4000-8000-000000000005', true);
select set_config('t.buyer', '70000009-0000-4000-8000-000000000009', true);
select set_config('t.buyer2', '70000003-0000-4000-8000-000000000003', true);
select set_config('t.cairo_area', (select min(key) from app.place_cities where governorate_key = 'cairo'), true);

select set_config('app.marketplace_seller_write', 'on', true);
insert into public.marketplace_seller_accounts (organization_id, status, approved_at)
values (current_setting('t.a')::uuid, 'approved', now()), (current_setting('t.b')::uuid, 'approved', now())
on conflict (organization_id) do update set status = 'approved', approved_at = now();
select set_config('app.marketplace_seller_write', 'off', true);

create function pg_temp.as_user(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.stock(p_sku text) returns text language sql as $$
  select l.on_hand || '/' || l.reserved from public.marketplace_inventory_levels l
  join public.marketplace_product_variants v on v.id = l.variant_id
  where v.sku = p_sku and v.seller_organization_id = current_setting('t.a')::uuid;
$$;
-- the ledger agrees with the order's stock_state (sum of reserve/deduct/release/replenish movements for the order)
create function pg_temp.ledger(p_order text) returns text language sql as $$
  select coalesce(string_agg(m.movement_type || ':' || m.request_quantity, ',' order by m.created_at, case m.movement_type when 'reserve' then 1 when 'deduct' then 2 else 3 end, m.request_quantity), '')
  from public.marketplace_stock_movements m where m.reference_id = p_order;
$$;
create function pg_temp.prep(p_lines text, p_fulfil text, p_addr text, p_speed text, p_pay text, p_session text default null)
returns jsonb language sql as $$
  select public.marketplace_checkout_prepare(p_lines::jsonb, p_fulfil, nullif(p_addr, '')::uuid, p_speed, p_pay, nullif(p_session, '')::uuid);
$$;
-- attest a receipt's bytes as the central verifier would (service role), then confirm it as the buyer
create function pg_temp.attest(p_key text, p_owner text) returns void language plpgsql as $$
begin
  perform public.media_storage_reserve('marketplace', p_key, 'r2', p_owner::uuid);
  perform public.media_storage_attest('marketplace', p_key, p_owner::uuid, 'r2', 900, 'image/png', repeat('e', 64));
end;
$$;

-- ---------------------------------------------------------------------------
-- fixture: two published products of showroom A with stock; delivery, next day, payments, pickup
-- ---------------------------------------------------------------------------
reset role;
select pg_temp.as_user(current_setting('t.seller'));
select set_config('t.p1', (public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'), 'product_type_key', 'wallpaper', 'name_ar', 'ورق طلبات', 'name_en', 'Order paper',
  'variants', jsonb_build_array(jsonb_build_object('sku', 'CHK-1', 'selling_unit', 'roll', 'price_egp', 100)))) ->> 'id'), true);
select set_config('t.p2', (public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'), 'product_type_key', 'wallpaper', 'name_ar', 'ورق ثاني', 'name_en', 'Second paper',
  'variants', jsonb_build_array(jsonb_build_object('sku', 'CHK-2', 'selling_unit', 'roll', 'price_egp', 250)))) ->> 'id'), true);
select set_config('t.loc', public.marketplace_seller_default_location(current_setting('t.a')::uuid)::text, true);
select public.marketplace_seller_stock_adjust((select id from public.marketplace_product_variants where sku = 'CHK-1'),
  current_setting('t.loc')::uuid, 10, 'chk-stock-0001');
select public.marketplace_seller_stock_adjust((select id from public.marketplace_product_variants where sku = 'CHK-2'),
  current_setting('t.loc')::uuid, 1, 'chk-stock-0002');
select public.marketplace_seller_delivery_areas_save(current_setting('t.a')::uuid,
  jsonb_build_array(jsonb_build_object('governorate_key', 'cairo')));
select public.marketplace_seller_delivery_terms_save(current_setting('t.a')::uuid,
  jsonb_build_object('preparation_days', 2, 'pickup_instructions', 'Ask at reception'),
  jsonb_build_array(jsonb_build_object('governorate_key', 'cairo', 'fee_egp', 60, 'duration_min_days', 1, 'duration_max_days', 3,
                                       'next_day_available', true, 'next_day_fee_egp', 40)));
select public.marketplace_seller_payment_settings_save(current_setting('t.a')::uuid,
  '{"cod_enabled":true,"instapay_enabled":true,"instapay_full_enabled":true,"instapay_address":"decore@instapay","instapay_account_name":"Decore Store","instapay_deposit_percent":30}'::jsonb);
select public.marketplace_seller_pickup_set(current_setting('t.a')::uuid, true);
reset role;
set local session_replication_role = replica;
update public.marketplace_products set status = 'published', published_at = now()
 where id in (current_setting('t.p1')::uuid, current_setting('t.p2')::uuid);
set local session_replication_role = origin;
select set_config('t.s1', (select slug from public.marketplace_products where id = current_setting('t.p1')::uuid), true);
select set_config('t.s2', (select slug from public.marketplace_products where id = current_setting('t.p2')::uuid), true);
select set_config('t.lines', jsonb_build_array(
  jsonb_build_object('slug', current_setting('t.s1'), 'sku', 'CHK-1', 'qty', 3),
  jsonb_build_object('slug', current_setting('t.s2'), 'sku', 'CHK-2', 'qty', 1))::text, true);
select set_config('t.line1', jsonb_build_array(jsonb_build_object('slug', current_setting('t.s1'), 'sku', 'CHK-1', 'qty', 2))::text, true);

-- buyer: account phone verified, one saved Cairo address whose recipient mobile is that phone
update public.profiles set phone_e164 = '+201999000009', phone_country_iso2 = 'EG', phone_national = '01999000009', phone_verified_at = now()
  where user_id = current_setting('t.buyer')::uuid;
update public.profiles set phone_e164 = '+201999000003', phone_country_iso2 = 'EG', phone_national = '01999000003', phone_verified_at = null
  where user_id = current_setting('t.buyer2')::uuid;
delete from public.marketplace_buyer_addresses where user_id in (current_setting('t.buyer')::uuid, current_setting('t.buyer2')::uuid);
reset role;
select pg_temp.as_user(current_setting('t.buyer'));
select public.marketplace_buyer_address_save(jsonb_build_object('id', 'a0000000-0000-4000-8000-0000000000c1', 'kind', 'home',
  'governorate_key', 'cairo', 'area_key', current_setting('t.cairo_area'), 'street', '12 Example Street', 'building', '4', 'floor', '3',
  'apartment', '7', 'landmark', 'next to the pharmacy', 'recipient_first_name', 'Test', 'recipient_last_name', 'Buyer',
  'recipient_phone_e164', '+201999000009'));
select pg_temp.as_user(current_setting('t.buyer2'));
select public.marketplace_buyer_address_save(jsonb_build_object('id', 'a0000000-0000-4000-8000-0000000000c2', 'kind', 'home',
  'governorate_key', 'cairo', 'area_key', current_setting('t.cairo_area'), 'street', '9 Other Street', 'building', '1', 'floor', '1',
  'apartment', '1', 'landmark', 'near the mosque', 'recipient_first_name', 'Other', 'recipient_last_name', 'Buyer',
  'recipient_phone_e164', '+201999000003'));
reset role;
select set_config('t.addr', 'a0000000-0000-4000-8000-0000000000c1', true);
select set_config('t.addr2', 'a0000000-0000-4000-8000-0000000000c2', true);

-- ===========================================================================
-- A. Shape
-- ===========================================================================
select is((select bool_and(relrowsecurity) from pg_class where oid in ('public.marketplace_checkout_sessions'::regclass,
  'public.marketplace_order_cancellations'::regclass, 'public.marketplace_order_shipments'::regclass, 'public.marketplace_timers'::regclass)), true,
  'A1. the four new tables have RLS on');
select is((select count(*)::int from information_schema.role_table_grants
           where table_name in ('marketplace_checkout_sessions', 'marketplace_order_cancellations', 'marketplace_order_shipments', 'marketplace_timers')
             and grantee in ('anon', 'authenticated', 'service_role')), 0, 'A2. no client grant on the new tables (RPC-only)');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname in ('marketplace_checkout_prepare', 'marketplace_checkout_receipt_request_upload',
             'marketplace_checkout_receipt_confirm', 'marketplace_checkout_receipt_remove', 'marketplace_checkout_confirm',
             'marketplace_seller_order_action', 'marketplace_buyer_order_cancel_v2', 'marketplace_buyer_receipt_resubmit_request_upload',
             'marketplace_buyer_receipt_resubmit_confirm', 'marketplace_order_reason_presets')
             and p.prosecdef and exists (select 1 from unnest(p.proconfig) c where c = 'search_path=""')
             and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
             and not has_function_privilege('service_role', p.oid, 'execute')), 10,
  'A3. the ten public RPCs are SECURITY DEFINER, empty search_path, authenticated-only');
select is((select has_function_privilege('service_role', 'public.marketplace_checkout_sessions_purge(interval, integer)', 'execute')
           and not has_function_privilege('authenticated', 'public.marketplace_checkout_sessions_purge(interval, integer)', 'execute')
           and not has_function_privilege('anon', 'public.marketplace_checkout_sessions_purge(interval, integer)', 'execute')), true,
  'A4. the session purge is service-role only');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'app' and p.proname in ('marketplace_order_apply', 'marketplace_order_document_v2', 'marketplace_order_actions',
             'marketplace_checkout_quote', 'marketplace_checkout_quote_hash', 'marketplace_order_notify', 'marketplace_notify_order_managers',
             'marketplace_timer_open', 'marketplace_timer_close', 'marketplace_order_stock_alert', 'marketplace_order_complaint_id',
             'marketplace_order_extra_actions', 'marketplace_complaint_admin_can_read', 'marketplace_return_evidence_can_read',
             'marketplace_order_reason', 'marketplace_variant_label', 'marketplace_order_state_guard', 'marketplace_checkout_receipts')
             and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')
                  or has_function_privilege('service_role', p.oid, 'execute'))), 0,
  'A5. the internal functions and hooks have no client grant');
select is((select count(*)::int from public.marketplace_orders), 0, 'A6. the fixture starts with no orders');

-- ===========================================================================
-- B. Prepare: repricing, readiness, refusals
-- ===========================================================================
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok(format($$ select public.marketplace_checkout_prepare(%L::jsonb, 'delivery', null, 'standard', 'cod', null) $$, current_setting('t.lines')),
  '42501', null, 'B1. anon cannot prepare a checkout');
reset role;
reset role;
select pg_temp.as_user(current_setting('t.seller'));
select throws_like(format($$ select pg_temp.prep(%L, 'delivery', %L, 'standard', 'cod') $$, current_setting('t.lines'), current_setting('t.addr')),
  'mp:own_showroom%', 'B2. a member of the selling showroom cannot check out its products');

select pg_temp.as_user(current_setting('t.buyer'));
select set_config('t.r1', pg_temp.prep(current_setting('t.lines'), 'delivery', current_setting('t.addr'), 'standard', 'cod')::text, true);
select is((current_setting('t.r1')::jsonb -> 'quote' ->> 'subtotal_egp')::numeric, 550.00, 'B3. the subtotal is priced from the database (3 x 100 + 1 x 250)');
select is((current_setting('t.r1')::jsonb -> 'quote' ->> 'delivery_fee_egp')::numeric, 60.00, 'B4. the delivery fee is the showroom''s price for the address place');
select is((current_setting('t.r1')::jsonb -> 'quote' ->> 'total_egp')::numeric, 610.00, 'B5. total = subtotal + fee');
select is(current_setting('t.r1')::jsonb -> 'quote' -> 'delivery' -> 'estimate',
  jsonb_build_object('earliest', to_char((now() at time zone 'Africa/Cairo')::date + 3, 'YYYY-MM-DD'),
                     'latest', to_char((now() at time zone 'Africa/Cairo')::date + 5, 'YYYY-MM-DD')),
  'B6. the estimate is today (Cairo) + 2 preparation days + 1..3 delivery days, calendar days, no cut-off');
select is(current_setting('t.r1')::jsonb ->> 'ready', 'true', 'B7. with a saved address and a verified phone the checkout is ready');
select ok(not (current_setting('t.r1')::jsonb ? '_internal') and not (current_setting('t.r1')::jsonb -> 'quote' ? '_internal'), 'B8. nothing internal leaves the database');
select is(current_setting('t.r1')::jsonb -> 'quote' -> 'payment' -> 'methods_enabled',
  '{"cod": true, "instapay_full": true, "instapay_deposit": {"deposit_percent": 30}}'::jsonb, 'B9. the three payment methods the showroom enabled');
select is((current_setting('t.r1')::jsonb -> 'quote' -> 'lines' -> 0 ->> 'unit_price_egp')::numeric, 100.00,
  'B10. lines carry the database price: the request had only slug, sku and qty');
-- the browser cannot make the order cheaper: extra fields in a line are ignored
select is((pg_temp.prep(jsonb_build_array(jsonb_build_object('slug', current_setting('t.s1'), 'sku', 'CHK-1', 'qty', 1, 'price_egp', 1, 'unit_price_egp', 1))::text,
  'delivery', current_setting('t.addr'), 'standard', 'cod') -> 'quote' ->> 'subtotal_egp')::numeric, 100.00, 'B11. a price sent by the browser is ignored');
select is(pg_temp.prep(current_setting('t.lines'), 'delivery', current_setting('t.addr'), 'standard', null) -> 'quote' -> 'payment' ->> 'method', 'cod',
  'B12. with no payment chosen the first method the showroom offers is selected');
select is(pg_temp.prep(current_setting('t.lines'), 'delivery', null, 'standard', 'cod') -> 'missing', '["address_missing"]'::jsonb, 'B13. no address: address_missing');
select is(pg_temp.prep(current_setting('t.lines'), 'delivery', current_setting('t.addr2'), 'standard', 'cod') -> 'missing', '["address_missing"]'::jsonb,
  'B14. another buyer''s address id is treated as missing (no leak)');
select pg_temp.as_user(current_setting('t.buyer2'));
select is(pg_temp.prep(current_setting('t.lines'), 'delivery', current_setting('t.addr2'), 'standard', 'cod') -> 'missing', '["phone_unverified"]'::jsonb,
  'B15. an unverified account phone: phone_unverified (the closed decision: only the buyer''s own verified mobile counts)');
select pg_temp.as_user(current_setting('t.buyer'));
select is(pg_temp.prep(current_setting('t.lines'), 'delivery', current_setting('t.addr'), 'next_day', 'cod') -> 'quote' ->> 'delivery_fee_egp', '100.00',
  'B16. next day adds the extra fee (60 + 40)');
select is(pg_temp.prep(current_setting('t.lines'), 'delivery', current_setting('t.addr'), 'next_day', 'cod') -> 'quote' -> 'delivery' -> 'estimate',
  jsonb_build_object('earliest', to_char((now() at time zone 'Africa/Cairo')::date + 1, 'YYYY-MM-DD'),
                     'latest', to_char((now() at time zone 'Africa/Cairo')::date + 1, 'YYYY-MM-DD')), 'B17. next day arrives tomorrow');
select is(pg_temp.prep(current_setting('t.lines'), 'pickup', null, 'standard', 'cod') -> 'quote' ->> 'delivery_fee_egp', '0.00', 'B18. pickup is free');
select is(pg_temp.prep(current_setting('t.lines'), 'pickup', null, 'standard', 'cod') ->> 'ready', 'true', 'B19. pickup needs only the account''s verified phone');
select throws_like(format($$ select pg_temp.prep(%L, 'pickup', null, 'next_day', 'cod') $$, current_setting('t.lines')), 'mp:invalid_payload%', 'B20. next day is not a pickup option');
select throws_like(format($$ select pg_temp.prep(%L, 'courier', null, 'standard', 'cod') $$, current_setting('t.lines')), 'mp:invalid_fulfilment%', 'B21. unknown fulfilment refused');
select throws_like(format($$ select pg_temp.prep(%L, 'delivery', %L, 'standard', 'card') $$, current_setting('t.lines'), current_setting('t.addr')), 'mp:invalid_payment%', 'B22. unknown payment method refused');
select throws_like($$ select pg_temp.prep('[{"slug":"nope","sku":"X","qty":1}]', 'pickup', null, 'standard', 'cod') $$, 'mp:cart_changed%', 'B23. a line that is not for sale is refused (cart changed)');
select throws_like($$ select pg_temp.prep('[]', 'pickup', null, 'standard', 'cod') $$, 'mp:invalid_lines%', 'B24. an empty cart is refused');
select throws_like(format($$ select pg_temp.prep(%L, 'pickup', null, 'standard', 'cod') $$,
  jsonb_build_array(jsonb_build_object('slug', current_setting('t.s1'), 'sku', 'CHK-1', 'qty', 0))::text), 'mp:invalid_quantity%', 'B25. quantity 0 refused');
select throws_like(format($$ select pg_temp.prep(%L, 'pickup', null, 'standard', 'cod') $$,
  jsonb_build_array(jsonb_build_object('slug', current_setting('t.s1'), 'sku', 'CHK-1', 'qty', 1), jsonb_build_object('slug', current_setting('t.s1'), 'sku', 'CHK-1', 'qty', 2))::text),
  'mp:duplicate_line%', 'B26. the same variant twice refused');
select is(pg_temp.prep(jsonb_build_array(jsonb_build_object('slug', current_setting('t.s2'), 'sku', 'CHK-2', 'qty', 2))::text, 'pickup', null, 'standard', 'cod') -> 'missing',
  '["insufficient_stock"]'::jsonb, 'B27. more than the stock is reported as a missing item (the page can show it)');
select is(pg_temp.prep(current_setting('t.lines'), 'delivery', current_setting('t.addr'), 'standard', 'cod') -> 'quote' -> 'lines' -> 1 ->> 'available', '1', 'B28. availability is reported per line');

-- free shipping rules: threshold reached -> free; a mixed cart with one flagged product is not free
reset role;
update public.marketplace_delivery_rates set free_shipping_min_egp = 500 where seller_organization_id = current_setting('t.a')::uuid and area_key is null;
reset role;
select pg_temp.as_user(current_setting('t.buyer'));
select is(pg_temp.prep(current_setting('t.lines'), 'delivery', current_setting('t.addr'), 'standard', 'cod') -> 'quote' -> 'delivery' ->> 'free', 'true',
  'B29. the order reaches the free-shipping minimum: delivery is free');
select is(pg_temp.prep(current_setting('t.lines'), 'delivery', current_setting('t.addr'), 'next_day', 'cod') -> 'quote' ->> 'delivery_fee_egp', '40.00',
  'B30. free shipping does not pay for the faster next-day option');
reset role;
update public.marketplace_delivery_rates set free_shipping_min_egp = null where seller_organization_id = current_setting('t.a')::uuid;
insert into public.marketplace_free_shipping_products (product_id, seller_organization_id) values (current_setting('t.p1')::uuid, current_setting('t.a')::uuid);
reset role;
select pg_temp.as_user(current_setting('t.buyer'));
select is(pg_temp.prep(current_setting('t.lines'), 'delivery', current_setting('t.addr'), 'standard', 'cod') -> 'quote' ->> 'delivery_fee_egp', '60.00',
  'B31. only some products are flagged free: the fee is charged (open question 7)');
select is(pg_temp.prep(current_setting('t.line1'), 'delivery', current_setting('t.addr'), 'standard', 'cod') -> 'quote' ->> 'delivery_fee_egp', '0.00',
  'B32. every product in the order is flagged free: no delivery fee');
reset role;
delete from public.marketplace_free_shipping_products where product_id = current_setting('t.p1')::uuid;

-- a second showroom in the cart is refused (pilot rule)
reset role;
select pg_temp.as_user(current_setting('t.sellerb'));
select set_config('t.pb', (public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.b'), 'product_type_key', 'wallpaper', 'name_ar', 'ورق ب', 'name_en', 'B paper',
  'variants', jsonb_build_array(jsonb_build_object('sku', 'CHK-B1', 'selling_unit', 'roll', 'price_egp', 80)))) ->> 'id'), true);
reset role;
set local session_replication_role = replica;
update public.marketplace_products set status = 'published', published_at = now() where id = current_setting('t.pb')::uuid;
set local session_replication_role = origin;
reset role;
select pg_temp.as_user(current_setting('t.buyer'));
select throws_like(format($$ select pg_temp.prep(%L, 'pickup', null, 'standard', 'cod') $$, jsonb_build_array(
  jsonb_build_object('slug', current_setting('t.s1'), 'sku', 'CHK-1', 'qty', 1),
  jsonb_build_object('slug', (select slug from public.marketplace_products where id = current_setting('t.pb')::uuid), 'sku', 'CHK-B1', 'qty', 1))::text),
  'mp:multi_seller_unsupported%', 'B33. a cart with two showrooms is refused (the pilot sells from one)');

-- the Marketplace switch
reset role;
update public.marketplace_platform_settings set marketplace_open = false;
reset role;
select pg_temp.as_user(current_setting('t.buyer'));
select throws_like(format($$ select pg_temp.prep(%L, 'pickup', null, 'standard', 'cod') $$, current_setting('t.lines')), 'mp:marketplace_closed%',
  'B34. a closed Marketplace refuses a new checkout');
reset role;
update public.marketplace_platform_settings set marketplace_open = true;

-- ===========================================================================
-- C. Confirm: a COD order
-- ===========================================================================
reset role;
select pg_temp.as_user(current_setting('t.buyer'));
select set_config('t.r2', pg_temp.prep(current_setting('t.lines'), 'delivery', current_setting('t.addr'), 'standard', 'cod')::text, true);
select set_config('t.sess', current_setting('t.r2')::jsonb ->> 'session_id', true);
select set_config('t.hash', current_setting('t.r2')::jsonb ->> 'quote_hash', true);
select is(pg_temp.stock('CHK-1') || ' ' || pg_temp.stock('CHK-2'), '10/0 1/0', 'C1. prepare reserves nothing: the session holds no stock');
select throws_like(format($$ select public.marketplace_checkout_confirm(%L::uuid, 'deadbeef', 'chk-key-0001', null) $$, current_setting('t.sess')),
  'mp:quote_changed%', 'C2. a stale quote hash is refused (the buyer must see the new quote)');
select throws_like(format($$ select public.marketplace_checkout_confirm(%L::uuid, %L, 'short', null) $$, current_setting('t.sess'), current_setting('t.hash')),
  'mp:invalid_payload%', 'C3. an idempotency key under 8 characters is refused');
select throws_like(format($$ select public.marketplace_checkout_confirm(gen_random_uuid(), %L, 'chk-key-0001', null) $$, current_setting('t.hash')),
  'mp:session_not_found%', 'C4. an unknown session is refused');
select pg_temp.as_user(current_setting('t.buyer2'));
select throws_like(format($$ select public.marketplace_checkout_confirm(%L::uuid, %L, 'chk-key-0001', null) $$, current_setting('t.sess'), current_setting('t.hash')),
  'mp:session_not_found%', 'C5. another buyer cannot confirm my session');
select pg_temp.as_user(current_setting('t.buyer'));
select set_config('t.c1', public.marketplace_checkout_confirm(current_setting('t.sess')::uuid, current_setting('t.hash'), 'chk-key-0001', 'please call before arriving')::text, true);
select set_config('t.o1', current_setting('t.c1')::jsonb -> 'orders' -> 0 ->> 'id', true);
select is(current_setting('t.c1')::jsonb ->> 'replayed', 'false', 'C6. the order is placed');
select is(current_setting('t.c1')::jsonb -> 'orders' -> 0 ->> 'status', 'new', 'C7. a confirmed checkout is an order in status new (nobody confirms it)');
select is((select source || '/' || payment_status || '/' || stock_state || '/' || paid_now_egp || '/' || balance_due_egp from public.marketplace_orders where id = current_setting('t.o1')::uuid),
  'v2/pending/pending/0.00/610.00', 'C8. v2 order: COD pending payment, stock PENDING, nothing paid now, 610 due on delivery');
select is(pg_temp.stock('CHK-1') || ' ' || pg_temp.stock('CHK-2'), '10/3 1/1', 'C9. the units are held (reserved) from the moment the order exists');
select is((select count(*)::int from public.marketplace_order_items where order_id = current_setting('t.o1')::uuid and product_slug is not null
           and unit_price_egp > 0 and variant_label is not null), 2, 'C10. the price snapshot (slug, label, price) is captured on every line');
select is((select recipient from (select buyer_name || '|' || buyer_phone || '|' || governorate_key as recipient from public.marketplace_orders where id = current_setting('t.o1')::uuid) x),
  'Test Buyer|+201999000009|cairo', 'C11. the recipient and the place are snapshotted from the saved address');
select is((select address_snapshot ->> 'street' from public.marketplace_orders where id = current_setting('t.o1')::uuid), '12 Example Street',
  'C12. the address snapshot is stored on the order (a later edit of the address does not change it)');
select is((select delivery_estimate_earliest - (now() at time zone 'Africa/Cairo')::date from public.marketplace_orders where id = current_setting('t.o1')::uuid), 3,
  'C13. the promised estimate is frozen on the order');
select is((select count(*)::int from public.marketplace_timers where subject_id = current_setting('t.o1')::uuid and kind = 'order_seller_start' and state = 'active'
           and expires_at - started_at = interval '72 hours' and remind_every = interval '6 hours'), 1, 'C14. the 72-hour seller timer (reminder every 6 hours) is open');
select is((select count(*)::int from public.marketplace_order_events where order_id = current_setting('t.o1')::uuid and action = 'placed' and actor_role = 'buyer'), 1,
  'C15. one placed event');
select is((select count(*)::int from public.notifications n where n.event_type = 'marketplace.order.placed' and n.subject_id = current_setting('t.o1')::uuid
           and n.recipient_user_id = current_setting('t.seller')::uuid), 1, 'C16. the showroom manager is notified');
select is((select count(*)::int from public.notifications n where n.subject_id = current_setting('t.o1')::uuid
           and (n.content::text ~ '01999000009' or n.content::text ~ 'Example Street' or n.content::text ~ 'proofs/')), 0,
  'C17. no notification carries a phone, an address or a receipt link');
select is(pg_temp.ledger(current_setting('t.o1')), 'reserve:1,reserve:3', 'C18. the ledger agrees: one reserve per line');
-- replay
select is(public.marketplace_checkout_confirm(current_setting('t.sess')::uuid, current_setting('t.hash'), 'chk-key-0001', null) ->> 'replayed', 'true',
  'C19. the same confirm again returns the same order (replayed)');
select is(public.marketplace_checkout_confirm(current_setting('t.sess')::uuid, current_setting('t.hash'), 'chk-key-OTHER', null) -> 'orders' -> 0 ->> 'id', current_setting('t.o1'),
  'C20. a confirmed session replays whatever the key');
select is((select count(*)::int from public.marketplace_orders where buyer_user_id = current_setting('t.buyer')::uuid), 1, 'C21. a replay never creates a second order');
select is(pg_temp.stock('CHK-1') || ' ' || pg_temp.stock('CHK-2'), '10/3 1/1', 'C22. a replay never holds stock twice');
select set_config('t.r3', pg_temp.prep(current_setting('t.line1'), 'pickup', null, 'standard', 'cod')::text, true);
select throws_like(format($$ select public.marketplace_checkout_confirm(%L::uuid, %L, 'chk-key-0001', null) $$,
  current_setting('t.r3')::jsonb ->> 'session_id', current_setting('t.r3')::jsonb ->> 'quote_hash'),
  'mp:idempotency_conflict%', 'C23. a key already used on another session is a conflict');
select throws_like(format($$ select public.marketplace_checkout_receipt_request_upload(%L::uuid, 'image/png') $$, current_setting('t.r3')::jsonb ->> 'session_id'),
  'mp:proof_not_expected%', 'C24. a COD session takes no receipt');
select throws_like(format($$ select public.marketplace_checkout_confirm(%L::uuid, %L, 'chk-key-0002', null) $$,
  current_setting('t.r3')::jsonb ->> 'session_id', repeat('0', 64)), 'mp:quote_changed%', 'C25. a quote that changed since the hash is refused');
-- price changes between prepare and confirm
reset role;
update public.marketplace_product_variants set price_egp = 110 where sku = 'CHK-1';
reset role;
select pg_temp.as_user(current_setting('t.buyer'));
select throws_like(format($$ select public.marketplace_checkout_confirm(%L::uuid, %L, 'chk-key-0003', null) $$,
  current_setting('t.r3')::jsonb ->> 'session_id', current_setting('t.r3')::jsonb ->> 'quote_hash'), 'mp:quote_changed%',
  'C26. the showroom changed a price after prepare: confirm refuses and shows the new quote');
reset role;
update public.marketplace_product_variants set price_egp = 100 where sku = 'CHK-1';
-- the cart is cleared of ordered lines
select is((select count(*)::int from public.marketplace_cart_items where user_id = current_setting('t.buyer')::uuid), 0, 'C27. no cart rows remain for the buyer');
-- expired session
update public.marketplace_checkout_sessions set expires_at = now() - interval '1 minute' where id = (current_setting('t.r3')::jsonb ->> 'session_id')::uuid;
reset role;
select pg_temp.as_user(current_setting('t.buyer'));
select throws_like(format($$ select public.marketplace_checkout_confirm(%L::uuid, %L, 'chk-key-0004', null) $$,
  current_setting('t.r3')::jsonb ->> 'session_id', current_setting('t.r3')::jsonb ->> 'quote_hash'), 'mp:session_expired%', 'C28. an expired session is refused');
-- confirm refuses with the Marketplace closed
reset role;
update public.marketplace_platform_settings set marketplace_open = false;
reset role;
select pg_temp.as_user(current_setting('t.buyer'));
select is(public.marketplace_checkout_confirm(current_setting('t.sess')::uuid, current_setting('t.hash'), 'chk-key-0005', null) ->> 'replayed', 'true',
  'C29. (replay) a closed Marketplace does not hide an order that already exists');
reset role;
update public.marketplace_platform_settings set marketplace_open = true;

-- ===========================================================================
-- D. InstaPay: the receipt comes BEFORE confirm
-- ===========================================================================
reset role;
select pg_temp.as_user(current_setting('t.buyer'));
select set_config('t.r4', pg_temp.prep(current_setting('t.line1'), 'delivery', current_setting('t.addr'), 'standard', 'instapay_deposit')::text, true);
select set_config('t.sess2', current_setting('t.r4')::jsonb ->> 'session_id', true);
select is(current_setting('t.r4')::jsonb ->> 'missing', '["receipt_required"]', 'D1. an InstaPay deposit checkout is not ready without a receipt');
select is((current_setting('t.r4')::jsonb -> 'quote' -> 'payment' ->> 'pay_now_egp')::numeric, 78.00, 'D2. the deposit is 30 percent of 260 (200 + 60 fee)');
select is(current_setting('t.r4')::jsonb -> 'quote' -> 'payment' -> 'instapay', '{"address":"decore@instapay","account_name":"Decore Store"}'::jsonb,
  'D3. the quote tells the buyer where to transfer');
select throws_like(format($$ select public.marketplace_checkout_confirm(%L::uuid, %L, 'chk-key-0010', null) $$, current_setting('t.sess2'), current_setting('t.r4')::jsonb ->> 'quote_hash'),
  'mp:receipt_required%', 'D4. confirm refuses without a receipt');
select throws_like(format($$ select public.marketplace_checkout_receipt_request_upload(%L::uuid, 'application/pdf') $$, current_setting('t.sess2')),
  'mp:image_type_invalid%', 'D5. only images');
select set_config('t.pr1', public.marketplace_checkout_receipt_request_upload(current_setting('t.sess2')::uuid, 'image/png') ->> 'proof_id', true);
reset role;
select set_config('t.k1', (select object_key from public.marketplace_payment_proofs where id = current_setting('t.pr1')::uuid), true);
select ok(current_setting('t.k1') like 'proofs/' || current_setting('t.sess2') || '/%.png', 'D6. the receipt key is proofs/<session>/<proof>.png (bound to the checkout session)');
select is((select order_id is null and checkout_session_id = current_setting('t.sess2')::uuid from public.marketplace_payment_proofs where id = current_setting('t.pr1')::uuid), true,
  'D7. the receipt exists before the order and belongs to the session');
select is(app.media_storage_key_for('marketplace', current_setting('t.k1'), current_setting('t.buyer')::uuid, current_setting('t.a')::uuid),
  'u/' || current_setting('t.buyer') || '/certificates/' || current_setting('t.pr1') || '/original.png', 'D8. it is stored in the buyer''s documents folder');
reset role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.media_storage_reserve('marketplace', current_setting('t.k1'), 'r2', current_setting('t.buyer')::uuid);
select pg_temp.as_user(current_setting('t.buyer'));
select is(public.media_storage_resolve('marketplace', current_setting('t.k1'), 'upload') ->> 'provider', 'r2', 'D9. the buyer may upload to the issued key');
reset role;
select is((select organization_id from public.media_storage_locations where namespace = 'marketplace' and object_key = current_setting('t.k1')), null,
  'D9b. a buyer receipt is not attributed to the showroom: no per-organization rate or quota is charged to the seller');
select is(app.media_metadata('marketplace', current_setting('t.k1')) ->> 'organization', null, 'D9c. the receipt metadata carries no organization');
select pg_temp.as_user(current_setting('t.buyer2'));
select is(public.media_storage_resolve('marketplace', current_setting('t.k1'), 'upload'), null, 'D10. another buyer may not');
select pg_temp.as_user(current_setting('t.buyer'));
select throws_like(format($$ select public.marketplace_checkout_receipt_confirm(%L::uuid) $$, current_setting('t.pr1')), 'mp:upload_not_found%', 'D11. unverified bytes are not a receipt');
reset role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.media_storage_attest('marketplace', current_setting('t.k1'), current_setting('t.buyer')::uuid, 'r2', 900, 'image/png', repeat('e', 64));
reset role;
select pg_temp.as_user(current_setting('t.buyer'));
select is((public.marketplace_checkout_receipt_confirm(current_setting('t.pr1')::uuid) ->> 'receipt_ok')::boolean, true, 'D12. the verified receipt is accepted on the session');
select is(jsonb_array_length(public.marketplace_checkout_receipt_confirm(current_setting('t.pr1')::uuid) -> 'receipts'), 1, 'D13. confirming twice is idempotent');
select is(pg_temp.prep(current_setting('t.line1'), 'delivery', current_setting('t.addr'), 'standard', 'instapay_deposit', current_setting('t.sess2')) ->> 'ready', 'true',
  'D14. with the receipt the checkout is ready');
select pg_temp.as_user(current_setting('t.buyer2'));
select throws_like(format($$ select public.marketplace_checkout_receipt_remove(%L::uuid) $$, current_setting('t.pr1')), 'mp:not_found%', 'D15. another buyer cannot remove my receipt');
select is(public.media_storage_resolve('marketplace', current_setting('t.k1'), 'read'), null, 'D16. nor read it');
select pg_temp.as_user(current_setting('t.seller'));
select is(public.media_storage_resolve('marketplace', current_setting('t.k1'), 'read'), null, 'D17. the showroom cannot read a receipt before the order exists');
select pg_temp.as_user(current_setting('t.buyer'));
select is(public.media_storage_resolve('marketplace', current_setting('t.k1'), 'read') ->> 'provider', 'r2', 'D18. the buyer can read their own receipt');
select set_config('t.r5', pg_temp.prep(current_setting('t.line1'), 'delivery', current_setting('t.addr'), 'standard', 'instapay_deposit', current_setting('t.sess2'))::text, true);
select set_config('t.c2', public.marketplace_checkout_confirm(current_setting('t.sess2')::uuid, current_setting('t.r5')::jsonb ->> 'quote_hash', 'chk-key-0010', null)::text, true);
select set_config('t.o2', current_setting('t.c2')::jsonb -> 'orders' -> 0 ->> 'id', true);
select is((select payment_method || '/' || payment_status || '/' || paid_now_egp || '/' || balance_due_egp || '/' || deposit_percent || '/' || deposit_egp
           from public.marketplace_orders where id = current_setting('t.o2')::uuid), 'instapay_deposit/receipt_submitted/78.00/182.00/30/78.00',
  'D19. the InstaPay deposit order starts with its receipt submitted: 78 paid now, 182 on delivery');
select is((select order_id = current_setting('t.o2')::uuid from public.marketplace_payment_proofs where id = current_setting('t.pr1')::uuid), true,
  'D20. the receipt is attached to the order at confirm');
select is(public.media_storage_resolve('marketplace', current_setting('t.k1'), 'read') ->> 'state', 'ready', 'D21. the key never changes');
select pg_temp.as_user(current_setting('t.seller'));
select is(public.media_storage_resolve('marketplace', current_setting('t.k1'), 'read') ->> 'state', 'ready', 'D22. now the showroom''s order manager can read the receipt');
select pg_temp.as_user(current_setting('t.sales'));
select is(public.media_storage_resolve('marketplace', current_setting('t.k1'), 'read'), null, 'D23. a member without order rights cannot');
-- full InstaPay
select pg_temp.as_user(current_setting('t.buyer2'));
reset role;
update public.profiles set phone_verified_at = now() where user_id = current_setting('t.buyer2')::uuid;
reset role;
select pg_temp.as_user(current_setting('t.buyer2'));
select set_config('t.r6', pg_temp.prep(current_setting('t.line1'), 'pickup', null, 'standard', 'instapay_full')::text, true);
select is((current_setting('t.r6')::jsonb -> 'quote' -> 'payment' ->> 'pay_now_egp')::numeric, 200.00, 'D24. InstaPay full: the whole order is paid now');
select set_config('t.pr2', public.marketplace_checkout_receipt_request_upload((current_setting('t.r6')::jsonb ->> 'session_id')::uuid, 'image/png') ->> 'proof_id', true);
reset role;
select set_config('t.k2', (select object_key from public.marketplace_payment_proofs where id = current_setting('t.pr2')::uuid), true);
set local request.jwt.claims = '{"role":"service_role"}';
select pg_temp.attest(current_setting('t.k2'), current_setting('t.buyer2'));
reset role;
select pg_temp.as_user(current_setting('t.buyer2'));
select public.marketplace_checkout_receipt_confirm(current_setting('t.pr2')::uuid);
select set_config('t.c3', public.marketplace_checkout_confirm((current_setting('t.r6')::jsonb ->> 'session_id')::uuid, current_setting('t.r6')::jsonb ->> 'quote_hash', 'chk-key-0020', null)::text, true);
select set_config('t.o3', current_setting('t.c3')::jsonb -> 'orders' -> 0 ->> 'id', true);
select is((select payment_method || '/' || payment_status || '/' || paid_now_egp || '/' || balance_due_egp || '/' || coalesce(deposit_percent::text, 'null') || '/' || fulfilment
           from public.marketplace_orders where id = current_setting('t.o3')::uuid), 'instapay_full/receipt_submitted/200.00/0.00/null/pickup',
  'D25. InstaPay full pickup order: 200 paid now, nothing due, no deposit percent');
-- receipt limit and removal
select set_config('t.r7', pg_temp.prep(current_setting('t.line1'), 'pickup', null, 'standard', 'instapay_full')::text, true);
select set_config('t.pr3', public.marketplace_checkout_receipt_request_upload((current_setting('t.r7')::jsonb ->> 'session_id')::uuid, 'image/png') ->> 'proof_id', true);
reset role;
select set_config('t.k3', (select object_key from public.marketplace_payment_proofs where id = current_setting('t.pr3')::uuid), true);
set local request.jwt.claims = '{"role":"service_role"}';
select pg_temp.attest(current_setting('t.k3'), current_setting('t.buyer2'));
reset role;
select pg_temp.as_user(current_setting('t.buyer2'));
select public.marketplace_checkout_receipt_confirm(current_setting('t.pr3')::uuid);
select is(jsonb_array_length(public.marketplace_checkout_receipt_remove(current_setting('t.pr3')::uuid) -> 'receipts'), 0, 'D26. the buyer removes a receipt before confirm');
reset role;
select is((select upload_state from public.marketplace_payment_proofs where id = current_setting('t.pr3')::uuid), 'deleting', 'D27. a removed receipt is handed to the central cleanup');
select ok(exists (select 1 from app.marketplace_media_cleanup_rows() r where r.key = current_setting('t.k3')), 'D28. and the cleanup lists it');
select is((select count(*)::int from public.marketplace_checkout_sessions_purge('0 seconds', 10) as x where false), 0, 'D29. purge exists');

-- ===========================================================================
-- E. The machine: preparation, deduction, shipping, delivery, collection
-- ===========================================================================
reset role;
select pg_temp.as_user(current_setting('t.sales'));
select throws_like(format($$ select public.marketplace_seller_order_action(%L::uuid, 'start_preparing', '{}'::jsonb) $$, current_setting('t.o1')),
  'mp:not_found%', 'E1. a member without order rights cannot act on an order');
select pg_temp.as_user(current_setting('t.sellerb'));
select throws_like(format($$ select public.marketplace_seller_order_action(%L::uuid, 'start_preparing', '{}'::jsonb) $$, current_setting('t.o1')),
  'mp:not_found%', 'E2. another showroom cannot act on it');
select pg_temp.as_user(current_setting('t.seller'));
select throws_like(format($$ select public.marketplace_seller_order_action(%L::uuid, 'confirm', '{}'::jsonb) $$, current_setting('t.o1')),
  'mp:invalid_action%', 'E3. there is no confirm: the showroom no longer confirms or rejects');
select throws_like(format($$ select public.marketplace_seller_order_action(%L::uuid, 'mark_ready', '{}'::jsonb) $$, current_setting('t.o1')),
  'mp:invalid_transition%', 'E4. a new order cannot jump to ready');
select is(public.marketplace_seller_order_action(current_setting('t.o1')::uuid, 'start_preparing', '{}'::jsonb) ->> 'status', 'preparing', 'E5. start preparing');
select is(public.marketplace_seller_order_action(current_setting('t.o1')::uuid, 'start_preparing', '{}'::jsonb) ->> 'replayed', 'true', 'E6. starting twice is a no-op (replayed)');
select is((select count(*)::int from public.marketplace_order_events where order_id = current_setting('t.o1')::uuid and action = 'preparing'), 1, 'E7. one preparing event');
select is((select count(*)::int from public.marketplace_timers where subject_id = current_setting('t.o1')::uuid and kind = 'order_seller_start' and state = 'done'), 1,
  'E8. the seller timer is closed when preparing starts');
select is(pg_temp.stock('CHK-1') || ' ' || pg_temp.stock('CHK-2'), '10/7 1/1', 'E9. stock is still PENDING while preparing');
select is((select count(*)::int from public.notifications where event_type = 'marketplace.order.preparing' and recipient_user_id = current_setting('t.buyer')::uuid
           and subject_id = current_setting('t.o1')::uuid), 1, 'E10. the buyer is told preparation started');
select pg_temp.as_user(current_setting('t.buyer'));
select throws_like(format($$ select public.marketplace_buyer_order_cancel_v2(%L::uuid, null, null) $$, current_setting('t.o1')),
  'mp:invalid_transition%', 'E11. the buyer cannot cancel once preparation started');
select is((public.marketplace_buyer_order_get(current_setting('t.o1')::uuid) ->> 'status'), 'preparing', 'E12. the buyer reads the order through the existing getter');
select pg_temp.as_user(current_setting('t.seller'));
select is(public.marketplace_seller_order_action(current_setting('t.o1')::uuid, 'mark_ready', '{}'::jsonb) ->> 'status', 'ready', 'E13. mark ready');
select is(pg_temp.stock('CHK-1') || ' ' || pg_temp.stock('CHK-2'), '7/4 0/0', 'E14. stock is DEDUCTED at the end of preparation (on hand and reserved both drop)');
select is((select stock_state from public.marketplace_orders where id = current_setting('t.o1')::uuid), 'deducted', 'E15. stock_state deducted');
select is(public.marketplace_seller_order_action(current_setting('t.o1')::uuid, 'mark_ready', '{}'::jsonb) ->> 'replayed', 'true', 'E16. marking ready twice does not deduct twice');
select is(pg_temp.stock('CHK-1') || ' ' || pg_temp.stock('CHK-2'), '7/4 0/0', 'E17. stock unchanged by the replay');
select throws_like(format($$ select public.marketplace_seller_order_action(%L::uuid, 'mark_delivered', '{}'::jsonb) $$, current_setting('t.o1')),
  'mp:invalid_transition%', 'E18. a delivery order must be shipped before it is delivered');
select throws_like(format($$ select public.marketplace_seller_order_action(%L::uuid, 'mark_shipped', '{"tracking_number":"a b"}'::jsonb) $$, current_setting('t.o1')),
  'mp:invalid_payload%', 'E19. a malformed tracking number is refused');
select is(public.marketplace_seller_order_action(current_setting('t.o1')::uuid, 'mark_shipped', '{"carrier_name":"Fast Courier","tracking_number":"TRK-1001"}'::jsonb) -> 'delivery' -> 'shipment' ->> 'tracking_number',
  'TRK-1001', 'E20. shipped with a carrier and a tracking number');
select is((select count(*)::int from public.marketplace_order_shipments where order_id = current_setting('t.o1')::uuid), 1, 'E21. one shipment row');
select is((public.marketplace_seller_order_action(current_setting('t.o1')::uuid, 'mark_delivered', '{}'::jsonb) -> 'actions')::text, '["collect_payment"]', 'E22. delivered: only collecting the cash is left');
select is((select payment_status from public.marketplace_orders where id = current_setting('t.o1')::uuid), 'pending', 'E23. COD stays pending until collected');
select is(public.marketplace_seller_order_action(current_setting('t.o1')::uuid, 'collect_payment', '{}'::jsonb) -> 'payment' ->> 'status', 'collected', 'E24. collect payment');
select is(public.marketplace_seller_order_action(current_setting('t.o1')::uuid, 'collect_payment', '{}'::jsonb) ->> 'replayed', 'true', 'E25. collecting twice is a no-op');
select throws_like(format($$ select public.marketplace_seller_order_action(%L::uuid, 'cancel', '{"message":"too late"}'::jsonb) $$, current_setting('t.o1')),
  'mp:invalid_transition%', 'E26. a delivered order cannot be cancelled');
select is((select string_agg(action, ',' order by sequence) from public.marketplace_order_events where order_id = current_setting('t.o1')::uuid),
  'placed,preparing,ready,shipped,delivered,payment_collected', 'E27. the timeline is the append-only event trail of the machine');
select is(pg_temp.ledger(current_setting('t.o1')), 'reserve:1,reserve:3,deduct:1,deduct:3', 'E28. the ledger: reserved at placement, deducted at mark_ready');
reset role;
select throws_like(format($$ update public.marketplace_orders set status = 'cancelled' where id = %L $$, current_setting('t.o1')), 'mp:legacy_order%',
  'E29. nothing but the machine changes a v2 order status');
reset role;
select pg_temp.as_user(current_setting('t.seller'));
select throws_like(format($$ select public.marketplace_seller_order_transition(%L::uuid, 'deliver', null) $$, current_setting('t.o1')), 'mp:%',
  'E30. the legacy transition RPC cannot move a v2 order');
select is((select jsonb_array_length(public.marketplace_seller_orders_page(current_setting('t.a')::uuid, null) -> 'items')) > 0, true, 'E31. (shape) the legacy reader still answers');
select throws_like(format($$ select public.marketplace_seller_order_action(%L::uuid, 'mark_ready', '{}'::jsonb) $$, gen_random_uuid()), 'mp:not_found%', 'E32. unknown order');
select throws_like(format($$ select public.marketplace_seller_order_action(%L::uuid, 'teleport', '{}'::jsonb) $$, current_setting('t.o1')), 'mp:invalid_action%', 'E33. unknown action');

-- ===========================================================================
-- F. Cancel
-- ===========================================================================
-- (o2: deposit order, new, 2 x CHK-1 held; o3: full InstaPay pickup, new, 2 x CHK-1 held)
select is(pg_temp.stock('CHK-1'), '7/4', 'F1. two orders hold 2 + 2 units');
select pg_temp.as_user(current_setting('t.buyer2'));
select throws_like(format($$ select public.marketplace_buyer_order_cancel_v2(%L::uuid, null, null) $$, current_setting('t.o2')), 'mp:not_found%', 'F2. another buyer cannot cancel it');
select pg_temp.as_user(current_setting('t.buyer'));
select is(jsonb_array_length(public.marketplace_order_reason_presets('order_cancel_buyer')), 3, 'F3. three seeded buyer reasons');
select throws_like($$ select public.marketplace_order_reason_presets('approve') $$, 'mp:invalid_action%', 'F4. only the three order preset actions are listed');
select throws_like(format($$ select public.marketplace_buyer_order_cancel_v2(%L::uuid, gen_random_uuid(), null) $$, current_setting('t.o2')), 'mp:preset_invalid%', 'F5. an unknown preset is refused');
select is((public.marketplace_buyer_order_cancel_v2(current_setting('t.o2')::uuid,
  (select id from public.marketplace_seller_message_presets where action = 'order_cancel_buyer' order by sort_order limit 1), null) ->> 'status'), 'cancelled',
  'F6. the buyer cancels a new order with a preset reason');
select is(pg_temp.stock('CHK-1'), '7/2', 'F7. the held units are released');
select is((select stock_state || '/' || payment_status from public.marketplace_orders where id = current_setting('t.o2')::uuid), 'released/not_collected',
  'F8. stock released; the unreviewed receipt is not_collected (contract row 11 rule)');
select is((select cancelled_by_role || '/' || reason_code || '/' || stock_effect from public.marketplace_order_cancellations where order_id = current_setting('t.o2')::uuid),
  'buyer/preset/released', 'F9. the structured cancellation record');
select is(public.marketplace_buyer_order_cancel_v2(current_setting('t.o2')::uuid, null, null) ->> 'replayed', 'true', 'F10. cancelling twice is a no-op');
select is(pg_temp.stock('CHK-1'), '7/2', 'F11. and never releases twice');
select is((select count(*)::int from public.notifications where event_type = 'marketplace.order.cancelled_by_buyer' and subject_id = current_setting('t.o2')::uuid
           and recipient_user_id = current_setting('t.seller')::uuid), 1, 'F12. the showroom is told');
select is(pg_temp.ledger(current_setting('t.o2')), 'reserve:2,release:2', 'F13. ledger: reserve then release');
select pg_temp.as_user(current_setting('t.seller'));
select throws_like(format($$ select public.marketplace_seller_order_action(%L::uuid, 'cancel', '{}'::jsonb) $$, current_setting('t.o3')), 'mp:reason_required%', 'F14. the showroom must give a reason');
select throws_like(format($$ select public.marketplace_seller_order_action(%L::uuid, 'cancel', '{"message":"x"}'::jsonb) $$, current_setting('t.o3')), 'mp:reason_required%', 'F15. a custom reason is 3-300 characters');
select throws_like(format($$ select public.marketplace_seller_order_action(%L::uuid, 'cancel', jsonb_build_object('preset_id', %L)) $$, current_setting('t.o3'),
  (select id from public.marketplace_seller_message_presets where action = 'order_cancel_buyer' limit 1)), 'mp:preset_invalid%', 'F16. a preset of the wrong kind is refused');
select is(public.marketplace_seller_order_action(current_setting('t.o3')::uuid, 'cancel', jsonb_build_object(
  'preset_id', (select id from public.marketplace_seller_message_presets where action = 'order_cancel_seller' order by sort_order limit 1),
  'internal_note', 'supplier delay'))  -> 'cancellation' ->> 'internal_note', 'supplier delay', 'F17. the showroom cancels with a preset; its internal note is visible to the showroom');
select is((select payment_status from public.marketplace_orders where id = current_setting('t.o3')::uuid), 'not_collected', 'F18. an unreviewed InstaPay receipt on a cancelled order');
select is(pg_temp.stock('CHK-1'), '7/0', 'F19. the held units are released');
select pg_temp.as_user(current_setting('t.buyer2'));
select is(public.marketplace_buyer_order_get(current_setting('t.o3')::uuid) ->> 'status', 'cancelled', 'F20. the buyer sees the cancellation');
select is((select content -> 'en' ->> 'body' from public.notifications where event_type = 'marketplace.order.cancelled_by_seller' and subject_id = current_setting('t.o3')::uuid
           and recipient_user_id = current_setting('t.buyer2')::uuid) like '%cancelled your order%', true, 'F21. the buyer''s notification carries the preset text in their language');

-- ===========================================================================
-- G. Receipts: accept, dispute, resubmit; a disputed receipt freezes progress. New order for the same buyer.
-- ===========================================================================
reset role;
update public.profiles set phone_verified_at = now() where user_id = current_setting('t.buyer')::uuid;
reset role;
select pg_temp.as_user(current_setting('t.buyer'));
select set_config('t.r8', pg_temp.prep(current_setting('t.line1'), 'delivery', current_setting('t.addr'), 'standard', 'instapay_full')::text, true);
select set_config('t.pr4', public.marketplace_checkout_receipt_request_upload((current_setting('t.r8')::jsonb ->> 'session_id')::uuid, 'image/png') ->> 'proof_id', true);
reset role;
select set_config('t.k4', (select object_key from public.marketplace_payment_proofs where id = current_setting('t.pr4')::uuid), true);
set local request.jwt.claims = '{"role":"service_role"}';
select pg_temp.attest(current_setting('t.k4'), current_setting('t.buyer'));
reset role;
select pg_temp.as_user(current_setting('t.buyer'));
select public.marketplace_checkout_receipt_confirm(current_setting('t.pr4')::uuid);
select set_config('t.o4', public.marketplace_checkout_confirm((current_setting('t.r8')::jsonb ->> 'session_id')::uuid, current_setting('t.r8')::jsonb ->> 'quote_hash', 'chk-key-0030', null) -> 'orders' -> 0 ->> 'id', true);
select pg_temp.as_user(current_setting('t.seller'));
select throws_like(format($$ select public.marketplace_seller_order_action(%L::uuid, 'flag_receipt_not_received', '{"message":"nothing arrived"}'::jsonb) $$, current_setting('t.o4')),
  'mp:invalid_transition%', 'G1. a receipt can be flagged only while preparing or ready');
select public.marketplace_seller_order_action(current_setting('t.o4')::uuid, 'start_preparing', '{}'::jsonb);
select throws_like(format($$ select public.marketplace_seller_order_action(%L::uuid, 'flag_receipt_not_received', '{}'::jsonb) $$, current_setting('t.o4')),
  'mp:reason_required%', 'G2. «لم تصلني الفلوس» needs a reason (preset or custom)');
select is(jsonb_array_length(public.marketplace_order_reason_presets('payment_issue')), 3, 'G3. three seeded payment-issue presets');
select is((public.marketplace_seller_order_action(current_setting('t.o4')::uuid, 'flag_receipt_not_received', jsonb_build_object(
  'preset_id', (select id from public.marketplace_seller_message_presets where action = 'payment_issue' order by sort_order limit 1))) -> 'payment' ->> 'status'),
  'receipt_disputed', 'G4. the showroom flags the receipt');
select is((select state from public.marketplace_timers where subject_id = current_setting('t.o4')::uuid and kind = 'order_receipt_resubmit'), 'active', 'G5. the 48-hour buyer timer opens');
select is((select expires_at - started_at || '/' || remind_offsets[1] from public.marketplace_timers where subject_id = current_setting('t.o4')::uuid and kind = 'order_receipt_resubmit'),
  '2 days/24:00:00', 'G6. deadline 48 hours, reminder at 24 hours');
select throws_like(format($$ select public.marketplace_seller_order_action(%L::uuid, 'mark_ready', '{}'::jsonb) $$, current_setting('t.o4')), 'mp:payment_dispute_open%',
  'G7. a disputed receipt freezes progress');
select is((select count(*)::int from public.notifications where event_type = 'marketplace.order.receipt_disputed' and recipient_user_id = current_setting('t.buyer')::uuid and subject_id = current_setting('t.o4')::uuid), 1,
  'G8. the buyer is told to check the transfer');
select is(public.marketplace_seller_order_action(current_setting('t.o4')::uuid, 'flag_receipt_not_received', '{}'::jsonb) ->> 'replayed', 'true', 'G9. flagging twice is a no-op');
select pg_temp.as_user(current_setting('t.buyer'));
select is(public.marketplace_buyer_order_get(current_setting('t.o4')::uuid) ->> 'payment_status', 'receipt_disputed', 'G10. the buyer sees the dispute');
select set_config('t.pr5', public.marketplace_buyer_receipt_resubmit_request_upload(current_setting('t.o4')::uuid, 'image/png') ->> 'proof_id', true);
reset role;
select set_config('t.k5', (select object_key from public.marketplace_payment_proofs where id = current_setting('t.pr5')::uuid), true);
select ok(current_setting('t.k5') like 'proofs/' || current_setting('t.o4') || '/%.png', 'G11. a resubmission is keyed by the order id');
set local request.jwt.claims = '{"role":"service_role"}';
select pg_temp.attest(current_setting('t.k5'), current_setting('t.buyer'));
reset role;
select pg_temp.as_user(current_setting('t.buyer'));
select is(public.marketplace_buyer_receipt_resubmit_confirm(current_setting('t.pr5')::uuid) -> 'payment' ->> 'status', 'receipt_submitted', 'G12. the new receipt puts the order back to submitted');
select is((select string_agg(status, ',' order by created_at) from public.marketplace_payment_proofs where order_id = current_setting('t.o4')::uuid and upload_state = 'confirmed'),
  'superseded,submitted', 'G13. the old receipt is superseded');
select is((select state from public.marketplace_timers where subject_id = current_setting('t.o4')::uuid and kind = 'order_receipt_resubmit'), 'done', 'G14. the buyer timer closes');
select is((select count(*)::int from public.notifications where event_type = 'marketplace.order.receipt_resubmitted' and recipient_user_id = current_setting('t.seller')::uuid and subject_id = current_setting('t.o4')::uuid), 1,
  'G15. the showroom is told a new receipt arrived');
select is(public.marketplace_buyer_receipt_resubmit_confirm(current_setting('t.pr5')::uuid) -> 'payment' ->> 'status', 'receipt_submitted', 'G16. confirming the resubmission twice is idempotent');
select throws_like(format($$ select public.marketplace_buyer_receipt_resubmit_request_upload(%L::uuid, 'image/png') $$, current_setting('t.o4')), 'mp:proof_not_expected%',
  'G17. no new upload ticket unless the receipt is disputed');
select pg_temp.as_user(current_setting('t.seller'));
select is(public.marketplace_seller_order_action(current_setting('t.o4')::uuid, 'accept_receipt', '{}'::jsonb) -> 'payment' ->> 'status', 'collected', 'G18. accepting the receipt of a full InstaPay order settles it');
select is((select status from public.marketplace_payment_proofs where order_id = current_setting('t.o4')::uuid and upload_state = 'confirmed' and status <> 'superseded'), 'accepted', 'G19. the receipt is marked accepted');
select is(public.marketplace_seller_order_action(current_setting('t.o4')::uuid, 'accept_receipt', '{}'::jsonb) ->> 'replayed', 'true', 'G20. accepting twice is a no-op');
select throws_like(format($$ select public.marketplace_seller_order_action(%L::uuid, 'flag_receipt_not_received', '{"message":"late claim"}'::jsonb) $$, current_setting('t.o4')),
  'mp:invalid_transition%', 'G21. once the money is confirmed it cannot be flagged');
select is(public.marketplace_seller_order_action(current_setting('t.o4')::uuid, 'mark_ready', '{}'::jsonb) ->> 'status', 'ready', 'G22. progress resumes');
select is(pg_temp.stock('CHK-1'), '5/0', 'G23. units deducted at the end of preparation (7 - 2)');
-- cancel after ready: the units come back
select is(public.marketplace_seller_order_action(current_setting('t.o4')::uuid, 'cancel', '{"message":"the courier cannot reach this area"}'::jsonb) ->> 'status', 'cancelled',
  'G24. the showroom may cancel after ready (open question 4)');
select is(pg_temp.stock('CHK-1'), '7/0', 'G25. restocked: the deducted units come back');
select is((select stock_state || '/' || payment_status from public.marketplace_orders where id = current_setting('t.o4')::uuid), 'restocked/refund_due', 'G26. restocked; money was received so a refund is due');
select is(pg_temp.ledger(current_setting('t.o4')), 'reserve:2,deduct:2,replenish:2', 'G27. ledger: reserve, deduct, replenish');

-- ===========================================================================
-- H. Last unit, deposit accept + balance, delivery_failed -> returned to stock, pickup
-- ===========================================================================
select pg_temp.as_user(current_setting('t.seller'));
select public.marketplace_seller_stock_adjust((select id from public.marketplace_product_variants where sku = 'CHK-2'),
  current_setting('t.loc')::uuid, 1, 'chk-stock-0003');
reset role;
select is(pg_temp.stock('CHK-2'), '1/0', 'H0. fixture: exactly one unit of CHK-2 is on the shelf');
select pg_temp.as_user(current_setting('t.buyer2'));
select set_config('t.r9', pg_temp.prep(jsonb_build_array(jsonb_build_object('slug', current_setting('t.s2'), 'sku', 'CHK-2', 'qty', 1))::text, 'pickup', null, 'standard', 'cod')::text, true);
select pg_temp.as_user(current_setting('t.buyer'));
select set_config('t.r10', pg_temp.prep(jsonb_build_array(jsonb_build_object('slug', current_setting('t.s2'), 'sku', 'CHK-2', 'qty', 1))::text, 'pickup', null, 'standard', 'cod')::text, true);
select set_config('t.o5', public.marketplace_checkout_confirm((current_setting('t.r10')::jsonb ->> 'session_id')::uuid, current_setting('t.r10')::jsonb ->> 'quote_hash', 'chk-key-0040', null) -> 'orders' -> 0 ->> 'id', true);
select is(pg_temp.stock('CHK-2'), '1/1', 'H1. the last unit is held for the first buyer');
select pg_temp.as_user(current_setting('t.buyer2'));
select throws_like(format($$ select public.marketplace_checkout_confirm(%L::uuid, %L, 'chk-key-0041', null) $$, current_setting('t.r9')::jsonb ->> 'session_id', current_setting('t.r9')::jsonb ->> 'quote_hash'),
  'mp:insufficient_stock%', 'H2. nobody else can order a held unit: no last-unit race');
select is((select count(*)::int from public.marketplace_orders where buyer_user_id = current_setting('t.buyer2')::uuid and status = 'new'), 0, 'H3. the refused confirm left no order behind');
select pg_temp.as_user(current_setting('t.seller'));
select public.marketplace_seller_order_action(current_setting('t.o5')::uuid, 'start_preparing', '{}'::jsonb);
select is((public.marketplace_seller_order_action(current_setting('t.o5')::uuid, 'mark_ready', '{}'::jsonb) -> 'actions'), '["mark_delivered","cancel","mark_delivery_failed"]'::jsonb,
  'H4. a ready pickup order is handed over, cancelled or marked failed');
select is(public.marketplace_seller_order_action(current_setting('t.o5')::uuid, 'mark_delivery_failed', '{}'::jsonb) ->> 'status', 'delivery_failed', 'H5. pickup not collected');
select is((select payment_status from public.marketplace_orders where id = current_setting('t.o5')::uuid), 'not_collected', 'H6. nothing was collected');
select is(public.marketplace_seller_order_action(current_setting('t.o5')::uuid, 'mark_returned_to_stock', '{}'::jsonb) ->> 'status', 'returned', 'H7. returned to stock');
select is(pg_temp.stock('CHK-2'), '1/0', 'H8. the unit is back');
select is((select stock_state from public.marketplace_orders where id = current_setting('t.o5')::uuid), 'restocked', 'H9. stock_state restocked');
select is(public.marketplace_seller_order_action(current_setting('t.o5')::uuid, 'mark_returned_to_stock', '{}'::jsonb) ->> 'replayed', 'true', 'H10. returning twice is a no-op');
select is(pg_temp.stock('CHK-2'), '1/0', 'H11. and never restocks twice');
-- stock invariant across every v2 order
reset role;
select is((select count(*)::int from public.marketplace_orders o where o.source = 'v2' and not (
  (o.status in ('new', 'preparing') and o.stock_state = 'pending') or (o.status in ('ready', 'shipped', 'delivered', 'delivery_failed') and o.stock_state = 'deducted')
  or (o.status = 'cancelled' and o.stock_state in ('released', 'restocked')) or (o.status = 'returned' and o.stock_state = 'restocked'))), 0,
  'H12. every v2 order''s stock_state agrees with its status');
select is((select coalesce(sum(l.reserved), 0)::int from public.marketplace_inventory_levels l where l.seller_organization_id = current_setting('t.a')::uuid
            and l.variant_id in (select id from public.marketplace_product_variants where sku in ('CHK-1', 'CHK-2'))),
  (select coalesce(sum(i.quantity), 0)::int from public.marketplace_order_items i join public.marketplace_orders o on o.id = i.order_id where o.stock_state = 'pending'),
  'H13. reserved units in stock = units of the orders whose stock is pending');

-- deposit order: accept the receipt, deliver, collect the balance
reset role;
update public.marketplace_platform_settings set marketplace_open = true;
reset role;
select pg_temp.as_user(current_setting('t.buyer'));
select set_config('t.r11', pg_temp.prep(current_setting('t.line1'), 'pickup', null, 'standard', 'instapay_deposit')::text, true);
select set_config('t.pr6', public.marketplace_checkout_receipt_request_upload((current_setting('t.r11')::jsonb ->> 'session_id')::uuid, 'image/png') ->> 'proof_id', true);
reset role;
select set_config('t.k6', (select object_key from public.marketplace_payment_proofs where id = current_setting('t.pr6')::uuid), true);
set local request.jwt.claims = '{"role":"service_role"}';
select pg_temp.attest(current_setting('t.k6'), current_setting('t.buyer'));
reset role;
select pg_temp.as_user(current_setting('t.buyer'));
select public.marketplace_checkout_receipt_confirm(current_setting('t.pr6')::uuid);
select set_config('t.o6', public.marketplace_checkout_confirm((current_setting('t.r11')::jsonb ->> 'session_id')::uuid, current_setting('t.r11')::jsonb ->> 'quote_hash', 'chk-key-0050', null) -> 'orders' -> 0 ->> 'id', true);
select pg_temp.as_user(current_setting('t.seller'));
select is((public.marketplace_seller_order_action(current_setting('t.o6')::uuid, 'accept_receipt', '{}'::jsonb) -> 'payment' ->> 'status'), 'receipt_accepted', 'H14. a deposit receipt accepted: the balance remains');
select public.marketplace_seller_order_action(current_setting('t.o6')::uuid, 'start_preparing', '{}'::jsonb);
select public.marketplace_seller_order_action(current_setting('t.o6')::uuid, 'mark_ready', '{}'::jsonb);
select public.marketplace_seller_order_action(current_setting('t.o6')::uuid, 'mark_delivered', '{}'::jsonb);
select is(public.marketplace_seller_order_action(current_setting('t.o6')::uuid, 'collect_payment', '{}'::jsonb) -> 'payment' ->> 'status', 'collected', 'H15. the balance is collected at handover');

-- ===========================================================================
-- I. Isolation and the document
-- ===========================================================================
select pg_temp.as_user(current_setting('t.buyer2'));
select throws_like(format($$ select public.marketplace_buyer_order_get(%L::uuid) $$, current_setting('t.o6')), 'mp:not_found%', 'I1. another buyer cannot read the order');
reset role;
select is(app.marketplace_order_document_v2(current_setting('t.o6')::uuid, 'buyer') ? 'organization_id', false, 'I2. the document never carries an organization id');
select is(app.marketplace_order_document_v2(current_setting('t.o6')::uuid, 'admin') -> 'recipient' ->> 'phone', null, 'I3. the admin view carries no phone');
select is(app.marketplace_order_document_v2(current_setting('t.o6')::uuid, 'buyer') -> 'cancellation', 'null'::jsonb, 'I4. no cancellation on a delivered order');
select is(jsonb_typeof(app.marketplace_order_document_v2(current_setting('t.o4')::uuid, 'buyer') -> 'cancellation'), 'object', 'I5. a cancelled order carries its cancellation');
select is(app.marketplace_order_document_v2(current_setting('t.o4')::uuid, 'buyer') -> 'cancellation' ? 'internal_note', true, 'I6. (key present)');
select is(app.marketplace_order_document_v2(current_setting('t.o4')::uuid, 'buyer') -> 'cancellation' ->> 'internal_note', null, 'I7. the internal note is never shown to the buyer');
select ok(app.marketplace_order_document_v2(current_setting('t.o6')::uuid, 'buyer') ? 'invoice' and app.marketplace_order_document_v2(current_setting('t.o6')::uuid, 'buyer') ? 'returns'
          and app.marketplace_order_document_v2(current_setting('t.o6')::uuid, 'buyer') ? 'return_window', 'I8. the keys later PRs fill exist already');
select is(app.marketplace_order_document_v2(current_setting('t.o4')::uuid, 'seller') -> 'events' @> '[{"action":"receipt_disputed"}]'::jsonb, true, 'I9. the seller timeline carries the dispute');
select is(app.marketplace_order_actions(current_setting('t.o6')::uuid, 'buyer'), '{}'::text[], 'I10. a delivered order offers the buyer nothing in this PR');
-- a receipt attached to an order: the showroom's order managers read it only while the showroom organization is live
reset role;
select set_config('t.rk', (select pr.object_key from public.marketplace_payment_proofs pr join public.marketplace_orders o on o.id = pr.order_id
  where o.seller_organization_id = current_setting('t.a')::uuid and pr.upload_state = 'confirmed' limit 1), true);
select set_config('t.rbuyer', (select pr.created_by::text from public.marketplace_payment_proofs pr where pr.object_key = current_setting('t.rk')), true);
select ok(current_setting('t.rk') is not null, 'I10a. fixture: an attached, confirmed receipt exists');
select pg_temp.as_user(current_setting('t.seller'));
select is(public.media_storage_resolve('marketplace', current_setting('t.rk'), 'read') is not null
          or public.organization_media_resolve('marketplace', current_setting('t.rk'), 'read') is not null, true,
  'I10b. the showroom owner can read an attached receipt while the organization is live');
reset role;
set local session_replication_role = replica;
update public.organizations set deleted_at = now() where id = current_setting('t.a')::uuid;
set local session_replication_role = origin;
select pg_temp.as_user(current_setting('t.seller'));
select is(public.organization_media_resolve('marketplace', current_setting('t.rk'), 'read'), null,
  'I10c. members of a soft-deleted showroom organization cannot read buyer receipts');
select pg_temp.as_user(current_setting('t.rbuyer'));
select is(public.organization_media_resolve('marketplace', current_setting('t.rk'), 'read') is not null, true,
  'I10d. the buyer still reads their own receipt');
reset role;
set local session_replication_role = replica;
update public.organizations set deleted_at = null where id = current_setting('t.a')::uuid;
set local session_replication_role = origin;
-- legacy v1 checkout still works for the promoted app and stays legacy
reset role;
select pg_temp.as_user(current_setting('t.buyer2'));
select is(public.marketplace_checkout_place(jsonb_build_array(jsonb_build_object('slug', current_setting('t.s1'), 'sku', 'CHK-1', 'qty', 1)),
  '{"name":"Old Buyer","phone":"01012345678","governorate":"cairo","address":"12 Nasr Road, Cairo"}'::jsonb,
  '[{"index":1,"fulfilment":"delivery","payment":"cod"}]'::jsonb, 'legacy-key-0001') ->> 'replayed', 'false', 'I11. the promoted v1 checkout still places an order');
reset role;
select is((select source || '/' || status || '/' || stock_state from public.marketplace_orders where idempotency_key = 'legacy-key-0001'), 'legacy/pending_confirmation/none',
  'I12. it stays a legacy order with its old status (expand / contract)');
reset role;
select pg_temp.as_user(current_setting('t.seller'));
select throws_like(format($$ select public.marketplace_seller_order_action(%L::uuid, 'start_preparing', '{}'::jsonb) $$,
  (select id from public.marketplace_orders where idempotency_key = 'legacy-key-0001')), 'mp:legacy_order%', 'I13. the v2 wrapper refuses a legacy order');
select is(public.marketplace_seller_order_transition((select id from public.marketplace_orders where idempotency_key = 'legacy-key-0001'), 'confirm', null) ->> 'status', 'confirmed',
  'I14. the legacy RPC still confirms a legacy order');

select * from finish();
rollback;
