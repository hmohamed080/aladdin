-- pgTAP: Marketplace clarity fixes of the 2026-11-28 test round (20261128090001_marketplace_test_round_clarity.sql).
-- The return flow itself is covered by 390; this file covers what the migration adds: labels, dates, the new timer kind and
-- escalation reason, the new notification templates and that every re-created function keeps its privileges.
create extension if not exists pgtap;

begin;
select no_plan();

-- units: measurements are stored in mm, g and ml; a plain number keeps its display unit; no trailing zeros
select is(app.marketplace_attribute_number(10.0000, null, null, false), '10', 'A1. no trailing zeros');
select is(app.marketplace_attribute_number(530.0000, 'length', null, false), '53 cm', 'A2. length in cm');
select is(app.marketplace_attribute_number(1500, 'weight', null, true), '1.5 كجم', 'A3. weight in kg');
select is(app.marketplace_attribute_number(750, 'volume', null, false), '750 ml', 'A4. volume in ml');
select is(app.marketplace_attribute_number(2.50, null, 'm²/L', false), '2.5 m²/L', 'A5. the display unit of a number');

select is(app.marketplace_date_range('2026-12-01', '2026-12-02', false), '1–2 Dec', 'B1. a range inside one month');
select is(app.marketplace_date_range('2026-11-30', '2026-12-02', false), '30 Nov – 2 Dec', 'B2. across two months');
select is(app.marketplace_date_range('2026-12-01', '2026-12-01', true), '1 ديسمبر', 'B3. one day, Arabic month');
select is(app.marketplace_date_range(null, null, false), '', 'B4. no estimate');

select ok(app.marketplace_timer_open('return', '45000000-0000-4000-8000-000000000001', 'return_refund_confirm', now()) is not null, 'C0. the timer opens');
select is((select expires_at - started_at from public.marketplace_timers where subject_id = '45000000-0000-4000-8000-000000000001'),
          interval '7 days', 'C1. the buyer has 7 days to confirm a recorded refund');
select is((select remind_offsets from public.marketplace_timers where subject_id = '45000000-0000-4000-8000-000000000001'),
          array[interval '3 days'], 'C2. reminded at 3 days');
select ok(pg_get_functiondef('app.marketplace_timer_handle(public.marketplace_timers, timestamptz)'::regprocedure)
            like '%return_refund_confirm%', 'C3. the runner dispatches the new kind to the return hook');
select ok(pg_get_constraintdef((select oid from pg_constraint where conname = 'ck_mp_returns_escalated')) like '%refund_unconfirmed%',
          'C4. the new escalation reason is allowed');

select is((select count(*)::int from public.notification_templates
            where key in ('marketplace.return.shipped', 'marketplace.return.complaint_filed', 'marketplace.return.refund_confirm_reminder')),
          3, 'D1. the three new templates exist');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname in ('app', 'public') and p.prosrc like '%''عمارة '' || nullif(a.building%'), 1,
          'D2. new orders label the building, floor and apartment');
select ok(pg_get_functiondef('app.marketplace_order_notify(uuid, text, jsonb)'::regprocedure) like '%marketplace_date_range%',
          'D3. order notifications show a readable date');

select is(has_function_privilege('anon', 'app.marketplace_attribute_number(numeric, text, text, boolean)', 'execute'), false, 'E1. internal helper');
select is(has_function_privilege('authenticated', 'app.marketplace_return_timer_tick(public.marketplace_timers, timestamptz)', 'execute'), false,
          'E2. the timer hook stays closed to clients');
select is(has_function_privilege('authenticated', 'public.marketplace_seller_refund_record(uuid, numeric, text)', 'execute'), true,
          'E3. the showroom still records refunds');

select set_config('request.jwt.claims', '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated"}', true);
select is(jsonb_array_length(public.marketplace_order_reason_presets('return_reject')), 4, 'F1. the rejection reasons can be listed');

select * from finish();
rollback;
