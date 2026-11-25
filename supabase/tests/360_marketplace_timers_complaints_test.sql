-- pgTAP: Marketplace PR 14 - order timers, notifications and payment complaints
-- (20261125120001/2/3; contract docs/product/marketplace-order-model-contract-20261124.md sections 4.4, 5, 6, 7)
--
--   A. SHAPE       RPC-only tables, function privileges (runner: service role only), the permission row.
--   B. SELLER      reminder every 6 h, catch-up gives ONE reminder, expiry at 72 h releases stock, replay and overlap no-ops,
--                  boundary at exactly 72 h, a stale timer of an order that moved on, bounded batch, return timers untouched.
--   C. RECEIPT     buyer path: reminder at 24 h, cancel at 48 h; a complaint under review pauses the clock, decision resumes it.
--   D. COMPLAINT   file (buyer / showroom managers), refusals, one per dispute, admin gate (permission is grantable),
--                  take / decide with the three outcomes, notifications, receipts readable only with the permission.
--   E. ISOLATION   other showroom, outsider, anonymous, admin without the permission.
--
-- Fixtures (seed-pilot): showroom A 9c000000-...001 (owner 70000001 manages orders; 70000002 sales-only), showroom B 91000005-...005
-- (owner 71000005), buyer 70000009, staff 55555555 (administrator: gets the permission inside the test only).
create extension if not exists pgtap;

begin;
select no_plan();

update auth.users set email_confirmed_at = now() where email_confirmed_at is null;
select set_config('t.a', '9c000000-cccc-4ccc-8ccc-000000000001', true);
select set_config('t.seller', '70000001-0000-4000-8000-000000000001', true);
select set_config('t.sales', '70000002-0000-4000-8000-000000000002', true);
select set_config('t.sellerb', '71000005-0000-4000-8000-000000000005', true);
select set_config('t.buyer', '70000009-0000-4000-8000-000000000009', true);
select set_config('t.admin', '55555555-5555-4555-8555-555555555555', true);

select set_config('app.marketplace_seller_write', 'on', true);
insert into public.marketplace_seller_accounts (organization_id, status, approved_at)
values (current_setting('t.a')::uuid, 'approved', now()), ('91000005-1111-4111-8111-000000000005', 'approved', now())
on conflict (organization_id) do update set status = 'approved', approved_at = now();
select set_config('app.marketplace_seller_write', 'off', true);

create function pg_temp.as_user(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.as_anon() returns void language sql as $$ select set_config('request.jwt.claims', '', true); $$;
create function pg_temp.stock() returns text language sql as $$
  select l.on_hand || '/' || l.reserved from public.marketplace_inventory_levels l
  join public.marketplace_product_variants v on v.id = l.variant_id
  where v.sku = 'TMR-1' and v.seller_organization_id = current_setting('t.a')::uuid;
$$;
create function pg_temp.notes(p_order text, p_event text) returns integer language sql as $$
  select count(*)::int from public.notifications n where n.subject_id = p_order::uuid and n.event_type = p_event;
$$;
create function pg_temp.run(p_now timestamptz, p_limit integer default 200) returns jsonb language sql as $$
  select public.marketplace_timers_run(p_limit, p_now);
$$;

-- fixture: one product with stock 100 at showroom A
select pg_temp.as_user(current_setting('t.seller'));
select set_config('t.p1', (public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'), 'product_type_key', 'wallpaper', 'name_ar', 'ورق مؤقت', 'name_en', 'Timer paper',
  'variants', jsonb_build_array(jsonb_build_object('sku', 'TMR-1', 'selling_unit', 'roll', 'price_egp', 100)))) ->> 'id'), true);
select set_config('t.loc', public.marketplace_seller_default_location(current_setting('t.a')::uuid)::text, true);
select public.marketplace_seller_stock_adjust((select id from public.marketplace_product_variants where sku = 'TMR-1'),
  current_setting('t.loc')::uuid, 100, 'tmr-stock-0001');
reset role;
select pg_temp.as_anon();

-- an order with a reserved quantity of 2 (what checkout confirm leaves behind)
create function pg_temp.mk_order(p_method text, p_status text, p_pay text, p_placed timestamptz, p_timer text default null) returns text
language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
  v_var uuid := (select id from public.marketplace_product_variants where sku = 'TMR-1');
  v_ip boolean := p_method <> 'cod';
begin
  insert into public.marketplace_orders (id, checkout_id, idempotency_key, buyer_user_id, seller_organization_id, status, payment_method,
    payment_status, fulfilment, buyer_name, buyer_phone, subtotal_egp, delivery_fee_egp, total_egp, instapay_address, instapay_account_name,
    source, stock_state, paid_now_egp, balance_due_egp, placed_at)
  values (v_id, gen_random_uuid(), 'tmr-' || v_id::text, current_setting('t.buyer')::uuid, current_setting('t.a')::uuid, p_status, p_method,
    p_pay, 'pickup', 'Test Buyer', '+201999000009', 200, 0, 200, case when v_ip then 'shop@instapay' end, case when v_ip then 'Shop' end,
    'v2', 'pending', case when v_ip then 200 else 0 end, case when v_ip then 0 else 200 end, p_placed);
  insert into public.marketplace_order_items (order_id, product_id, variant_id, location_id, sku, name_ar, name_en, selling_unit, unit_price_egp, quantity, product_slug)
  values (v_id, current_setting('t.p1')::uuid, v_var, current_setting('t.loc')::uuid, 'TMR-1', 'ورق', 'Paper', 'roll', 100, 2, 'timer-paper');
  perform app.marketplace_order_stock(v_id, 'reserve');
  if v_ip then
    insert into public.marketplace_payment_proofs (order_id, object_key, mime_type, created_by, upload_state, status)
    values (v_id, 'proofs/' || v_id::text || '/' || gen_random_uuid()::text || '.png', 'image/png', current_setting('t.buyer')::uuid, 'confirmed',
            case when p_pay = 'receipt_disputed' then 'rejected' else 'submitted' end);
  end if;
  if p_pay = 'receipt_disputed' then
    insert into public.marketplace_order_events (order_id, action, from_status, to_status, from_payment, to_payment, actor_role)
    values (v_id, 'receipt_disputed', p_status, p_status, 'receipt_submitted', 'receipt_disputed', 'seller');
  end if;
  if p_timer is not null then perform app.marketplace_timer_open('order', v_id, p_timer, p_placed); end if;
  return v_id::text;
