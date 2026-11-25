-- pgTAP: Marketplace PR 15 - returns and exchanges
-- (20261125130001_marketplace_returns_tables.sql, 150002 rpcs, 150003 order hooks)
-- Contract: docs/product/marketplace-order-model-contract-20261124.md, section 4.5
--
--   A. SHAPE        RPC-only tables, function privileges, the permission, seeded reasons, hooks installed.
--   B. WINDOWS      14 / 30 calendar days in Africa/Cairo (winter and summer time), 48 h transit damage, the floor of the settings.
--   C. ELIGIBILITY  delivered orders only, returnable quantities, reasons, isolation.
--   D. CREATE       validation, the windows, the non-returnable flag, evidence, idempotency, one active return per order.
--   E. FLOW         cancel, reject, approve, partial proposal, ship, receive (stock only for sellable units), refund recorded
--                   by the showroom and confirmed by the buyer, the order payment mirror.
--   F. EXCHANGE     same-product exchange takes stock for the replacement.
--   G. ESCALATION   reminders at 24 / 48 h, silence at 72 h goes to the admin queue and is NEVER approved, a complaint escalates,
--                   idempotent ticks, the refund deadline.
--   H. ADMIN        the queue needs marketplace_returns.review; remind and decide with actor_role admin; evidence access.
--   I. ISOLATION    other buyer, other showroom, a member without order rights, anon.
--
-- Fixtures (seed-pilot): showroom A 9c000000-...001 (owner 70000001 with order.manage; 70000002 sales-only member),
-- showroom B 91000005-...005 (owner 71000005), buyer 70000009, second buyer 70000003, staff 11111111 (made Super Admin HERE),
-- staff 55555555 (Administrator without the returns permission).
create extension if not exists pgtap;

begin;
select no_plan();

update auth.users set email_confirmed_at = now()
  where id in ('70000001-0000-4000-8000-000000000001', '70000002-0000-4000-8000-000000000002',
               '71000005-0000-4000-8000-000000000005', '70000009-0000-4000-8000-000000000009',
               '70000003-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111',
               '55555555-5555-4555-8555-555555555555');
select set_config('t.a', '9c000000-cccc-4ccc-8ccc-000000000001', true);
select set_config('t.b', '91000005-1111-4111-8111-000000000005', true);
select set_config('t.seller', '70000001-0000-4000-8000-000000000001', true);
select set_config('t.sales', '70000002-0000-4000-8000-000000000002', true);
select set_config('t.sellerb', '71000005-0000-4000-8000-000000000005', true);
select set_config('t.buyer', '70000009-0000-4000-8000-000000000009', true);
select set_config('t.buyer2', '70000003-0000-4000-8000-000000000003', true);
select set_config('t.super', '11111111-1111-4111-8111-111111111111', true);
select set_config('t.staff', '55555555-5555-4555-8555-555555555555', true);
select set_config('t.cairo_area', (select min(key) from app.place_cities where governorate_key = 'cairo'), true);

insert into public.admin_role_assignments (user_id, role_id, scope_type, assigned_by)
select '11111111-1111-4111-8111-111111111111', r.id, 'platform', '55555555-5555-4555-8555-555555555555'
from public.admin_roles r where r.key = 'super_admin';

select set_config('app.marketplace_seller_write', 'on', true);
insert into public.marketplace_seller_accounts (organization_id, status, approved_at)
values (current_setting('t.a')::uuid, 'approved', now()), (current_setting('t.b')::uuid, 'approved', now())
on conflict (organization_id) do update set status = 'approved', approved_at = now();
select set_config('app.marketplace_seller_write', 'off', true);

-- PR 14 owns the admin fan-out; when it is not installed yet, a recording stand-in (rolled back with this test)
create table pg_temp.admin_notes (key text, subject uuid);
do $$
begin
  if to_regprocedure('app.marketplace_notify_admins(text, text, text, uuid, text, jsonb)') is null then
    execute $f$
      create function app.marketplace_notify_admins(p_permission text, p_template_key text, p_subject_type text, p_subject_id uuid,
        p_deep_link text, p_vars jsonb) returns void language plpgsql security definer set search_path = '' as $b$
      begin
        insert into public.notifications (recipient_user_id, event_type, subject_type, subject_id, deep_link, title_key)
        select u.user_id, p_template_key, p_subject_type, p_subject_id, p_deep_link, 'notifications.template.' || p_template_key
          from public.admin_role_assignments u join public.admin_role_permissions rp on rp.role_id = u.role_id
         where rp.permission_key = p_permission;
      end $b$;
    $f$;
  end if;
end $$;

create function pg_temp.as_user(p_uid text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;
create function pg_temp.stock(p_sku text) returns text language sql as $$
  select l.on_hand || '/' || l.reserved from public.marketplace_inventory_levels l
  join public.marketplace_product_variants v on v.id = l.variant_id
  where v.sku = p_sku and v.seller_organization_id = current_setting('t.a')::uuid;
$$;
create function pg_temp.prep(p_lines text, p_fulfil text, p_addr text, p_speed text, p_pay text, p_session text default null)
returns jsonb language sql as $$
  select public.marketplace_checkout_prepare(p_lines::jsonb, p_fulfil, nullif(p_addr, '')::uuid, p_speed, p_pay, nullif(p_session, '')::uuid);
$$;
create function pg_temp.attest(p_key text, p_owner text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform public.media_storage_reserve('marketplace', p_key, 'r2', p_owner::uuid);
  perform public.media_storage_attest('marketplace', p_key, p_owner::uuid, 'r2', 900, 'image/png', repeat('e', 64));
end;
$$;
-- a confirmed, attested evidence photo of the buyer for an order
create function pg_temp.evidence(p_order text) returns uuid language plpgsql as $$
declare v jsonb; k text;
begin
  perform pg_temp.as_user(current_setting('t.buyer'));
  v := public.marketplace_buyer_return_request_upload(p_order::uuid, 'image/png');
  k := v ->> 'object_key';
  perform pg_temp.attest(k, current_setting('t.buyer'));
  perform pg_temp.as_user(current_setting('t.buyer'));
  perform public.marketplace_buyer_return_evidence_confirm((v ->> 'evidence_id')::uuid);
  return (v ->> 'evidence_id')::uuid;
end;
$$;
-- place a COD order of the buyer (status new)
create function pg_temp.place(p_lines text, p_key text) returns uuid language plpgsql as $$
declare v jsonb; c jsonb;
begin
  perform pg_temp.as_user(current_setting('t.buyer'));
  v := pg_temp.prep(p_lines, 'delivery', current_setting('t.addr'), 'standard', 'cod');
  c := public.marketplace_checkout_confirm((v ->> 'session_id')::uuid, v ->> 'quote_hash', p_key, null);
  return (c -> 'orders' -> 0 ->> 'id')::uuid;
end;
$$;
-- ... and walk it to delivered through the real order machine
create function pg_temp.deliver(p_lines text, p_key text) returns uuid language plpgsql as $$
declare o uuid := pg_temp.place(p_lines, p_key);
begin
  perform pg_temp.as_user(current_setting('t.seller'));
  perform public.marketplace_seller_order_action(o, 'start_preparing', '{}'::jsonb);
  perform public.marketplace_seller_order_action(o, 'mark_ready', '{}'::jsonb);
  perform public.marketplace_seller_order_action(o, 'mark_shipped', '{}'::jsonb);
  perform public.marketplace_seller_order_action(o, 'mark_delivered', '{}'::jsonb);
  return o;
end;
$$;
create function pg_temp.islike(have text, pat text, descr text) returns text language sql as $$ select ok(have like pat, descr) $$;
create function pg_temp.reason(p_label text) returns uuid language sql as $$
  select id from public.marketplace_seller_message_presets where action = 'return_reason' and label_en = p_label;
$$;
create function pg_temp.reject_reason(p_label text) returns uuid language sql as $$
  select id from public.marketplace_seller_message_presets where action = 'return_reject' and label_en = p_label;
$$;
create function pg_temp.item(p_order text, p_sku text) returns text language sql as $$
  select id::text from public.marketplace_order_items where order_id = p_order::uuid and sku = p_sku;
$$;

-- ---------------------------------------------------------------------------
-- fixture: three published products of showroom A with stock; delivery, payments
-- ---------------------------------------------------------------------------
reset role;
select pg_temp.as_user(current_setting('t.seller'));
select set_config('t.p1', (public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'), 'product_type_key', 'wallpaper', 'name_ar', 'ورق مرتجع', 'name_en', 'Return paper',
  'variants', jsonb_build_array(jsonb_build_object('sku', 'RT-1', 'selling_unit', 'roll', 'price_egp', 100)))) ->> 'id'), true);
select set_config('t.p2', (public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'), 'product_type_key', 'wallpaper', 'name_ar', 'ورق ثاني', 'name_en', 'Second return paper',
  'variants', jsonb_build_array(jsonb_build_object('sku', 'RT-2', 'selling_unit', 'roll', 'price_egp', 250)))) ->> 'id'), true);
select set_config('t.p3', (public.marketplace_seller_product_save(jsonb_build_object(
  'organization_id', current_setting('t.a'), 'product_type_key', 'wallpaper', 'name_ar', 'ستارة', 'name_en', 'Made to measure curtain',
  'variants', jsonb_build_array(jsonb_build_object('sku', 'RT-3', 'selling_unit', 'roll', 'price_egp', 80)))) ->> 'id'), true);
