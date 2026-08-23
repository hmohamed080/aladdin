-- pgTAP: Transactional Chat -> Notifications — the message.sent integration.
-- Authority: docs/database/chat-core.md §13 (Q6 decided 2026-08-23) and
-- docs/database/notifications-core.md, "MVP event-to-recipient mapping".
-- Implementation: 20260823090002_chat_message_notifications.sql.
--
-- Proves the one product decision this increment encodes: a persisted Chat
-- message notifies THE OPPOSITE TRANSACTION PARTY, and nobody else — not the
-- sending organization, not a colleague without conversation.participate, not an
-- unrelated tenant, and never the actor themselves. Plus the two properties that
-- make it safe to ship: the notice carries NO message content, and it is written
-- in the SAME transaction as the message it announces.
--
-- Deliberately NOT repeated here: the Chat security contract
-- (33_chat_core_test.sql), the notifications RLS contract
-- (31_notifications_core_test.sql), and the commerce emission mapping
-- (32_notifications_event_emission_test.sql). This suite asserts only the seam.
--
-- Fixtures (shared seed, plus one organization built here):
--   Org A = 'aaaaaaaa…' (Nile Finishing)  — SUPPLIER side
--     · 11111111 owner — HOLDS conversation.participate (sender and recipient)
--     · 22222222 staff — active member WITHOUT it, so fan-out is proved to be
--                        capability-scoped rather than org-wide. Org A keeps a
--                        holder (11111111), so app.notify_org's org.manage owner
--                        fallback is NOT engaged and this assertion stays honest.
--   Org B = 'bbbbbbbb…' (Delta Interiors) — REQUESTER side
--     · 33333333 owner — HOLDS conversation.participate
--   Org C = 'ccccffff…' (built below)     — UNRELATED tenant; member 44444444
--                        holding conversation.participate in ITS OWN org, which
--                        must grant it nothing here.
create extension if not exists pgtap;

begin;
select plan(46);

-- ===========================================================================
-- Fixtures
-- ===========================================================================
insert into public.membership_capabilities (membership_id, capability_key) values
  ('e1111111-eeee-4eee-8eee-eeeeeeeeeee1', 'catalog.publish'),
  ('e1111111-eeee-4eee-8eee-eeeeeeeeeee1', 'rfq.respond'),
  ('e1111111-eeee-4eee-8eee-eeeeeeeeeee1', 'quote.submit'),
  ('e1111111-eeee-4eee-8eee-eeeeeeeeeee1', 'order.manage'),
  ('e1111111-eeee-4eee-8eee-eeeeeeeeeee1', 'conversation.participate'),
  ('e3333333-eeee-4eee-8eee-eeeeeeeeeee3', 'rfq.create'),
  ('e3333333-eeee-4eee-8eee-eeeeeeeeeee3', 'quote.decide'),
  ('e3333333-eeee-4eee-8eee-eeeeeeeeeee3', 'order.create'),
  ('e3333333-eeee-4eee-8eee-eeeeeeeeeee3', 'conversation.participate')
on conflict do nothing;

-- The unrelated tenant. Its member holds the capability in its OWN org, which is
-- exactly the fixture that proves the capability is not ambient.
insert into public.organizations (id, name, slug, org_type, status, is_verified, primary_locale, created_by)
values ('ccccffff-cccc-4ccc-8ccc-cccccccccccc', 'Gamma Contracting', 'gamma-contracting',
        'contractor_company', 'active', true, 'en', '44444444-4444-4444-8444-444444444444')
on conflict do nothing;
insert into public.memberships (id, user_id, organization_id, primary_branch_id, status, accepted_at)
values ('e4444444-eeee-4eee-8eee-eeeeeeeeeee4', '44444444-4444-4444-8444-444444444444',
        'ccccffff-cccc-4ccc-8ccc-cccccccccccc', null, 'active', now())
on conflict do nothing;
insert into public.membership_capabilities (membership_id, capability_key)
values ('e4444444-eeee-4eee-8eee-eeeeeeeeeee4', 'conversation.participate')
on conflict do nothing;