end;
$$;

-- ===========================================================================
-- A. Shape
-- ===========================================================================
select is((select bool_and(relrowsecurity) from pg_class where oid in ('public.marketplace_payment_complaints'::regclass,
  'public.marketplace_payment_complaint_events'::regclass)), true, 'A1. both complaint tables have RLS on');
select is((select count(*)::int from information_schema.role_table_grants
           where table_name in ('marketplace_payment_complaints', 'marketplace_payment_complaint_events')
             and grantee in ('anon', 'authenticated', 'service_role')), 0, 'A2. no client grant on the complaint tables (RPC-only)');
select is((select count(*)::int from pg_policy where polrelid in ('public.marketplace_payment_complaints'::regclass,
  'public.marketplace_payment_complaint_events'::regclass)), 0, 'A3. no policy: the tables are reachable only through SECURITY DEFINER functions');
select is((has_function_privilege('service_role', 'public.marketplace_timers_run(integer, timestamptz)', 'execute'),
           has_function_privilege('authenticated', 'public.marketplace_timers_run(integer, timestamptz)', 'execute'),
           has_function_privilege('anon', 'public.marketplace_timers_run(integer, timestamptz)', 'execute'))::text,
  '(t,f,f)', 'A4. the runner is executable by the service role only');
select is((select count(*)::int from unnest(array[
    'public.marketplace_payment_complaint_file(uuid,text,text)', 'public.admin_marketplace_payment_complaints(text,integer,integer)',
    'public.admin_marketplace_payment_complaint_get(uuid)', 'public.admin_marketplace_payment_complaint_take(uuid)',
    'public.admin_marketplace_payment_complaint_decide(uuid,text,text)']) f
  where has_function_privilege('authenticated', f, 'execute') and not has_function_privilege('anon', f, 'execute')
    and not has_function_privilege('service_role', f, 'execute')), 5, 'A5. complaint RPCs: authenticated only');
select is((select count(*)::int from unnest(array['app.marketplace_timer_handle(public.marketplace_timers,timestamptz)',
    'app.marketplace_notify_admins(text,text,text,uuid,text,jsonb)', 'app.marketplace_return_timer_tick(public.marketplace_timers,timestamptz)',
    'app.marketplace_complaint_admin_can_read(text)', 'app.marketplace_order_complaint_id(uuid)', 'app.marketplace_order_extra_actions(uuid,text)']) f
  where has_function_privilege('authenticated', f, 'execute') or has_function_privilege('anon', f, 'execute') or has_function_privilege('service_role', f, 'execute')),
  0, 'A6. internal helpers have no grant');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname in ('public', 'app') and (p.proname like 'marketplace\_timer%' or p.proname like '%payment\_complaint%')
             and not (p.proconfig @> array['search_path=""'])), 0,
  'A7. every timer and complaint function has an empty search_path');
select is((select (select is_locked from public.admin_role_permissions rp join public.admin_roles r on r.id = rp.role_id
                    where r.key = 'super_admin' and rp.permission_key = 'marketplace_payment_complaints.review'))::text, 'true',
  'A8. the permission exists and Super Admin holds it, locked');
select is((select count(*)::int from public.admin_role_permissions rp join public.admin_roles r on r.id = rp.role_id
            where rp.permission_key = 'marketplace_payment_complaints.review' and r.key <> 'super_admin'), 0,
  'A9. no other role holds the permission by default (grantable by the owner)');
select is((select count(*)::int from public.notification_templates where key in ('marketplace.order.reminder_seller_start',
  'marketplace.order.cancelled_timeout_seller', 'marketplace.order.reminder_receipt_resubmit', 'marketplace.order.cancelled_timeout_receipt',
  'marketplace.order.payment_complaint_filed', 'marketplace.order.payment_complaint_resolved')), 6, 'A10. the six PR 14 templates are seeded');

-- ===========================================================================
-- B. Seller start timer: reminders every 6 h, cancel at 72 h
-- ===========================================================================
select set_config('t.t0', '2026-12-01 10:00:00+00', true);
select set_config('t.o1', pg_temp.mk_order('cod', 'new', 'pending', current_setting('t.t0')::timestamptz, 'order_seller_start'), true);
select is(pg_temp.stock(), '100/2', 'B1. the order holds 2 units as PENDING');

select is(pg_temp.run(current_setting('t.t0')::timestamptz + interval '1 hour'), '{"processed":0,"reminders":0,"cancelled":0,"errors":0}'::jsonb,
  'B2. nothing is due after one hour');
select is(pg_temp.run(current_setting('t.t0')::timestamptz + interval '6 hours 1 minute'), '{"processed":1,"reminders":1,"cancelled":0,"errors":0}'::jsonb,
  'B3. the first reminder is sent at 6 h');
select is((select reminders_sent || '|' || (next_remind_at = current_setting('t.t0')::timestamptz + interval '12 hours') from public.marketplace_timers
            where subject_id = current_setting('t.o1')::uuid), '1|true', 'B4. the next reminder stays on the 6-hour schedule');
select is(pg_temp.run(current_setting('t.t0')::timestamptz + interval '6 hours 1 minute'), '{"processed":0,"reminders":0,"cancelled":0,"errors":0}'::jsonb,
  'B5. a second run at the same moment is a no-op (idempotent)');
select is(pg_temp.notes(current_setting('t.o1'), 'marketplace.order.reminder_seller_start'), 1, 'B6. exactly one reminder notification so far');
select is((select array_agg(distinct n.recipient_user_id)::text from public.notifications n where n.subject_id = current_setting('t.o1')::uuid
            and n.event_type = 'marketplace.order.reminder_seller_start'), '{' || current_setting('t.seller') || '}',
  'B7. the reminder reaches the order manager only, not the sales-only member');
select is((select n.content -> 'ar' ->> 'body' like '%6%' from public.notifications n where n.subject_id = current_setting('t.o1')::uuid
            and n.event_type = 'marketplace.order.reminder_seller_start' limit 1), true, 'B8. the Arabic text carries the hours waiting');
select is((select n.content -> 'en' ->> 'body' like '%66 hours%' from public.notifications n where n.subject_id = current_setting('t.o1')::uuid
            and n.event_type = 'marketplace.order.reminder_seller_start' limit 1), true, 'B9. the English text carries the hours left');