select set_config('t.loc', public.marketplace_seller_default_location(current_setting('t.a')::uuid)::text, true);
select public.marketplace_seller_stock_adjust((select id from public.marketplace_product_variants where sku = 'RT-1'), current_setting('t.loc')::uuid, 20, 'rt-stock-0001');
select public.marketplace_seller_stock_adjust((select id from public.marketplace_product_variants where sku = 'RT-2'), current_setting('t.loc')::uuid, 2, 'rt-stock-0002');
select public.marketplace_seller_stock_adjust((select id from public.marketplace_product_variants where sku = 'RT-3'), current_setting('t.loc')::uuid, 5, 'rt-stock-0003');
select public.marketplace_seller_delivery_areas_save(current_setting('t.a')::uuid, jsonb_build_array(jsonb_build_object('governorate_key', 'cairo')));
select public.marketplace_seller_delivery_terms_save(current_setting('t.a')::uuid,
  jsonb_build_object('preparation_days', 2, 'pickup_instructions', 'Ask at reception'),
  jsonb_build_array(jsonb_build_object('governorate_key', 'cairo', 'fee_egp', 60, 'duration_min_days', 1, 'duration_max_days', 3,
                                       'next_day_available', true, 'next_day_fee_egp', 40)));
select public.marketplace_seller_payment_settings_save(current_setting('t.a')::uuid,
  '{"cod_enabled":true,"instapay_enabled":true,"instapay_full_enabled":true,"instapay_address":"decore@instapay","instapay_account_name":"Decore Store","instapay_deposit_percent":30}'::jsonb);
reset role;
set local session_replication_role = replica;
update public.marketplace_products set status = 'published', published_at = now()
 where id in (current_setting('t.p1')::uuid, current_setting('t.p2')::uuid, current_setting('t.p3')::uuid);
set local session_replication_role = origin;
select set_config('t.s1', (select slug from public.marketplace_products where id = current_setting('t.p1')::uuid), true);
select set_config('t.s2', (select slug from public.marketplace_products where id = current_setting('t.p2')::uuid), true);
select set_config('t.s3', (select slug from public.marketplace_products where id = current_setting('t.p3')::uuid), true);

update public.profiles set phone_e164 = '+201999000009', phone_country_iso2 = 'EG', phone_national = '01999000009', phone_verified_at = now()
  where user_id = current_setting('t.buyer')::uuid;
delete from public.marketplace_buyer_addresses where user_id = current_setting('t.buyer')::uuid;
select pg_temp.as_user(current_setting('t.buyer'));
select public.marketplace_buyer_address_save(jsonb_build_object('id', 'a0000000-0000-4000-8000-0000000000d1', 'kind', 'home',
  'governorate_key', 'cairo', 'area_key', current_setting('t.cairo_area'), 'street', '12 Example Street', 'building', '4', 'floor', '3',
  'apartment', '7', 'landmark', 'next to the pharmacy', 'recipient_first_name', 'Test', 'recipient_last_name', 'Buyer',
  'recipient_phone_e164', '+201999000009'));
reset role;
select set_config('t.addr', 'a0000000-0000-4000-8000-0000000000d1', true);

-- the showroom flags the curtain as made to order (the setter is PR 15's)
select pg_temp.as_user(current_setting('t.seller'));
select is(public.marketplace_seller_product_returnability_set(current_setting('t.a')::uuid, current_setting('t.p3')::uuid, true), true,
  'A0. the showroom flags a product non-returnable (made to order)');
reset role;

-- ===========================================================================
-- A. Shape
-- ===========================================================================
select is((select bool_and(relrowsecurity) from pg_class where oid in ('public.marketplace_seller_return_settings'::regclass,
  'public.marketplace_return_reason_rules'::regclass, 'public.marketplace_return_requests'::regclass, 'public.marketplace_return_items'::regclass,
  'public.marketplace_return_events'::regclass, 'public.marketplace_return_evidence'::regclass, 'public.marketplace_order_refunds'::regclass)), true,
  'A1. the seven new tables have RLS on');
select is((select count(*)::int from information_schema.role_table_grants
           where table_name in ('marketplace_seller_return_settings', 'marketplace_return_reason_rules', 'marketplace_return_requests',
             'marketplace_return_items', 'marketplace_return_events', 'marketplace_return_evidence', 'marketplace_order_refunds')
             and grantee in ('anon', 'authenticated', 'service_role', 'public')), 0, 'A2. no client grant on any returns table (RPC-only)');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and (p.proname like 'marketplace\_buyer\_return%' or p.proname like 'marketplace\_seller\_return%'
             or p.proname like 'admin\_marketplace\_return%' or p.proname in ('marketplace_buyer_refund_confirm', 'marketplace_buyer_returns',
             'marketplace_seller_returns_page', 'marketplace_seller_refund_record', 'marketplace_seller_exchange_fulfil',
             'marketplace_seller_product_returnability_set', 'marketplace_return_complaint_file', 'admin_marketplace_returns'))
             and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')
             and not has_function_privilege('public', p.oid, 'execute')), 23, 'A3. the 23 public returns functions are authenticated-only');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'app' and p.proname like 'marketplace\_return\_%' and has_function_privilege('authenticated', p.oid, 'execute')), 0,
  'A4. no internal returns function is callable by clients');
select is((select count(*)::int from public.admin_permissions where key = 'marketplace_returns.review' and sort_order = 115), 1, 'A5. the permission exists (sort 115)');
select is((select count(*)::int from public.admin_role_permissions rp join public.admin_roles r on r.id = rp.role_id
            where rp.permission_key = 'marketplace_returns.review' and r.key = 'super_admin' and rp.is_locked), 1, 'A6. held by the Super Admin, locked');
select is((select count(*)::int from public.admin_role_permissions where permission_key = 'marketplace_returns.review'), 1, 'A7. nobody else holds it by default (grantable)');
select is((select count(*)::int from public.marketplace_return_reason_rules), 6, 'A8. six return reasons are seeded with their rules');
select is((select count(*)::int from public.marketplace_seller_message_presets where action = 'return_reject'), 4, 'A9. four rejection reasons are seeded');
select is((select count(*)::int from public.notification_templates where key like 'marketplace.return.%'), 10, 'A10. ten return templates (both languages)');
select is((select count(*)::int from public.marketplace_return_reason_rules where claim_type = 'defect' and requires_evidence and shipping_payer = 'seller'), 4,
  'A11. defect, wrong item, not as described and transit damage need evidence and are shipped by the showroom');
select is((select shipping_payer from public.marketplace_return_reason_rules ru join public.marketplace_seller_message_presets p on p.id = ru.preset_id
            where p.label_en = 'I changed my mind'), 'buyer', 'A12. a change of mind is shipped by the buyer');
select ok(to_regprocedure('app.marketplace_return_timer_tick(public.marketplace_timers, timestamptz)') is not null, 'A13. the timer hook exists');

-- ===========================================================================
-- B. Windows (pure functions)
-- ===========================================================================
select is(app.marketplace_return_window_end('2026-11-01T08:00:00Z', 14), '2026-11-15 21:59:59+00'::timestamptz, 'B1. 14 days from a winter delivery end at 23:59:59 Cairo');
select is(app.marketplace_return_window_end('2026-11-01T08:00:00Z', 30), '2026-12-01 21:59:59+00'::timestamptz, 'B2. 30 days (defect)');
select is(app.marketplace_return_window_end('2026-07-01T10:00:00Z', 14), '2026-07-15 20:59:59+00'::timestamptz, 'B3. summer time (UTC+3)');
select is(app.marketplace_return_window_end('2026-11-01T22:30:00Z', 14), '2026-11-16 21:59:59+00'::timestamptz, 'B4. a late evening delivery counts the Cairo day');
select is(app.marketplace_return_window_end('2026-10-20T10:00:00Z', 30), '2026-11-19 21:59:59+00'::timestamptz, 'B5. across the end of summer time');

select pg_temp.as_user(current_setting('t.seller'));
select is(public.marketplace_seller_return_settings_get(current_setting('t.a')::uuid) ->> 'general_days', '14', 'B6. the default window is 14 days');
select throws_like(format($$ select public.marketplace_seller_return_settings_save(%L::uuid, '{"general_days":"10","defect_days":"30"}') $$, current_setting('t.a')),
  'mp:invalid_payload%', 'B7. a showroom cannot offer fewer than 14 days');
select throws_like(format($$ select public.marketplace_seller_return_settings_save(%L::uuid, '{"general_days":"14","defect_days":"29"}') $$, current_setting('t.a')),
  'mp:invalid_payload%', 'B8. nor fewer than 30 days for a defect');
select throws_like(format($$ select public.marketplace_seller_return_settings_save(%L::uuid, '{"general_days":"x","defect_days":"30"}') $$, current_setting('t.a')),
  'mp:invalid_payload%', 'B9. a malformed value is refused');
select pg_temp.as_user(current_setting('t.sales'));
select throws_like(format($$ select public.marketplace_seller_return_settings_save(%L::uuid, '{"general_days":"21","defect_days":"45"}') $$, current_setting('t.a')),
  'mp:not_permitted%', 'B10. a member without order rights cannot change the policy');
select pg_temp.as_user(current_setting('t.sellerb'));
select throws_like(format($$ select public.marketplace_seller_return_settings_get(%L::uuid) $$, current_setting('t.a')),
  'mp:not_permitted%', 'B11. another showroom cannot read it');
select pg_temp.as_user(current_setting('t.seller'));
select is(public.marketplace_seller_return_settings_save(current_setting('t.a')::uuid, '{"general_days":"21","defect_days":"45"}') ->> 'general_days', '21', 'B12. a showroom may offer more');
select is(public.marketplace_seller_return_settings_save(current_setting('t.a')::uuid, '{"general_days":"14","defect_days":"30"}') ->> 'defect_days', '30', 'B13. and go back to the floor');
reset role;