-- ---- The commercial spine: rfq -> quotation -> order ----------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select public.create_product('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','MsgNotify Marble','finishing','square_meter');
reset role;
create temp table _p as select id as pid, version as pv from public.products where name='MsgNotify Marble';
grant select on _p to authenticated, service_role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select public.set_product_published((select pid from _p), true, (select pv from _p));

set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select public.create_rfq('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','MsgNotify chain');
reset role;
create temp table _r as select id as rid, version as rv from public.rfqs where title='MsgNotify chain';
grant select on _r to authenticated, service_role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select public.add_rfq_item((select rid from _r), (select pid from _p), 25);
select public.submit_rfq((select rid from _r), (select rv from _r));
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select public.create_quotation((select rid from _r));
reset role;
create temp table _q as select
  (select id from public.quotations where rfq_id=(select rid from _r)) as qid,
  (select version from public.quotations where rfq_id=(select rid from _r)) as qv,
  (select id from public.quotation_items
     where quotation_id=(select id from public.quotations where rfq_id=(select rid from _r))) as qiid;
grant select on _q to authenticated, service_role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select public.set_quotation_item_price((select qiid from _q), 400.00);
select public.submit_quotation((select qid from _q), (select qv from _q));
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select public.decide_quotation((select qid from _q), true,
  (select version from public.quotations where id=(select qid from _q)));
select public.create_order_from_quotation((select qid from _q));
reset role;
create temp table _o as select id as oid from public.orders where quotation_id=(select qid from _q);
grant select on _o to authenticated, service_role;

-- One conversation per subject type, opened by the requester side.
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select public.open_conversation('rfq',       (select rid from _r));
select public.open_conversation('quotation', (select qid from _q));
select public.open_conversation('order',     (select oid from _o));
reset role;
create temp table _c as select
  (select id from public.conversations where subject_type='rfq'       and subject_id=(select rid from _r)) as crfq,
  (select id from public.conversations where subject_type='quotation' and subject_id=(select qid from _q)) as cquo,
  (select id from public.conversations where subject_type='order'     and subject_id=(select oid from _o)) as cord;
grant select on _c to authenticated, service_role;

-- The commerce chain above emitted its own notifications; everything below is
-- scoped to event_type='message.sent' so those can never be miscounted as ours.

-- ===========================================================================
-- 1. Direction — the recipient is the OPPOSITE party, both ways
-- ===========================================================================
-- --- requester (Org B, user 33333333) sends -> supplier side (Org A) --------
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select public.send_message((select cord from _c), 'Requester asking about the delivery window.');
reset role;
set local request.jwt.claims = '';

select is(
  (select count(*)::int from public.notifications
   where event_type='message.sent' and recipient_user_id='11111111-1111-4111-8111-111111111111'),
  1, 'requester-side send notified the SUPPLIER-side capability holder');

select is(
  (select organization_id from public.notifications
   where event_type='message.sent' and recipient_user_id='11111111-1111-4111-8111-111111111111'),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
  'the notice is filed under the RECIPIENT organization, the opposite party');

select is(
  (select count(*)::int from public.notifications
   where event_type='message.sent' and recipient_user_id='33333333-3333-4333-8333-333333333333'),
  0, 'the SENDING organization received nothing — and the actor did not self-notify');

select is(
  (select count(*)::int from public.notifications
   where event_type='message.sent' and recipient_user_id='22222222-2222-4222-8222-222222222222'),
  0, 'a same-org colleague WITHOUT conversation.participate received nothing');

select is(
  (select count(*)::int from public.notifications
   where event_type='message.sent' and recipient_user_id='44444444-4444-4444-8444-444444444444'),
  0, 'the unrelated tenant received nothing, despite holding the capability in its own org');

select is(
  (select count(*)::int from public.notifications where event_type='message.sent'),
  1, 'exactly ONE notification row exists in total — fan-out is capability-scoped, not org-wide');

-- --- supplier (Org A, user 11111111) replies -> requester side (Org B) ------
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select public.send_message((select cord from _c), 'Supplier answering about the delivery window.');
reset role;
set local request.jwt.claims = '';