-- the runner was down for a day: ONE reminder, no burst, next on schedule
select is(pg_temp.run(current_setting('t.t0')::timestamptz + interval '30 hours'), '{"processed":1,"reminders":1,"cancelled":0,"errors":0}'::jsonb,
  'B10. after a long outage one reminder is sent, not four');
select is((select reminders_sent || '|' || (next_remind_at = current_setting('t.t0')::timestamptz + interval '36 hours') from public.marketplace_timers
            where subject_id = current_setting('t.o1')::uuid), '2|true', 'B11. the schedule resumes at the next 6-hour mark');
select is((select count(*)::int from public.marketplace_order_events where order_id = current_setting('t.o1')::uuid and action = 'reminder_seller_start'
            and actor_role = 'system'), 2, 'B12. each reminder is recorded as an internal system event');

-- a seller who started just before the deadline: the timer is closed by the machine, the runner finds nothing
select set_config('t.o2', pg_temp.mk_order('cod', 'new', 'pending', current_setting('t.t0')::timestamptz, 'order_seller_start'), true);
select app.marketplace_order_apply(current_setting('t.o2')::uuid, 'start_preparing', 'seller', current_setting('t.seller')::uuid, '{}'::jsonb);
select is((select state from public.marketplace_timers where subject_id = current_setting('t.o2')::uuid), 'done', 'B13. starting preparation closes the timer');
-- a stale timer: the order moved on without closing it (defence in depth)
select set_config('t.o3', pg_temp.mk_order('cod', 'new', 'pending', current_setting('t.t0')::timestamptz, 'order_seller_start'), true);
select set_config('app.marketplace_order_apply', 'on', true);
update public.marketplace_orders set status = 'preparing', preparing_at = now() where id = current_setting('t.o3')::uuid;
select set_config('app.marketplace_order_apply', 'off', true);
select is(pg_temp.stock(), '100/6', 'B14. three orders hold 6 units before the deadline');

-- expiry at 72 h (this run also finds o2 and o3: both closed without effect)
select is(pg_temp.run(current_setting('t.t0')::timestamptz + interval '73 hours'), '{"processed":2,"reminders":0,"cancelled":1,"errors":0}'::jsonb,
  'B15. at 73 h one order is cancelled; the stale timer of the order that moved on is only closed');
select is((select status || '|' || stock_state || '|' || payment_status from public.marketplace_orders where id = current_setting('t.o1')::uuid),
  'cancelled|released|not_collected', 'B16. the unstarted order is cancelled, stock released, COD not collected');
select is(pg_temp.stock(), '100/4', 'B17. the 2 units of the cancelled order are available again (the two started orders still hold theirs)');
select is((select state from public.marketplace_timers where subject_id = current_setting('t.o1')::uuid and kind = 'order_seller_start'), 'expired',
  'B18. the timer is recorded as expired');
select is((select reason_code || '|' || stock_effect || '|' || cancelled_by_role from public.marketplace_order_cancellations
            where order_id = current_setting('t.o1')::uuid), 'timeout_seller_start|released|system', 'B19. the cancellation record is a system timeout');
select is((select (state || '|' || closed_by_action) from public.marketplace_timers where subject_id = current_setting('t.o3')::uuid),
  'done|order_moved', 'B20. the stale timer of an order that already moved is closed done, no side effect');
select is((select status from public.marketplace_orders where id = current_setting('t.o3')::uuid), 'preparing', 'B21. the order that moved on is untouched');
select is(pg_temp.notes(current_setting('t.o1'), 'marketplace.order.cancelled_timeout_seller'), 2, 'B22. buyer and the showroom manager are both told');
select is((select count(*)::int from public.notifications n where n.subject_id = current_setting('t.o1')::uuid
            and n.event_type = 'marketplace.order.cancelled_timeout_seller' and n.recipient_user_id = current_setting('t.buyer')::uuid), 1, 'B23. exactly one reaches the buyer');
select is(pg_temp.run(current_setting('t.t0')::timestamptz + interval '73 hours'), '{"processed":0,"reminders":0,"cancelled":0,"errors":0}'::jsonb,
  'B24. replaying the run changes nothing');
select is(pg_temp.stock(), '100/4', 'B25. and moves no stock a second time');
select is((select count(*)::int from public.marketplace_stock_movements m where m.reference_id = current_setting('t.o1') and m.movement_type = 'release'), 1,
  'B26. the ledger holds exactly one release for the order');
select is((select count(*)::int from public.marketplace_order_events where order_id = current_setting('t.o1')::uuid and action = 'cancelled_timeout_seller'), 1,
  'B27. exactly one cancellation event');

-- exactly at the deadline, and a bounded batch
select set_config('t.o7', pg_temp.mk_order('cod', 'new', 'pending', current_setting('t.t0')::timestamptz, 'order_seller_start'), true);
select is(pg_temp.run(current_setting('t.t0')::timestamptz + interval '72 hours' - interval '1 second'),
  '{"processed":1,"reminders":1,"cancelled":0,"errors":0}'::jsonb, 'B28. one second before 72 h the order is only reminded');
select is((select status from public.marketplace_orders where id = current_setting('t.o7')::uuid), 'new', 'B29. and still new');
select set_config('t.o8', pg_temp.mk_order('cod', 'new', 'pending', current_setting('t.t0')::timestamptz, 'order_seller_start'), true);
select is((pg_temp.run(current_setting('t.t0')::timestamptz + interval '72 hours', 1) ->> 'cancelled')::int, 1, 'B30. at exactly 72 h with a limit of 1 only one of the two due orders is processed');
select is((pg_temp.run(current_setting('t.t0')::timestamptz + interval '72 hours', 1) ->> 'cancelled')::int, 1, 'B31. the next run takes the other one');
select is((select count(*)::int from public.marketplace_orders where id in (current_setting('t.o7')::uuid, current_setting('t.o8')::uuid) and status = 'cancelled'), 2,
  'B32. both are cancelled');

-- a timer whose order is gone is closed, not retried forever
insert into public.marketplace_timers (subject_type, subject_id, kind, started_at, expires_at, remind_every, next_remind_at)
values ('order', gen_random_uuid(), 'order_seller_start', current_setting('t.t0')::timestamptz, current_setting('t.t0')::timestamptz + interval '72 hours',
        interval '6 hours', current_setting('t.t0')::timestamptz + interval '6 hours');
select is(pg_temp.run(current_setting('t.t0')::timestamptz + interval '100 hours'), '{"processed":1,"reminders":0,"cancelled":0,"errors":0}'::jsonb,
  'B33. a timer of a missing order is closed');

