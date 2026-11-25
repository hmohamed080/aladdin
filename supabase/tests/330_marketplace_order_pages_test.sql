-- pgTAP: Marketplace PR 13 — order pages: reads, invoice, waybill, shipment correction
-- (20261125110001_marketplace_order_invoices.sql, 130002_marketplace_order_reads_v2.sql, 130003_marketplace_order_document_invoice.sql)
-- Contract: docs/product/marketplace-order-model-contract-20261124.md section 4.3
--
--   A. SHAPE       RPC-only tables and sequence, function privileges, RLS on.
--   B. BUYER LIST  own orders only, search (number / name / SKU, wildcards escaped), period, group, paging, summary shape.
--   C. BUYER GET   own order only, no seller organization id, no internal note.
--   D. SELLER LIST tabs and counts, search, dates, needs_attention, other showroom / member without rights refused.
--   E. SELLER GET  document, actions from the database.
--   F. INVOICE     lazy and idempotent, one number, one internal event, buyer or seller only, no phone, immutable.
--   G. WAYBILL     seller only, delivery orders only, collect amount, phone for the courier.
--   H. SHIPMENT    correction in `shipped` only, event once, validation, legacy refused.
--   I. NO WRITES   the reads never change an order's status, payment status or stock.
--
-- Orders are inserted directly in the state under test (the state machine is PR 12's and tested in 300).
-- Fixtures (seed-pilot): showroom A 9c000000-…001 (owner 70000001 with order.manage; 70000002 sales-only member),
-- showroom B 91000005-…005 (owner 71000005), buyer 70000009, second buyer 70000003.
create extension if not exists pgtap;

begin;
select no_plan();

select set_config('t.a', '9c000000-cccc-4ccc-8ccc-000000000001', true);
select set_config('t.b', '91000005-1111-4111-8111-000000000005', true);
select set_config('t.seller', '70000001-0000-4000-8000-000000000001', true);
select set_config('t.sales', '70000002-0000-4000-8000-000000000002', true);
select set_config('t.sellerb', '71000005-0000-4000-8000-000000000005', true);
select set_config('t.buyer', '70000009-0000-4000-8000-000000000009', true);
select set_config('t.buyer2', '70000003-0000-4000-8000-000000000003', true);

select set_config('app.marketplace_seller_write', 'on', true);
insert into public.marketplace_seller_accounts (organization_id, status, approved_at)
values (current_setting('t.a')::uuid, 'approved', now()), (current_setting('t.b')::uuid, 'approved', now())
on conflict (organization_id) do update set status = 'approved', approved_at = now();
select set_config('app.marketplace_seller_write', 'off', true);

create function pg_temp.as_user(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.as_anon() returns void language sql as $$
  select set_config('request.jwt.claims', '', true);
$$;

-- two products of showroom A (needed by the order lines)
reset role;
select pg_temp.as_user(current_setting('t.seller'));
select set_config('t.p1', (public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'), 'product_type_key', 'wallpaper', 'name_ar', 'ورق جدران ناعم', 'name_en', 'Soft wallpaper',
  'variants', jsonb_build_array(jsonb_build_object('sku', 'PG-1', 'selling_unit', 'roll', 'price_egp', 100)))) ->> 'id'), true);
select set_config('t.p2', (public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'), 'product_type_key', 'wallpaper', 'name_ar', 'ورق ثان', 'name_en', 'Second paper',
  'variants', jsonb_build_array(jsonb_build_object('sku', 'PG-2', 'selling_unit', 'roll', 'price_egp', 250)))) ->> 'id'), true);
select set_config('t.loc', public.marketplace_seller_default_location(current_setting('t.a')::uuid)::text, true);
reset role;

-- one order with two lines, in the state under test; returns its id
create function pg_temp.mk_order(p_label text, p_status text, p_method text, p_pay text, p_fulfil text,
  p_buyer text, p_org text, p_placed interval default interval '0', p_source text default 'v2') returns uuid language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
  v_stock text := case when p_source = 'legacy' then 'deducted'
    when p_status in ('new', 'preparing') then 'pending'
    when p_status in ('ready', 'shipped', 'delivered', 'delivery_failed') then 'deducted'
    when p_status = 'returned' then 'restocked' else 'released' end;
  v_paid numeric := case p_method when 'cod' then 0 when 'instapay_full' then 450 else 135 end;