-- ===========================================================================
-- C. Eligibility
-- ===========================================================================
select set_config('t.o1', pg_temp.deliver(jsonb_build_array(jsonb_build_object('slug', current_setting('t.s1'), 'sku', 'RT-1', 'qty', 3),
  jsonb_build_object('slug', current_setting('t.s2'), 'sku', 'RT-2', 'qty', 1))::text, 'rt-key-0001')::text, true);
select set_config('t.o2', pg_temp.deliver(jsonb_build_array(jsonb_build_object('slug', current_setting('t.s3'), 'sku', 'RT-3', 'qty', 2))::text, 'rt-key-0002')::text, true);
select set_config('t.o3', pg_temp.deliver(jsonb_build_array(jsonb_build_object('slug', current_setting('t.s1'), 'sku', 'RT-1', 'qty', 1))::text, 'rt-key-0003')::text, true);
select set_config('t.o4', pg_temp.deliver(jsonb_build_array(jsonb_build_object('slug', current_setting('t.s1'), 'sku', 'RT-1', 'qty', 1))::text, 'rt-key-0004')::text, true);
-- one order that is NOT delivered (still new)
select set_config('t.onew', pg_temp.place(jsonb_build_array(jsonb_build_object('slug', current_setting('t.s1'), 'sku', 'RT-1', 'qty', 1))::text, 'rt-key-0005')::text, true);

select pg_temp.as_user(current_setting('t.buyer'));
select is((public.marketplace_buyer_return_eligibility(current_setting('t.o1')::uuid) ->> 'eligible')::boolean, true, 'C1. a delivered order is eligible');
select is(jsonb_array_length(public.marketplace_buyer_return_eligibility(current_setting('t.o1')::uuid) -> 'lines'), 2, 'C2. both lines are listed');
select is((public.marketplace_buyer_return_eligibility(current_setting('t.o1')::uuid) -> 'lines' -> 0 ->> 'returnable_quantity')::int, 3, 'C3. the whole quantity is returnable');
select is(jsonb_array_length(public.marketplace_buyer_return_eligibility(current_setting('t.o1')::uuid) -> 'reasons'), 6, 'C4. six reasons are offered');
select is((public.marketplace_buyer_return_eligibility(current_setting('t.o1')::uuid) -> 'window' ->> 'general_ends_at')::timestamptz,
  app.marketplace_return_window_end((select delivered_at from public.marketplace_orders where id = current_setting('t.o1')::uuid), 14), 'C5. the general deadline');
select is((public.marketplace_buyer_return_eligibility(current_setting('t.onew')::uuid) ->> 'eligible')::boolean, false, 'C6. an order that is not delivered is not eligible');
select is(public.marketplace_buyer_return_eligibility(current_setting('t.onew')::uuid) -> 'window', 'null'::jsonb, 'C7. and has no window yet');
select is((app.marketplace_order_document_v2(current_setting('t.o1')::uuid, 'buyer') -> 'return_window' ->> 'returnable')::boolean, true, 'C9. the document fills return_window');
select is(app.marketplace_order_document_v2(current_setting('t.o1')::uuid, 'buyer') -> 'returns', '[]'::jsonb, 'C10. and returns (empty)');
select is(app.marketplace_order_actions(current_setting('t.o1')::uuid, 'buyer') @> array['request_return', 'request_exchange'], true, 'C11. the actions carry request_return / request_exchange');
select is(app.marketplace_order_actions(current_setting('t.onew')::uuid, 'buyer') @> array['request_return'], false, 'C12. not before delivery');
select is(app.marketplace_order_actions(current_setting('t.o1')::uuid, 'seller') @> array['request_return'], false, 'C13. never for the seller');
select pg_temp.as_user(current_setting('t.buyer2'));
select throws_like(format($$ select public.marketplace_buyer_return_eligibility(%L::uuid) $$, current_setting('t.o1')), 'mp:not_found%', 'C14. another buyer cannot ask');
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_like(format($$ select public.marketplace_buyer_return_eligibility(%L::uuid) $$, current_setting('t.o1')), 'mp:auth_required%', 'C15. anon is refused');
reset role;

-- ===========================================================================
-- D. Create
-- ===========================================================================
select set_config('t.i1', pg_temp.item(current_setting('t.o1'), 'RT-1'), true);
select set_config('t.i2', pg_temp.item(current_setting('t.o1'), 'RT-2'), true);
select set_config('t.i3', pg_temp.item(current_setting('t.o2'), 'RT-3'), true);
select set_config('t.line1', jsonb_build_array(jsonb_build_object('item_id', current_setting('t.i1'), 'quantity', 1))::text, true);
select pg_temp.as_user(current_setting('t.buyer'));
select throws_like(format($$ select public.marketplace_buyer_return_create(%L::uuid, 'swap', %L::jsonb, %L::uuid, null, '{}', null, 'rt-ret-0001') $$,
  current_setting('t.o1'), current_setting('t.line1'), pg_temp.reason('I changed my mind')), 'mp:invalid_payload%', 'D1. an unknown kind is refused');
select throws_like(format($$ select public.marketplace_buyer_return_create(%L::uuid, 'return', '[]'::jsonb, %L::uuid, null, '{}', null, 'rt-ret-0001') $$,
  current_setting('t.o1'), pg_temp.reason('I changed my mind')), 'mp:invalid_payload%', 'D2. no lines is refused');
select throws_like(format($$ select public.marketplace_buyer_return_create(%L::uuid, 'return', %L::jsonb, gen_random_uuid(), null, '{}', null, 'rt-ret-0001') $$,
  current_setting('t.o1'), current_setting('t.line1')), 'mp:preset_invalid%', 'D3. an unknown reason is refused');
select throws_like(format($$ select public.marketplace_buyer_return_create(%L::uuid, 'return', %L::jsonb, %L::uuid, null, '{}', null, 'short') $$,
  current_setting('t.o1'), current_setting('t.line1'), pg_temp.reason('I changed my mind')), 'mp:invalid_payload%', 'D4. a short idempotency key is refused');
select throws_like(format($$ select public.marketplace_buyer_return_create(%L::uuid, 'exchange', %L::jsonb, %L::uuid, null, '{}', 'refund', 'rt-ret-0001') $$,
  current_setting('t.o1'), current_setting('t.line1'), pg_temp.reason('I changed my mind')), 'mp:invalid_payload%', 'D5. an exchange cannot ask for a refund');
select throws_like(format($$ select public.marketplace_buyer_return_create(%L::uuid, 'return', %L::jsonb, %L::uuid, null, '{}', null, 'rt-ret-0001') $$,
  current_setting('t.onew'), current_setting('t.line1'), pg_temp.reason('I changed my mind')), 'mp:return_not_eligible%', 'D6. an order that is not delivered cannot be returned');
select throws_like(format($$ select public.marketplace_buyer_return_create(%L::uuid, 'return', %L::jsonb, %L::uuid, null, '{}', null, 'rt-ret-0001') $$,
  current_setting('t.o1'), jsonb_build_array(jsonb_build_object('item_id', current_setting('t.i1'), 'quantity', 4)), pg_temp.reason('I changed my mind')),
  'mp:quantity_exceeds_order%', 'D7. more than was ordered is refused');
select throws_like(format($$ select public.marketplace_buyer_return_create(%L::uuid, 'return', %L::jsonb, %L::uuid, null, '{}', null, 'rt-ret-0001') $$,
  current_setting('t.o1'), jsonb_build_array(jsonb_build_object('item_id', gen_random_uuid(), 'quantity', 1)), pg_temp.reason('I changed my mind')),
  'mp:invalid_payload%', 'D8. a line that is not on the order is refused');
select throws_like(format($$ select public.marketplace_buyer_return_create(%L::uuid, 'return', %L::jsonb, %L::uuid, null, '{}', null, 'rt-ret-0001') $$,
  current_setting('t.o1'), current_setting('t.line1'), pg_temp.reason('The product is defective')), 'mp:evidence_required%', 'D9. a defect claim needs photos');
select throws_like(format($$ select public.marketplace_buyer_return_create(%L::uuid, 'return', %L::jsonb, %L::uuid, null, '{}', null, 'rt-ret-0001') $$,
  current_setting('t.o2'), jsonb_build_array(jsonb_build_object('item_id', current_setting('t.i3'), 'quantity', 1)), pg_temp.reason('I changed my mind')),
  'mp:return_not_eligible%', 'D10. a made-to-order product accepts only a defect claim');

-- evidence: types, attest, limits
select throws_like(format($$ select public.marketplace_buyer_return_request_upload(%L::uuid, 'video/mp4') $$, current_setting('t.o1')), 'mp:image_type_invalid%',
  'D11. photos only: a video is refused');
select set_config('t.ev1', pg_temp.evidence(current_setting('t.o2'))::text, true);
select is((select upload_state from public.marketplace_return_evidence where id = current_setting('t.ev1')::uuid), 'confirmed', 'D12. the verified photo is confirmed');
select is(public.media_storage_resolve('marketplace', (select object_key from public.marketplace_return_evidence where id = current_setting('t.ev1')::uuid), 'read') ->> 'provider',
  'r2', 'D13. the buyer can read their own evidence (private R2)');
select pg_temp.islike((select object_key from public.marketplace_return_evidence where id = current_setting('t.ev1')::uuid), 'returns/' || current_setting('t.o2') || '/%.png',
  'D14. the key is returns/<order>/<evidence>.<ext>');
select pg_temp.as_user(current_setting('t.buyer2'));
select is(public.media_storage_resolve('marketplace', (select object_key from public.marketplace_return_evidence where id = current_setting('t.ev1')::uuid), 'read'), null,
  'D15. another buyer cannot read it');
select pg_temp.as_user(current_setting('t.seller'));
select is(public.media_storage_resolve('marketplace', (select object_key from public.marketplace_return_evidence where id = current_setting('t.ev1')::uuid), 'read'), null,
  'D16. nor the showroom before the photo is attached to a request');