-- return timers belong to PR 15: the runner leaves them alone (hook is a no-op by default)
insert into public.marketplace_timers (subject_type, subject_id, kind, started_at, expires_at, remind_offsets, next_remind_at)
values ('return', gen_random_uuid(), 'return_seller_response', current_setting('t.t0')::timestamptz, current_setting('t.t0')::timestamptz + interval '72 hours',
        array[interval '24 hours'], current_setting('t.t0')::timestamptz + interval '24 hours');
select is(pg_temp.run(current_setting('t.t0')::timestamptz + interval '200 hours'), '{"processed":0,"reminders":0,"cancelled":0,"errors":0}'::jsonb,
  'B34. a return timer is passed to the PR 15 hook and left active by the default no-op');
select is((select state from public.marketplace_timers where kind = 'return_seller_response' limit 1), 'active', 'B35. the return timer is untouched');

-- ===========================================================================
-- C. Buyer receipt timer: reminder at 24 h, cancel at 48 h
-- ===========================================================================
select set_config('t.c1', pg_temp.mk_order('instapay_full', 'preparing', 'receipt_disputed', current_setting('t.t0')::timestamptz, 'order_receipt_resubmit'), true);
select is(pg_temp.run(current_setting('t.t0')::timestamptz + interval '23 hours'), '{"processed":0,"reminders":0,"cancelled":0,"errors":0}'::jsonb, 'C1. nothing at 23 h');
select is(pg_temp.run(current_setting('t.t0')::timestamptz + interval '24 hours 5 minutes'), '{"processed":1,"reminders":1,"cancelled":0,"errors":0}'::jsonb,
  'C2. the buyer is reminded at 24 h');
select is((select n.recipient_user_id::text from public.notifications n where n.subject_id = current_setting('t.c1')::uuid
            and n.event_type = 'marketplace.order.reminder_receipt_resubmit'), current_setting('t.buyer'), 'C3. the reminder goes to the buyer');
select is((select next_remind_at is null and reminders_sent = 1 from public.marketplace_timers where subject_id = current_setting('t.c1')::uuid), true,
  'C4. there is no second reminder');
select is(pg_temp.run(current_setting('t.t0')::timestamptz + interval '30 hours'), '{"processed":0,"reminders":0,"cancelled":0,"errors":0}'::jsonb, 'C5. nothing between 24 h and 48 h');
select is(pg_temp.run(current_setting('t.t0')::timestamptz + interval '48 hours 1 minute'), '{"processed":1,"reminders":0,"cancelled":1,"errors":0}'::jsonb,
  'C6. at 48 h the order is cancelled');
select is((select status || '|' || stock_state || '|' || payment_status from public.marketplace_orders where id = current_setting('t.c1')::uuid),
  'cancelled|released|not_collected', 'C7. cancelled, stock released, nothing refundable');
select is((select reason_code from public.marketplace_order_cancellations where order_id = current_setting('t.c1')::uuid), 'timeout_receipt_resubmit', 'C8. recorded as a receipt timeout');
select is(pg_temp.notes(current_setting('t.c1'), 'marketplace.order.cancelled_timeout_receipt'), 2, 'C9. buyer and showroom are both told');
select is(pg_temp.run(current_setting('t.t0')::timestamptz + interval '49 hours'), '{"processed":0,"reminders":0,"cancelled":0,"errors":0}'::jsonb, 'C10. replay is a no-op');

-- buyer re-uploads in time: the machine closes the timer, the runner does nothing
select set_config('t.c2', pg_temp.mk_order('instapay_full', 'preparing', 'receipt_disputed', current_setting('t.t0')::timestamptz, 'order_receipt_resubmit'), true);
select app.marketplace_order_apply(current_setting('t.c2')::uuid, 'resubmit_receipt', 'buyer', current_setting('t.buyer')::uuid, '{}'::jsonb);
select is(pg_temp.run(current_setting('t.t0')::timestamptz + interval '60 hours'), '{"processed":0,"reminders":0,"cancelled":0,"errors":0}'::jsonb,
  'C11. a buyer who re-uploaded in time is not cancelled');
select is((select status from public.marketplace_orders where id = current_setting('t.c2')::uuid), 'preparing', 'C12. the order continues');

-- ===========================================================================
-- D. Complaints. The admin gate first: the permission is not held by Administrator until granted
-- ===========================================================================
select set_config('t.c3', pg_temp.mk_order('instapay_full', 'preparing', 'receipt_disputed', current_setting('t.t0')::timestamptz, 'order_receipt_resubmit'), true);
select pg_temp.as_user(current_setting('t.admin'));
select throws_ok($q$select public.admin_marketplace_payment_complaints(null, 10, 0)$q$, '42501', 'mp:not_permitted', 'D1. Administrator without the permission is refused (queue)');
select throws_ok($q$select public.admin_marketplace_payment_complaint_get(gen_random_uuid())$q$, '42501', 'mp:not_permitted', 'D2. refused (detail)');
select throws_ok($q$select public.admin_marketplace_payment_complaint_take(gen_random_uuid())$q$, '42501', 'mp:not_permitted', 'D3. refused (take)');
select throws_ok($q$select public.admin_marketplace_payment_complaint_decide(gen_random_uuid(), 'dismissed', 'no reason')$q$, '42501', 'mp:not_permitted', 'D4. refused (decide)');
select pg_temp.as_user(current_setting('t.buyer'));
select throws_ok($q$select public.admin_marketplace_payment_complaints(null, 10, 0)$q$, '42501', 'mp:not_permitted', 'D5. a buyer is refused');
select pg_temp.as_anon();
select throws_ok($q$select public.admin_marketplace_payment_complaints(null, 10, 0)$q$, '42501', 'mp:auth_required', 'D6. anonymous is refused');

-- filing: refusals
select pg_temp.as_user(current_setting('t.buyer'));
select is(app.marketplace_order_actions(current_setting('t.c3')::uuid, 'buyer') @> array['file_complaint', 'resubmit_receipt'], true,
  'D7. the buyer of a disputed order is offered file_complaint');
select pg_temp.as_user(current_setting('t.seller'));
select is(app.marketplace_order_actions(current_setting('t.c3')::uuid, 'seller') @> array['file_complaint'], true, 'D8. the showroom is offered it too');
select pg_temp.as_user(current_setting('t.sellerb'));
select throws_ok(format($q$select public.marketplace_payment_complaint_file(%L, 'transfer_made', null)$q$, current_setting('t.c3')), '42501', 'mp:not_found',
  'D9. another showroom cannot file on this order');
