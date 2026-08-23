-- pgTAP: Transactional Chat Core — conversations, messages, read state.
-- Authority: docs/database/chat-core.md (approved 2026-08-23).
--
-- Proves the security contract of the first persisted messaging model:
--   • a conversation is a PROPERTY OF A TRANSACTION — both party organizations
--     are derived from the authoritative subject row and no RPC accepts an
--     organization id, so a caller can neither fabricate parties nor re-anchor
--     a conversation onto an unrelated subject;
--   • Chat is NOT a side channel: a DRAFT rfq/quotation cannot be used to open a
--     channel, because that would disclose the subject's existence and id to the
--     counterparty before the commerce policies allow it (the `visible` gate);
--   • access is derived from ACTIVE membership + conversation.participate in a
--     party org — so a colleague holding it reads the full prior history
--     (deliberately unlike Notifications), and a colleague lacking it sees
--     nothing at all;
--   • losing membership OR the capability closes conversations, messages AND the
--     user's own read-state rows in the same statement, with no cleanup job —
--     and restoring access brings the read pointer back unchanged;
--   • sender_user_id / sender_organization_id are derived and unspoofable;
--   • messages are append-only to product clients.
--
-- NOT covered here, because this increment deliberately does not build them:
-- Chat UI, Realtime, Points,
-- attachments, reactions, editing, deletion, typing, presence, consumer DMs.
--
-- Fixtures come from the shared seed, plus one extra organization built here:
--   Org A = 'aaaaaaaa…' (Nile Finishing)  — SUPPLIER side; owner 11111111,
--                                            staff 22222222 (the COLLEAGUE)
--   Org B = 'bbbbbbbb…' (Delta Interiors) — REQUESTER side; owner 33333333
--   Org C = 'ccccffff…' (built below)     — UNRELATED tenant; member 44444444,
--                                            holding conversation.participate in
--                                            ITS OWN org — which must grant it
--                                            nothing here
--   user 55555555 = platform administrator (must NOT gain a chat read path)
create extension if not exists pgtap;

begin;
select plan(106);

-- ===========================================================================
-- Fixtures
-- ===========================================================================
-- Commerce capabilities, so the RFQ → quotation → order chain can be built by
-- the real RPCs rather than by hand (mirrors 24_orders_projects_test.sql).
insert into public.membership_capabilities (membership_id, capability_key) values
  ('e1111111-eeee-4eee-8eee-eeeeeeeeeee1', 'catalog.publish'),
  ('e1111111-eeee-4eee-8eee-eeeeeeeeeee1', 'rfq.respond'),
  ('e1111111-eeee-4eee-8eee-eeeeeeeeeee1', 'order.manage'),
  ('e3333333-eeee-4eee-8eee-eeeeeeeeeee3', 'rfq.create'),
  ('e3333333-eeee-4eee-8eee-eeeeeeeeeee3', 'quote.decide'),
  ('e3333333-eeee-4eee-8eee-eeeeeeeeeee3', 'order.create')
on conflict do nothing;

-- Chat capability for ONE holder on each side of the transaction. The Org A
-- STAFF member (22222222) is deliberately left WITHOUT it for now: the first
-- colleague assertions below prove that an active same-org membership alone
-- grants nothing, and the capability is granted to them later to prove that a
-- newly authorised colleague inherits the whole earlier history.
insert into public.membership_capabilities (membership_id, capability_key) values
  ('e1111111-eeee-4eee-8eee-eeeeeeeeeee1', 'conversation.participate'),
  ('e3333333-eeee-4eee-8eee-eeeeeeeeeee3', 'conversation.participate')
on conflict do nothing;

-- Org C — an unrelated tenant whose member holds conversation.participate in its
-- OWN organization. This is the fixture that proves the capability is not an
-- ambient permission: it must match one of the CONVERSATION's two party columns.
insert into public.organizations (id, name, slug, org_type, status, is_verified, primary_locale, created_by)
values ('ccccffff-cccc-4ccc-8ccc-cccccccccccc', 'Gamma Contracting', 'gamma-contracting',
        'contractor_company', 'active', true, 'en', '44444444-4444-4444-8444-444444444444');
insert into public.memberships (id, user_id, organization_id, primary_branch_id, status, accepted_at)
values ('e4444444-eeee-4eee-8eee-eeeeeeeeeee4', '44444444-4444-4444-8444-444444444444',
        'ccccffff-cccc-4ccc-8ccc-cccccccccccc', null, 'active', now());
