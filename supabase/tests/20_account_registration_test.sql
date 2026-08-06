-- pgTAP: account registration — consent receipts, token invitations, derived
-- registration state (Sprint 7.2).
--
-- Proves: consent is recorded only for the authenticated caller at the
-- server-controlled version and cannot be forged; my_registration_state()
-- derives the resume state from existing tables; a token invitation can be looked
-- up safely (no enumeration), can only be accepted by the matching verified email,
-- bridges into the existing membership model, and is single-use.
create extension if not exists pgtap;

begin;
select plan(25);

-- Seed identities (from supabase/seed.sql):
--   11111111… Amina  — Org A owner (org.members.manage)
--   22222222… Karim  — Org A Cairo staff (email a-cairo@example.test), no manage
--   44444444… Omar   — end consumer, no org
-- Org A = aaaaaaaa…; Cairo branch = c1111111….
-- We set email_confirmed_at on the seeded auth.users so the verified-email gate passes.
update auth.users set email_confirmed_at = now()
  where id in ('11111111-1111-4111-8111-111111111111',
               '22222222-2222-4222-8222-222222222222',
               '44444444-4444-4444-8444-444444444444');
-- Model Omar as a fresh registrant (the seed marks him active; a just-registered
-- personal account is still pending_verification until onboarding completes).
update public.users set status = 'pending_verification'
  where id = '44444444-4444-4444-8444-444444444444';

-- ===== record_consent =====
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';

-- Before consenting, a verified but not-yet-active user is consent_pending.
select is(
  (select public.my_registration_state()),
  'consent_pending', 'a verified, not-yet-active user without consent is consent_pending');

select lives_ok(
  $$ select public.record_consent(array['terms','privacy','pilot']::public.consent_type[], 'ar') $$,
  'a verified user can record their consent');
select is(
  (select count(*)::int from public.consent_receipts where user_id='44444444-4444-4444-8444-444444444444'),
  3, 'three consent receipts are stored');
select is(
  (select version from public.consent_receipts
   where user_id='44444444-4444-4444-8444-444444444444' and consent_type='terms'),
  app.current_consent_version('terms'),
  'the receipt records the server-controlled version, not client input');
select is(
  (select locale from public.consent_receipts
   where user_id='44444444-4444-4444-8444-444444444444' and consent_type='pilot'),
  'ar', 'the accepted locale is captured');

-- idempotent: re-recording the same version adds no duplicate rows
select lives_ok(
  $$ select public.record_consent(array['terms']::public.consent_type[], 'ar') $$,
  're-recording the same consent version is a no-op');
select is(
  (select count(*)::int from public.consent_receipts where user_id='44444444-4444-4444-8444-444444444444'),
  3, 'no duplicate receipt is created for the same version');

-- a caller cannot write a receipt for someone else (no user_id param; derived)
select is(
  (select bool_and(user_id='44444444-4444-4444-8444-444444444444')
   from public.consent_receipts where user_id='44444444-4444-4444-8444-444444444444'),
  true, 'every receipt belongs to the calling user');

-- direct client INSERT into consent_receipts is denied (writes only via RPC)
select throws_ok(
  $$ insert into public.consent_receipts (user_id, consent_type, version, locale)
     values ('44444444-4444-4444-8444-444444444444','terms','forged','ar') $$,
  '42501', null, 'direct client insert into consent_receipts is denied');

-- ===== my_registration_state (derived) =====
-- Omar: verified + consent, no membership, no org -> onboarding_pending
select is(
  (select public.my_registration_state()),
  'onboarding_pending', 'a verified, consented, org-less user is onboarding_pending');

-- Amina (Org A owner, active membership) -> active_personal
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ select public.record_consent(array['terms','privacy','pilot']::public.consent_type[], 'en') $$,
  'the org owner records consent');
select is(
  (select public.my_registration_state()),
  'active_personal', 'a user with an active membership resolves to active_personal');

-- Karim is an active Org A member -> active_personal even without recording consent
-- (existing operational members are never re-gated on the registration consent step).
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select is(
  (select public.my_registration_state()),
  'active_personal', 'an active member is active_personal regardless of consent');

-- ===== invitation_create (manager only) =====
-- Karim (no org.members.manage) cannot invite
select throws_ok(
  $$ select public.invitation_create('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'newhire@example.test') $$,
  '42501', null, 'a non-manager cannot create an invitation');

-- Amina (manager) invites a new hire to the Cairo branch
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select lives_ok(
  $$ select public.invitation_create('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
       '  A-Cairo@Example.test ', 'c1111111-cccc-4ccc-8ccc-cccccccccccc') $$,
  'a manager creates an invitation (email normalized)');
select is(
  (select email from public.organization_invitations
   where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' limit 1),
  'a-cairo@example.test', 'the invitation email is normalized to lowercase/trimmed');

-- Capture the token into a session temp table (as superuser, bypassing RLS) and
-- grant it to the switched roles, so later anon/authenticated lookups never touch
-- the RLS-protected table directly in a subquery.
reset role;
create temporary table _inv on commit drop as
  select token from public.organization_invitations
  where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' limit 1;
grant select on _inv to anon, authenticated;

-- ===== invitation_lookup (anti-enumeration) =====
-- anon lookup of a bad token -> invalid, no org, no email
set local role anon;
set local request.jwt.claims = '';
select is(
  (select status from public.invitation_lookup('does-not-exist-token-000000')),
  'invalid', 'an unknown token resolves to the invalid state');
select is(
  (select email_masked from public.invitation_lookup((select token from _inv))),
  'a•••@•••.test', 'lookup never returns the raw email — only a masked form');
select is(
  (select organization_name from public.invitation_lookup((select token from _inv))),
  'Nile Finishing Supplies', 'lookup returns the organization display name');

-- ===== invitation_accept (email-bound, single-use, bridges to membership) =====
-- Omar (wrong email) cannot accept an invitation addressed to a-cairo@example.test
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select throws_ok(
  $$ select public.invitation_accept(
       (select token from _inv)) $$,
  '42501', null, 'an invitation cannot be accepted by a different email');

-- Karim (matching email a-cairo@example.test) accepts; already an Org A member,
-- so the membership stays active (upsert) and the invitation is consumed.
set local request.jwt.claims = '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated"}';
select lives_ok(
  $$ select public.invitation_accept(
       (select token from _inv)) $$,
  'the matching verified email accepts the invitation');
-- Verify persisted invitation state as superuser (the invitee is not a manager and
-- cannot read the invitation row via RLS — that is the intended policy).
reset role;
select is(
  (select status::text from public.organization_invitations
   where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' limit 1),
  'accepted', 'the invitation is marked accepted');
select is(
  (select accepted_user_id from public.organization_invitations
   where organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' limit 1),
  '22222222-2222-4222-8222-222222222222'::uuid, 'the accepting user is recorded');
select is(
  (select status::text from public.memberships
   where user_id='22222222-2222-4222-8222-222222222222'
     and organization_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  'active', 'acceptance yields an active membership in the existing model');

-- single-use: a second, different user cannot reuse the consumed token
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_ok(
  $$ select public.invitation_accept(
       (select token from _inv)) $$,
  '22023', null, 'an already-accepted invitation cannot be reused');

select * from finish();
rollback;