select pg_temp.as_user(current_setting('t.sales'));
select throws_ok(format($q$select public.marketplace_payment_complaint_file(%L, 'transfer_made', null)$q$, current_setting('t.c3')), '42501', 'mp:not_found',
  'D10. a member without order rights cannot file');
select pg_temp.as_user(current_setting('t.buyer'));
select throws_ok(format($q$select public.marketplace_payment_complaint_file(%L, 'nonsense', null)$q$, current_setting('t.c3')), '22023', 'mp:invalid_payload', 'D11. unknown reason refused');
select throws_ok(format($q$select public.marketplace_payment_complaint_file(%L, 'other', null)$q$, current_setting('t.c3')), '22023', 'mp:reason_required', 'D12. reason other needs a note');
select throws_ok(format($q$select public.marketplace_payment_complaint_file(%L, 'transfer_made', 'x')$q$, current_setting('t.c3')), '22023', 'mp:invalid_payload', 'D13. a note under 3 characters is refused');
select throws_ok(format($q$select public.marketplace_payment_complaint_file(%L, 'transfer_made', null)$q$, current_setting('t.o3')), '23514', 'mp:complaint_not_allowed',
  'D14. an order whose receipt is not disputed cannot be complained about');
select pg_temp.as_anon();
select throws_ok(format($q$select public.marketplace_payment_complaint_file(%L, 'transfer_made', null)$q$, current_setting('t.c3')), '42501', 'mp:auth_required', 'D15. anonymous cannot file');

-- grant the permission to Administrator (what the owner does in the role editor) and file
insert into public.admin_role_permissions (role_id, permission_key)
select r.id, 'marketplace_payment_complaints.review' from public.admin_roles r where r.key = 'administrator' on conflict do nothing;
select pg_temp.as_user(current_setting('t.buyer'));
select set_config('t.k1', (public.marketplace_payment_complaint_file(current_setting('t.c3')::uuid, 'transfer_made', 'I paid at 10am') ->> 'complaint_id'), true);
select is((select state || '|' || filed_by_role || '|' || reason from public.marketplace_payment_complaints where id = current_setting('t.k1')::uuid),
  'open|buyer|transfer_made', 'D16. the buyer files a complaint');
select throws_ok(format($q$select public.marketplace_payment_complaint_file(%L, 'other', 'again please')$q$, current_setting('t.c3')), '23505', 'mp:complaint_exists',
  'D17. one open complaint per order');
select is(app.marketplace_order_extra_actions(current_setting('t.c3')::uuid, 'buyer'), '{}'::text[], 'D18. file_complaint disappears once filed');
select is(app.marketplace_order_complaint_id(current_setting('t.c3')::uuid), current_setting('t.k1')::uuid, 'D19. the order document hook returns the complaint id');
select is((app.marketplace_order_document_v2(current_setting('t.c3')::uuid, 'buyer') -> 'payment' -> 'dispute' ->> 'complaint_id')::uuid, current_setting('t.k1')::uuid,
  'D20. payment.dispute.complaint_id of the order document is filled');
select is(pg_temp.notes(current_setting('t.k1'), 'marketplace.order.payment_complaint_filed'), 1, 'D21. exactly the admin holding the permission is notified');
select is((select n.recipient_user_id::text from public.notifications n where n.subject_id = current_setting('t.k1')::uuid), current_setting('t.admin'), 'D22. and it is the Administrator who was granted it');
select is((select count(*)::int from public.marketplace_order_events where order_id = current_setting('t.c3')::uuid and action = 'complaint_filed'), 1, 'D23. the order timeline records the filing');
select is((select count(*)::int from public.marketplace_payment_complaint_events where complaint_id = current_setting('t.k1')::uuid and action = 'filed'), 1, 'D24. and so does the complaint');

-- a showroom manager files on another disputed order
select set_config('t.c4', pg_temp.mk_order('instapay_full', 'preparing', 'receipt_disputed', current_setting('t.t0')::timestamptz, 'order_receipt_resubmit'), true);
select pg_temp.as_user(current_setting('t.seller'));
select set_config('t.k2', (public.marketplace_payment_complaint_file(current_setting('t.c4')::uuid, 'receipt_unreadable', null) ->> 'complaint_id'), true);
select is((select filed_by_role from public.marketplace_payment_complaints where id = current_setting('t.k2')::uuid), 'seller', 'D25. a showroom order manager can file');

-- admin: queue, detail
select pg_temp.as_user(current_setting('t.admin'));
select is((public.admin_marketplace_payment_complaints(null, 10, 0) ->> 'total')::int, 2, 'D26. the queue lists both complaints');
select is((public.admin_marketplace_payment_complaints('open', 10, 0) -> 'counts' ->> 'open')::int, 2, 'D27. counts by state');
select is((public.admin_marketplace_payment_complaints('open', 1, 0) -> 'items' -> 0 ->> 'receipts_count')::int, 1, 'D28. an item carries the receipts count');
select throws_ok($q$select public.admin_marketplace_payment_complaints('weird', 10, 0)$q$, '22023', 'mp:invalid_status', 'D29. unknown state filter refused');
select is((public.admin_marketplace_payment_complaint_get(current_setting('t.k1')::uuid) -> 'order' ->> 'viewer'), 'admin', 'D30. the detail carries the order document for the admin');
select is((public.admin_marketplace_payment_complaint_get(current_setting('t.k1')::uuid) -> 'order' -> 'recipient' ->> 'phone'), null, 'D31. without the buyer phone');
select throws_ok($q$select public.admin_marketplace_payment_complaint_get('00000000-0000-4000-8000-0000000000aa')$q$, '42501', 'mp:not_found', 'D32. unknown complaint: not found');

-- receipts readable by the admin only for an order that has a complaint, and only with the permission
select set_config('t.key_c3', (select object_key from public.marketplace_payment_proofs where order_id = current_setting('t.c3')::uuid limit 1), true);
select set_config('t.key_c1', (select object_key from public.marketplace_payment_proofs where order_id = current_setting('t.c1')::uuid limit 1), true);
select is(app.marketplace_media_can_read(current_setting('t.key_c3')), true, 'D33. the admin can read the receipt of an order with a complaint');
select is(app.marketplace_media_can_read(current_setting('t.key_c1')), false, 'D34. but not the receipt of an order without one');
select pg_temp.as_user(current_setting('t.sellerb'));
select is(app.marketplace_media_can_read(current_setting('t.key_c3')), false, 'D35. another showroom cannot read it');
select pg_temp.as_user(current_setting('t.admin'));