select is(
  (select count(*)::int from public.notifications
   where event_type='message.sent' and recipient_user_id='33333333-3333-4333-8333-333333333333'),
  1, 'supplier-side send notified the REQUESTER-side capability holder');

select is(
  (select count(*)::int from public.notifications
   where event_type='message.sent' and recipient_user_id='11111111-1111-4111-8111-111111111111'),
  1, 'the supplier still has only their OWN earlier notice — a sender is never notified of their own message');

-- No dedupe in the Pilot: a second message from the same side is a second row.
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select public.send_message((select cord from _c), 'Supplier following up while the first notice is still unread.');
reset role;
set local request.jwt.claims = '';

select is(
  (select count(*)::int from public.notifications
   where event_type='message.sent' and recipient_user_id='33333333-3333-4333-8333-333333333333'),
  2, 'no dedupe in the Pilot: every persisted message is an independent notification event');

-- ===========================================================================
-- 2. The persisted contract — event, subject, keys, and the deep link
-- ===========================================================================
select is(
  (select count(distinct event_type)::int from public.notifications where event_type='message.sent'),
  1, 'the persisted event_type is exactly message.sent');

select is(
  (select count(*)::int from public.notifications
   where event_type='message.sent'
     and title_key='notifications.message.sent.title'
     and body_key ='notifications.message.sent.body'),
  (select count(*)::int from public.notifications where event_type='message.sent'),
  'every notice carries the approved title/body key pair');

select is(
  (select count(*)::int from public.notifications n
   where n.event_type='message.sent'
     and n.subject_type='order' and n.subject_id=(select oid from _o)),
  (select count(*)::int from public.notifications where event_type='message.sent'),
  'subject_type/subject_id are the CONVERSATION''s own subject, not a chat id');

select is(
  (select distinct deep_link from public.notifications where event_type='message.sent'),
  '/b2b/orders/' || (select oid from _o)::text,
  'order-anchored conversation deep-links to the ORDER record');

-- --- the same contract on the other two subject types -----------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select public.send_message((select crfq from _c), 'Requester message on the RFQ.');
select public.send_message((select cquo from _c), 'Requester message on the quotation.');
reset role;
set local request.jwt.claims = '';

select is(
  (select deep_link from public.notifications
   where event_type='message.sent' and subject_type='rfq' and subject_id=(select rid from _r)),
  '/b2b/rfqs/' || (select rid from _r)::text,
  'rfq-anchored conversation deep-links to the RFQ record');

select is(
  (select deep_link from public.notifications
   where event_type='message.sent' and subject_type='quotation' and subject_id=(select qid from _q)),
  '/b2b/quotations/' || (select qid from _q)::text,
  'quotation-anchored conversation deep-links to the QUOTATION record');

select is(
  (select count(*)::int from public.notifications
   where event_type='message.sent' and deep_link like '/chat%'),
  0, 'no notice links to an invented /chat route');

select is(
  (select count(*)::int from public.notifications
   where event_type='message.sent' and deep_link !~ '^/[A-Za-z0-9/_-]*$'),
  0, 'every deep link satisfies the relative-path constraint');

-- ===========================================================================
-- 3. Privacy — the authored message never reaches the notification row
-- ===========================================================================
select is(
  (select count(*)::int from public.notifications
   where event_type='message.sent'
     and params::text like '%delivery window%'),
  0, 'no notification carries the authored message body');

select is(
  (select count(*)::int from public.notifications
   where event_type='message.sent'
     and (params ? 'body' or params ? 'message' or params ? 'excerpt' or params ? 'preview')),
  0, 'params carry no body/message/excerpt/preview key of any kind');

select is(
  (select count(distinct (select array_agg(k order by k) from jsonb_object_keys(params) k))::int
   from public.notifications where event_type='message.sent'),
  1, 'every notice carries the SAME minimal param set');

select is(
  (select (select array_agg(k order by k) from jsonb_object_keys(params) k)
   from public.notifications where event_type='message.sent' limit 1),
  array['counterparty_name'],
  'the only param is counterparty_name — business context, no personal data');

