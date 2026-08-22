-- pgTAP: Notifications Core — MVP event emission wiring.
-- Proves that each approved commerce / verification transition writes exactly the
-- notification the specification maps it to, to exactly the right counterparty,
-- with the approved payload — and that the acting side is never notified.
--
-- The RLS/authorization contracts of the notifications table itself are covered
-- by 31_notifications_core_test.sql and are deliberately not repeated here.
--
-- Fixture roles (shared seed):
--   Org A = 'aaaaaaaa…' (Nile Finishing)  — SUPPLIER / executing side
--     · 11111111 owner  — holds the supplier-side commerce capabilities (actor
--                          for supplier actions, recipient for buyer actions)
--     · 22222222 staff  — active member holding NO commerce capability, so it
--                          proves fan-out is capability-scoped, not org-wide
--   Org B = 'bbbbbbbb…' (Delta Interiors) — REQUESTER / buyer side
--     · 33333333 owner  — holds the buyer-side commerce capabilities
--   user 55555555 = platform administrator (the verification reviewer)
--
-- Org B deliberately has NO project.write holder, so every project.* event also
-- exercises the approved owner fallback in app.notify_org through a real flow.
create extension if not exists pgtap;

begin;
select plan(50);

-- ===========================================================================
-- Capability fixtures
-- ===========================================================================
insert into public.membership_capabilities (membership_id, capability_key) values
  -- Org A — supplier side. 22222222 is granted nothing on purpose.
  ('e1111111-eeee-4eee-8eee-eeeeeeeeeee1', 'catalog.publish'),
  ('e1111111-eeee-4eee-8eee-eeeeeeeeeee1', 'rfq.respond'),
  ('e1111111-eeee-4eee-8eee-eeeeeeeeeee1', 'quote.submit'),
  ('e1111111-eeee-4eee-8eee-eeeeeeeeeee1', 'order.manage'),
  ('e1111111-eeee-4eee-8eee-eeeeeeeeeee1', 'project.write'),
  -- Org B — requester side. project.write is deliberately absent.
  ('e3333333-eeee-4eee-8eee-eeeeeeeeeee3', 'rfq.create'),
  ('e3333333-eeee-4eee-8eee-eeeeeeeeeee3', 'quote.decide'),
  ('e3333333-eeee-4eee-8eee-eeeeeeeeeee3', 'order.create')
on conflict do nothing;

-- A published product to quote against.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select public.create_product('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Marble Slab 120x60','finishing','square_meter');
reset role;
create temp table _p as select id as pid, version as pv from public.products where name='Marble Slab 120x60';
grant select on _p to authenticated, service_role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select public.set_product_published((select pid from _p), true, (select pv from _p));

-- ===========================================================================
-- CHAIN 1 — the full happy lifecycle, asserting emission at every transition.
-- ===========================================================================
-- --- rfq.submitted : actor Org B  ->  recipient Org A / rfq.respond ----------
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select public.create_rfq('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Villa marble — Chain 1');
reset role;
create temp table _r1 as select id as rid, version as rv from public.rfqs where title='Villa marble — Chain 1';
grant select on _r1 to authenticated, service_role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select public.add_rfq_item((select rid from _r1), (select pid from _p), 40);
select public.submit_rfq((select rid from _r1), (select rv from _r1));
reset role;
set local request.jwt.claims = '';