-- take
select is((public.admin_marketplace_payment_complaint_take(current_setting('t.k1')::uuid) ->> 'state'), 'under_review', 'D36. take marks it under review');
select is((public.admin_marketplace_payment_complaint_take(current_setting('t.k1')::uuid) ->> 'state'), 'under_review', 'D37. taking again is a replay');
select is((select count(*)::int from public.marketplace_payment_complaint_events where complaint_id = current_setting('t.k1')::uuid and action = 'taken'), 1, 'D38. one taken event');

-- the clock is paused while the complaint is under review
select is(pg_temp.run(current_setting('t.t0')::timestamptz + interval '49 hours'), '{"processed":0,"reminders":0,"cancelled":0,"errors":0}'::jsonb,
  'D39. a complaint under review pauses the 48 h clock: neither order (open / under review) is cancelled');
select is((select count(*)::int from public.marketplace_orders where id in (current_setting('t.c3')::uuid, current_setting('t.c4')::uuid) and status = 'preparing'), 2,
  'D40. both orders are still preparing');
select is((select count(*)::int from public.marketplace_timers where subject_id in (current_setting('t.c3')::uuid, current_setting('t.c4')::uuid) and state = 'active'), 2,
  'D41. and their timers are still active');

-- decide: validation
select throws_ok(format($q$select public.admin_marketplace_payment_complaint_decide(%L, 'payment_valid', 'x')$q$, current_setting('t.k1')), '22023', 'mp:reason_required', 'D42. the note is required');
select throws_ok(format($q$select public.admin_marketplace_payment_complaint_decide(%L, 'refund', 'a proper note')$q$, current_setting('t.k1')), '22023', 'mp:invalid_payload', 'D43. unknown decision refused');

-- decide payment_not_received on c4 (not taken: open): order unchanged, the 48 h are NOT restarted, so the paused timer expires at the next run
select is((public.admin_marketplace_payment_complaint_decide(current_setting('t.k2')::uuid, 'payment_not_received', 'Seller account shows no credit') ->> 'state'),
  'resolved', 'D44. payment_not_received resolves the complaint');
select is((select status || '|' || payment_status from public.marketplace_orders where id = current_setting('t.c4')::uuid), 'preparing|receipt_disputed',
  'D45. the order itself does not change');
select is((select state from public.marketplace_timers where subject_id = current_setting('t.c4')::uuid), 'active', 'D46. the timer is untouched');
select is(pg_temp.run(current_setting('t.t0')::timestamptz + interval '49 hours'), '{"processed":1,"reminders":0,"cancelled":1,"errors":0}'::jsonb,
  'D47. after the decision the timer rules resume (the clock was not restarted): the past-deadline order is cancelled, the paused one still waits');
select is((select status from public.marketplace_orders where id = current_setting('t.c4')::uuid), 'cancelled', 'D48. c4 is cancelled');
select is(pg_temp.notes(current_setting('t.c4'), 'marketplace.order.payment_complaint_resolved'), 2, 'D49. buyer and showroom are told the complaint was decided');
select is((select n.content -> 'en' ->> 'body' like '%could not be confirmed%' from public.notifications n where n.subject_id = current_setting('t.c4')::uuid
            and n.event_type = 'marketplace.order.payment_complaint_resolved' limit 1), true, 'D50. the notification states the outcome, not the admin note');
select is((select count(*)::int from public.notifications n where n.event_type = 'marketplace.order.payment_complaint_resolved'
            and (n.content::text like '%Seller account shows no credit%')), 0, 'D51. the admin note never reaches the parties');
select is((public.admin_marketplace_payment_complaint_decide(current_setting('t.k2')::uuid, 'payment_not_received', 'another note') ->> 'state'), 'resolved',
  'D52. repeating the same decision is a replay');
select throws_ok(format($q$select public.admin_marketplace_payment_complaint_decide(%L, 'dismissed', 'changed my mind')$q$, current_setting('t.k2')), '23514', 'mp:invalid_transition',
  'D53. a decided complaint cannot be decided differently');
select is(pg_temp.notes(current_setting('t.c4'), 'marketplace.order.payment_complaint_resolved'), 2, 'D54. the replay did not notify again');

-- decide payment_valid on c3 (taken by this admin): the machine accepts the receipt
select is((public.admin_marketplace_payment_complaint_decide(current_setting('t.k1')::uuid, 'payment_valid', 'Bank statement confirms the credit') ->> 'decision'),
  'payment_valid', 'D55. payment_valid is recorded');
select is((select payment_status || '|' || status from public.marketplace_orders where id = current_setting('t.c3')::uuid), 'collected|preparing',
  'D56. the order payment counts as received and the seller carries on');
select is((select state || '|' || closed_by_action from public.marketplace_timers where subject_id = current_setting('t.c3')::uuid), 'done|accept_receipt',
  'D57. the dispute timer is closed by the machine');
select is((select actor_role from public.marketplace_order_events where order_id = current_setting('t.c3')::uuid and action = 'receipt_accepted'), 'admin',
  'D58. the acceptance is recorded with actor role admin');
select is((select status from public.marketplace_payment_proofs where order_id = current_setting('t.c3')::uuid), 'accepted', 'D59. the receipt is marked accepted');
select is(pg_temp.run(current_setting('t.t0')::timestamptz + interval '200 hours'), '{"processed":0,"reminders":0,"cancelled":0,"errors":0}'::jsonb,
  'D60. nothing left to expire');
select is((select count(*)::int from public.marketplace_order_events where order_id = current_setting('t.c3')::uuid and action = 'complaint_resolved'), 1, 'D61. the order timeline records the decision');

-- dismissed, and no re-filing loop; a disputed order whose complaint was dismissed cannot be re-filed
select set_config('t.c5', pg_temp.mk_order('instapay_full', 'preparing', 'receipt_disputed', current_setting('t.t0')::timestamptz + interval '1000 hours', 'order_receipt_resubmit'), true);
select pg_temp.as_user(current_setting('t.buyer'));
select set_config('t.k3', (public.marketplace_payment_complaint_file(current_setting('t.c5')::uuid, 'amount_mismatch', null) ->> 'complaint_id'), true);
select pg_temp.as_user(current_setting('t.admin'));
select is((public.admin_marketplace_payment_complaint_decide(current_setting('t.k3')::uuid, 'dismissed', 'Receipt matches the order amount') ->> 'state'), 'dismissed',
  'D62. dismissed closes the complaint without action');