insert into public.membership_capabilities (membership_id, capability_key)
values ('e4444444-eeee-4eee-8eee-eeeeeeeeeee4', 'conversation.participate');

-- ---- The commercial spine -------------------------------------------------
-- Supplier (A) publishes a product.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select public.create_product('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Chat Fixture Marble','finishing','square_meter');
reset role;
create temp table _p as select id as pid, version as pv from public.products where name='Chat Fixture Marble';
grant select on _p to authenticated, service_role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select public.set_product_published((select pid from _p), true, (select pv from _p));

-- Chain 1: submitted RFQ → submitted quotation → accepted → ORDER.
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select public.create_rfq('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Chat chain 1');
reset role;
create temp table _r1 as select id as rid, version as rv from public.rfqs where title='Chat chain 1';
grant select on _r1 to authenticated, service_role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select public.add_rfq_item((select rid from _r1), (select pid from _p), 25);
select public.submit_rfq((select rid from _r1), (select rv from _r1));
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select public.create_quotation((select rid from _r1));
reset role;
create temp table _q1 as select
  (select id from public.quotations where rfq_id=(select rid from _r1)) as qid,
  (select version from public.quotations where rfq_id=(select rid from _r1)) as qv,
  (select id from public.quotation_items
     where quotation_id=(select id from public.quotations where rfq_id=(select rid from _r1))) as qiid;
grant select on _q1 to authenticated, service_role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select public.set_quotation_item_price((select qiid from _q1), 400.00);
select public.submit_quotation((select qid from _q1), (select qv from _q1));
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select public.decide_quotation((select qid from _q1), true,
  (select version from public.quotations where id=(select qid from _q1)));
select public.create_order_from_quotation((select qid from _q1));
reset role;
create temp table _o1 as select id as oid from public.orders where quotation_id=(select qid from _q1);
grant select on _o1 to authenticated, service_role;

-- Chain 2: an RFQ left in DRAFT — the visibility-gate fixture.
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select public.create_rfq('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Chat chain 2 draft');
reset role;
create temp table _r2 as select id as rid from public.rfqs where title='Chat chain 2 draft';
grant select on _r2 to authenticated, service_role;

-- Chain 3: submitted RFQ with a quotation left in DRAFT — the supplier-side
-- mirror of the same gate.
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select public.create_rfq('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Chat chain 3');
reset role;
create temp table _r3 as select id as rid, version as rv from public.rfqs where title='Chat chain 3';
grant select on _r3 to authenticated, service_role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select public.add_rfq_item((select rid from _r3), (select pid from _p), 5);
select public.submit_rfq((select rid from _r3), (select rv from _r3));
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select public.create_quotation((select rid from _r3));
reset role;
create temp table _q3 as select id as qid from public.quotations where rfq_id=(select rid from _r3);
grant select on _q3 to authenticated, service_role;

-- ===========================================================================
-- 1. Conversation creation — parties are DERIVED, never supplied
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select isnt(
  (select public.open_conversation('order', (select oid from _o1))),
  null, 'a requester-side capability holder opens the ORDER conversation');
reset role;
set local request.jwt.claims = '';
create temp table _co as select id as cid from public.conversations
  where subject_type='order' and subject_id=(select oid from _o1);
grant select on _co to authenticated, service_role;

select is(
  (select count(*)::int from public.conversations where subject_id=(select oid from _o1)),
  1, 'exactly one conversation row exists for the order');
select is(
  (select requester_org_id from public.conversations where id=(select cid from _co)),
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,
  'requester_org_id is derived from the ORDER row, not from the caller');
select is(
  (select supplier_org_id from public.conversations where id=(select cid from _co)),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
  'supplier_org_id is derived from the ORDER row, not from the caller');
select ok(
  (select last_message_at is null from public.conversations where id=(select cid from _co)),
  'a freshly opened conversation has no last_message_at');

-- The audit trail records the opening exactly once, against the caller's own
-- party organization.
select is(
  (select count(*)::int from public.audit_log
   where action='conversation.opened' and subject_id=(select cid from _co)),
  1, 'conversation.opened is written to the audit trail on first creation');
select is(
  (select subject_type from public.audit_log
   where action='conversation.opened' and subject_id=(select cid from _co)),
  'conversation', 'the audit row is subject_type = conversation');