select pg_temp.as_user(current_setting('t.buyer'));
select throws_like(format($$ select public.marketplace_buyer_return_evidence_confirm(%L::uuid) $$, gen_random_uuid()), 'mp:not_found%', 'D17. an unknown evidence id is refused');
-- upload authorization of a fresh evidence key (the media function branch of this PR)
select set_config('t.pend', public.marketplace_buyer_return_request_upload(current_setting('t.o2')::uuid, 'image/webp') ->> 'object_key', true);
reset role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.media_storage_reserve('marketplace', current_setting('t.pend'), 'r2', current_setting('t.buyer')::uuid);
select pg_temp.as_user(current_setting('t.buyer'));
select is(public.media_storage_resolve('marketplace', current_setting('t.pend'), 'upload') ->> 'provider', 'r2', 'D17b. the buyer may upload to the issued evidence key');
select is((select organization_id from public.media_storage_locations where namespace = 'marketplace' and object_key = current_setting('t.pend')), null,
  'D17c. evidence is buyer-owned: no showroom quota is charged');
select pg_temp.as_user(current_setting('t.buyer2'));
select is(public.media_storage_resolve('marketplace', current_setting('t.pend'), 'upload'), null, 'D17d. another buyer may not');
select pg_temp.as_user(current_setting('t.seller'));
select is(public.media_storage_resolve('marketplace', current_setting('t.pend'), 'upload'), null, 'D17e. nor the showroom');
select pg_temp.as_user(current_setting('t.buyer'));

-- the made-to-order curtain accepts a defect claim with evidence
select set_config('t.r2', public.marketplace_buyer_return_create(current_setting('t.o2')::uuid, 'return',
  jsonb_build_array(jsonb_build_object('item_id', current_setting('t.i3'), 'quantity', 1)), pg_temp.reason('The product is defective'), 'edge is chipped',
  array[current_setting('t.ev1')::uuid], null, 'rt-ret-0002')::text, true);
select is(current_setting('t.r2')::jsonb ->> 'status', 'requested', 'D18. a defect claim on a made-to-order product is accepted');
select is(current_setting('t.r2')::jsonb ->> 'claim_type', 'defect', 'D19. as a defect claim');
select is(current_setting('t.r2')::jsonb ->> 'return_shipping_payer', 'seller', 'D20. the showroom pays the return shipping of a defect');
select pg_temp.islike(current_setting('t.r2')::jsonb ->> 'request_number', 'RT-%', 'D21. request number RT-nnnnnn');
select is((select return_id::text from public.marketplace_return_evidence where id = current_setting('t.ev1')::uuid), current_setting('t.r2')::jsonb ->> 'id',
  'D22. the photo is attached to the request');
select is((select quantity_returned from public.marketplace_order_items where id = current_setting('t.i3')::uuid), 1, 'D23. quantity_returned follows the request');
select is((select count(*)::int from public.marketplace_timers where subject_type = 'return' and subject_id = (current_setting('t.r2')::jsonb ->> 'id')::uuid
            and kind = 'return_seller_response' and state = 'active'), 1, 'D24. the 72 h seller timer is open');
select is((select count(*)::int from public.marketplace_return_events where return_id = (current_setting('t.r2')::jsonb ->> 'id')::uuid and action = 'requested'), 1, 'D25. one event');
select is((select count(*)::int from public.marketplace_order_events where order_id = current_setting('t.o2')::uuid and action = 'return_requested'), 1, 'D26. the order timeline says a return was requested');
select is((select count(*)::int from public.notifications where event_type = 'marketplace.return.requested' and recipient_user_id = current_setting('t.seller')::uuid
            and subject_id = (current_setting('t.r2')::jsonb ->> 'id')::uuid), 1, 'D27. the showroom is told (in-app)');
select is((select deep_link from public.notifications where event_type = 'marketplace.return.requested' and subject_id = (current_setting('t.r2')::jsonb ->> 'id')::uuid limit 1),
  '/showroom/marketplace/returns/' || (current_setting('t.r2')::jsonb ->> 'id'), 'D28. with a deep link to the return');
select is(public.marketplace_buyer_return_create(current_setting('t.o2')::uuid, 'return',
  jsonb_build_array(jsonb_build_object('item_id', current_setting('t.i3'), 'quantity', 1)), pg_temp.reason('The product is defective'), 'edge is chipped',
  array[current_setting('t.ev1')::uuid], null, 'rt-ret-0002') ->> 'id', current_setting('t.r2')::jsonb ->> 'id', 'D29. the same idempotency key returns the same request');
select is((select count(*)::int from public.marketplace_return_requests where order_id = current_setting('t.o2')::uuid), 1, 'D30. and creates nothing twice');
select throws_like(format($$ select public.marketplace_buyer_return_create(%L::uuid, 'return', %L::jsonb, %L::uuid, null, '{}', null, 'rt-ret-0002') $$,
  current_setting('t.o1'), current_setting('t.line1'), pg_temp.reason('I changed my mind')), 'mp:idempotency_conflict%', 'D31. the key cannot be reused for another order');
select throws_like(format($$ select public.marketplace_buyer_return_create(%L::uuid, 'return', %L::jsonb, %L::uuid, null, '{}', null, 'rt-ret-0099') $$,
  current_setting('t.o2'), jsonb_build_array(jsonb_build_object('item_id', current_setting('t.i3'), 'quantity', 1)), pg_temp.reason('The product is defective')),
  'mp:return_exists%', 'D32. one active return per order') ;
reset role;

-- the windows, with the delivery date moved
update public.marketplace_orders set delivered_at = now() - interval '16 days' where id = current_setting('t.o1')::uuid;
select pg_temp.as_user(current_setting('t.buyer'));
select throws_like(format($$ select public.marketplace_buyer_return_create(%L::uuid, 'return', %L::jsonb, %L::uuid, null, '{}', null, 'rt-ret-0010') $$,
  current_setting('t.o1'), current_setting('t.line1'), pg_temp.reason('I changed my mind')), 'mp:return_window_closed%', 'D33. a change of mind after 14 days is too late');
select throws_like(format($$ select public.marketplace_buyer_return_create(%L::uuid, 'return', %L::jsonb, %L::uuid, null, '{}', null, 'rt-ret-0010') $$,
  current_setting('t.o1'), current_setting('t.line1'), pg_temp.reason('Damaged in transit')), 'mp:return_window_closed%', 'D34. visible transit damage must be reported within 48 hours');
select is((public.marketplace_buyer_return_eligibility(current_setting('t.o1')::uuid) ->> 'eligible')::boolean, true, 'D35. the defect window (30 days) is still open');
reset role;
update public.marketplace_orders set delivered_at = now() - interval '32 days' where id = current_setting('t.o1')::uuid;
select pg_temp.as_user(current_setting('t.buyer'));
select is((public.marketplace_buyer_return_eligibility(current_setting('t.o1')::uuid) ->> 'eligible')::boolean, false, 'D36. after 30 days nothing can be returned');
select is((app.marketplace_order_document_v2(current_setting('t.o1')::uuid, 'buyer') -> 'return_window' ->> 'returnable')::boolean, false, 'D37. the document says so');
select throws_like(format($$ select public.marketplace_buyer_return_create(%L::uuid, 'return', %L::jsonb, %L::uuid, null, '{}', null, 'rt-ret-0011') $$,
  current_setting('t.o1'), current_setting('t.line1'), pg_temp.reason('The product is defective')), 'mp:return_window_closed%', 'D38. a defect claim after 30 days is refused');
reset role;
-- a showroom that offers more
select pg_temp.as_user(current_setting('t.seller'));
select public.marketplace_seller_return_settings_save(current_setting('t.a')::uuid, '{"general_days":"60","defect_days":"90"}');
select pg_temp.as_user(current_setting('t.buyer'));
select is((public.marketplace_buyer_return_eligibility(current_setting('t.o1')::uuid) ->> 'eligible')::boolean, true, 'D39. a showroom that offers 60 / 90 days extends the window');
reset role;
select pg_temp.as_user(current_setting('t.seller'));
select public.marketplace_seller_return_settings_save(current_setting('t.a')::uuid, '{"general_days":"14","defect_days":"30"}');
reset role;
update public.marketplace_orders set delivered_at = now() - interval '1 hour' where id in (current_setting('t.o1')::uuid, current_setting('t.o3')::uuid, current_setting('t.o4')::uuid);

-- ===========================================================================
-- E. Flow: cancel, reject, approve, partial proposal, ship, receive, refund, confirm
-- ===========================================================================
select pg_temp.as_user(current_setting('t.buyer'));
select set_config('t.r1', public.marketplace_buyer_return_create(current_setting('t.o1')::uuid, 'return', current_setting('t.line1')::jsonb,
  pg_temp.reason('I changed my mind'), 'no longer needed', '{}', null, 'rt-ret-0020')::text, true);
select set_config('t.rid1', current_setting('t.r1')::jsonb ->> 'id', true);
select is(current_setting('t.r1')::jsonb ->> 'return_shipping_payer', 'buyer', 'E1. a change of mind is shipped by the buyer');
select is(current_setting('t.r1')::jsonb ->> 'claim_type', 'general', 'E2. general claim');
select is(current_setting('t.r1')::jsonb -> 'buyer', 'null'::jsonb, 'E3. the buyer document carries no buyer block (no personal data repeated)');
select is((select quantity_returned from public.marketplace_order_items where id = current_setting('t.i1')::uuid), 1, 'E4. one unit is held by the request');
select is(public.marketplace_buyer_return_cancel(current_setting('t.rid1')::uuid) ->> 'status', 'cancelled', 'E5. the buyer cancels while requested');
select is(public.marketplace_buyer_return_cancel(current_setting('t.rid1')::uuid) ->> 'status', 'cancelled', 'E6. cancelling twice is a no-op');
select is((select quantity_returned from public.marketplace_order_items where id = current_setting('t.i1')::uuid), 0, 'E7. the unit is released');
select is((select state from public.marketplace_timers where subject_id = current_setting('t.rid1')::uuid and kind = 'return_seller_response'), 'cancelled', 'E8. the timer is closed');