select is(
  (select params->>'counterparty_name' from public.notifications
   where event_type='message.sent' and recipient_user_id='33333333-3333-4333-8333-333333333333'
   order by created_at limit 1),
  (select app.org_display_name('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')),
  'counterparty_name names the SENDING organization, as the reader''s counterparty');

-- ===========================================================================
-- 4. The Chat write path is unchanged, and coupled to the notice
-- ===========================================================================
select is(
  (select count(*)::int from public.messages where conversation_id=(select cord from _c)),
  3, 'the messages themselves are still written');

select ok(
  (select last_message_at is not null from public.conversations where id=(select cord from _c)),
  'conversations.last_message_at is still advanced');

select ok(
  (select c.last_message_at >= max(m.created_at)
   from public.conversations c join public.messages m on m.conversation_id=c.id
   where c.id=(select cord from _c) group by c.last_message_at),
  'last_message_at is at least as recent as the newest message');

select is(
  (select count(*)::int from public.audit_log where subject_type='conversation' and action='message.sent'),
  0, 'still no audit row per message — the Chat audit contract is unchanged');

-- --- TRANSACTIONAL COUPLING -------------------------------------------------
-- Rolling back to a savepoint taken before the send must remove BOTH the
-- message and its notification. That is the whole guarantee: they are one
-- transaction, not a write plus a best-effort follow-up.
create temp table _before as select
  (select count(*)::int from public.messages)      as m,
  (select count(*)::int from public.notifications where event_type='message.sent') as n;
grant select on _before to authenticated, service_role;

savepoint coupling;
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select public.send_message((select cord from _c), 'This send is about to be rolled back.');
reset role;
set local request.jwt.claims = '';

select is(
  (select count(*)::int from public.messages), (select m from _before) + 1,
  'inside the transaction, the message is present');
select is(
  (select count(*)::int from public.notifications where event_type='message.sent'),
  (select n from _before) + 1,
  'inside the SAME transaction, its notification is present');

rollback to savepoint coupling;

select is(
  (select count(*)::int from public.messages), (select m from _before),
  'rolling back removed the message');
select is(
  (select count(*)::int from public.notifications where event_type='message.sent'),
  (select n from _before),
  'rolling back removed the notification WITH it — one transaction, not two');

-- --- a REJECTED send writes neither -----------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select throws_ok(
  $$ select public.send_message((select cord from _c), '   ') $$,
  '22023', null,
  'a whitespace-only body is still rejected (22023)');
reset role;
set local request.jwt.claims = '';

select is(
  (select count(*)::int from public.notifications where event_type='message.sent'),
  (select n from _before),
  'a rejected send created NO notification');
select is(
  (select count(*)::int from public.messages), (select m from _before),
  'a rejected send created no message either');

-- --- authorization is unchanged ---------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select throws_ok(
  $$ select public.send_message((select cord from _c), 'I am not a party to this transaction.') $$,
  '42501', null,
  'a non-party still cannot send (42501) — authorization is unchanged');
reset role;
set local request.jwt.claims = '';

select is(
  (select count(*)::int from public.notifications where event_type='message.sent'),
  (select n from _before),
  'the refused send emitted nothing');

-- --- the sender organization is still DERIVED, never supplied ---------------
select is(
  (select count(*)::int from public.messages m
   join public.conversations c on c.id=m.conversation_id
   where m.sender_organization_id not in (c.requester_org_id, c.supplier_org_id)),
  0, 'every message is attributed to one of its conversation''s two parties');

-- Parameter NAMES are part of the contract too: PostgREST calls this RPC by
-- named argument, so a rename would break every caller as surely as a retype.
select is(
  (select pg_get_function_identity_arguments(p.oid)
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='send_message'),
  'p_conversation_id uuid, p_body text',
  'send_message kept its exact signature, parameter names included');

select ok(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='send_message'),
  'send_message is still SECURITY DEFINER');