begin
  insert into public.marketplace_orders (id, checkout_id, idempotency_key, buyer_user_id, seller_organization_id, status,
    payment_method, payment_status, fulfilment, governorate_key, area_key, address_text, buyer_name, buyer_phone, buyer_note,
    subtotal_egp, delivery_fee_egp, total_egp, deposit_percent, deposit_egp, instapay_address, instapay_account_name,
    delivery_estimate_earliest, delivery_estimate_latest, placed_at, paid_now_egp, balance_due_egp, stock_state, source,
    latitude, longitude)
  values (v_id, gen_random_uuid(), 'pg-' || p_label || '-' || v_id, p_buyer::uuid, p_org::uuid, p_status,
    p_method, p_pay, p_fulfil,
    case when p_fulfil = 'delivery' then 'cairo' end, null, case when p_fulfil = 'delivery' then '12 Example Street, Maadi' end,
    'Recipient ' || p_label, '+201999000009', case when p_fulfil = 'delivery' then 'Call before arriving' end,
    450, 0, 450,
    case p_method when 'instapay_deposit' then 30 end, case p_method when 'instapay_deposit' then 135 end,
    case when p_method like 'instapay%' then 'decore@instapay' end, case when p_method like 'instapay%' then 'Decore Store' end,
    current_date + 2, current_date + 4, now() - p_placed, v_paid, 450 - v_paid, v_stock, p_source,
    30.0, 31.2);
  insert into public.marketplace_order_items (order_id, product_id, variant_id, location_id, sku, name_ar, name_en, selling_unit,
    unit_price_egp, quantity, product_slug)
  select v_id, p.id, v.id, current_setting('t.loc')::uuid, v.sku, p.name_ar, p.name_en, 'roll', v.price_egp,
         case v.sku when 'PG-1' then 2 else 1 end, 'slug-' || lower(v.sku)
    from public.marketplace_product_variants v join public.marketplace_products p on p.id = v.product_id
   where v.sku in ('PG-1', 'PG-2');
  return v_id;
end;
$$;

select set_config('t.o_new', pg_temp.mk_order('new', 'new', 'cod', 'pending', 'delivery', current_setting('t.buyer'), current_setting('t.a'))::text, true);
select set_config('t.o_prep', pg_temp.mk_order('prep', 'preparing', 'instapay_full', 'receipt_submitted', 'delivery', current_setting('t.buyer'), current_setting('t.a'))::text, true);
select set_config('t.o_disp', pg_temp.mk_order('disp', 'preparing', 'instapay_deposit', 'receipt_disputed', 'delivery', current_setting('t.buyer'), current_setting('t.a'))::text, true);
select set_config('t.o_ready', pg_temp.mk_order('ready', 'ready', 'cod', 'pending', 'delivery', current_setting('t.buyer'), current_setting('t.a'))::text, true);
select set_config('t.o_pick', pg_temp.mk_order('pick', 'ready', 'cod', 'pending', 'pickup', current_setting('t.buyer'), current_setting('t.a'))::text, true);
select set_config('t.o_ship', pg_temp.mk_order('ship', 'shipped', 'instapay_deposit', 'receipt_accepted', 'delivery', current_setting('t.buyer'), current_setting('t.a'))::text, true);
select set_config('t.o_done', pg_temp.mk_order('done', 'delivered', 'cod', 'collected', 'delivery', current_setting('t.buyer'), current_setting('t.a'))::text, true);
select set_config('t.o_canc', pg_temp.mk_order('canc', 'cancelled', 'cod', 'not_collected', 'delivery', current_setting('t.buyer'), current_setting('t.a'))::text, true);
select set_config('t.o_old', pg_temp.mk_order('old', 'delivered', 'cod', 'collected', 'delivery', current_setting('t.buyer'), current_setting('t.a'), interval '2 years')::text, true);
select set_config('t.o_other', pg_temp.mk_order('other', 'new', 'cod', 'pending', 'delivery', current_setting('t.buyer2'), current_setting('t.a'))::text, true);
select set_config('t.o_b', pg_temp.mk_order('showb', 'new', 'cod', 'pending', 'delivery', current_setting('t.buyer'), current_setting('t.b'))::text, true);
select set_config('t.o_leg', pg_temp.mk_order('legacy', 'shipped', 'cod', 'pending', 'delivery', current_setting('t.buyer'), current_setting('t.a'), interval '0', 'legacy')::text, true);

insert into public.marketplace_order_shipments (order_id, carrier_name, tracking_number, shipped_by)
values (current_setting('t.o_ship')::uuid, 'Bosta', 'BST-1001', current_setting('t.seller')::uuid),
       (current_setting('t.o_leg')::uuid, 'Old Carrier', 'OLD-1001', current_setting('t.seller')::uuid);
insert into public.marketplace_order_cancellations (order_id, cancelled_by_role, reason_code, message_ar, message_en, internal_note, stock_effect)
values (current_setting('t.o_canc')::uuid, 'seller', 'custom', 'نفد المخزون', 'Out of stock', 'supplier delayed', 'released');
insert into public.marketplace_order_events (order_id, action, to_status, actor_role, note)
values (current_setting('t.o_new')::uuid, 'placed', 'new', 'buyer', null),
       (current_setting('t.o_new')::uuid, 'reminder_seller_start', 'new', 'system', 'internal reminder');

-- stock ledger before any read (I)
select set_config('t.moves', (select count(*)::text from public.marketplace_stock_movements), true);