-- a new request for 2 units, then the showroom rejects it
select set_config('t.r1', public.marketplace_buyer_return_create(current_setting('t.o1')::uuid, 'return',
  jsonb_build_array(jsonb_build_object('item_id', current_setting('t.i1'), 'quantity', 2)),
  pg_temp.reason('I changed my mind'), null, '{}', null, 'rt-ret-0021')::text, true);
select set_config('t.rid1', current_setting('t.r1')::jsonb ->> 'id', true);
reset role;
select pg_temp.as_user(current_setting('t.sales'));
select throws_like(format($$ select public.marketplace_seller_return_decide(%L::uuid, 'approve') $$, current_setting('t.rid1')), 'mp:not_found%', 'E9. a member without order rights cannot decide');
select pg_temp.as_user(current_setting('t.sellerb'));
select throws_like(format($$ select public.marketplace_seller_return_decide(%L::uuid, 'approve') $$, current_setting('t.rid1')), 'mp:not_found%', 'E10. nor another showroom');
select throws_like(format($$ select public.marketplace_seller_return_get(%L::uuid) $$, current_setting('t.rid1')), 'mp:not_found%', 'E11. nor read it');
select pg_temp.as_user(current_setting('t.seller'));
select is(jsonb_array_length(public.marketplace_seller_returns_page(current_setting('t.a')::uuid, 'requested') -> 'items') >= 2, true, 'E12. the showroom lists the requests');
select is(public.marketplace_seller_return_get(current_setting('t.rid1')::uuid) -> 'buyer' ->> 'name', (select buyer_name from public.marketplace_orders where id = current_setting('t.o1')::uuid),
  'E13. the showroom sees the recipient name');
select is((public.marketplace_seller_return_get(current_setting('t.rid1')::uuid) -> 'actions')::text, '["approve", "reject", "propose_partial"]', 'E14. the actions come from the database');
select throws_like(format($$ select public.marketplace_seller_return_decide(%L::uuid, 'reject') $$, current_setting('t.rid1')), 'mp:reason_required%', 'E15. a rejection needs a reason');
select throws_like(format($$ select public.marketplace_seller_return_decide(%L::uuid, 'reject', %L::uuid) $$, current_setting('t.rid1'), pg_temp.reason('I changed my mind')),
  'mp:preset_invalid%', 'E16. the reason must be a rejection preset');
select throws_like(format($$ select public.marketplace_seller_return_decide(%L::uuid, 'maybe') $$, current_setting('t.rid1')), 'mp:invalid_payload%', 'E17. an unknown decision is refused');
select is(public.marketplace_seller_return_decide(current_setting('t.rid1')::uuid, 'reject', pg_temp.reject_reason('The product was used')) ->> 'status', 'rejected', 'E18. rejected with a preset reason');
select is(public.marketplace_seller_return_decide(current_setting('t.rid1')::uuid, 'reject', pg_temp.reject_reason('The product was used')) ->> 'status', 'rejected', 'E19. rejecting twice is a no-op');
select throws_like(format($$ select public.marketplace_seller_return_decide(%L::uuid, 'approve') $$, current_setting('t.rid1')), 'mp:invalid_transition%', 'E20. a decided request cannot be decided again by the showroom');
select is((select quantity_returned from public.marketplace_order_items where id = current_setting('t.i1')::uuid), 0, 'E21. a rejected request gives the units back');
select is((select count(*)::int from public.notifications where event_type = 'marketplace.return.rejected' and recipient_user_id = current_setting('t.buyer')::uuid
            and subject_id = current_setting('t.rid1')::uuid), 1, 'E22. the buyer is told');
select pg_temp.islike((select content -> 'ar' ->> 'body' from public.notifications where event_type = 'marketplace.return.rejected' and subject_id = current_setting('t.rid1')::uuid limit 1), '%مستخدم%',
  'E23. in Arabic, with the rejection message');
select pg_temp.islike((select content -> 'en' ->> 'body' from public.notifications where event_type = 'marketplace.return.rejected' and subject_id = current_setting('t.rid1')::uuid limit 1), '%was used%',
  'E24. and in English');
select is((select state from public.marketplace_timers where subject_id = current_setting('t.rid1')::uuid and kind = 'return_seller_response'), 'done', 'E25. the 72 h timer is closed by the decision');
reset role;

-- approve, partial proposal rules, ship, receive
select pg_temp.as_user(current_setting('t.buyer'));
select set_config('t.r1', public.marketplace_buyer_return_create(current_setting('t.o1')::uuid, 'return',
  jsonb_build_array(jsonb_build_object('item_id', current_setting('t.i1'), 'quantity', 2)),
  pg_temp.reason('I changed my mind'), null, '{}', null, 'rt-ret-0022')::text, true);
select set_config('t.rid1', current_setting('t.r1')::jsonb ->> 'id', true);
reset role;
select pg_temp.as_user(current_setting('t.seller'));
select throws_like(format($$ select public.marketplace_seller_return_decide(%L::uuid, 'propose_partial', null, null, null, 0) $$, current_setting('t.rid1')), 'mp:invalid_payload%', 'E26. a partial proposal needs an amount');
select throws_like(format($$ select public.marketplace_seller_return_decide(%L::uuid, 'propose_partial', null, null, null, 200) $$, current_setting('t.rid1')), 'mp:invalid_payload%',
  'E27. and one below the value of the returned units');
select is(public.marketplace_seller_return_decide(current_setting('t.rid1')::uuid, 'approve', null, 'Please bring them in the original box', 'Please bring them in the original box') ->> 'status',
  'approved', 'E28. approved with a message');
select is((select count(*)::int from public.notifications where event_type = 'marketplace.return.approved' and recipient_user_id = current_setting('t.buyer')::uuid
            and subject_id = current_setting('t.rid1')::uuid), 1, 'E29. the buyer is told');
select throws_like(format($$ select public.marketplace_seller_refund_record(%L::uuid, 200) $$, current_setting('t.rid1')), 'mp:invalid_transition%', 'E30. no refund before the goods are received');
select throws_like(format($$ select public.marketplace_seller_return_receive(%L::uuid, '[{"item_id":"x","sellable":true}]') $$, current_setting('t.rid1')), 'mp:invalid_payload%', 'E31. a malformed sellable list is refused');
select pg_temp.as_user(current_setting('t.buyer'));
select throws_like(format($$ select public.marketplace_buyer_return_mark_shipped(%L::uuid, 'a b') $$, current_setting('t.rid1')), 'mp:invalid_payload%', 'E32. a malformed tracking number is refused');
select is(public.marketplace_buyer_return_mark_shipped(current_setting('t.rid1')::uuid, 'RET-1001') ->> 'status', 'in_transit', 'E33. the buyer marks the parcel sent');
select is(public.marketplace_buyer_return_mark_shipped(current_setting('t.rid1')::uuid, 'RET-1001') ->> 'status', 'in_transit', 'E34. twice is a no-op');
select throws_like(format($$ select public.marketplace_buyer_return_cancel(%L::uuid) $$, current_setting('t.rid1')), 'mp:invalid_transition%', 'E35. no cancel once it left');
reset role;
-- the order was paid (COD collected at delivery): the payment mirror follows the refund
select set_config('app.marketplace_order_apply', 'on', true);
update public.marketplace_orders set payment_status = 'collected' where id = current_setting('t.o1')::uuid;
select set_config('app.marketplace_order_apply', 'off', true);
select pg_temp.as_user(current_setting('t.seller'));
select set_config('t.stock_before', pg_temp.stock('RT-1'), true);
select is(public.marketplace_seller_return_receive(current_setting('t.rid1')::uuid,
  jsonb_build_array(jsonb_build_object('item_id', current_setting('t.i1'), 'sellable', true))) ->> 'status', 'received', 'E37. received, the goods are sellable');