select is(
  (select count(*)::int from public.notifications
   where event_type = 'rfq.submitted' and subject_id = (select rid from _r1)
     and recipient_user_id = '11111111-1111-4111-8111-111111111111'
     and organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  1, 'rfq.submitted notifies the supplier-side rfq.respond holder');

select is(
  (select count(*)::int from public.notifications
   where event_type = 'rfq.submitted' and subject_id = (select rid from _r1)
     and recipient_user_id = '22222222-2222-4222-8222-222222222222'),
  0, 'rfq.submitted does NOT reach a same-org member lacking rfq.respond (capability-scoped fan-out)');

select is(
  (select count(*)::int from public.notifications
   where event_type = 'rfq.submitted' and subject_id = (select rid from _r1)
     and recipient_user_id = '33333333-3333-4333-8333-333333333333'),
  0, 'the RFQ submitter does not receive its own supplier-demand notification');

-- Payload contract for the representative event.
select is(
  (select deep_link from public.notifications
   where event_type = 'rfq.submitted' and subject_id = (select rid from _r1)),
  '/b2b/rfqs/' || (select rid from _r1)::text,
  'rfq.submitted stores the approved relative deep link /b2b/rfqs/{rfq_id}');
select is(
  (select subject_type from public.notifications
   where event_type = 'rfq.submitted' and subject_id = (select rid from _r1)),
  'rfq', 'rfq.submitted stores the approved subject_type');
select is(
  (select title_key from public.notifications
   where event_type = 'rfq.submitted' and subject_id = (select rid from _r1)),
  'notifications.rfq.submitted.title', 'the notification stores a translation key, not rendered text');
select is(
  (select params->>'requester_name' from public.notifications
   where event_type = 'rfq.submitted' and subject_id = (select rid from _r1)),
  'Delta Interiors Studio', 'params carries the counterparty name as an interpolation value');

-- The audit trail is untouched by the addition.
select is(
  (select count(*)::int from public.audit_log
   where action = 'rfq.submitted' and subject_id = (select rid from _r1)),
  1, 'the existing rfq.submitted audit row is still written');

-- --- quotation.submitted : actor Org A  ->  recipient Org B / quote.decide ---
set local role authenticated;
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
reset role;
set local request.jwt.claims = '';

select is(
  (select count(*)::int from public.notifications
   where event_type = 'quotation.submitted' and subject_id = (select qid from _q1)
     and recipient_user_id = '33333333-3333-4333-8333-333333333333'
     and organization_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  1, 'quotation.submitted notifies the requester-side quote.decide holder');
select is(
  (select count(*)::int from public.notifications
   where event_type = 'quotation.submitted' and subject_id = (select qid from _q1)
     and recipient_user_id = '11111111-1111-4111-8111-111111111111'),
  0, 'the quotation submitter does not receive the requester-facing notification');
select is(
  (select deep_link from public.notifications
   where event_type = 'quotation.submitted' and subject_id = (select qid from _q1)),
  '/b2b/quotations/' || (select qid from _q1)::text,
  'quotation.submitted stores /b2b/quotations/{quotation_id}');
select is(
  (select (params->>'total')::numeric from public.notifications
   where event_type = 'quotation.submitted' and subject_id = (select qid from _q1)),
  20000.00, 'quotation.submitted carries the recomputed total, not a pre-pricing figure');

-- --- quotation.accepted : actor Org B  ->  recipient Org A / quote.submit ----
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select public.decide_quotation((select qid from _q1), true,
  (select version from public.quotations where id=(select qid from _q1)));
reset role;
set local request.jwt.claims = '';

select is(
  (select count(*)::int from public.notifications
   where event_type = 'quotation.accepted' and subject_id = (select qid from _q1)
     and recipient_user_id = '11111111-1111-4111-8111-111111111111'
     and organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  1, 'quotation.accepted travels back to the supplier-side quote.submit holder');
select is(
  (select count(*)::int from public.notifications
   where event_type = 'quotation.accepted' and subject_id = (select qid from _q1)
     and recipient_user_id = '33333333-3333-4333-8333-333333333333'),
  0, 'the deciding buyer is not notified of its own decision');

-- --- order.created : actor Org B  ->  recipient Org A / order.manage ---------
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select public.create_order_from_quotation((select qid from _q1));
reset role;
create temp table _o1 as select id as oid, version as ov from public.orders where quotation_id=(select qid from _q1);
grant select on _o1 to authenticated, service_role;
set local request.jwt.claims = '';

select is(
  (select count(*)::int from public.notifications
   where event_type = 'order.created' and subject_id = (select oid from _o1)
     and recipient_user_id = '11111111-1111-4111-8111-111111111111'
     and organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  1, 'order.created reaches the supplier-side order.manage holder');
select is(
  (select deep_link from public.notifications
   where event_type = 'order.created' and subject_id = (select oid from _o1)),
  '/b2b/orders/' || (select oid from _o1)::text,
  'order.created stores /b2b/orders/{order_id}');

-- --- order.started : actor Org A  ->  recipient Org B / order.create ---------
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select public.start_order((select oid from _o1), (select ov from _o1));
reset role;
set local request.jwt.claims = '';

select is(
  (select count(*)::int from public.notifications
   where event_type = 'order.started' and subject_id = (select oid from _o1)
     and recipient_user_id = '33333333-3333-4333-8333-333333333333'
     and organization_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  1, 'order.started informs the buyer side (order.create holder)');
select is(
  (select count(*)::int from public.notifications
   where event_type = 'order.started' and subject_id = (select oid from _o1)
     and recipient_user_id = '11111111-1111-4111-8111-111111111111'),
  0, 'the supplier that started the order is not notified of its own action');

-- --- project.created : actor Org A  ->  recipient Org B, via OWNER FALLBACK --
-- Org B holds no project.write, so the approved fallback delivers to org.manage.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select public.create_project_from_order((select oid from _o1), 'Villa marble execution');
reset role;
create temp table _pr1 as select id as prid, version as prv from public.projects where order_id=(select oid from _o1);
grant select on _pr1 to authenticated, service_role;
set local request.jwt.claims = '';

select is(
  (select count(*)::int from public.notifications
   where event_type = 'project.created' and subject_id = (select prid from _pr1)
     and recipient_user_id = '33333333-3333-4333-8333-333333333333'),
  1, 'project.created reaches the buyer side through the approved owner fallback');
select is(
  (select deep_link from public.notifications
   where event_type = 'project.created' and subject_id = (select prid from _pr1)),
  '/b2b/projects/' || (select prid from _pr1)::text,
  'project.created stores /b2b/projects/{project_id}');

-- --- project.activated ------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select public.activate_project((select prid from _pr1), (select prv from _pr1));
reset role;
set local request.jwt.claims = '';

select is(
  (select count(*)::int from public.notifications
   where event_type = 'project.activated' and subject_id = (select prid from _pr1)
     and recipient_user_id = '33333333-3333-4333-8333-333333333333'
     and organization_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  1, 'project.activated notifies the buyer side');
select is(
  (select count(*)::int from public.notifications
   where event_type = 'project.activated' and subject_id = (select prid from _pr1)
     and recipient_user_id = '11111111-1111-4111-8111-111111111111'),
  0, 'the executing org is not notified of its own activation');

-- --- project.completed AND order.completed, both from complete_project -------
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select public.complete_project((select prid from _pr1),
  (select version from public.projects where id=(select prid from _pr1)));
reset role;
set local request.jwt.claims = '';

select is(
  (select count(*)::int from public.notifications
   where event_type = 'project.completed' and subject_id = (select prid from _pr1)
     and recipient_user_id = '33333333-3333-4333-8333-333333333333'),
  1, 'project.completed notifies the buyer side');
select is(
  (select count(*)::int from public.notifications
   where event_type = 'order.completed' and subject_id = (select oid from _o1)
     and recipient_user_id = '33333333-3333-4333-8333-333333333333'),
  1, 'order.completed is emitted through the ACTUAL complete_project transition');
select is(
  (select deep_link from public.notifications
   where event_type = 'order.completed' and subject_id = (select oid from _o1)),
  '/b2b/orders/' || (select oid from _o1)::text,
  'order.completed points at the ORDER, not at the project that completed it');
select is(
  (select status::text from public.orders where id=(select oid from _o1)),
  'completed', 'the parent order really did complete (the transition is unchanged)');
select is(
  (select count(*)::int from public.audit_log
   where action = 'order.completed' and subject_id = (select oid from _o1)),
  1, 'the existing order.completed audit row is still written');

-- ===========================================================================
-- CHAIN 2 — quotation.rejected
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select public.create_rfq('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Villa marble — Chain 2');
reset role;
create temp table _r2 as select id as rid, version as rv from public.rfqs where title='Villa marble — Chain 2';
grant select on _r2 to authenticated, service_role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select public.add_rfq_item((select rid from _r2), (select pid from _p), 10);
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
select public.decide_quotation((select qid from _q2), false,
  (select version from public.quotations where id=(select qid from _q2)));
reset role;
set local request.jwt.claims = '';

select is(
  (select count(*)::int from public.notifications
   where event_type = 'quotation.rejected' and subject_id = (select qid from _q2)
     and recipient_user_id = '11111111-1111-4111-8111-111111111111'
     and organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  1, 'quotation.rejected travels back to the supplier-side quote.submit holder');
select is(
  (select count(*)::int from public.notifications
   where event_type = 'quotation.rejected' and subject_id = (select qid from _q2)
     and recipient_user_id = '33333333-3333-4333-8333-333333333333'),
  0, 'the rejecting buyer is not notified of its own rejection');

-- ===========================================================================
-- CHAIN 3 — rfq.cancelled
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select public.create_rfq('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Villa marble — Chain 3');
reset role;
create temp table _r3 as select id as rid, version as rv from public.rfqs where title='Villa marble — Chain 3';
grant select on _r3 to authenticated, service_role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select public.add_rfq_item((select rid from _r3), (select pid from _p), 5);
select public.submit_rfq((select rid from _r3), (select rv from _r3));
select public.cancel_rfq((select rid from _r3));
reset role;
set local request.jwt.claims = '';

select is(
  (select count(*)::int from public.notifications
   where event_type = 'rfq.cancelled' and subject_id = (select rid from _r3)
     and recipient_user_id = '11111111-1111-4111-8111-111111111111'),
  1, 'rfq.cancelled notifies the supplier side that pending work is moot');

-- ===========================================================================
-- CHAIN 4 — order.cancelled BY THE BUYER  -> the supplier side is told
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select public.create_rfq('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Villa marble — Chain 4');
reset role;
create temp table _r4 as select id as rid, version as rv from public.rfqs where title='Villa marble — Chain 4';
grant select on _r4 to authenticated, service_role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select public.add_rfq_item((select rid from _r4), (select pid from _p), 7);
select public.submit_rfq((select rid from _r4), (select rv from _r4));
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select public.create_quotation((select rid from _r4));
reset role;
create temp table _q4 as select
  (select id from public.quotations where rfq_id=(select rid from _r4)) as qid,
  (select version from public.quotations where rfq_id=(select rid from _r4)) as qv,
  (select id from public.quotation_items where quotation_id=(select id from public.quotations where rfq_id=(select rid from _r4))) as qiid;
grant select on _q4 to authenticated, service_role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select public.set_quotation_item_price((select qiid from _q4), 200.00);
select public.submit_quotation((select qid from _q4), (select qv from _q4));
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select public.decide_quotation((select qid from _q4), true,
  (select version from public.quotations where id=(select qid from _q4)));
select public.create_order_from_quotation((select qid from _q4));
reset role;
create temp table _o4 as select id as oid, version as ov from public.orders where quotation_id=(select qid from _q4);
grant select on _o4 to authenticated, service_role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select public.cancel_order((select oid from _o4));   -- BUYER cancels
reset role;
set local request.jwt.claims = '';

select is(
  (select count(*)::int from public.notifications
   where event_type = 'order.cancelled' and subject_id = (select oid from _o4)
     and recipient_user_id = '11111111-1111-4111-8111-111111111111'
     and organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  1, 'when the BUYER cancels, the supplier side is the resolved counterparty');
select is(
  (select count(*)::int from public.notifications
   where event_type = 'order.cancelled' and subject_id = (select oid from _o4)
     and recipient_user_id = '33333333-3333-4333-8333-333333333333'),
  0, 'the cancelling buyer is not notified of its own cancellation');
select is(
  (select params->>'actor_name' from public.notifications
   where event_type = 'order.cancelled' and subject_id = (select oid from _o4)),
  'Delta Interiors Studio', 'order.cancelled names the party that cancelled');

-- ===========================================================================
-- CHAIN 5 — order.cancelled BY THE SUPPLIER -> the buyer side is told.
-- The same RPC must resolve the OPPOSITE recipient purely from who acted.
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select public.create_rfq('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Villa marble — Chain 5');
reset role;
create temp table _r5 as select id as rid, version as rv from public.rfqs where title='Villa marble — Chain 5';
grant select on _r5 to authenticated, service_role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select public.add_rfq_item((select rid from _r5), (select pid from _p), 3);
select public.submit_rfq((select rid from _r5), (select rv from _r5));
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select public.create_quotation((select rid from _r5));
reset role;
create temp table _q5 as select
  (select id from public.quotations where rfq_id=(select rid from _r5)) as qid,
  (select version from public.quotations where rfq_id=(select rid from _r5)) as qv,
  (select id from public.quotation_items where quotation_id=(select id from public.quotations where rfq_id=(select rid from _r5))) as qiid;
grant select on _q5 to authenticated, service_role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select public.set_quotation_item_price((select qiid from _q5), 300.00);
select public.submit_quotation((select qid from _q5), (select qv from _q5));
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select public.decide_quotation((select qid from _q5), true,
  (select version from public.quotations where id=(select qid from _q5)));
select public.create_order_from_quotation((select qid from _q5));
reset role;
create temp table _o5 as select id as oid, version as ov from public.orders where quotation_id=(select qid from _q5);
grant select on _o5 to authenticated, service_role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select public.cancel_order((select oid from _o5));   -- SUPPLIER cancels
reset role;
set local request.jwt.claims = '';

select is(
  (select count(*)::int from public.notifications
   where event_type = 'order.cancelled' and subject_id = (select oid from _o5)
     and recipient_user_id = '33333333-3333-4333-8333-333333333333'
     and organization_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  1, 'when the SUPPLIER cancels, the buyer side is the resolved counterparty');
select is(
  (select count(*)::int from public.notifications
   where event_type = 'order.cancelled' and subject_id = (select oid from _o5)
     and recipient_user_id = '11111111-1111-4111-8111-111111111111'),
  0, 'the cancelling supplier is not notified of its own cancellation');
select is(
  (select params->>'actor_name' from public.notifications
   where event_type = 'order.cancelled' and subject_id = (select oid from _o5)),
  'Nile Finishing Supplies', 'the same RPC names whichever party actually cancelled');

-- ===========================================================================
-- CHAIN 6 — a FAILED transition leaves no notification behind
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select public.create_rfq('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Villa marble — Chain 6');
reset role;
create temp table _r6 as select id as rid, version as rv from public.rfqs where title='Villa marble — Chain 6';
grant select on _r6 to authenticated, service_role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select public.add_rfq_item((select rid from _r6), (select pid from _p), 2);

-- A stale expected_version aborts the whole transition.
select throws_ok(
  $$ select public.submit_rfq((select rid from _r6), 999) $$,
  '40001', null, 'a concurrent-modification guard still aborts submit_rfq');

reset role;
set local request.jwt.claims = '';
select is(
  (select count(*)::int from public.notifications
   where event_type = 'rfq.submitted' and subject_id = (select rid from _r6)),
  0, 'a failed business transition leaves NO notification behind (same transaction)');
select is(
  (select status::text from public.rfqs where id = (select rid from _r6)),
  'draft', 'the failed transition also left the RFQ unchanged');

-- ===========================================================================
-- CHAIN 7 — organization verification decisions.
-- The actor is a PLATFORM reviewer, never a member of the org under review, so
-- the notice addresses the organization being verified via org.manage.
-- ===========================================================================
insert into public.verifications
  (id, subject_type, organization_id, verification_type, status, reviewer_id)
values
  ('99999999-0000-4000-8000-00000000000a', 'organization',
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'organization', 'under_review',
   '55555555-5555-4555-8555-555555555555'),
  ('99999999-0000-4000-8000-00000000000b', 'organization',
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'organization', 'under_review',
   '55555555-5555-4555-8555-555555555555'),
  ('99999999-0000-4000-8000-00000000000c', 'organization',
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'organization', 'under_review',
   '55555555-5555-4555-8555-555555555555');

set local role authenticated;
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select public.review_approve('99999999-0000-4000-8000-00000000000a', false);
select public.review_reject('99999999-0000-4000-8000-00000000000b', 'Trade licence is illegible.');
select public.review_request_changes('99999999-0000-4000-8000-00000000000c', 'Please re-upload page 2.');
reset role;
set local request.jwt.claims = '';

select is(
  (select count(*)::int from public.notifications
   where event_type = 'verification.approved'
     and subject_id = '99999999-0000-4000-8000-00000000000a'
     and recipient_user_id = '33333333-3333-4333-8333-333333333333'
     and organization_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  1, 'verification.approved notifies the org.manage holder of the verified organization');
select is(
  (select count(*)::int from public.notifications
   where event_type = 'verification.rejected'
     and subject_id = '99999999-0000-4000-8000-00000000000b'
     and recipient_user_id = '33333333-3333-4333-8333-333333333333'),
  1, 'verification.rejected notifies the organization being verified');
select is(
  (select count(*)::int from public.notifications
   where event_type = 'verification.changes_requested'
     and subject_id = '99999999-0000-4000-8000-00000000000c'
     and recipient_user_id = '33333333-3333-4333-8333-333333333333'),
  1, 'verification.changes_requested notifies the organization being verified');
select is(
  (select deep_link from public.notifications
   where event_type = 'verification.approved'
     and subject_id = '99999999-0000-4000-8000-00000000000a'),
  '/b2b/organization', 'verification notices use the approved /b2b/organization route');
select is(
  (select count(*)::int from public.notifications
   where subject_type = 'verification'
     and recipient_user_id = '55555555-5555-4555-8555-555555555555'),
  0, 'the platform reviewer is never notified of its own decision');
select is(
  (select count(*)::int from public.notifications
   where subject_id = '99999999-0000-4000-8000-00000000000b'
     and params::text like '%illegible%'),
  0, 'the free-text rejection reason is not copied into notification params');
select is(
  (select count(*)::int from public.audit_log
   where action = 'verification.approved'
     and subject_id = '99999999-0000-4000-8000-00000000000a'),
  1, 'the existing verification.approved audit row is still written');

-- ===========================================================================
-- CHAIN 8 — individual actor suppression inside a capability fan-out.
-- One person may hold memberships in both parties (a real pilot case). When the
-- actor is themselves a capability holder in the RECIPIENT org, app.notify
-- suppresses only that person, while other holders still receive the notice.
-- ===========================================================================
insert into public.memberships (id, user_id, organization_id, status, accepted_at)
values ('e9999999-eeee-4eee-8eee-eeeeeeeeeee9',
        '33333333-3333-4333-8333-333333333333',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'active', now())
on conflict do nothing;
insert into public.membership_capabilities (membership_id, capability_key)
values ('e9999999-eeee-4eee-8eee-eeeeeeeeeee9', 'rfq.respond')
on conflict do nothing;

set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select public.create_rfq('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Villa marble — Chain 8');
reset role;
create temp table _r8 as select id as rid, version as rv from public.rfqs where title='Villa marble — Chain 8';
grant select on _r8 to authenticated, service_role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select public.add_rfq_item((select rid from _r8), (select pid from _p), 1);
select public.submit_rfq((select rid from _r8), (select rv from _r8));
reset role;
set local request.jwt.claims = '';

select is(
  (select count(*)::int from public.notifications
   where event_type = 'rfq.submitted' and subject_id = (select rid from _r8)
     and recipient_user_id = '33333333-3333-4333-8333-333333333333'),
  0, 'the actor is suppressed even when they hold the capability in the recipient org');
select is(
  (select count(*)::int from public.notifications
   where event_type = 'rfq.submitted' and subject_id = (select rid from _r8)
     and recipient_user_id = '11111111-1111-4111-8111-111111111111'),
  1, 'the other capability holder still receives the notice');

-- ===========================================================================
-- Global invariant: the member holding no commerce capability received nothing
-- across every chain above.
-- ===========================================================================
select is(
  (select count(*)::int from public.notifications
   where recipient_user_id = '22222222-2222-4222-8222-222222222222'),
  0, 'a member holding no commerce capability received no notification at all');

-- Every notification written by this suite carries a relative deep link.
select is(
  (select count(*)::int from public.notifications where deep_link !~ '^/[A-Za-z0-9/_-]*$'),
  0, 'every emitted deep link satisfies the approved relative-path contract');

select * from finish();
rollback;