-- ---------------------------------------------------------------------------
-- A. SHAPE
-- ---------------------------------------------------------------------------
select has_table('public', 'marketplace_order_invoices', 'A1 invoices table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.marketplace_order_invoices'::regclass), 'A2 invoices: RLS on');
select ok(not has_table_privilege('authenticated', 'public.marketplace_order_invoices', 'select')
      and not has_table_privilege('anon', 'public.marketplace_order_invoices', 'select')
      and not has_table_privilege('service_role', 'public.marketplace_order_invoices', 'select'), 'A3 invoices: no client or service grant');
select ok(not has_sequence_privilege('authenticated', 'public.marketplace_invoice_number_seq', 'usage'), 'A4 invoice sequence: no client grant');
select ok(has_function_privilege('authenticated', 'public.marketplace_buyer_orders_v2(text, text, text, integer, integer)', 'execute')
      and has_function_privilege('authenticated', 'public.marketplace_buyer_order_get_v2(uuid)', 'execute')
      and has_function_privilege('authenticated', 'public.marketplace_seller_orders_page_v2(uuid, text, text, date, date, integer, integer)', 'execute')
      and has_function_privilege('authenticated', 'public.marketplace_seller_order_get_v2(uuid)', 'execute')
      and has_function_privilege('authenticated', 'public.marketplace_order_invoice_get(uuid)', 'execute')
      and has_function_privilege('authenticated', 'public.marketplace_order_waybill_get(uuid)', 'execute')
      and has_function_privilege('authenticated', 'public.marketplace_seller_order_shipment_update(uuid, text, text)', 'execute'),
  'A5 the seven public functions are executable by authenticated');
select ok(not has_function_privilege('anon', 'public.marketplace_buyer_orders_v2(text, text, text, integer, integer)', 'execute')
      and not has_function_privilege('anon', 'public.marketplace_order_invoice_get(uuid)', 'execute')
      and not has_function_privilege('anon', 'public.marketplace_order_waybill_get(uuid)', 'execute'), 'A6 anon cannot execute them');
select ok(not has_function_privilege('authenticated', 'app.marketplace_order_summary(public.marketplace_orders, text)', 'execute')
      and not has_function_privilege('authenticated', 'app.marketplace_order_invoice_issue(uuid, text)', 'execute')
      and not has_function_privilege('authenticated', 'app.marketplace_order_document_v2(uuid, text)', 'execute'), 'A7 internals are not executable by clients');