select is((string_to_array(pg_temp.stock('RT-1'), '/'))[1]::int - (string_to_array(current_setting('t.stock_before'), '/'))[1]::int, 2, 'E38. two units go back to stock because the showroom said so');
select is((select count(*)::int from public.marketplace_stock_movements where reference_id = current_setting('t.rid1') and movement_type = 'replenish'), 1, 'E39. one ledger movement, keyed by the return');
select is(public.marketplace_seller_return_receive(current_setting('t.rid1')::uuid, '[]') ->> 'status', 'received', 'E40. receiving twice is a no-op');
select is((string_to_array(pg_temp.stock('RT-1'), '/'))[1]::int - (string_to_array(current_setting('t.stock_before'), '/'))[1]::int, 2, 'E41. and puts nothing back twice');
select is((select payment_status from public.marketplace_orders where id = current_setting('t.o1')::uuid), 'refund_due', 'E42. the order says a refund is due');
select is((select count(*)::int from public.marketplace_timers where subject_id = current_setting('t.rid1')::uuid and kind = 'return_refund_due' and state = 'active'), 1, 'E43. the 7 day refund timer is open');
select is((public.marketplace_seller_return_get(current_setting('t.rid1')::uuid) ->> 'max_refund_egp')::numeric, 200::numeric, 'E44. the refund is the value of the returned units (delivery fee excluded)');
select throws_like(format($$ select public.marketplace_seller_refund_record(%L::uuid, 150) $$, current_setting('t.rid1')), 'mp:invalid_payload%', 'E45. the refund is exactly what was agreed');
select is(public.marketplace_seller_refund_record(current_setting('t.rid1')::uuid, 200, 'InstaPay ref 123') -> 'refund' ->> 'state', 'sent', 'E46. the showroom records the refund it paid');
select is(public.marketplace_seller_refund_record(current_setting('t.rid1')::uuid, 200, 'InstaPay ref 123') -> 'refund' ->> 'state', 'sent', 'E47. recording twice is a no-op');
select is((select count(*)::int from public.marketplace_order_refunds where return_id = current_setting('t.rid1')::uuid), 1, 'E48. one refund row');
select is((select method from public.marketplace_order_refunds where return_id = current_setting('t.rid1')::uuid), 'cod', 'E49. through the ORIGINAL method of the order');
select is((select status from public.marketplace_return_requests where id = current_setting('t.rid1')::uuid), 'received', 'E50. the return is not closed until the buyer confirms');
select pg_temp.as_user(current_setting('t.buyer'));
select is((public.marketplace_buyer_return_get(current_setting('t.rid1')::uuid) -> 'actions')::text, '["confirm_refund", "file_complaint"]', 'E51. the buyer may confirm the refund (or complain)');
select pg_temp.as_user(current_setting('t.buyer2'));
select throws_like(format($$ select public.marketplace_buyer_refund_confirm(%L::uuid) $$, current_setting('t.rid1')), 'mp:not_found%', 'E52. another buyer cannot confirm');
select pg_temp.as_user(current_setting('t.buyer'));
select is(public.marketplace_buyer_refund_confirm(current_setting('t.rid1')::uuid) ->> 'status', 'refunded', 'E53. the buyer confirms: refunded');
select is(public.marketplace_buyer_refund_confirm(current_setting('t.rid1')::uuid) ->> 'status', 'refunded', 'E54. confirming twice is a no-op');
select is((select payment_status from public.marketplace_orders where id = current_setting('t.o1')::uuid), 'collected', 'E55. a partial refund returns the payment status to collected');
select is((select state from public.marketplace_order_refunds where return_id = current_setting('t.rid1')::uuid), 'confirmed', 'E56. refund confirmed');
select is((select count(*)::int from public.marketplace_timers where subject_id = current_setting('t.rid1')::uuid and kind = 'return_refund_due' and state = 'active'), 0, 'E57. the refund timer is closed');
select is((select status from public.marketplace_orders where id = current_setting('t.o1')::uuid), 'delivered', 'E58. the order itself stays delivered');
select is((select quantity_returned from public.marketplace_order_items where id = current_setting('t.i1')::uuid), 2, 'E59. two units stay counted as returned');
reset role;

-- the rest of the order: a PARTIAL REFUND PROPOSAL, then everything refunded settles the order
select pg_temp.as_user(current_setting('t.buyer'));
select set_config('t.r3', public.marketplace_buyer_return_create(current_setting('t.o1')::uuid, 'return',
  jsonb_build_array(jsonb_build_object('item_id', current_setting('t.i1'), 'quantity', 1), jsonb_build_object('item_id', current_setting('t.i2'), 'quantity', 1)),
  pg_temp.reason('I changed my mind'), null, '{}', null, 'rt-ret-0023')::text, true);
select set_config('t.rid3', current_setting('t.r3')::jsonb ->> 'id', true);
reset role;
select pg_temp.as_user(current_setting('t.seller'));
select is(public.marketplace_seller_return_decide(current_setting('t.rid3')::uuid, 'propose_partial', null, 'Small scratch on the box', 'Small scratch on the box', 300) ->> 'status', 'approved',
  'E60. a partial proposal approves the return with a capped refund');
select is((public.marketplace_seller_return_get(current_setting('t.rid3')::uuid) ->> 'max_refund_egp')::numeric, 300::numeric, 'E61. the cap is the proposed amount');
select pg_temp.as_user(current_setting('t.buyer'));
select is((public.marketplace_buyer_return_get(current_setting('t.rid3')::uuid) ->> 'partial_refund_egp')::numeric, 300::numeric, 'E62. the buyer sees the proposal');
select is(public.marketplace_buyer_return_mark_shipped(current_setting('t.rid3')::uuid, null) ->> 'status', 'in_transit', 'E63. shipped without a tracking number');
reset role;
select pg_temp.as_user(current_setting('t.seller'));
select is(public.marketplace_seller_return_receive(current_setting('t.rid3')::uuid, jsonb_build_array(jsonb_build_object('item_id', current_setting('t.i1'), 'sellable', false))) ->> 'status',
  'received', 'E64. received, one line not sellable');
select is((select sellable from public.marketplace_return_items where return_id = current_setting('t.rid3')::uuid and order_item_id = current_setting('t.i2')::uuid), false,
  'E65. a line the showroom did not mark is NOT sellable (no stock goes back)');
select is((select count(*)::int from public.marketplace_stock_movements where reference_id = current_setting('t.rid3') and movement_type = 'replenish'), 0, 'E66. no unit goes back to stock');
select is(public.marketplace_seller_refund_record(current_setting('t.rid3')::uuid, 300, null) -> 'refund' ->> 'state', 'sent', 'E67. refund of the proposed amount recorded');
select pg_temp.as_user(current_setting('t.buyer'));
select is(public.marketplace_buyer_refund_confirm(current_setting('t.rid3')::uuid) ->> 'status', 'refunded', 'E68. confirmed');
select is((select payment_status from public.marketplace_orders where id = current_setting('t.o1')::uuid), 'collected', 'E69. 500 refunded of 550: not settled yet');
select is((select quantity_returned from public.marketplace_order_items where id = current_setting('t.i1')::uuid), 3, 'E70. all three units of line 1 returned');
select is((select count(*)::int from public.marketplace_order_events where order_id = current_setting('t.o1')::uuid and action = 'return_closed'), 2, 'E71. the order timeline records each closed return');
select is((app.marketplace_order_document_v2(current_setting('t.o1')::uuid, 'buyer') -> 'returns' -> 0 ->> 'request_number') like 'RT-%', true, 'E72. the order document lists its returns');
reset role;

-- ===========================================================================
-- F. Exchange: the replacement leaves stock
-- ===========================================================================
select pg_temp.as_user(current_setting('t.buyer'));
select set_config('t.i4', pg_temp.item(current_setting('t.o3'), 'RT-1'), true);
select throws_like(format($$ select public.marketplace_buyer_return_create(%L::uuid, 'exchange', %L::jsonb, %L::uuid, null, '{}', 'exchange', 'rt-ret-0030') $$,
  current_setting('t.o3'), jsonb_build_array(jsonb_build_object('item_id', current_setting('t.i4'), 'quantity', 1)), pg_temp.reason('The product is defective')),
  'mp:evidence_required%', 'F1. an exchange for a defect needs photos too');
select set_config('t.ev3', pg_temp.evidence(current_setting('t.o3'))::text, true);
select set_config('t.r4', public.marketplace_buyer_return_create(current_setting('t.o3')::uuid, 'exchange',
  jsonb_build_array(jsonb_build_object('item_id', current_setting('t.i4'), 'quantity', 1)), pg_temp.reason('The product is defective'), 'torn',
  array[current_setting('t.ev3')::uuid], 'exchange', 'rt-ret-0031')::text, true);
select set_config('t.rid4', current_setting('t.r4')::jsonb ->> 'id', true);
select is(current_setting('t.r4')::jsonb ->> 'remedy', 'exchange', 'F2. an exchange request');
reset role;
select pg_temp.as_user(current_setting('t.seller'));
select is(public.marketplace_seller_return_get(current_setting('t.rid4')::uuid) -> 'evidence' -> 0 ->> 'id', current_setting('t.ev3'), 'F3. the showroom sees the evidence once it is attached');
select is(public.media_storage_resolve('marketplace', (select object_key from public.marketplace_return_evidence where id = current_setting('t.ev3')::uuid), 'read') ->> 'provider', 'r2',
  'F4. and can read the photo');
select pg_temp.as_user(current_setting('t.sellerb'));
select is(public.media_storage_resolve('marketplace', (select object_key from public.marketplace_return_evidence where id = current_setting('t.ev3')::uuid), 'read'), null, 'F5. another showroom cannot');
select pg_temp.as_user(current_setting('t.seller'));
select is(public.marketplace_seller_return_decide(current_setting('t.rid4')::uuid, 'approve') ->> 'status', 'approved', 'F6. approved');
select throws_like(format($$ select public.marketplace_seller_exchange_fulfil(%L::uuid, null) $$, current_setting('t.rid4')), 'mp:invalid_transition%', 'F7. no replacement before the goods are back');
select is(public.marketplace_seller_return_receive(current_setting('t.rid4')::uuid, jsonb_build_array(jsonb_build_object('item_id', current_setting('t.i4'), 'sellable', false))) ->> 'status', 'received', 'F8. received (damaged: not sellable)');
select throws_like(format($$ select public.marketplace_seller_refund_record(%L::uuid, 100) $$, current_setting('t.rid4')), 'mp:invalid_transition%', 'F9. an exchange has no refund');
select set_config('t.stock_before', pg_temp.stock('RT-1'), true);
select is(public.marketplace_seller_exchange_fulfil(current_setting('t.rid4')::uuid, 'handed over') ->> 'status', 'exchanged', 'F10. the replacement is handed over');
select is((string_to_array(current_setting('t.stock_before'), '/'))[1]::int - (string_to_array(pg_temp.stock('RT-1'), '/'))[1]::int, 1, 'F11. one unit leaves stock for the replacement');
select is(public.marketplace_seller_exchange_fulfil(current_setting('t.rid4')::uuid, null) ->> 'status', 'exchanged', 'F12. fulfilling twice is a no-op');
select is((string_to_array(current_setting('t.stock_before'), '/'))[1]::int - (string_to_array(pg_temp.stock('RT-1'), '/'))[1]::int, 1, 'F13. and takes nothing twice');
select is((select count(*)::int from public.marketplace_stock_movements where reference_id = current_setting('t.rid4') and movement_type in ('reserve', 'deduct')), 2, 'F14. reserve and deduct, keyed by the return');

