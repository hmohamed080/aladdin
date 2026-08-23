-- pgTAP: Notifications Core — recipient-only inbox (docs/database/notifications-core.md).
-- Proves the security contract of the first persisted notification model:
--   • recipient_user_id is the ONLY authority column — organization_id never
--     grants visibility, INCLUDING to an active same-org colleague. This is the
--     test the specification calls out as the one that matters.
--   • no client write path exists (no INSERT/UPDATE/DELETE policy or grant)
--   • the two mark-read RPCs are recipient-scoped and idempotent
--   • app.notify / app.notify_org are internal-only, fan out by capability,
--     fall back to the org owner, and suppress self-notification
--   • the deep-link CHECK rejects absolute, protocol-relative and scheme links
-- Emission from the commerce RPCs is NOT covered here: it is a later increment.
--
-- Fixtures come from the shared seed:
--   Org A = 'aaaaaaaa…' (Nile Finishing) — owner 11111111 (org.manage),
--                                          staff 22222222 (active, sales caps only)
--   Org B = 'bbbbbbbb…' (Delta Interiors) — owner 33333333 (org.manage)
--   user 44444444 = non-member (intruder)
-- 11111111 and 22222222 are ACTIVE MEMBERS OF THE SAME ORG, which is what makes
-- the colleague-isolation assertions meaningful.
create extension if not exists pgtap;

begin;
select plan(38);

-- ===========================================================================
-- Fixtures. Inserted directly as the migration owner (bypasses RLS and grants)
-- so the RLS assertions below test the POLICY, not the writer. app.notify has
-- its own dedicated section further down.
-- ===========================================================================
insert into public.notifications
  (id, recipient_user_id, organization_id, event_type, subject_type, subject_id,
   deep_link, title_key, body_key, params)