-- ---------------------------------------------------------------------------
-- B. BUYER LIST
-- ---------------------------------------------------------------------------
select pg_temp.as_user(current_setting('t.buyer'));
select is((public.marketplace_buyer_orders_v2() ->> 'total')::int, 10, 'B1 default (3 months): the buyer sees his 10 recent orders in showroom A and B, not buyer2 and not the 2-year-old one');
select is((select count(*)::int from jsonb_array_elements(public.marketplace_buyer_orders_v2() -> 'items') i where i ->> 'id' = current_setting('t.o_other')), 0, 'B2 another buyer''s order never appears');
select is((public.marketplace_buyer_orders_v2(null, 'all') ->> 'total')::int, 11, 'B3 period all adds the old order');
select is((public.marketplace_buyer_orders_v2(null, '1y') ->> 'total')::int, 10, 'B4 one year still hides the 2-year-old order');
select is((public.marketplace_buyer_orders_v2(null, '3m', 'delivered') ->> 'total')::int, 1, 'B5 group delivered');
select is((public.marketplace_buyer_orders_v2(null, '3m', 'cancelled') ->> 'total')::int, 1, 'B6 group cancelled');
select is((public.marketplace_buyer_orders_v2(null, '3m', 'active') ->> 'total')::int, 8, 'B7 group active (new, preparing x2, ready x2, shipped, legacy shipped, showroom B new)');
select is((public.marketplace_buyer_orders_v2((select order_number from public.marketplace_orders where id = current_setting('t.o_ship')::uuid)) ->> 'total')::int, 1, 'B8 search by order number');
select is((public.marketplace_buyer_orders_v2('ناعم') ->> 'total')::int, 10, 'B9 search by Arabic product name matches every order that has the product');
select is((public.marketplace_buyer_orders_v2('second paper') ->> 'total')::int, 10, 'B10 search by English product name');
select is((public.marketplace_buyer_orders_v2('pg-2') ->> 'total')::int, 10, 'B11 search by SKU, any case');
select is((public.marketplace_buyer_orders_v2('no-such-thing') ->> 'total')::int, 0, 'B12 a search with no match is empty');
select is((public.marketplace_buyer_orders_v2('%') ->> 'total')::int, 0, 'B13 a wildcard typed by the buyer is a literal, not "match everything"');
select is((public.marketplace_buyer_orders_v2(null, '3m', null, 4, 0) -> 'items') #>> '{0,id}' is not null, true, 'B14 paging returns rows');
select is(jsonb_array_length(public.marketplace_buyer_orders_v2(null, '3m', null, 4, 0) -> 'items'), 4, 'B15 limit is honoured');
select is(jsonb_array_length(public.marketplace_buyer_orders_v2(null, '3m', null, 4, 8) -> 'items'), 2, 'B16 offset is honoured (10 rows, offset 8)');
select throws_ok($$select public.marketplace_buyer_orders_v2(null, 'forever')$$, '22023', 'mp:invalid_payload', 'B17 unknown period refused');
select throws_ok($$select public.marketplace_buyer_orders_v2(null, '3m', 'pending_confirmation')$$, '22023', 'mp:invalid_payload', 'B18 unknown group refused');
select ok((select every(i ->> 'buyer_name' is null and i ->> 'governorate_key' is null) from jsonb_array_elements(public.marketplace_buyer_orders_v2() -> 'items') i), 'B19 buyer rows do not carry the seller-view fields');
select is((select (i -> 'first_items' -> 0 ->> 'quantity')::int from jsonb_array_elements(public.marketplace_buyer_orders_v2() -> 'items') i where i ->> 'id' = current_setting('t.o_new')), 2, 'B20 first_items and item_count come from the snapshot');
select is((select (i ->> 'item_count')::int from jsonb_array_elements(public.marketplace_buyer_orders_v2() -> 'items') i where i ->> 'id' = current_setting('t.o_new')), 3, 'B21 item_count is the sum of quantities');
select is((select i -> 'estimate' ->> 'earliest' from jsonb_array_elements(public.marketplace_buyer_orders_v2() -> 'items') i where i ->> 'id' = current_setting('t.o_new')), to_char(current_date + 2, 'YYYY-MM-DD'), 'B22 the frozen estimate is returned');
select is((select (i ->> 'action_needed')::boolean from jsonb_array_elements(public.marketplace_buyer_orders_v2() -> 'items') i where i ->> 'id' = current_setting('t.o_disp')), true, 'B23 a disputed receipt is an action for the buyer');
select is((select (i ->> 'has_dispute')::boolean from jsonb_array_elements(public.marketplace_buyer_orders_v2() -> 'items') i where i ->> 'id' = current_setting('t.o_prep')), false, 'B24 no dispute flag on a normal order');
select pg_temp.as_anon();
select throws_ok($$select public.marketplace_buyer_orders_v2()$$, '42501', 'mp:auth_required', 'B25 anonymous refused');

-- ---------------------------------------------------------------------------
-- C. BUYER GET
-- ---------------------------------------------------------------------------
select pg_temp.as_user(current_setting('t.buyer'));
select is(public.marketplace_buyer_order_get_v2(current_setting('t.o_ship')::uuid) ->> 'viewer', 'buyer', 'C1 own order, viewer buyer');
select throws_ok(format($$select public.marketplace_buyer_order_get_v2(%L)$$, current_setting('t.o_other')), '42501', 'mp:not_found', 'C2 another buyer''s order is not found');
select throws_ok(format($$select public.marketplace_buyer_order_get_v2(%L)$$, gen_random_uuid()), '42501', 'mp:not_found', 'C3 an unknown id gives the same answer');
select ok(position(current_setting('t.a') in public.marketplace_buyer_order_get_v2(current_setting('t.o_ship')::uuid)::text) = 0, 'C4 the buyer document never carries the seller organization id');
select is(public.marketplace_buyer_order_get_v2(current_setting('t.o_ship')::uuid) #>> '{delivery,shipment,tracking_number}', 'BST-1001', 'C5 tracking number reaches the buyer');
select is(public.marketplace_buyer_order_get_v2(current_setting('t.o_canc')::uuid) #>> '{cancellation,message_en}', 'Out of stock', 'C6 the buyer reads the cancellation message');
select ok(public.marketplace_buyer_order_get_v2(current_setting('t.o_canc')::uuid) -> 'cancellation' -> 'internal_note' = 'null'::jsonb
       or not (public.marketplace_buyer_order_get_v2(current_setting('t.o_canc')::uuid) -> 'cancellation' ? 'internal_note')
       or public.marketplace_buyer_order_get_v2(current_setting('t.o_canc')::uuid) #>> '{cancellation,internal_note}' is null, 'C7 the buyer never reads the internal note');
select ok(position('supplier delayed' in public.marketplace_buyer_order_get_v2(current_setting('t.o_canc')::uuid)::text) = 0, 'C8 the internal note text is nowhere in the buyer document');
select is(jsonb_path_exists(public.marketplace_buyer_order_get_v2(current_setting('t.o_new')::uuid), '$.events[*] ? (@.action == "reminder_seller_start")'), false, 'C9 internal events are hidden from the buyer');
select is(public.marketplace_buyer_order_get_v2(current_setting('t.o_new')::uuid) -> 'actions', '["cancel"]'::jsonb, 'C10 a new order: the buyer may cancel');
select is(public.marketplace_buyer_order_get_v2(current_setting('t.o_leg')::uuid) ->> 'source', 'legacy', 'C11 a legacy order is readable and says so');
select is(public.marketplace_buyer_order_get_v2(current_setting('t.o_leg')::uuid) -> 'actions', '[]'::jsonb, 'C12 a legacy order offers no action');
select pg_temp.as_anon();
select throws_ok(format($$select public.marketplace_buyer_order_get_v2(%L)$$, current_setting('t.o_new')), '42501', 'mp:auth_required', 'C13 anonymous refused');

-- ---------------------------------------------------------------------------
-- D. SELLER LIST
-- ---------------------------------------------------------------------------
select pg_temp.as_user(current_setting('t.seller'));
select is(public.marketplace_seller_orders_page_v2(current_setting('t.a')::uuid) -> 'counts',
  '{"new": 2, "shipped": 2, "cancelled": 1, "delivered": 2, "in_preparation": 4}'::jsonb, 'D1 counts per tab (new: new + other buyer''s; shipped: shipped + legacy shipped; delivered: done + old)');
select is((public.marketplace_seller_orders_page_v2(current_setting('t.a')::uuid, 'new') ->> 'total')::int, 2, 'D2 tab new');
select is((public.marketplace_seller_orders_page_v2(current_setting('t.a')::uuid, 'in_preparation') ->> 'total')::int, 4, 'D3 tab in_preparation holds preparing and ready');
select is((public.marketplace_seller_orders_page_v2(current_setting('t.a')::uuid, 'shipped') ->> 'total')::int, 2, 'D4 tab shipped');
select is((public.marketplace_seller_orders_page_v2(current_setting('t.a')::uuid, 'cancelled') ->> 'total')::int, 1, 'D5 tab cancelled');
select throws_ok(format($$select public.marketplace_seller_orders_page_v2(%L, 'pending_confirmation')$$, current_setting('t.a')), '22023', 'mp:invalid_payload', 'D6 the removed awaiting-confirmation tab is not a tab');
select is((public.marketplace_seller_orders_page_v2(current_setting('t.a')::uuid, null, 'Recipient disp') ->> 'total')::int, 1, 'D7 search by buyer name');
select is((public.marketplace_seller_orders_page_v2(current_setting('t.a')::uuid, null, 'PG-1') ->> 'total')::int, 12 - 1 - 0, 'D8 search by SKU across all orders of the showroom (all but showroom B''s)');
select is((public.marketplace_seller_orders_page_v2(current_setting('t.a')::uuid, null, null, current_date + 1, current_date + 2) ->> 'total')::int, 0, 'D9 a date range in the future is empty');
select is((public.marketplace_seller_orders_page_v2(current_setting('t.a')::uuid, null, null, (now() at time zone 'Africa/Cairo')::date, (now() at time zone 'Africa/Cairo')::date) ->> 'total')::int, 11 - 1, 'D10 today (Cairo) holds every order but the old one');
select throws_ok(format($$select public.marketplace_seller_orders_page_v2(%L, null, null, current_date, current_date - 1)$$, current_setting('t.a')), '22023', 'mp:invalid_payload', 'D11 from after to is refused');
select is((public.marketplace_seller_orders_page_v2(current_setting('t.a')::uuid) ->> 'needs_attention')::int, 2, 'D12 needs_attention: receipt waiting + disputed receipt');
select is((select (i ->> 'action_needed')::boolean from jsonb_array_elements(public.marketplace_seller_orders_page_v2(current_setting('t.a')::uuid) -> 'items') i where i ->> 'id' = current_setting('t.o_prep')), true, 'D13 the row of a receipt to review is flagged');
select is((select i ->> 'buyer_name' from jsonb_array_elements(public.marketplace_seller_orders_page_v2(current_setting('t.a')::uuid) -> 'items') i where i ->> 'id' = current_setting('t.o_new')), 'Recipient new', 'D14 the seller rows carry the buyer (recipient) name');
select is((select i ->> 'governorate_key' from jsonb_array_elements(public.marketplace_seller_orders_page_v2(current_setting('t.a')::uuid) -> 'items') i where i ->> 'id' = current_setting('t.o_new')), 'cairo', 'D15 and the governorate');
select is((select count(*)::int from jsonb_array_elements(public.marketplace_seller_orders_page_v2(current_setting('t.a')::uuid) -> 'items') i where i ->> 'id' = current_setting('t.o_b')), 0, 'D16 another showroom''s order never appears');
select is(jsonb_array_length(public.marketplace_seller_orders_page_v2(current_setting('t.a')::uuid, null, null, null, null, 5, 0) -> 'items'), 5, 'D17 limit honoured');
select pg_temp.as_user(current_setting('t.sellerb'));
select throws_ok(format($$select public.marketplace_seller_orders_page_v2(%L)$$, current_setting('t.a')), '42501', 'mp:not_found', 'D18 another showroom''s owner is refused');
select pg_temp.as_user(current_setting('t.sales'));
select throws_ok(format($$select public.marketplace_seller_orders_page_v2(%L)$$, current_setting('t.a')), '42501', 'mp:not_found', 'D19 a member without order rights is refused');
select pg_temp.as_user(current_setting('t.buyer'));
select throws_ok(format($$select public.marketplace_seller_orders_page_v2(%L)$$, current_setting('t.a')), '42501', 'mp:not_found', 'D20 a buyer is refused');
select pg_temp.as_anon();
select throws_ok(format($$select public.marketplace_seller_orders_page_v2(%L)$$, current_setting('t.a')), '42501', 'mp:not_found', 'D21 anonymous refused');

-- ---------------------------------------------------------------------------
-- E. SELLER GET
-- ---------------------------------------------------------------------------
select pg_temp.as_user(current_setting('t.seller'));
select is(public.marketplace_seller_order_get_v2(current_setting('t.o_new')::uuid) ->> 'viewer', 'seller', 'E1 seller document');
select is(public.marketplace_seller_order_get_v2(current_setting('t.o_new')::uuid) -> 'actions', '["start_preparing", "cancel"]'::jsonb, 'E2 a new order: start preparing or cancel (no confirm step)');
select is(public.marketplace_seller_order_get_v2(current_setting('t.o_prep')::uuid) -> 'actions', '["mark_ready", "cancel", "accept_receipt", "flag_receipt_not_received"]'::jsonb, 'E3 preparing with a receipt: ready, cancel, review the receipt');
select is(public.marketplace_seller_order_get_v2(current_setting('t.o_disp')::uuid) -> 'actions', '["cancel", "accept_receipt"]'::jsonb, 'E4 a disputed receipt freezes progress');
select is(public.marketplace_seller_order_get_v2(current_setting('t.o_canc')::uuid) #>> '{cancellation,internal_note}', 'supplier delayed', 'E5 the seller reads the internal note');
select is(public.marketplace_seller_order_get_v2(current_setting('t.o_new')::uuid) #>> '{recipient,phone}', '+201999000009', 'E6 the seller reads the recipient phone (the delivery needs it)');
select is(jsonb_path_exists(public.marketplace_seller_order_get_v2(current_setting('t.o_new')::uuid), '$.events[*] ? (@.action == "reminder_seller_start")'), true, 'E7 the seller sees internal events');
select pg_temp.as_user(current_setting('t.sellerb'));
select throws_ok(format($$select public.marketplace_seller_order_get_v2(%L)$$, current_setting('t.o_new')), '42501', 'mp:not_found', 'E8 another showroom: not found');
select pg_temp.as_user(current_setting('t.sales'));
select throws_ok(format($$select public.marketplace_seller_order_get_v2(%L)$$, current_setting('t.o_new')), '42501', 'mp:not_found', 'E9 member without order rights: not found');
select pg_temp.as_user(current_setting('t.buyer'));
select throws_ok(format($$select public.marketplace_seller_order_get_v2(%L)$$, current_setting('t.o_new')), '42501', 'mp:not_found', 'E10 the buyer cannot use the seller read');

-- ---------------------------------------------------------------------------
-- F. INVOICE
-- ---------------------------------------------------------------------------
select pg_temp.as_user(current_setting('t.buyer'));
select throws_ok(format($$select public.marketplace_order_invoice_get(%L)$$, current_setting('t.o_new')), '23514', 'mp:invoice_not_available', 'F1 no invoice before the order is ready');
select throws_ok(format($$select public.marketplace_order_invoice_get(%L)$$, current_setting('t.o_canc')), '23514', 'mp:invoice_not_available', 'F2 no invoice for an order cancelled before it was ready');
select is(public.marketplace_buyer_order_get_v2(current_setting('t.o_ready')::uuid) -> 'invoice', 'null'::jsonb, 'F3 the document has invoice null before issue');
select set_config('t.inv', public.marketplace_order_invoice_get(current_setting('t.o_ready')::uuid) ->> 'invoice_number', true);
select matches(current_setting('t.inv'), '^INV-[0-9]{6}$', 'F4 the first read issues INV-nnnnnn');
select is(public.marketplace_order_invoice_get(current_setting('t.o_ready')::uuid) ->> 'invoice_number', current_setting('t.inv'), 'F5 the second read returns the same number');
select is((select count(*)::int from public.marketplace_order_invoices where order_id = current_setting('t.o_ready')::uuid), 1, 'F6 one invoice per order');
select is((select count(*)::int from public.marketplace_order_events where order_id = current_setting('t.o_ready')::uuid and action = 'invoice_issued'), 1, 'F7 one internal event, written once');
select is(public.marketplace_order_invoice_get(current_setting('t.o_ready')::uuid) #>> '{buyer,name}', 'Recipient ready', 'F8 buyer snapshot: recipient name');
select ok(position('+2019990' in public.marketplace_order_invoice_get(current_setting('t.o_ready')::uuid)::text) = 0, 'F9 the invoice never carries a phone number');
select is(jsonb_array_length(public.marketplace_order_invoice_get(current_setting('t.o_ready')::uuid) -> 'lines'), 2, 'F10 the lines come from the order snapshot');
select is((public.marketplace_order_invoice_get(current_setting('t.o_ready')::uuid) ->> 'total_egp')::numeric, 450::numeric, 'F11 totals come from the order');
select is(public.marketplace_buyer_order_get_v2(current_setting('t.o_ready')::uuid) #>> '{invoice,number}', current_setting('t.inv'), 'F12 the document now carries the invoice key');
select is(jsonb_path_exists(public.marketplace_buyer_order_get_v2(current_setting('t.o_ready')::uuid), '$.events[*] ? (@.action == "invoice_issued")'), false, 'F13 invoice_issued stays internal for the buyer');
select pg_temp.as_user(current_setting('t.seller'));
select is(public.marketplace_order_invoice_get(current_setting('t.o_ready')::uuid) ->> 'invoice_number', current_setting('t.inv'), 'F14 the seller reads the same invoice');
select is(jsonb_path_exists(public.marketplace_seller_order_get_v2(current_setting('t.o_ready')::uuid), '$.events[*] ? (@.action == "invoice_issued")'), true, 'F15 the seller sees the internal event');
select pg_temp.as_user(current_setting('t.buyer2'));
select throws_ok(format($$select public.marketplace_order_invoice_get(%L)$$, current_setting('t.o_ready')), '42501', 'mp:not_found', 'F16 another buyer is refused');
select pg_temp.as_user(current_setting('t.sellerb'));
select throws_ok(format($$select public.marketplace_order_invoice_get(%L)$$, current_setting('t.o_ready')), '42501', 'mp:not_found', 'F17 another showroom is refused');
select pg_temp.as_user(current_setting('t.sales'));
select throws_ok(format($$select public.marketplace_order_invoice_get(%L)$$, current_setting('t.o_ready')), '42501', 'mp:not_found', 'F18 a member without order rights is refused');
select pg_temp.as_anon();
select throws_ok(format($$select public.marketplace_order_invoice_get(%L)$$, current_setting('t.o_ready')), '42501', 'mp:auth_required', 'F19 anonymous refused');
-- a later change of the order never changes the invoice (snapshot) and the row cannot be updated
select throws_ok(format($$update public.marketplace_order_invoices set total_egp = 1, subtotal_egp = 1, delivery_fee_egp = 0 where order_id = %L$$, current_setting('t.o_ready')), '23514', 'mp:invoice_immutable', 'F20 an issued invoice cannot be updated');
-- an invoice stays readable when the order is cancelled afterwards
reset role;
select pg_temp.as_user(current_setting('t.seller'));
select ok(public.marketplace_order_invoice_get(current_setting('t.o_done')::uuid) ->> 'invoice_number' <> current_setting('t.inv'), 'F21 a second order gets its own, different number');

-- ---------------------------------------------------------------------------
-- G. WAYBILL
-- ---------------------------------------------------------------------------
select is(public.marketplace_order_waybill_get(current_setting('t.o_ready')::uuid) #>> '{recipient,phone}', '+201999000009', 'G1 the waybill carries the recipient phone for the courier');
select is((public.marketplace_order_waybill_get(current_setting('t.o_ready')::uuid) #>> '{payment,collect_on_delivery_egp}')::numeric, 450::numeric, 'G2 cash on delivery: the whole total is collected');
select is((public.marketplace_order_waybill_get(current_setting('t.o_prep')::uuid) #>> '{payment,collect_on_delivery_egp}')::numeric, 0::numeric, 'G3 full InstaPay: nothing to collect');
select is((public.marketplace_order_waybill_get(current_setting('t.o_ship')::uuid) #>> '{payment,collect_on_delivery_egp}')::numeric, 315::numeric, 'G4 deposit: the balance is collected');
select is((public.marketplace_order_waybill_get(current_setting('t.o_done')::uuid) #>> '{payment,collect_on_delivery_egp}')::numeric, 0::numeric, 'G5 a settled payment collects nothing');
select is(public.marketplace_order_waybill_get(current_setting('t.o_ship')::uuid) ->> 'tracking_number', 'BST-1001', 'G6 tracking number printed');
select is(jsonb_array_length(public.marketplace_order_waybill_get(current_setting('t.o_ready')::uuid) -> 'items'), 2, 'G7 the items come from the snapshot');
select is(public.marketplace_order_waybill_get(current_setting('t.o_ready')::uuid) ->> 'notes', 'Call before arriving', 'G8 the delivery note is printed');
select throws_ok(format($$select public.marketplace_order_waybill_get(%L)$$, current_setting('t.o_pick')), '23514', 'mp:not_a_delivery_order', 'G9 a pickup order has no waybill');
select throws_ok(format($$select public.marketplace_order_waybill_get(%L)$$, current_setting('t.o_canc')), '23514', 'mp:invalid_transition', 'G10 a cancelled order has no waybill');
select pg_temp.as_user(current_setting('t.buyer'));
select throws_ok(format($$select public.marketplace_order_waybill_get(%L)$$, current_setting('t.o_ready')), '42501', 'mp:not_found', 'G11 the buyer cannot read the waybill');
select pg_temp.as_user(current_setting('t.sellerb'));
select throws_ok(format($$select public.marketplace_order_waybill_get(%L)$$, current_setting('t.o_ready')), '42501', 'mp:not_found', 'G12 another showroom is refused');
select pg_temp.as_user(current_setting('t.sales'));
select throws_ok(format($$select public.marketplace_order_waybill_get(%L)$$, current_setting('t.o_ready')), '42501', 'mp:not_found', 'G13 a member without order rights is refused');
select pg_temp.as_anon();
select throws_ok(format($$select public.marketplace_order_waybill_get(%L)$$, current_setting('t.o_ready')), '42501', 'mp:auth_required', 'G14 anonymous refused');

-- ---------------------------------------------------------------------------
-- H. SHIPMENT CORRECTION
-- ---------------------------------------------------------------------------
select pg_temp.as_user(current_setting('t.seller'));
select is(public.marketplace_seller_order_shipment_update(current_setting('t.o_ship')::uuid, 'Aramex', 'ARX/2002') #>> '{delivery,shipment,tracking_number}', 'ARX/2002', 'H1 carrier and tracking corrected');
select is((select count(*)::int from public.marketplace_order_events where order_id = current_setting('t.o_ship')::uuid and action = 'shipment_updated'), 1, 'H2 one shipment_updated event');
select is(public.marketplace_seller_order_shipment_update(current_setting('t.o_ship')::uuid, 'Aramex', 'ARX/2002') ->> 'id', current_setting('t.o_ship'), 'H3 a repeat with the same values is a no-op that returns the document');
select is((select count(*)::int from public.marketplace_order_events where order_id = current_setting('t.o_ship')::uuid and action = 'shipment_updated'), 1, 'H4 the repeat wrote no second event');
select is((select status from public.marketplace_orders where id = current_setting('t.o_ship')::uuid), 'shipped', 'H5 the status is untouched');
select is(public.marketplace_seller_order_shipment_update(current_setting('t.o_ship')::uuid, null, null) #>> '{delivery,shipment,carrier_name}', null, 'H6 both may be cleared (own delivery)');
select throws_ok(format($$select public.marketplace_seller_order_shipment_update(%L, 'X', 'ABC123')$$, current_setting('t.o_ship')), '22023', 'mp:carrier_invalid', 'H7 carrier needs 2 to 80 characters');
select throws_ok(format($$select public.marketplace_seller_order_shipment_update(%L, 'Aramex', 'has space')$$, current_setting('t.o_ship')), '22023', 'mp:tracking_invalid', 'H8 tracking pattern enforced');
select throws_ok(format($$select public.marketplace_seller_order_shipment_update(%L, 'Aramex', 'AB')$$, current_setting('t.o_ship')), '22023', 'mp:tracking_invalid', 'H9 tracking needs 3 to 64 characters');
select throws_ok(format($$select public.marketplace_seller_order_shipment_update(%L, 'Aramex', 'ABC123')$$, current_setting('t.o_ready')), '23514', 'mp:invalid_transition', 'H10 only a shipped order can be corrected');
select throws_ok(format($$select public.marketplace_seller_order_shipment_update(%L, 'Aramex', 'ABC123')$$, current_setting('t.o_done')), '23514', 'mp:invalid_transition', 'H11 not after delivery');
select throws_ok(format($$select public.marketplace_seller_order_shipment_update(%L, 'Aramex', 'ABC123')$$, current_setting('t.o_leg')), '23514', 'mp:legacy_order', 'H12 a legacy order is refused');
select pg_temp.as_user(current_setting('t.buyer'));
select throws_ok(format($$select public.marketplace_seller_order_shipment_update(%L, 'Aramex', 'ABC123')$$, current_setting('t.o_ship')), '42501', 'mp:not_found', 'H13 the buyer cannot correct a shipment');
select pg_temp.as_user(current_setting('t.sellerb'));
select throws_ok(format($$select public.marketplace_seller_order_shipment_update(%L, 'Aramex', 'ABC123')$$, current_setting('t.o_ship')), '42501', 'mp:not_found', 'H14 another showroom is refused');
select pg_temp.as_user(current_setting('t.sales'));
select throws_ok(format($$select public.marketplace_seller_order_shipment_update(%L, 'Aramex', 'ABC123')$$, current_setting('t.o_ship')), '42501', 'mp:not_found', 'H15 a member without order rights is refused');
select pg_temp.as_anon();
select throws_ok(format($$select public.marketplace_seller_order_shipment_update(%L, 'Aramex', 'ABC123')$$, current_setting('t.o_ship')), '42501', 'mp:auth_required', 'H16 anonymous refused');

-- ---------------------------------------------------------------------------
-- I. NO WRITES TO THE ORDER OR THE STOCK
-- ---------------------------------------------------------------------------
reset role;
select is((select count(*)::text from public.marketplace_stock_movements), current_setting('t.moves'), 'I1 no stock movement was written by any read, invoice, waybill or correction');
select is((select status || '/' || payment_status || '/' || stock_state from public.marketplace_orders where id = current_setting('t.o_ready')::uuid), 'ready/pending/deducted', 'I2 a ready order is unchanged');
select is((select status || '/' || payment_status || '/' || stock_state from public.marketplace_orders where id = current_setting('t.o_new')::uuid), 'new/pending/pending', 'I3 a new order is unchanged');

select * from finish();
rollback;
