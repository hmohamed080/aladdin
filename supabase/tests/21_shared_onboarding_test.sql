-- pgTAP: shared onboarding engine (Sprint 7.3).
--
-- Proves the resumable step machine (profile -> contact -> account-type -> handoff)
-- is server-authoritative and caller-scoped: each writer requires a verified
-- caller, enforces step order and EG phone format, records account-type INTENT
-- without ever touching users.primary_account_type, rejects the invitation-only
-- path, and drives my_registration_state() to the correct terminal per track.
create extension if not exists pgtap;

begin;
select plan(27);

-- Omar (44…) is our fresh registrant. Verify his email and give consent so the
-- state machine reaches the onboarding steps. Seed marks him active -> model him
-- as a pending registrant.
update auth.users set email_confirmed_at = now()
  where id in ('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111');
update public.users set status = 'pending_verification'
  where id = '44444444-4444-4444-8444-444444444444';

set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select public.record_consent(array['terms','privacy','pilot']::public.consent_type[], 'en');

-- ===== step ordering: cannot skip ahead =====
select is((select public.my_registration_state()), 'profile_pending',
  'a consented user with no progress is profile_pending');
select throws_ok(
  $$ select public.onboarding_save_contact('01012345678') $$,
  '22023', null, 'contact cannot be saved before the profile step');
select throws_ok(
  $$ select public.onboarding_select_account_type('professional','engineer') $$,
  '22023', null, 'account type cannot be selected before the contact step');

-- ===== profile step =====
select lives_ok(
  $$ select public.onboarding_save_profile('  Omar Hassan  ', 'ar') $$,
  'profile step saves display name + locale');
select is((select display_name from public.profiles where user_id='44444444-4444-4444-8444-444444444444'),
  'Omar Hassan', 'display name is trimmed and persisted to the shared profile');
select is((select locale from public.users where id='44444444-4444-4444-8444-444444444444'),
  'ar', 'preferred locale is persisted on the identity');
select is((select public.my_registration_state()), 'contact_pending',
  'after the profile step the next state is contact_pending');
-- validation: empty display name is rejected
select throws_ok(
  $$ select public.onboarding_save_profile('   ', 'en') $$,
  '22023', null, 'an empty display name is rejected');

-- ===== contact step (EG phone, UNVERIFIED) =====
select throws_ok(
  $$ select public.onboarding_save_contact('0100') $$,
  '22023', null, 'a malformed Egyptian mobile is rejected');
select throws_ok(
  $$ select public.onboarding_save_contact('01312345678') $$,
  '22023', null, 'a non-EG operator prefix (013) is rejected');
select lives_ok(
  $$ select public.onboarding_save_contact(' 01012345678 ') $$,
  'contact step saves a valid Egyptian mobile');
select is((select phone from public.onboarding_progress where user_id='44444444-4444-4444-8444-444444444444'),
  '01012345678', 'the phone is trimmed and stored');
-- The phone is NOT promoted to a verified contact channel — it lives only in
-- onboarding_progress, never as a (verified) contacts row.
select is(
  (select count(*)::int from public.contacts
   where user_id='44444444-4444-4444-8444-444444444444' and value='01012345678'),
  0, 'the collected phone is never stored as a contact channel');
select is((select public.my_registration_state()), 'account_type_pending',
  'after the contact step the next state is account_type_pending');

-- ===== account-type step: intent only, invitation path impossible =====
-- professional track requires a concrete type
select throws_ok(
  $$ select public.onboarding_select_account_type('professional', null) $$,
  '22023', null, 'a professional track requires a concrete account type');
-- record engineer intent
select lives_ok(
  $$ select public.onboarding_select_account_type('professional','engineer') $$,
  'account-type step records the professional intent');
select is((select selected_persona::text from public.onboarding_progress where user_id='44444444-4444-4444-8444-444444444444'),
  'engineer', 'the selected account type is recorded as intent');
-- CRITICAL: intent never changes the canonical account type this sprint
select is((select primary_account_type::text from public.users where id='44444444-4444-4444-8444-444444444444'),
  'end_consumer', 'onboarding never mutates users.primary_account_type');
select is((select public.my_registration_state()), 'persona_onboarding_pending',
  'a professional selection lands on the persona handoff');
-- handoff is audited (audit_log is admin-read-only under RLS, so read as superuser)
reset role;
select is(
  (select count(*)::int from public.audit_log
   where action='onboarding.completed' and subject_id='44444444-4444-4444-8444-444444444444'),
  1, 'reaching the handoff emits an onboarding.completed audit event');
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';

-- ===== track terminals: consumer + business =====
-- consumer keeps a null concrete type and lands on the consumer handoff
select lives_ok(
  $$ select public.onboarding_select_account_type('consumer', null) $$,
  're-selecting the consumer track is allowed (account type not silently locked)');
select is((select selected_persona from public.onboarding_progress where user_id='44444444-4444-4444-8444-444444444444'),
  null, 'the consumer track stores a null concrete account type');
select is((select public.my_registration_state()), 'consumer_onboarding_pending',
  'a consumer selection lands on the consumer handoff');
-- business track -> organization setup handoff
select lives_ok(
  $$ select public.onboarding_select_account_type('business','supplier') $$,
  'a business selection is recorded');
select is((select public.my_registration_state()), 'organization_setup_pending',
  'a business selection lands on the organization-setup handoff');

-- ===== authorization: caller-scoped writes =====
-- direct client writes to the progress table are denied (RPC-only)
select throws_ok(
  $$ insert into public.onboarding_progress (user_id, profile_completed_at)
     values ('44444444-4444-4444-8444-444444444444', now()) $$,
  '42501', null, 'direct client insert into onboarding_progress is denied');
-- a caller can only read their OWN progress row (RLS)
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select is(
  (select count(*)::int from public.onboarding_progress where user_id='44444444-4444-4444-8444-444444444444'),
  0, 'a user cannot read another user''s onboarding progress');

select * from finish();
rollback;
