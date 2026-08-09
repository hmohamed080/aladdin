-- pgTAP: B2B Execution — Order → Project → Completion (Phase 3, Sprint 10).
-- Proves the full execution journey end-to-end
--   (accepted quotation → order → start → project → activate → complete),
-- the immutable-snapshot / RPC-only write boundary, the "exactly one" invariants
-- (one order per accepted quotation, one project per order), cross-tenant denial,
-- lifecycle guards, capability scope, and audit emission.
-- Fixtures come from the shared seed:
--   Org A = 'aaaaaaaa…' (Nile Finishing) — SUPPLIER / executing org; owner 11111111
--   Org B = 'bbbbbbbb…' (Delta Interiors) — REQUESTER / buyer; owner 33333333
--   user 44444444 = non-member (intruder)
create extension if not exists pgtap;

begin;
select plan(30);

-- Grant the granular commerce + execution caps (also exercises the non-org.manage
-- path). Owners already qualify via the org.manage fallback in the helpers.
insert into public.membership_capabilities (membership_id, capability_key) values
  ('e1111111-eeee-4eee-8eee-eeeeeeeeeee1', 'catalog.publish'),
  ('e1111111-eeee-4eee-8eee-eeeeeeeeeee1', 'rfq.respond'),
  ('e1111111-eeee-4eee-8eee-eeeeeeeeeee1', 'order.manage'),
  ('e1111111-eeee-4eee-8eee-eeeeeeeeeee1', 'project.write'),
  ('e3333333-eeee-4eee-8eee-eeeeeeeeeee3', 'rfq.create'),
  ('e3333333-eeee-4eee-8eee-eeeeeeeeeee3', 'quote.decide'),
  ('e3333333-eeee-4eee-8eee-eeeeeeeeeee3', 'order.create')
on conflict do nothing;

-- ===========================================================================
-- Fixture builder: from a fresh product, produce an ACCEPTED quotation and,
-- optionally, leave one SUBMITTED (not accepted). All steps are plain calls
-- (not assertions) so the plan counts only the invariants under test.
-- ===========================================================================
-- Supplier (A) publishes a product.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select public.create_product('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Marble Slab 120x60','finishing','square_meter');
reset role;
create temp table _p as select id as pid, version as pv from public.products where name='Marble Slab 120x60';
grant select on _p to authenticated, service_role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select public.set_product_published((select pid from _p), true, (select pv from _p));

-- Helper: build an accepted quotation for a titled RFQ; returns nothing (state in tables).
-- We inline the three chains (Q1 happy, Q2 cancel, Q3 submitted-only) to avoid a
-- server-side function that would need its own grants inside the test txn.

-- ---- Chain 1: accepted quotation → happy path -----------------------------
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select public.create_rfq('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Villa marble — Chain 1');
reset role;
create temp table _r1 as select id as rid, version as rv from public.rfqs where title='Villa marble — Chain 1';
grant select on _r1 to authenticated, service_role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select public.add_rfq_item((select rid from _r1), (select pid from _p), 40);
select public.submit_rfq((select rid from _r1), (select rv from _r1));
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select public.create_quotation((select rid from _r1));
reset role;
create temp table _q1 as select
  (select id from public.quotations where rfq_id=(select rid from _r1)) as qid,
  (select version from public.quotations where rfq_id=(select rid from _r1)) as qv,
  (select id from public.quotation_items where quotation_id=(select id from public.quotations where rfq_id=(select rid from _r1))) as qiid;
grant select on _q1 to authenticated, service_role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select public.set_quotation_item_price((select qiid from _q1), 500.00);   -- 40 x 500 = 20000
select public.submit_quotation((select qid from _q1), (select qv from _q1));
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select public.decide_quotation((select qid from _q1), true,
  (select version from public.quotations where id=(select qid from _q1)));   -- accepted