select is((select payment_status from public.marketplace_orders where id = current_setting('t.c5')::uuid), 'receipt_disputed', 'D63. the order is unchanged');
select pg_temp.as_user(current_setting('t.buyer'));
select throws_ok(format($q$select public.marketplace_payment_complaint_file(%L, 'other', 'file again')$q$, current_setting('t.c5')), '23505', 'mp:complaint_exists',
  'D64. a decided complaint cannot be re-filed for the same dispute');
select is(app.marketplace_order_extra_actions(current_setting('t.c5')::uuid, 'buyer'), '{}'::text[], 'D65. and file_complaint is no longer offered');

-- admin two: another admin cannot decide a complaint taken by the first
select set_config('t.c6', pg_temp.mk_order('instapay_full', 'preparing', 'receipt_disputed', current_setting('t.t0')::timestamptz + interval '1000 hours', 'order_receipt_resubmit'), true);
select pg_temp.as_user(current_setting('t.buyer'));
select set_config('t.k4', (public.marketplace_payment_complaint_file(current_setting('t.c6')::uuid, 'other', 'please review') ->> 'complaint_id'), true);
select pg_temp.as_user(current_setting('t.admin'));
select public.admin_marketplace_payment_complaint_take(current_setting('t.k4')::uuid);
reset role;
insert into public.admin_role_assignments (user_id, role_id, scope_type)
select current_setting('t.sales')::uuid, r.id, 'platform' from public.admin_roles r where r.key = 'administrator';
select pg_temp.as_user(current_setting('t.sales'));
select throws_ok(format($q$select public.admin_marketplace_payment_complaint_take(%L)$q$, current_setting('t.k4')), '23514', 'mp:invalid_transition', 'D66. a second admin cannot take a complaint already under review');
select throws_ok(format($q$select public.admin_marketplace_payment_complaint_decide(%L, 'dismissed', 'second admin tries')$q$, current_setting('t.k4')), '23514', 'mp:invalid_transition',
  'D67. nor decide it');

-- deadline evasion: after the 48 h are over a complaint cannot be filed to dodge the cancellation
select set_config('t.c7', pg_temp.mk_order('instapay_full', 'preparing', 'receipt_disputed', now() - interval '49 hours', 'order_receipt_resubmit'), true);
select pg_temp.as_user(current_setting('t.buyer'));
select is(app.marketplace_order_extra_actions(current_setting('t.c7')::uuid, 'buyer'), '{}'::text[], 'D68. file_complaint is not offered once the receipt deadline has passed');
select throws_ok(format($q$select public.marketplace_payment_complaint_file(%L, 'transfer_made', null)$q$, current_setting('t.c7')), '23514', 'mp:complaint_not_allowed',
  'D69. a complaint filed after the 48 h deadline is refused (no deadline evasion)');
select set_config('t.c8', pg_temp.mk_order('instapay_full', 'preparing', 'receipt_disputed', now() - interval '47 hours', 'order_receipt_resubmit'), true);
select is((public.marketplace_payment_complaint_file(current_setting('t.c8')::uuid, 'transfer_made', null) ->> 'state'), 'open',
  'D70. a complaint filed before the deadline is accepted (and pauses the clock)');

-- queue starvation: a paused timer must not take a batch slot from a runnable one
select pg_temp.as_anon();
delete from public.marketplace_timers where kind = 'return_seller_response';   -- the default PR 15 hook is a no-op: its timer would sit first in line
select pg_temp.run(current_setting('t.t0')::timestamptz + interval '3000 hours', 500);   -- clear everything runnable first
select set_config('t.c9', pg_temp.mk_order('instapay_full', 'preparing', 'receipt_disputed', current_setting('t.t0')::timestamptz + interval '2990 hours', 'order_receipt_resubmit'), true);
select pg_temp.as_user(current_setting('t.buyer'));
select public.marketplace_payment_complaint_file(current_setting('t.c9')::uuid, 'other', 'paused for review');
select pg_temp.as_anon();
select set_config('t.o9', pg_temp.mk_order('cod', 'new', 'pending', current_setting('t.t0')::timestamptz + interval '3000 hours', 'order_seller_start'), true);
select is(pg_temp.run(current_setting('t.t0')::timestamptz + interval '3080 hours', 1), '{"processed":1,"reminders":0,"cancelled":1,"errors":0}'::jsonb,
  'D71. with a batch of one, the paused (older) timer does not starve the runnable one');
select is((select status from public.marketplace_orders where id = current_setting('t.c9')::uuid), 'preparing', 'D72. the paused order is untouched');
select is((select status from public.marketplace_orders where id = current_setting('t.o9')::uuid), 'cancelled', 'D73. the runnable order was cancelled');

-- ===========================================================================
-- E. Isolation and append-only
-- ===========================================================================
select pg_temp.as_user(current_setting('t.buyer'));
select is(has_function_privilege('authenticated', 'public.marketplace_timers_run(integer, timestamptz)', 'execute'), false, 'E1. a signed-in user cannot run the timers');
reset role;
select throws_ok($q$update public.marketplace_payment_complaint_events set note = 'x'$q$, '23514', 'marketplace_payment_complaint_events is append-only', 'E2. complaint events are append-only (update)');
select throws_ok($q$delete from public.marketplace_payment_complaint_events$q$, '23514', 'marketplace_payment_complaint_events is append-only', 'E3. complaint events are append-only (delete)');
select throws_ok($q$insert into public.marketplace_payment_complaints (order_id, filed_by_role, reason) values (gen_random_uuid(), 'buyer', 'other')$q$, '23503', null,
  'E4. a complaint needs a real order');
select is((select count(*)::int from public.notifications n where n.event_type = 'marketplace.order.payment_complaint_filed'
            and n.recipient_user_id not in (current_setting('t.admin')::uuid, current_setting('t.sales')::uuid)), 0, 'E5. no notification of a filing reaches a user without the permission (both holders are admins granted it)');