select is(
  (select organization_id from public.audit_log
   where action='conversation.opened' and subject_id=(select cid from _co)),
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,
  'the audit row is attributed to the OPENER''s own party organization');
select is(
  (select metadata->>'subject_type' from public.audit_log
   where action='conversation.opened' and subject_id=(select cid from _co)),
  'order', 'the audit metadata carries the commercial subject type');

-- Idempotence: opening again returns the SAME row and writes NO second audit row.
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select is(
  (select public.open_conversation('order', (select oid from _o1))),
  (select cid from _co), 'opening the same subject again returns the SAME conversation');
-- …including from the OTHER side of the transaction, which must not fork a thread.
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select is(
  (select public.open_conversation('order', (select oid from _o1))),
  (select cid from _co),
  'the counterparty opening the same subject joins the SAME conversation, never a second one');
reset role;
set local request.jwt.claims = '';
select is(
  (select count(*)::int from public.conversations where subject_id=(select oid from _o1)),
  1, 'repeated opens never produce a duplicate conversation (uq_conversations_subject)');
select is(
  (select count(*)::int from public.audit_log
   where action='conversation.opened' and subject_id=(select cid from _co)),
  1, 're-opening writes NO second audit row — nothing changed');

-- Concurrency, as far as a single pgTAP transaction can prove it: the uniqueness
-- rule is enforced by an INDEX, not by a read-then-write race in the RPC, so a
-- direct duplicate insert is refused by the database itself (23505).
select throws_ok(
  $$ insert into public.conversations
       (subject_type, subject_id, requester_org_id, supplier_org_id, created_by)
     values ('order', (select oid from _o1),
             'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
             '33333333-3333-4333-8333-333333333333') $$,
  '23505', null,
  'a second conversation for the same subject is refused by uq_conversations_subject');

-- The other two subject types resolve their own parties.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select isnt(
  (select public.open_conversation('rfq', (select rid from _r1))),
  null, 'a supplier-side capability holder opens the RFQ conversation');
select isnt(
  (select public.open_conversation('quotation', (select qid from _q1))),
  null, 'the QUOTATION conversation opens on its own subject row');
reset role;
set local request.jwt.claims = '';
create temp table _cr as select id as cid from public.conversations
  where subject_type='rfq' and subject_id=(select rid from _r1);