-- no stock for the replacement: refused (RT-2 had 2 units, 1 sold in order o1, so 1 left; sell it, then exchange)
reset role;
select pg_temp.as_user(current_setting('t.buyer'));
select set_config('t.o5', pg_temp.deliver(jsonb_build_array(jsonb_build_object('slug', current_setting('t.s2'), 'sku', 'RT-2', 'qty', 1))::text, 'rt-key-0006')::text, true);
select set_config('t.i5', pg_temp.item(current_setting('t.o5'), 'RT-2'), true);
select set_config('t.ev5', pg_temp.evidence(current_setting('t.o5'))::text, true);
select set_config('t.r5', public.marketplace_buyer_return_create(current_setting('t.o5')::uuid, 'exchange',
  jsonb_build_array(jsonb_build_object('item_id', current_setting('t.i5'), 'quantity', 1)), pg_temp.reason('The product is defective'), null,
  array[current_setting('t.ev5')::uuid], 'exchange', 'rt-ret-0032')::text, true);
reset role;
select pg_temp.as_user(current_setting('t.seller'));
select public.marketplace_seller_return_decide((current_setting('t.r5')::jsonb ->> 'id')::uuid, 'approve');
select public.marketplace_seller_return_receive((current_setting('t.r5')::jsonb ->> 'id')::uuid, '[]');
select throws_like(format($$ select public.marketplace_seller_exchange_fulfil(%L::uuid, null) $$, current_setting('t.r5')::jsonb ->> 'id'), 'mp:insufficient_stock%',
  'F15. no replacement when the stock is gone');
select is(pg_temp.stock('RT-2'), '0/0', 'F16. stock untouched by the refused exchange');
reset role;

-- ===========================================================================
-- G. Escalation: reminders, silence, complaint, refund deadline
-- ===========================================================================
select pg_temp.as_user(current_setting('t.buyer'));
select set_config('t.r6', public.marketplace_buyer_return_create(current_setting('t.o4')::uuid, 'return',
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.item(current_setting('t.o4'), 'RT-1'), 'quantity', 1)), pg_temp.reason('I changed my mind'), null, '{}', null, 'rt-ret-0040')::text, true);
select set_config('t.rid6', current_setting('t.r6')::jsonb ->> 'id', true);
reset role;
select set_config('t.timer6', (select id::text from public.marketplace_timers where subject_id = current_setting('t.rid6')::uuid and kind = 'return_seller_response'), true);
select is((select array_length(remind_offsets, 1) from public.marketplace_timers where id = current_setting('t.timer6')::uuid), 2, 'G1. reminders at 24 h and 48 h');
select is((select expires_at - started_at from public.marketplace_timers where id = current_setting('t.timer6')::uuid), interval '72 hours', 'G2. the showroom has 72 hours');
select is(app.marketplace_return_timer_tick((select t from public.marketplace_timers t where t.id = current_setting('t.timer6')::uuid), now()), 'reminded', 'G3. before the deadline the tick sends a reminder');
select is((select count(*)::int from public.notifications where event_type = 'marketplace.return.seller_reminder' and subject_id = current_setting('t.rid6')::uuid
            and recipient_user_id = current_setting('t.seller')::uuid), 1, 'G4. the showroom gets the reminder');
select is((select in_admin_queue from public.marketplace_return_requests where id = current_setting('t.rid6')::uuid), false, 'G5. not in the admin queue yet');
select is(app.marketplace_return_timer_tick((select t from public.marketplace_timers t where t.id = current_setting('t.timer6')::uuid), now() + interval '73 hours'), 'escalated',
  'G6. at 72 hours the case goes to the admin queue');
select is((select status from public.marketplace_return_requests where id = current_setting('t.rid6')::uuid), 'requested', 'G7. and is NEVER approved automatically');
select is((select escalated_reason from public.marketplace_return_requests where id = current_setting('t.rid6')::uuid), 'seller_silent', 'G8. reason: the showroom was silent');
select is((select count(*)::int from public.notifications where event_type = 'marketplace.return.escalated' and subject_id = current_setting('t.rid6')::uuid
            and recipient_user_id = current_setting('t.super')::uuid), 1, 'G9. the admins holding the permission are told');
select is((select count(*)::int from public.marketplace_return_events where return_id = current_setting('t.rid6')::uuid and action = 'escalated'), 1, 'G11. one escalation event');
select is(app.marketplace_return_escalate(current_setting('t.rid6')::uuid, 'seller_silent', 'system'), false, 'G12. escalating again is a no-op');
select is((select count(*)::int from public.notifications where event_type = 'marketplace.return.escalated' and subject_id = current_setting('t.rid6')::uuid), 1, 'G13. and notifies no second time');

-- ===========================================================================
-- H. Admin queue
-- ===========================================================================
select pg_temp.as_user(current_setting('t.staff'));
select throws_like($$ select public.admin_marketplace_returns() $$, 'mp:not_permitted%', 'H1. an admin without the permission is refused');
select throws_like(format($$ select public.admin_marketplace_return_get(%L::uuid) $$, current_setting('t.rid6')), 'mp:not_permitted%', 'H2. cannot open a return');
select throws_like(format($$ select public.admin_marketplace_return_remind_seller(%L::uuid) $$, current_setting('t.rid6')), 'mp:not_permitted%', 'H3. cannot remind');
select throws_like(format($$ select public.admin_marketplace_return_decide(%L::uuid, 'approve', 'ok then') $$, current_setting('t.rid6')), 'mp:not_permitted%', 'H4. cannot decide');
select pg_temp.as_user(current_setting('t.buyer'));
select throws_like($$ select public.admin_marketplace_returns() $$, 'mp:not_permitted%', 'H5. a buyer is refused');
select pg_temp.as_user(current_setting('t.super'));
select is((public.admin_marketplace_returns() -> 'counts' ->> 'escalated')::int, 1, 'H6. the queue holds the escalated return');
select is(jsonb_array_length(public.admin_marketplace_returns('open', 'all') -> 'items') >= 2, true, 'H7. the full list shows the others');
select is(public.admin_marketplace_return_get(current_setting('t.rid6')::uuid) -> 'buyer' ->> 'name', (select buyer_name from public.marketplace_orders where id = current_setting('t.o4')::uuid), 'H8. the admin sees the names');
select is(public.admin_marketplace_return_get(current_setting('t.rid6')::uuid) ? 'phone', false, 'H9. never a phone number');
select is(public.admin_marketplace_return_get(current_setting('t.rid6')::uuid) -> 'actions', '["remind_seller", "approve", "reject"]'::jsonb, 'H10. the admin actions come from the database');
select is(public.admin_marketplace_return_remind_seller(current_setting('t.rid6')::uuid) ->> 'status', 'requested', 'H11. the admin reminds the showroom');
select is((select count(*)::int from public.notifications where event_type = 'marketplace.return.admin_reminder' and subject_id = current_setting('t.rid6')::uuid
            and recipient_user_id = current_setting('t.seller')::uuid), 1, 'H12. the showroom is told');
select throws_like(format($$ select public.admin_marketplace_return_decide(%L::uuid, 'reject', 'x') $$, current_setting('t.rid6')), 'mp:reason_required%', 'H13. a decision needs a written note (3 to 500 characters)');
select is(public.admin_marketplace_return_decide(current_setting('t.rid6')::uuid, 'approve', 'Showroom did not answer in time', null, null) ->> 'status', 'approved', 'H14. the admin decides');
select is((select decided_by_role from public.marketplace_return_requests where id = current_setting('t.rid6')::uuid), 'admin', 'H15. recorded as an admin decision');
select is((select actor_role from public.marketplace_return_events where return_id = current_setting('t.rid6')::uuid and action = 'approved'), 'admin', 'H16. in the dispute record');
select is((select in_admin_queue from public.marketplace_return_requests where id = current_setting('t.rid6')::uuid), false, 'H17. out of the queue once decided');
select is((select count(*)::int from public.notifications where event_type = 'marketplace.return.admin_decided' and subject_id = current_setting('t.rid6')::uuid), 2,
  'H18. buyer and showroom are both told');
select throws_like(format($$ select public.admin_marketplace_return_decide(%L::uuid, 'reject', 'changed my mind again') $$, current_setting('t.rid6')), 'mp:invalid_transition%',
  'H19. an approved return cannot be rejected by the admin afterwards');
-- the admin note is internal: neither the buyer nor the showroom document (events, decision, message) ever carries it
select pg_temp.as_user(current_setting('t.buyer'));
select is(position('did not answer' in public.marketplace_buyer_return_get(current_setting('t.rid6')::uuid)::text), 0, 'H19a. the buyer document never contains the internal admin note');
select pg_temp.as_user(current_setting('t.seller'));
select is(position('did not answer' in public.marketplace_seller_return_get(current_setting('t.rid6')::uuid)::text), 0, 'H19b. nor does the showroom document');
select pg_temp.as_user(current_setting('t.super'));
select is(public.admin_marketplace_return_get(current_setting('t.rid6')::uuid) -> 'decision' ->> 'internal_note', 'Showroom did not answer in time', 'H19c. the admin sees the internal note');
select is((select count(*)::int from public.marketplace_return_events where note like '%did not answer%'), 0, 'H19d. no event row carries it');
select is((select count(*)::int from public.notifications where subject_id = current_setting('t.rid6')::uuid and (coalesce(content::text,'') || params::text) like '%did not answer%'), 0, 'H19e. no notification carries it');