-- F. "money not received" gives the buyer at least 24 h from the ruling, even when the 48 h ran out while the complaint paused the clock
select set_config('t.c9', pg_temp.mk_order('instapay_full', 'preparing', 'receipt_disputed', now() - interval '1 hour', 'order_receipt_resubmit'), true);
select pg_temp.as_user(current_setting('t.buyer'));
select set_config('t.k9', (public.marketplace_payment_complaint_file(current_setting('t.c9')::uuid, 'transfer_made', null) ->> 'complaint_id'), true);
update public.marketplace_timers set started_at = now() - interval '60 hours', expires_at = now() - interval '12 hours'
 where subject_id = current_setting('t.c9')::uuid and kind = 'order_receipt_resubmit';
select pg_temp.as_user(current_setting('t.admin'));
select is((public.admin_marketplace_payment_complaint_decide(current_setting('t.k9')::uuid, 'payment_not_received', 'No credit on the statement') ->> 'state'),
  'resolved', 'F1. the late complaint is decided');
select is((select expires_at = now() + interval '24 hours' from public.marketplace_timers where subject_id = current_setting('t.c9')::uuid and state = 'active'), true,
  'F2. the expired deadline is moved to 24 hours after the ruling');
select lives_ok($q$select pg_temp.run(now() + interval '23 hours')$q$, 'F3. the runner runs inside the 24 hours');
select is((select status from public.marketplace_orders where id = current_setting('t.c9')::uuid), 'preparing', 'F4. the order survives inside the 24 hours');
select lives_ok($q$select pg_temp.run(now() + interval '25 hours')$q$, 'F5. the runner runs after the 24 hours');
select is((select status from public.marketplace_orders where id = current_setting('t.c9')::uuid), 'cancelled', 'F6. without a new receipt the order is cancelled');

-- G. an uploaded receipt the showroom never answers: cancelled after 72 h, owed back, admins told, either side may complain
reset role;
select set_config('t.g1', pg_temp.mk_order('instapay_full', 'new', 'receipt_submitted', now() - interval '73 hours', 'order_seller_start'), true);
select set_config('t.g2', pg_temp.mk_order('instapay_full', 'new', 'receipt_submitted', now() - interval '73 hours', 'order_seller_start'), true);
select lives_ok($q$select pg_temp.run(now())$q$, 'G1. the runner runs');
select is((select string_agg(status || '|' || payment_status, ',') from public.marketplace_orders
            where id in (current_setting('t.g1')::uuid, current_setting('t.g2')::uuid)), 'cancelled|refund_due,cancelled|refund_due',
  'G2. both are cancelled and the money is owed back');
select is(pg_temp.notes(current_setting('t.g1'), 'marketplace.order.refund_check') >= 1, true, 'G3. the authorised admins are told');
select is(app.marketplace_order_extra_actions(current_setting('t.g1')::uuid, 'buyer'), array['file_complaint'], 'G4. the buyer may file a complaint');
select pg_temp.as_user(current_setting('t.buyer'));
select set_config('t.kg1', (public.marketplace_payment_complaint_file(current_setting('t.g1')::uuid, 'transfer_made', null) ->> 'complaint_id'), true);
select set_config('t.kg2', (public.marketplace_payment_complaint_file(current_setting('t.g2')::uuid, 'transfer_made', null) ->> 'complaint_id'), true);
select throws_ok(format($q$select public.marketplace_payment_complaint_file(%L, 'transfer_made', null)$q$, current_setting('t.g1')), '23505', 'mp:complaint_exists',
  'G5. one complaint for such an order');
select pg_temp.as_user(current_setting('t.admin'));
select is((public.admin_marketplace_payment_complaint_decide(current_setting('t.kg1')::uuid, 'payment_valid', 'Statement shows the credit') ->> 'state'), 'resolved', 'G6. payment_valid is decided');
select is((public.admin_marketplace_payment_complaint_decide(current_setting('t.kg2')::uuid, 'payment_not_received', 'No credit on the statement') ->> 'state'), 'resolved', 'G7. payment_not_received is decided');
reset role;
select is((select payment_status from public.marketplace_orders where id = current_setting('t.g1')::uuid), 'refund_due', 'G8. a confirmed transfer stays owed back');
select is((select payment_status from public.marketplace_orders where id = current_setting('t.g2')::uuid), 'not_collected', 'G9. money that never arrived ends the claim');
select is(app.marketplace_order_extra_actions(current_setting('t.g1')::uuid, 'buyer'), '{}'::text[], 'G10. no second complaint is offered');

-- G (continued): the same rule when the buyer cancels himself
select set_config('t.g3', pg_temp.mk_order('instapay_full', 'new', 'receipt_submitted', now() - interval '1 hour', 'order_seller_start'), true);
select pg_temp.as_user(current_setting('t.buyer'));
select is(public.marketplace_buyer_order_cancel_v2(current_setting('t.g3')::uuid, null, null) ->> 'status', 'cancelled', 'G11. the buyer cancels after uploading a receipt');
select is((select payment_status from public.marketplace_orders where id = current_setting('t.g3')::uuid), 'refund_due', 'G12. the unchecked transfer is owed back');
select is(pg_temp.notes(current_setting('t.g3'), 'marketplace.order.refund_check') >= 1, true, 'G13. the authorised admins are told');
select is(app.marketplace_order_extra_actions(current_setting('t.g3')::uuid, 'seller'), array['file_complaint'], 'G14. the showroom may file a complaint');

-- G (continued): rejecting the receipt and then cancelling does not keep the money
reset role;
select set_config('t.g4', pg_temp.mk_order('instapay_full', 'preparing', 'receipt_disputed', now() - interval '1 hour', 'order_receipt_resubmit'), true);
select pg_temp.as_user(current_setting('t.seller'));
select is(public.marketplace_seller_order_action(current_setting('t.g4')::uuid, 'cancel', '{"message":"transfer not received"}'::jsonb) ->> 'status', 'cancelled',
  'G15. the showroom cancels after rejecting the receipt');
select is((select payment_status from public.marketplace_orders where id = current_setting('t.g4')::uuid), 'refund_due', 'G16. the amount is owed back');
select is(pg_temp.notes(current_setting('t.g4'), 'marketplace.order.refund_check') >= 1, true, 'G17. the authorised admins are told');
select is(app.marketplace_order_extra_actions(current_setting('t.g4')::uuid, 'buyer'), array['file_complaint'], 'G18. the buyer may file a complaint');

select * from finish();
rollback;