grant select on _cr to authenticated, service_role;
select is(
  (select count(*)::int from public.conversations
   where subject_type='quotation' and subject_id=(select qid from _q1)
     and requester_org_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
     and supplier_org_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  1, 'the quotation conversation derives both parties from the QUOTATION row');

-- ===========================================================================
-- 2. The RFQ visibility gate — Chat must not leak what RLS hides
-- ===========================================================================
-- The requester OWNS the draft and can see it; opening a channel on it would
-- disclose the RFQ's existence and id to the supplier before submission.
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select throws_ok(
  $$ select public.open_conversation('rfq', (select rid from _r2)) $$,
  '22023', null,
  'a DRAFT rfq cannot be used to open a channel to the supplier (the visible gate)');
reset role;
set local request.jwt.claims = '';
select is(
  (select count(*)::int from public.conversations where subject_id=(select rid from _r2)),
  0, 'the rejected draft-rfq open created no conversation row at all');

-- The same gate on the supplier side: a DRAFT quotation is private until submitted.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_ok(
  $$ select public.open_conversation('quotation', (select qid from _q3)) $$,
  '22023', null,
  'a DRAFT quotation cannot be used to open a channel to the requester');

-- ===========================================================================
-- 3. Subject validation — the discriminator is an access-control key
-- ===========================================================================
select throws_ok(
  $$ select public.open_conversation('project', (select oid from _o1)) $$,
  '22023', null,
  'project is NOT a chat subject type in the Pilot (the parent order carries the thread)');
select throws_ok(
  $$ select public.open_conversation('lead', extensions.gen_random_uuid()) $$,
  '22023', null, 'an arbitrary subject_type outside the allow-list is rejected');
select throws_ok(
  $$ select public.open_conversation('order', extensions.gen_random_uuid()) $$,
  null, null, 'a random uuid as the subject is a not-found error');
-- A real id of the WRONG type must not resolve: subject_type selects the table.
select throws_ok(
  $$ select public.open_conversation('rfq', (select oid from _o1)) $$,
  null, null, 'an ORDER id passed as an rfq subject does not resolve');
reset role;
set local request.jwt.claims = '';
select is(
  (select count(*)::int from public.conversations),
  3, 'every rejected open left the conversation count untouched (order, rfq, quotation only)');

-- ===========================================================================
-- 4. Unrelated tenants — knowing a uuid grants nothing
-- ===========================================================================
-- Org C's member holds conversation.participate in ITS OWN org. That must match
-- neither party column of an A–B conversation.
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select throws_ok(
  $$ select public.open_conversation('order', (select oid from _o1)) $$,
  '42501', null,
  'an unrelated organization cannot open a conversation on someone else''s order');
select is(
  (select count(*)::int from public.conversations where id=(select cid from _co)),
  0, 'an unrelated organization cannot SELECT the conversation by its known uuid');
select throws_ok(
  $$ select public.mark_conversation_read((select cid from _co)) $$,
  '42501', null, 'an unrelated organization cannot mark the conversation read');
select throws_ok(
  $$ select public.send_message((select cid from _co), 'let me in') $$,
  '42501', null, 'an unrelated organization cannot send into the conversation');

-- ===========================================================================
-- 5. The colleague rule — the capability is the whole line
-- ===========================================================================
-- The Org A STAFF member has an ACTIVE membership in a party organization but
-- does NOT hold conversation.participate. Active membership alone grants nothing.
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select is(
  (select count(*)::int from public.conversations where id=(select cid from _co)),
  0, 'a same-org colleague WITHOUT conversation.participate cannot read the conversation');
select throws_ok(
  $$ select public.send_message((select cid from _co), 'hello from an unauthorised colleague') $$,
  '42501', null, 'a party-org member lacking the capability cannot send');
select throws_ok(
  $$ select public.mark_conversation_read((select cid from _co)) $$,
  '42501', null, 'a party-org member lacking the capability cannot mark read');

-- Platform support gets NO chat read path. The assertion is only meaningful
-- because the SAME administrator can read the underlying commercial record —
-- proving the absence of a conversations_select_platform policy is deliberate.
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select is(
  (select count(*)::int from public.rfqs where id=(select rid from _r1)),
  1, 'a platform administrator CAN read the commercial record (rfqs_select_platform)');
select is(
  (select count(*)::int from public.conversations),
  0, 'a platform administrator has NO conversation read path (no *_select_platform policy)');
select is(
  (select count(*)::int from public.messages),
  0, 'a platform administrator has no message read path either');

-- ===========================================================================
-- 6. Sending — identity is derived on both axes
-- ===========================================================================
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select isnt(
  (select public.send_message((select cid from _co), '  When can you deliver the marble?  ')),
  null, 'a requester-side participant sends a message');
select is(
  (select count(*)::int from public.messages where conversation_id=(select cid from _co)),
  1, 'the message is persisted against the right conversation');
select is(
  (select body from public.messages where conversation_id=(select cid from _co)),
  'When can you deliver the marble?',
  'the body is stored trimmed and otherwise byte-identical');
select is(
  (select sender_user_id from public.messages where conversation_id=(select cid from _co)),
  '33333333-3333-4333-8333-333333333333'::uuid,
  'sender_user_id is derived from auth.uid() — it is not a parameter');
select is(
  (select sender_organization_id from public.messages where conversation_id=(select cid from _co)),
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'::uuid,
  'sender_organization_id is resolved to the CALLER''s own party org');
select ok(
  (select last_message_at is not null from public.conversations where id=(select cid from _co)),
  'send_message advanced conversations.last_message_at in the same transaction');

-- The supplier side sends, and BOTH derived identity columns differ accordingly.
-- Two callers, two identities, neither supplied: this is the anti-spoofing proof.
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select isnt(
  (select public.send_message((select cid from _co), 'Fourteen days from confirmation.')),
  null, 'a supplier-side participant sends into the same thread');
select is(
  (select sender_user_id from public.messages
   where conversation_id=(select cid from _co) and body='Fourteen days from confirmation.'),
  '11111111-1111-4111-8111-111111111111'::uuid,
  'the second sender''s user id is their own — identity cannot be spoofed');
select is(
  (select sender_organization_id from public.messages
   where conversation_id=(select cid from _co) and body='Fourteen days from confirmation.'),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
  'the second sender''s organization resolves to the OTHER party — never supplied');

-- Body validation.
select throws_ok(
  $$ select public.send_message((select cid from _co), '') $$,
  '22023', null, 'an empty message is rejected');
select throws_ok(
  $$ select public.send_message((select cid from _co), '   ') $$,
  '22023', null, 'a whitespace-only message is rejected');
select throws_ok(
  $$ select public.send_message((select cid from _co), E'\n\t  \r ') $$,
  '22023', null, 'a message of only newlines and tabs is rejected');
select throws_ok(
  $$ select public.send_message((select cid from _co), repeat('x', 4001)) $$,
  '22023', null, 'a 4001-character message is rejected');
select isnt(
  (select public.send_message((select cid from _co), repeat('y', 4000))),
  null, 'a 4000-character message is accepted (the bound is inclusive)');

-- Arabic is stored verbatim: no normalisation, no translation, no keying.
select isnt(
  (select public.send_message((select cid from _co), 'متى يمكنكم التسليم؟')),
  null, 'an Arabic message is accepted');
select is(
  (select count(*)::int from public.messages
   where conversation_id=(select cid from _co) and body='متى يمكنكم التسليم؟'),
  1, 'the Arabic body is stored byte-identical — never translated or keyed');

-- Chronological ordering. Every message sent above carries the SAME created_at,
-- because now() is the TRANSACTION timestamp and pgTAP runs the whole suite in
-- one transaction — so `order by created_at` would tie on all four rows and fall
-- through to the random-uuid tiebreak, which is exactly what a naive assertion
-- here would silently test instead. The timestamps are therefore stamped apart
-- so the ordering contract is observable at all: the rows and their send order
-- are real, only the clock is simulated.
reset role;
set local request.jwt.claims = '';
update public.messages set created_at = timestamptz '2026-03-01 09:00:00+00'
  where conversation_id=(select cid from _co) and body='When can you deliver the marble?';
update public.messages set created_at = timestamptz '2026-03-01 09:05:00+00'
  where conversation_id=(select cid from _co) and body='Fourteen days from confirmation.';
update public.messages set created_at = timestamptz '2026-03-01 09:10:00+00'
  where conversation_id=(select cid from _co) and body=repeat('y', 4000);
update public.messages set created_at = timestamptz '2026-03-01 09:15:00+00'
  where conversation_id=(select cid from _co) and body='متى يمكنكم التسليم؟';
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select is(
  (select body from public.messages
   where conversation_id=(select cid from _co)
   order by created_at asc, id asc limit 1),
  'When can you deliver the marble?',
  'the oldest message reads back first — messages are chronological');
select is(
  (select body from public.messages
   where conversation_id=(select cid from _co)
   order by created_at desc, id desc limit 1),
  'متى يمكنكم التسليم؟',
  'the newest reads back first under ix_messages_conversation''s desc ordering');

-- ===========================================================================
-- 7. Immutability and the write boundary — no client DML on any of the three
-- ===========================================================================
select throws_ok(
  $$ insert into public.messages (conversation_id, sender_user_id, sender_organization_id, body)
     values ((select cid from _co), '11111111-1111-4111-8111-111111111111',
             'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'forged') $$,
  '42501', null, 'a participant cannot INSERT a message directly (RPC-only)');
select throws_ok(
  $$ update public.messages set body = 'rewritten' where conversation_id=(select cid from _co) $$,
  '42501', null, 'a participant cannot UPDATE a sent message — history is append-only');
select throws_ok(
  $$ delete from public.messages where conversation_id=(select cid from _co) $$,
  '42501', null, 'a participant cannot DELETE a sent message');
select throws_ok(
  $$ update public.conversations set supplier_org_id='ccccffff-cccc-4ccc-8ccc-cccccccccccc'
     where id=(select cid from _co) $$,
  '42501', null, 'a participant cannot re-anchor a conversation onto another organization');
select throws_ok(
  $$ delete from public.conversations where id=(select cid from _co) $$,
  '42501', null, 'a participant cannot DELETE a conversation');
select throws_ok(
  $$ insert into public.conversation_read_state (conversation_id, user_id, last_read_at)
     values ((select cid from _co), '33333333-3333-4333-8333-333333333333', now()) $$,
  '42501', null, 'a participant cannot INSERT read state directly (RPC-only)');
select throws_ok(
  $$ update public.conversation_read_state set last_read_at = now() $$,
  '42501', null, 'a participant cannot UPDATE read state directly');
select throws_ok(
  $$ delete from public.conversation_read_state $$,
  '42501', null, 'a participant cannot DELETE read state');

-- ===========================================================================
-- 8. A newly authorised colleague inherits the whole history
-- ===========================================================================
reset role;
set local request.jwt.claims = '';
insert into public.membership_capabilities (membership_id, capability_key)
values ('e2222222-eeee-4eee-8eee-eeeeeeeeeee2', 'conversation.participate');

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select is(
  (select count(*)::int from public.conversations where id=(select cid from _co)),
  1, 'a newly authorised colleague can now read the conversation');
select is(
  (select count(*)::int from public.messages where conversation_id=(select cid from _co)),
  4, 'the newly authorised colleague sees the FULL earlier history, from the first message');
select is(
  (select count(*)::int from public.messages
   where conversation_id=(select cid from _co)
     and body='When can you deliver the marble?'),
  1, 'including messages sent before they were authorised');

-- ===========================================================================
-- 9. Read state — owner-only, AND only while parent access lasts
-- ===========================================================================
-- The colleague establishes a read pointer while their access is live.
select lives_ok(
  $$ select public.mark_conversation_read((select cid from _co)) $$,
  'a participant marks the conversation read');
select is(
  (select count(*)::int from public.conversation_read_state
   where conversation_id=(select cid from _co)
     and user_id='22222222-2222-4222-8222-222222222222'),
  1, 'the caller can read their OWN read-state row while access is live');

-- Pin the pointer to a distinctive value, so every later assertion can prove the
-- row is RETAINED rather than rewritten or destroyed.
reset role;
set local request.jwt.claims = '';
update public.conversation_read_state set last_read_at = timestamptz '2026-01-02 03:04:05+00'
where conversation_id=(select cid from _co)
  and user_id='22222222-2222-4222-8222-222222222222';

-- Idempotence and monotonicity. A pointer already AHEAD of now() must not be
-- dragged backwards by a replayed call — that would resurrect unread badges.
update public.conversation_read_state set last_read_at = timestamptz '2099-01-01 00:00:00+00'
where conversation_id=(select cid from _co)
  and user_id='33333333-3333-4333-8333-333333333333';
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select lives_ok(
  $$ select public.mark_conversation_read((select cid from _co)) $$,
  'mark_conversation_read is safe to call again');
select is(
  (select last_read_at from public.conversation_read_state
   where conversation_id=(select cid from _co)
     and user_id='33333333-3333-4333-8333-333333333333'),
  timestamptz '2099-01-01 00:00:00+00',
  'greatest() keeps the pointer monotonic — a repeat call never moves it backwards');
select is(
  (select count(*)::int from public.conversation_read_state
   where conversation_id=(select cid from _co)
     and user_id='33333333-3333-4333-8333-333333333333'),
  1, 'repeated mark-read upserts one row, never a duplicate');

-- Read state is private to its owner, even between two colleagues who can BOTH
-- read the conversation. When a colleague last read a thread is nobody's business.
select is(
  (select count(*)::int from public.conversation_read_state
   where user_id='22222222-2222-4222-8222-222222222222'),
  0, 'a participant cannot see a COLLEAGUE''s read-state row (no read receipts)');
select is(
  (select count(*)::int from public.conversation_read_state),
  1, 'a participant sees exactly one read-state row: their own');

-- ===========================================================================
-- 10. Losing access closes every surface in the same statement
-- ===========================================================================
reset role;
set local request.jwt.claims = '';
update public.memberships set status='suspended'
where id='e2222222-eeee-4eee-8eee-eeeeeeeeeee2';

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select is(
  (select count(*)::int from public.conversations where id=(select cid from _co)),
  0, 'a SUSPENDED membership loses the conversation immediately');
select is(
  (select count(*)::int from public.messages where conversation_id=(select cid from _co)),
  0, 'the messages go with it — parent visibility fails');
select is(
  (select count(*)::int from public.conversation_read_state),
  0, 'their OWN read-state row is invisible too — ownership alone is not enough');
select throws_ok(
  $$ select public.mark_conversation_read((select cid from _co)) $$,
  '42501', null, 'a suspended member cannot advance even their own read pointer');
select throws_ok(
  $$ select public.send_message((select cid from _co), 'still here?') $$,
  '42501', null, 'a suspended member cannot send');
select throws_ok(
  $$ select public.open_conversation('order', (select oid from _o1)) $$,
  '42501', null, 'a suspended member cannot re-open the conversation');

-- The row was RETAINED, not deleted: restoring access brings the reader's
-- position back intact, with no backfill and no cleanup job on either side.
reset role;
set local request.jwt.claims = '';
select is(
  (select last_read_at from public.conversation_read_state
   where conversation_id=(select cid from _co)
     and user_id='22222222-2222-4222-8222-222222222222'),
  timestamptz '2026-01-02 03:04:05+00',
  'the suspended user''s read-state row still EXISTS — it was hidden, not deleted');
update public.memberships set status='active'
where id='e2222222-eeee-4eee-8eee-eeeeeeeeeee2';

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select is(
  (select count(*)::int from public.conversations where id=(select cid from _co)),
  1, 'restoring the membership restores conversation access');
select is(
  (select last_read_at from public.conversation_read_state
   where conversation_id=(select cid from _co)),
  timestamptz '2026-01-02 03:04:05+00',
  'the restored user''s read pointer is visible again and UNCHANGED');

-- Capability withdrawal, with the membership left ACTIVE, closes the same doors.
-- This is the half that a membership-only check would miss.
reset role;
set local request.jwt.claims = '';
delete from public.membership_capabilities
where membership_id='e2222222-eeee-4eee-8eee-eeeeeeeeeee2'
  and capability_key='conversation.participate';

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select is(
  (select count(*)::int from public.conversations where id=(select cid from _co)),
  0, 'withdrawing the capability alone loses the conversation (membership still active)');
select is(
  (select count(*)::int from public.conversation_read_state),
  0, 'withdrawing the capability alone hides their own read-state row');
select throws_ok(
  $$ select public.mark_conversation_read((select cid from _co)) $$,
  '42501', null, 'a capability-less former participant cannot mark read');
reset role;
set local request.jwt.claims = '';
select is(
  (select last_read_at from public.conversation_read_state
   where conversation_id=(select cid from _co)
     and user_id='22222222-2222-4222-8222-222222222222'),
  timestamptz '2026-01-02 03:04:05+00',
  'the rejected mark-read left last_read_at untouched');

-- Their historical messages survive, correctly attributed, after access loss.
select is(
  (select count(*)::int from public.messages where conversation_id=(select cid from _co)),
  4, 'the message history itself is untouched by anyone losing access');

-- ===========================================================================
-- 11. Unread model — last_read_at vs last_message_at, no per-message receipts
-- ===========================================================================
-- A conversation nobody has spoken in is not unread (last_message_at is null).
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select is(
  (select count(*)::int
   from public.conversations c
   left join public.conversation_read_state rs
     on rs.conversation_id = c.id and rs.user_id = (select auth.uid())
   where c.id = (select cid from _cr)
     and c.last_message_at > coalesce(rs.last_read_at, '-infinity')),
  0, 'a silent conversation counts as zero unread');

-- The counterparty speaks; the requester has never opened this thread.
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select isnt(
  (select public.send_message((select cid from _cr), 'Quotation attached shortly.')),
  null, 'the supplier sends into the RFQ conversation');
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select is(
  (select count(*)::int
   from public.conversations c
   left join public.conversation_read_state rs
     on rs.conversation_id = c.id and rs.user_id = (select auth.uid())
   where c.id = (select cid from _cr)
     and c.last_message_at > coalesce(rs.last_read_at, '-infinity')),
  1, 'a user with no read-state row has the whole thread unread');

-- Reading it clears the badge…
select lives_ok(
  $$ select public.mark_conversation_read((select cid from _cr)) $$,
  'the recipient marks the RFQ conversation read');
select is(
  (select count(*)::int
   from public.conversations c
   left join public.conversation_read_state rs
     on rs.conversation_id = c.id and rs.user_id = (select auth.uid())
   where c.id = (select cid from _cr)
     and c.last_message_at > coalesce(rs.last_read_at, '-infinity')),
  0, 'marking read clears the unread badge for that conversation');

-- …and the SENDER never lit their own badge, because send_message advanced their
-- read state in the same transaction.
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select is(
  (select count(*)::int
   from public.conversations c
   left join public.conversation_read_state rs
     on rs.conversation_id = c.id and rs.user_id = (select auth.uid())
   where c.id = (select cid from _cr)
     and c.last_message_at > coalesce(rs.last_read_at, '-infinity')),
  0, 'sending does not mark the SENDER''s own conversation unread');

-- No per-message receipt rows exist anywhere in the model.
reset role;
set local request.jwt.claims = '';
select is(
  (select count(*)::int from public.conversation_read_state where conversation_id=(select cid from _cr)),
  2, 'read state is one row per USER per conversation — never one per message');

-- ===========================================================================
-- 12. Internal helpers are not client-callable
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select throws_ok(
  $$ select * from app.conversation_parties('order', (select oid from _o1)) $$,
  '42501', null,
  'app.conversation_parties is internal-only — authenticated cannot ask who the parties are');

-- app.can_participate is internal-only too. It is reachable ONLY through the
-- three security-definer RPCs, which execute as the function owner.
select throws_ok(
  $$ select app.can_participate('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') $$,
  '42501', null,
  'app.can_participate is internal-only — authenticated cannot execute it directly');
-- …including against the caller's OWN organization, so the denial is a
-- privilege failure and not merely a false answer.
select throws_ok(
  $$ select app.can_participate('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') $$,
  '42501', null,
  'app.can_participate is denied even for the caller''s own party organization');

-- The regression guard for that revocation: an RLS policy expression runs with
-- the INVOKER's privileges, so a policy calling an internal-only helper would
-- deny every client outright. conversations_select_party inlines the predicate
-- over app.has_capability instead, and must keep filtering rows normally for a
-- caller who cannot execute either Chat helper.
select is(
  (select count(*)::int from public.conversations where id=(select cid from _co)),
  1, 'the participation policy still resolves for a caller who cannot execute the helpers');

-- Catalog-level: neither Chat helper is reachable by ANY client role.
reset role;
set local request.jwt.claims = '';
select is(
  (select count(*)::int
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app'
     and p.proname in ('can_participate', 'conversation_parties')
     and (has_function_privilege('authenticated', p.oid, 'EXECUTE')
       or has_function_privilege('anon',          p.oid, 'EXECUTE')
       or has_function_privilege('service_role',  p.oid, 'EXECUTE'))),
  0, 'neither Chat helper grants EXECUTE to anon, authenticated or service_role');

-- ===========================================================================
-- 13. The seams that must stay closed in this increment
-- ===========================================================================
reset role;
set local request.jwt.claims = '';
-- Emission was ABSENT in the Chat Core increment and is now WIRED
-- (20260823090002, chat-core.md §13). These two assertions are inverted rather
-- than deleted: the seam is exactly what they were watching, and its contract is
-- proved in depth by 34_chat_message_notifications_test.sql.
select cmp_ok(
  (select count(*)::int from public.notifications where event_type = 'message.sent'),
  '>', 0, 'send_message now emits message.sent — the Notifications seam is wired');
select ok(
  (select pg_get_constraintdef(oid) like '%message.sent%'
   from pg_constraint where conname='ck_notifications_event_type_known'),
  'message.sent is in the notifications allow-list');
select is(
  (select count(*)::int from pg_publication_tables
   where pubname='supabase_realtime' and schemaname='public'
     and tablename in ('messages','conversations','conversation_read_state')),
  0, 'no Chat table was added to the Realtime publication');
select is(
  (select count(*)::int from pg_policies
   where schemaname='public'
     and tablename in ('conversations','messages','conversation_read_state')
     and cmd <> 'SELECT'),
  0, 'there is NO insert/update/delete policy on any Chat table');
select is(
  (select count(*)::int from information_schema.role_table_grants
   where table_schema='public'
     and table_name in ('conversations','messages','conversation_read_state')
     and grantee in ('anon','service_role')),
  0, 'neither anon nor service_role holds any privilege on a Chat table');

-- ===========================================================================
-- 14. Existing commerce authorization is unchanged
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select is(
  (select count(*)::int from public.rfqs where id=(select rid from _r1)),
  0, 'an unrelated organization still cannot read the RFQ (commerce RLS unchanged)');
select is(
  (select count(*)::int from public.orders where id=(select oid from _o1)),
  0, 'an unrelated organization still cannot read the order');
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select is(
  (select count(*)::int from public.orders where id=(select oid from _o1)),
  1, 'the requester can still read their own order');
-- Chat's capability does not leak into commerce: the Org A staff member holds no
-- rfq/order capability and Chat gave them none.
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select throws_ok(
  $$ select public.create_rfq('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                              'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Should not work') $$,
  '42501', null, 'Chat granted no commerce authority to anyone (rfq.create still required)');

select * from finish();
rollback;