values
  -- N1: to the STAFF member of Org A, in Org A context.
  ('11111111-0000-4000-8000-00000000000a', '22222222-2222-4222-8222-222222222222',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'rfq.submitted', 'rfq',
   'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
   '/b2b/rfqs/dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
   'notifications.rfq.submitted.title', 'notifications.rfq.submitted.body',
   '{"org_name":"Delta Interiors"}'::jsonb),
  -- N2: to the SAME staff member but in PERSONAL context (organization_id null).
  ('11111111-0000-4000-8000-00000000000b', '22222222-2222-4222-8222-222222222222',
   null, 'quotation.submitted', 'quotation',
   'dddddddd-dddd-4ddd-8ddd-ddddddddddd2',
   '/b2b/quotations/dddddddd-dddd-4ddd-8ddd-ddddddddddd2',
   'notifications.quotation.submitted.title', null, '{}'::jsonb),
  -- N3: to the OWNER of Org A, in Org A context (the colleague's own row).
  ('11111111-0000-4000-8000-00000000000c', '11111111-1111-4111-8111-111111111111',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'order.created', 'order',
   'dddddddd-dddd-4ddd-8ddd-ddddddddddd3',
   '/b2b/orders/dddddddd-dddd-4ddd-8ddd-ddddddddddd3',
   'notifications.order.created.title', null, '{}'::jsonb),
  -- N4: to the owner of Org B, in Org B context.
  ('11111111-0000-4000-8000-00000000000d', '33333333-3333-4333-8333-333333333333',
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'quotation.accepted', 'quotation',
   'dddddddd-dddd-4ddd-8ddd-ddddddddddd4',
   '/b2b/quotations/dddddddd-dddd-4ddd-8ddd-ddddddddddd4',
   'notifications.quotation.accepted.title', null, '{}'::jsonb);

-- ===========================================================================
-- 1. Recipient isolation — the core of the model
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select is(
  (select count(*)::int from public.notifications where id = '11111111-0000-4000-8000-00000000000a'),
  1, 'the recipient can read their own notification');

-- An active colleague IN THE SAME ORGANIZATION cannot read it. This is the
-- assertion that proves organization_id is context and not authority: user
-- 11111111 is an active org.manage member of the very org the row carries.
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select is(
  (select count(*)::int from public.notifications where id = '11111111-0000-4000-8000-00000000000a'),
  0, 'a SAME-ORG colleague cannot read another recipient''s notification');

-- …and the org owner sees only their OWN row among all rows carrying their org.
select is(
  (select count(*)::int from public.notifications
   where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  1, 'org.manage over the org does not widen the inbox — only the caller''s own row');
select is(
  (select recipient_user_id from public.notifications
   where organization_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  '11111111-1111-4111-8111-111111111111'::uuid,
  'the one visible org-context row is the caller''s own');

-- A member of another organization cannot read it.
set local request.jwt.claims = '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}';
select is(
  (select count(*)::int from public.notifications where id = '11111111-0000-4000-8000-00000000000a'),
  0, 'a member of another organization cannot read the notification (tenant isolation)');

-- A non-member sees nothing at all.
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select is(
  (select count(*)::int from public.notifications),
  0, 'a non-member sees no notifications at all');

-- Platform support is deliberately NOT granted an inbox read (audit_log is the
-- correct investigation surface).
set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';
select is(
  (select count(*)::int from public.notifications),
  0, 'a platform administrator has no inbox read path (audit_log is the support surface)');

-- ===========================================================================
-- 2. No client write path — there is no INSERT/UPDATE/DELETE policy or grant
-- ===========================================================================
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select throws_ok(
  $$ insert into public.notifications
       (recipient_user_id, event_type, subject_type, deep_link, title_key)
     values ('22222222-2222-4222-8222-222222222222', 'rfq.submitted', 'rfq', '/b2b/rfqs', 't') $$,
  '42501', null, 'authenticated cannot INSERT a notification directly (RPC-only)');
select throws_ok(
  $$ update public.notifications set read_at = now()
     where id = '11111111-0000-4000-8000-00000000000a' $$,
  '42501', null, 'the recipient cannot UPDATE their notification directly (RPC-only)');
select throws_ok(
  $$ delete from public.notifications where id = '11111111-0000-4000-8000-00000000000a' $$,
  '42501', null, 'the recipient cannot DELETE their notification directly (RPC-only)');

-- ===========================================================================
-- 3. mark_notification_read — recipient-only, idempotent
-- ===========================================================================
-- A non-recipient is rejected with the established authorization code.
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_ok(
  $$ select public.mark_notification_read('11111111-0000-4000-8000-00000000000a') $$,
  '42501', null, 'a non-recipient cannot mark another user''s notification read');

-- …and the row is genuinely untouched by that attempt.
reset role;
set local request.jwt.claims = '';
select ok(
  (select read_at is null from public.notifications where id = '11111111-0000-4000-8000-00000000000a'),
  'the rejected mark-read left the notification unread');

-- The recipient succeeds.
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select lives_ok(
  $$ select public.mark_notification_read('11111111-0000-4000-8000-00000000000a') $$,
  'the recipient marks their own notification read');
select ok(
  (select read_at is not null from public.notifications where id = '11111111-0000-4000-8000-00000000000a'),
  'read_at is set after mark_notification_read');

-- Idempotence: a second call is a no-op and does NOT move the timestamp.
reset role;
set local request.jwt.claims = '';
create temp table _first_read as
  select read_at as t from public.notifications where id = '11111111-0000-4000-8000-00000000000a';
grant select on _first_read to authenticated;
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select lives_ok(
  $$ select public.mark_notification_read('11111111-0000-4000-8000-00000000000a') $$,
  'marking an already-read notification read again is allowed (idempotent)');
select is(
  (select read_at from public.notifications where id = '11111111-0000-4000-8000-00000000000a'),
  (select t from _first_read),
  'a repeat mark-read does not move read_at (idempotent by construction)');

-- ===========================================================================
-- 4. mark_all_notifications_read — caller-scoped, org-narrowing
-- ===========================================================================
-- Org-scoped clear affects only that org context; the personal-context row (N2)
-- survives, so "clear all" in a business workspace cannot silently clear
-- notices the user has not seen elsewhere.
reset role;
set local request.jwt.claims = '';
update public.notifications set read_at = null
  where id = '11111111-0000-4000-8000-00000000000a';

set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select is(
  (select public.mark_all_notifications_read('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')),
  1, 'org-scoped mark-all clears exactly the rows in that organization context');
select ok(
  (select read_at is null from public.notifications where id = '11111111-0000-4000-8000-00000000000b'),
  'org-scoped mark-all leaves the personal-context notification unread');

-- Unscoped clear takes the remaining personal row.
select is(
  (select public.mark_all_notifications_read()),
  1, 'unscoped mark-all clears the caller''s remaining unread notifications');
select is(
  (select public.mark_all_notifications_read()),
  0, 'a second mark-all affects nothing (idempotent)');

-- It never reaches another user's rows: Org B's owner is still unread.
reset role;
set local request.jwt.claims = '';
select ok(
  (select read_at is null from public.notifications where id = '11111111-0000-4000-8000-00000000000d'),
  'mark-all never clears another recipient''s rows');
select ok(
  (select read_at is null from public.notifications where id = '11111111-0000-4000-8000-00000000000c'),
  'mark-all never clears a same-org colleague''s rows');

-- ===========================================================================
-- 5. Deep-link constraint — enforced at the column, not by convention
-- ===========================================================================
select lives_ok(
  $$ insert into public.notifications
       (recipient_user_id, event_type, subject_type, deep_link, title_key)
     values ('22222222-2222-4222-8222-222222222222', 'order.started', 'order',
             '/b2b/orders/dddddddd-dddd-4ddd-8ddd-ddddddddddd3', 't') $$,
  'a relative deep link is accepted');

select throws_ok(
  $$ insert into public.notifications
       (recipient_user_id, event_type, subject_type, deep_link, title_key)
     values ('22222222-2222-4222-8222-222222222222', 'order.started', 'order',
             'https://evil.example/b2b/orders', 't') $$,
  '23514', null, 'an absolute URL deep link is rejected');

select throws_ok(
  $$ insert into public.notifications
       (recipient_user_id, event_type, subject_type, deep_link, title_key)
     values ('22222222-2222-4222-8222-222222222222', 'order.started', 'order',
             '//evil.example/b2b/orders', 't') $$,
  '23514', null, 'a protocol-relative deep link is rejected');

select throws_ok(
  $$ insert into public.notifications
       (recipient_user_id, event_type, subject_type, deep_link, title_key)
     values ('22222222-2222-4222-8222-222222222222', 'order.started', 'order',
             'javascript:alert(1)', 't') $$,
  '23514', null, 'a javascript: deep link is rejected');

select throws_ok(
  $$ insert into public.notifications
       (recipient_user_id, event_type, subject_type, deep_link, title_key)
     values ('22222222-2222-4222-8222-222222222222', 'order.started', 'order',
             '/b2b/orders?next=https://evil.example', 't') $$,
  '23514', null, 'a deep link carrying a query string is rejected');

-- The bounded vocabulary and the params object rule are equally enforced.
select throws_ok(
  $$ insert into public.notifications
       (recipient_user_id, event_type, subject_type, deep_link, title_key)
     values ('22222222-2222-4222-8222-222222222222', 'points.awarded', 'points', '/b2b', 't') $$,
  '23514', null, 'an event_type outside the approved allow-list is rejected');

select throws_ok(
  $$ insert into public.notifications
       (recipient_user_id, event_type, subject_type, deep_link, title_key, params)
     values ('22222222-2222-4222-8222-222222222222', 'order.started', 'order', '/b2b', 't',
             '["not","an","object"]'::jsonb) $$,
  '23514', null, 'params that are not a JSON object are rejected');

-- ===========================================================================
-- 6. app.notify / app.notify_org — internal-only, capability-scoped
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select throws_ok(
  $$ select app.notify('11111111-1111-4111-8111-111111111111', null, 'rfq.submitted',
                       'rfq', null, '/b2b/rfqs', 't') $$,
  '42501', null, 'app.notify is not executable by an authenticated client');
select throws_ok(
  $$ select app.notify_org('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'rfq.respond',
                           'rfq.submitted', 'rfq', null, '/b2b/rfqs', 't') $$,
  '42501', null, 'app.notify_org is not executable by an authenticated client');

reset role;
set local request.jwt.claims = '';

-- Give the STAFF member (not the owner) the responder capability, so fan-out
-- and owner-fallback are distinguishable.
insert into public.membership_capabilities (membership_id, capability_key)
values ('e2222222-eeee-4eee-8eee-eeeeeeeeeee2', 'rfq.respond')
on conflict do nothing;

-- Fan-out reaches the capability holder only — NOT every employee of the org.
select is(
  (select app.notify_org('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'rfq.respond',
                         'rfq.submitted', 'rfq', 'dddddddd-dddd-4ddd-8ddd-ddddddddddd9',
                         '/b2b/rfqs', 'notifications.rfq.submitted.title')),
  1, 'app.notify_org fans out only to active holders of the requested capability');
select is(
  (select count(*)::int from public.notifications
   where subject_id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd9'
     and recipient_user_id = '22222222-2222-4222-8222-222222222222'),
  1, 'the capability holder received the fan-out');
select is(
  (select count(*)::int from public.notifications
   where subject_id = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd9'
     and recipient_user_id = '11111111-1111-4111-8111-111111111111'),
  0, 'the org owner, lacking the capability, did NOT receive the fan-out');

-- Owner fallback: no member of Org A holds quote.decide, so the org.manage
-- holder receives it rather than the notice being silently dropped.
select is(
  (select app.notify_org('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'quote.decide',
                         'quotation.submitted', 'quotation',
                         'dddddddd-dddd-4ddd-8ddd-dddddddddd10',
                         '/b2b/quotations', 'notifications.quotation.submitted.title')),
  1, 'a capability with no holder falls back to the organization owner');
select is(
  (select recipient_user_id from public.notifications
   where subject_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddd10'),
  '11111111-1111-4111-8111-111111111111'::uuid,
  'the owner-fallback recipient is the org.manage holder');

-- Self-suppression: when the ACTOR is the only capability holder, nothing is
-- written — no one is told they did the thing they just did.
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select is(
  (select app.notify_org('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'rfq.respond',
                         'rfq.submitted', 'rfq', 'dddddddd-dddd-4ddd-8ddd-dddddddddd11',
                         '/b2b/rfqs', 'notifications.rfq.submitted.title')),
  0, 'the acting user is not notified of their own action (self-suppression)');
select is(
  (select count(*)::int from public.notifications
   where subject_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddd11'),
  0, 'self-suppression writes no row at all');

select * from finish();
rollback;