-- a complaint escalates a rejected return; the admin reads the evidence of an escalated return only
select pg_temp.as_user(current_setting('t.buyer'));
select is(public.media_storage_resolve('marketplace', (select object_key from public.marketplace_return_evidence where id = current_setting('t.ev3')::uuid), 'read') ->> 'provider', 'r2',
  'H20. the buyer still reads their evidence');
select pg_temp.as_user(current_setting('t.super'));
select is(public.media_storage_resolve('marketplace', (select object_key from public.marketplace_return_evidence where id = current_setting('t.ev3')::uuid), 'read'), null,
  'H21. the admin cannot read the evidence of a return that is not escalated');
select pg_temp.as_user(current_setting('t.buyer'));
select throws_like(format($$ select public.marketplace_return_complaint_file(%L::uuid, 'ab') $$, current_setting('t.rid4')), 'mp:reason_required%', 'H22. a complaint needs a written reason');
reset role;
-- the first return of order o2 (defect, requested): reject it, then the buyer complains
select pg_temp.as_user(current_setting('t.seller'));
select is(public.marketplace_seller_return_decide((current_setting('t.r2')::jsonb ->> 'id')::uuid, 'reject', pg_temp.reject_reason('Photos do not show a defect')) ->> 'status', 'rejected',
  'H24. the showroom rejects the defect claim');
select throws_like(format($$ select public.marketplace_return_complaint_file(%L::uuid, 'ok') $$, current_setting('t.r2')::jsonb ->> 'id'), 'mp:reason_required%', 'H25. too short a complaint is refused');
select pg_temp.as_user(current_setting('t.buyer'));
select is(public.marketplace_return_complaint_file((current_setting('t.r2')::jsonb ->> 'id')::uuid, 'The photos clearly show the chipped edge') ->> 'in_admin_queue', 'true',
  'H26. the buyer escalates a rejection with a complaint');
select is((select escalated_reason from public.marketplace_return_requests where id = (current_setting('t.r2')::jsonb ->> 'id')::uuid), 'complaint', 'H27. reason: complaint');
select is(public.marketplace_return_complaint_file((current_setting('t.r2')::jsonb ->> 'id')::uuid, 'The photos clearly show the chipped edge') ->> 'in_admin_queue', 'true',
  'H28. complaining again is a no-op');
select pg_temp.as_user(current_setting('t.super'));
select is(public.media_storage_resolve('marketplace', (select object_key from public.marketplace_return_evidence where id = current_setting('t.ev1')::uuid), 'read') ->> 'provider', 'r2',
  'H29. now the admin holding the permission can read the evidence of the escalated return');
select pg_temp.as_user(current_setting('t.staff'));
select is(public.media_storage_resolve('marketplace', (select object_key from public.marketplace_return_evidence where id = current_setting('t.ev1')::uuid), 'read'), null,
  'H30. an admin without the permission cannot');
select pg_temp.as_user(current_setting('t.super'));
select is(public.admin_marketplace_return_decide((current_setting('t.r2')::jsonb ->> 'id')::uuid, 'approve', 'Photos show a defect', 'تم قبول طلبك بعد مراجعة الصور', 'Approved after reviewing the photos') ->> 'status',
  'approved', 'H31. the admin can overturn a rejection that was escalated');
select is((select decision_message_en from public.marketplace_return_requests where id = (current_setting('t.r2')::jsonb ->> 'id')::uuid), 'Approved after reviewing the photos', 'H32. with a message to both sides');
reset role;

-- the refund deadline: reminder, then the queue
select pg_temp.as_user(current_setting('t.seller'));
select public.marketplace_seller_return_receive((current_setting('t.r2')::jsonb ->> 'id')::uuid, '[]');
reset role;
select set_config('t.timer2', (select id::text from public.marketplace_timers where subject_id = (current_setting('t.r2')::jsonb ->> 'id')::uuid and kind = 'return_refund_due' and state = 'active'), true);
select is((select expires_at - started_at from public.marketplace_timers where id = current_setting('t.timer2')::uuid), interval '7 days', 'G14. the refund is due 7 days after receipt');
select is(app.marketplace_return_timer_tick((select t from public.marketplace_timers t where t.id = current_setting('t.timer2')::uuid), now() + interval '5 days'), 'reminded',
  'G15. a reminder at 5 days');
select is(app.marketplace_return_timer_tick((select t from public.marketplace_timers t where t.id = current_setting('t.timer2')::uuid), now() + interval '8 days'), 'escalated',
  'G16. then the admin queue');
select pg_temp.as_user(current_setting('t.seller'));
select is(public.marketplace_seller_refund_record((current_setting('t.r2')::jsonb ->> 'id')::uuid, 80, null) -> 'refund' ->> 'amount_egp', '80.00', 'G17. the showroom still records the refund (80 EGP)');
reset role;
select is(app.marketplace_return_timer_tick((select t from public.marketplace_timers t where t.id = current_setting('t.timer2')::uuid), now() + interval '9 days'), 'noop',
  'G18. nothing happens once the refund is recorded');

-- ===========================================================================
-- I. Isolation and the money rule
-- ===========================================================================
select pg_temp.as_user(current_setting('t.buyer2'));
select throws_like(format($$ select public.marketplace_buyer_return_get(%L::uuid) $$, current_setting('t.rid1')), 'mp:not_found%', 'I1. another buyer cannot read a return');
select is(public.marketplace_buyer_returns() ->> 'total', '0', 'I2. nor list it');
select throws_like(format($$ select public.marketplace_buyer_return_cancel(%L::uuid) $$, current_setting('t.rid6')), 'mp:not_found%', 'I3. nor cancel it');
select throws_like(format($$ select public.marketplace_buyer_return_request_upload(%L::uuid, 'image/png') $$, current_setting('t.o1')), 'mp:not_found%', 'I4. nor upload evidence for it');
select pg_temp.as_user(current_setting('t.sellerb'));
select is(public.marketplace_seller_returns_page(current_setting('t.b')::uuid) ->> 'total', '0', 'I5. another showroom sees none');
select throws_like(format($$ select public.marketplace_seller_returns_page(%L::uuid) $$, current_setting('t.a')), 'mp:not_permitted%', 'I6. and cannot ask for showroom A');
select throws_like(format($$ select public.marketplace_seller_product_returnability_set(%L::uuid, %L::uuid, false) $$, current_setting('t.a'), current_setting('t.p3')), 'mp:not_permitted%',
  'I7. nor flip the non-returnable flag of its products');
select pg_temp.as_user(current_setting('t.sales'));
select throws_like(format($$ select public.marketplace_seller_returns_page(%L::uuid) $$, current_setting('t.a')), 'mp:not_permitted%', 'I8. a member without order rights is refused');
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_like($$ select public.marketplace_buyer_returns() $$, 'mp:auth_required%', 'I9. anon is refused');
reset role;
select is((select count(*)::int from pg_attribute where attrelid = 'public.marketplace_order_refunds'::regclass and attname in ('iban', 'card', 'card_number', 'account_number')), 0,
  'I10. a refund is a record only: no bank or card column exists');
select is((select count(*)::int from public.marketplace_stock_movements where reference_id in (select id::text from public.marketplace_return_requests) and movement_type in ('correction', 'initial')), 0,
  'I11. returns move stock only through replenish, reserve and deduct');
select is((select count(*)::int from public.marketplace_return_requests where status = 'approved' and decided_by_role is null), 0, 'I12. no return is ever approved without a decision');
select is((select count(*)::int from public.marketplace_order_items where quantity_returned > quantity), 0, 'I13. quantity_returned never exceeds the ordered quantity');

-- ===========================================================================
-- J. The delivery fee: refunded only when one return takes back the whole order for a showroom fault
-- ===========================================================================
select set_config('t.o9', pg_temp.deliver(jsonb_build_array(jsonb_build_object('slug', current_setting('t.s1'), 'sku', 'RT-1', 'qty', 1))::text, 'rt-key-0090')::text, true);
select set_config('t.o10', pg_temp.deliver(jsonb_build_array(jsonb_build_object('slug', current_setting('t.s1'), 'sku', 'RT-1', 'qty', 1))::text, 'rt-key-0091')::text, true);
select set_config('t.ev9', pg_temp.evidence(current_setting('t.o9'))::text, true);
select set_config('t.r9', public.marketplace_buyer_return_create(current_setting('t.o9')::uuid, 'return',
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.item(current_setting('t.o9'), 'RT-1'), 'quantity', 1)),
  pg_temp.reason('The product is defective'), 'broken', array[current_setting('t.ev9')::uuid], null, 'rt-ret-0090')::text, true);
select set_config('t.r10', public.marketplace_buyer_return_create(current_setting('t.o10')::uuid, 'return',
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.item(current_setting('t.o10'), 'RT-1'), 'quantity', 1)),
  pg_temp.reason('I changed my mind'), null, '{}', null, 'rt-ret-0091')::text, true);
reset role;
select ok((select delivery_fee_egp > 0 from public.marketplace_orders where id = current_setting('t.o9')::uuid), 'J1. the order carries a delivery fee');
select is(app.marketplace_return_value((current_setting('t.r9')::jsonb ->> 'id')::uuid),
  (select total_egp from public.marketplace_orders where id = current_setting('t.o9')::uuid),
  'J2. the whole order returned for a defect refunds the items and the delivery fee');
select is(app.marketplace_return_value((current_setting('t.r10')::jsonb ->> 'id')::uuid),
  (select subtotal_egp from public.marketplace_orders where id = current_setting('t.o10')::uuid),
  'J3. a change of mind never includes the delivery fee');
select is(app.marketplace_return_value((current_setting('t.r2')::jsonb ->> 'id')::uuid), 80::numeric,
  'J4. a partial return for a defect does not include the delivery fee');

select * from finish();
rollback;