-- ---- Chain 3: submitted-only quotation (never accepted) --------------------
select public.create_rfq('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Villa marble — Chain 3');
reset role;
create temp table _r3 as select id as rid, version as rv from public.rfqs where title='Villa marble — Chain 3';
grant select on _r3 to authenticated, service_role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select public.add_rfq_item((select rid from _r3), (select pid from _p), 10);
select public.submit_rfq((select rid from _r3), (select rv from _r3));
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select public.create_quotation((select rid from _r3));
reset role;
create temp table _q3 as select
  (select id from public.quotations where rfq_id=(select rid from _r3)) as qid,
  (select version from public.quotations where rfq_id=(select rid from _r3)) as qv,
  (select id from public.quotation_items where quotation_id=(select id from public.quotations where rfq_id=(select rid from _r3))) as qiid;
grant select on _q3 to authenticated, service_role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select public.set_quotation_item_price((select qiid from _q3), 100.00);
select public.submit_quotation((select qid from _q3), (select qv from _q3));   -- left SUBMITTED

-- ===========================================================================
-- Direct-DML write boundary (RPC-only)
-- ===========================================================================
select throws_ok(
  $$ insert into public.orders (quotation_id, rfq_id, requester_org_id, supplier_org_id, title, created_by)
     values ((select qid from _q1),(select rid from _r1),
       'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','x',
       '33333333-3333-4333-8333-333333333333') $$,
  '42501', null, 'authenticated cannot INSERT an order directly (RPC-only)');
select throws_ok(
  $$ insert into public.projects (order_id, requester_org_id, executing_org_id, title, created_by)
     values (extensions.gen_random_uuid(),
       'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','x',
       '11111111-1111-4111-8111-111111111111') $$,
  '42501', null, 'authenticated cannot INSERT a project directly (RPC-only)');

-- ===========================================================================
-- Order creation guards
-- ===========================================================================
-- Invalid (not accepted) quotation cannot create an order.
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select throws_ok(
  $$ select public.create_order_from_quotation((select qid from _q3)) $$,
  '22023', null, 'a non-accepted quotation cannot create an order');

-- A non-member (intruder) cannot create the order.
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select throws_ok(
  $$ select public.create_order_from_quotation((select qid from _q1)) $$,
  '42501', null, 'a non-member cannot create an order (cross-tenant denied)');

-- Requester creates the order from the accepted quotation.
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select lives_ok(
  $$ select public.create_order_from_quotation((select qid from _q1)) $$,
  'requester creates an order from the accepted quotation');
reset role;
create temp table _o1 as select id as oid, version as ov from public.orders where quotation_id=(select qid from _q1);
grant select on _o1 to authenticated, service_role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select is((select status::text from public.orders where id=(select oid from _o1)),
  'confirmed', 'a new order starts as confirmed');
select is((select total from public.orders where id=(select oid from _o1)),
  20000.00, 'the order snapshots the accepted quotation total (40 x 500)');
select is((select count(*)::int from public.order_items where order_id=(select oid from _o1)),
  1, 'the order freezes the quotation line(s)');

-- Duplicate order for the same quotation is denied.
select throws_ok(
  $$ select public.create_order_from_quotation((select qid from _q1)) $$,
  '23505', null, 'a second order for the same accepted quotation is denied');

-- Intruder cannot see the order.
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select is((select count(*)::int from public.orders where id=(select oid from _o1)),
  0, 'a non-member of either party cannot see the order (RLS isolation)');

-- ===========================================================================
-- Order lifecycle + project creation gating
-- ===========================================================================
-- The requester (not a supplier member) cannot start the order.
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select throws_ok(
  $$ select public.start_order((select oid from _o1), (select ov from _o1)) $$,
  '42501', null, 'the requester cannot start the order (supplier-only action)');

-- A project cannot be created from a merely-confirmed order (must be started first).
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_ok(
  $$ select public.create_project_from_order((select oid from _o1), 'Too early') $$,
  '22023', null, 'a confirmed (not-yet-started) order cannot create a project');

-- Supplier starts the order.
select lives_ok(
  $$ select public.start_order((select oid from _o1), (select ov from _o1)) $$,
  'the supplier starts the order');
select is((select status::text from public.orders where id=(select oid from _o1)),
  'in_progress', 'the order is now in progress');

-- The requester (not the executing org) cannot create the project.
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select throws_ok(
  $$ select public.create_project_from_order((select oid from _o1), 'Requester project') $$,
  '42501', null, 'the requester cannot create the project (executing-org action)');