select is(
  (select count(*)::int from pg_publication_tables
   where pubname='supabase_realtime' and schemaname='public'
     and tablename in ('messages','conversations','conversation_read_state','notifications')),
  0, 'Realtime is still deferred — no table joined the publication');


-- ===========================================================================
-- 5. RECIPIENT AUTHORITY — the owner fallback is off for THIS event only
-- ===========================================================================
-- app.notify_org normally falls back to org.manage holders when the capability
-- yields nobody, so a notice is never silently dropped. For message.sent that
-- would tell an owner WITHOUT conversation.participate that a thread exists, on
-- which record, and with which counterparty — while conversations_select_party
-- refuses to show it to them. Below, Org B is stripped of its only
-- conversation.participate holder while keeping its org.manage owner: exactly
-- the state in which the fallback used to fire.
create temp table _authority as select
  (select count(*)::int from public.notifications
   where event_type='message.sent'
     and recipient_user_id='33333333-3333-4333-8333-333333333333') as before_n,
  (select count(*)::int from public.notifications
   where event_type='message.sent'
     and organization_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb') as before_org;
grant select on _authority to authenticated, service_role;

delete from public.membership_capabilities
where membership_id='e3333333-eeee-4eee-8eee-eeeeeeeeeee3'
  and capability_key='conversation.participate';

select is(
  (select count(*)::int from public.memberships m
   join public.membership_capabilities c on c.membership_id=m.id
   where m.organization_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
     and m.status='active' and c.capability_key='conversation.participate'),
  0, 'fixture: the recipient organization now has NO conversation.participate holder');

select cmp_ok(
  (select count(*)::int from public.memberships m
   join public.membership_capabilities c on c.membership_id=m.id
   where m.organization_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
     and m.status='active' and c.capability_key='org.manage'),
  '>', 0, 'fixture: but it DOES have an org.manage owner — the fallback would have fired');

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select public.send_message((select cord from _c), 'Sent while the counterparty has no authorised reader.');
reset role;
set local request.jwt.claims = '';

select is(
  (select count(*)::int from public.notifications
   where event_type='message.sent'
     and recipient_user_id='33333333-3333-4333-8333-333333333333'),
  (select before_n from _authority),
  'the org.manage owner was NOT told about a thread they cannot open');

-- Not just the owner: NOBODY in the counterparty organization gained a row.
-- Asserted as a delta rather than as a live-capability check over all history,
-- because a capability revoked AFTER a legitimate notice does not make that
-- notice retroactively wrong — and this suite revokes one deliberately.
select is(
  (select count(*)::int from public.notifications
   where event_type='message.sent'
     and organization_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  (select before_org from _authority),
  'no member of the counterparty organization was notified at all');

-- The message itself still persisted: silence is the correct outcome when
-- nobody in the counterparty organization is authorised to be told.
select is(
  (select count(*)::int from public.messages where conversation_id=(select cord from _c)),
  4, 'the message still persisted — a dropped notice never blocks correspondence');

-- --- and the fallback is still LIVE for every other event -------------------
-- Same organization, same owner, same "capability has no holder" state — only
-- the event differs. order.started notifies the requester org via order.create,
-- which is now held by nobody, so the approved fallback must still reach 33333333.
delete from public.membership_capabilities
where membership_id='e3333333-eeee-4eee-8eee-eeeeeeeeeee3'
  and capability_key='order.create';

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select public.start_order((select oid from _o),
  (select version from public.orders where id=(select oid from _o)));
reset role;
set local request.jwt.claims = '';

select is(
  (select count(*)::int from public.notifications
   where event_type='order.started'
     and recipient_user_id='33333333-3333-4333-8333-333333333333'),
  1, 'the owner fallback is UNCHANGED for other events — order.started still reached the owner');

select ok(
  (select p_allow.parameter_default = 'true'
   from information_schema.parameters p_allow
   where p_allow.specific_schema='app'
     and p_allow.parameter_name='p_allow_owner_fallback'
     and p_allow.specific_name like 'notify_org%'
   limit 1),
  'p_allow_owner_fallback defaults to true, so no existing call site changed behaviour');

select * from finish();
rollback;