-- Supplier creates the project.
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ select public.create_project_from_order((select oid from _o1), 'Maadi villa marble fit-out', 'Maadi, Cairo') $$,
  'the executing org creates the project from the in-progress order');
reset role;
create temp table _prj as select id as prid, version as prv from public.projects where order_id=(select oid from _o1);
grant select on _prj to authenticated, service_role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select is((select status::text from public.projects where id=(select prid from _prj)),
  'planned', 'a new project starts as planned');

-- Exactly one project per order.
select throws_ok(
  $$ select public.create_project_from_order((select oid from _o1), 'Second project') $$,
  '23505', null, 'a second project for the same order is denied');

-- Intruder cannot see the project; the requester (counter-party) can.
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select is((select count(*)::int from public.projects where id=(select prid from _prj)),
  0, 'a non-member of either party cannot see the project (RLS isolation)');
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select is((select count(*)::int from public.projects where id=(select prid from _prj)),
  1, 'the requester (counter-party) can see the project');

-- ===========================================================================
-- Project completion → PROJECT COMPLETED (and the order completes with it)
-- ===========================================================================
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ select public.activate_project((select prid from _prj), (select prv from _prj)) $$,
  'the executing org activates the project');
select is((select status::text from public.projects where id=(select prid from _prj)),
  'active', 'the project is now active');
select lives_ok(
  $$ select public.complete_project((select prid from _prj),
       (select version from public.projects where id=(select prid from _prj))) $$,
  'the executing org completes the project');
select is((select status::text from public.projects where id=(select prid from _prj)),
  'completed', 'PROJECT COMPLETED');
select is((select status::text from public.orders where id=(select oid from _o1)),
  'completed', 'completing the project completes its parent order');
select throws_ok(
  $$ select public.complete_project((select prid from _prj),
       (select version from public.projects where id=(select prid from _prj))) $$,
  '22023', null, 'an already-completed project cannot be completed again');

-- ===========================================================================
-- Audit emission
-- ===========================================================================
reset role;
select is(
  (select count(distinct action)::int from public.audit_log
   where action in ('order.created','order.started','project.created',
                    'project.activated','project.completed','order.completed')),
  6, 'the execution lifecycle emitted its audit events');

-- ===========================================================================
-- Order cancellation (confirmed → cancelled) via a second accepted quotation
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select public.create_rfq('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Villa marble — Chain 2');
reset role;
create temp table _r2 as select id as rid, version as rv from public.rfqs where title='Villa marble — Chain 2';
grant select on _r2 to authenticated, service_role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select public.add_rfq_item((select rid from _r2), (select pid from _p), 5);
select public.submit_rfq((select rid from _r2), (select rv from _r2));
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select public.create_quotation((select rid from _r2));
reset role;
create temp table _q2 as select
  (select id from public.quotations where rfq_id=(select rid from _r2)) as qid,
  (select version from public.quotations where rfq_id=(select rid from _r2)) as qv,
  (select id from public.quotation_items where quotation_id=(select id from public.quotations where rfq_id=(select rid from _r2))) as qiid;
grant select on _q2 to authenticated, service_role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select public.set_quotation_item_price((select qiid from _q2), 100.00);
select public.submit_quotation((select qid from _q2), (select qv from _q2));
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select public.decide_quotation((select qid from _q2), true,
  (select version from public.quotations where id=(select qid from _q2)));
select public.create_order_from_quotation((select qid from _q2));
reset role;
create temp table _o2 as select id as oid from public.orders where quotation_id=(select qid from _q2);
grant select on _o2 to authenticated, service_role;

-- Supplier cancels the confirmed order.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ select public.cancel_order((select oid from _o2)) $$,
  'a party cancels a confirmed order');
select is((select status::text from public.orders where id=(select oid from _o2)),
  'cancelled', 'the order is now cancelled');
select throws_ok(
  $$ select public.start_order((select oid from _o2),
       (select version from public.orders where id=(select oid from _o2))) $$,
  '22023', null, 'a cancelled order cannot be started');

select * from finish();
rollback;
