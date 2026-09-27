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
-- Staging-prep Increment 7 (20260924090007_registration_state_access_ready.sql)
-- removed profile_pending/contact_pending/every track-specific sub-state as
-- return values of my_registration_state() — that informational value now
-- lives in the non-gating public.my_profile_completion() RPC instead.
-- account_type_pending is the earliest state that still exists in the new
-- model.
select is((select public.my_registration_state()), 'account_type_pending',
  'a consented user with no progress is account_type_pending');
select throws_ok(
  $$ select public.onboarding_save_contact('01012345678') $$,
  '22023', null, 'contact cannot be saved before the profile step');
-- The SAME migration explicitly, intentionally drops the "complete the
-- contact step first" precondition from onboarding_select_account_type: the
-- streamlined registration flow this pass builds never runs the phone/contact
-- step at all, so forcing that order would unconditionally reject every
-- account-type selection made through it. The call now succeeds even before
-- the contact (or profile) step — harmless to the canonical wizard, which
-- still happens to run its steps in order; only the RPC's own enforcement is
-- gone. Reset immediately after so the rest of this file's step-by-step
-- narrative is unaffected by this early, out-of-order write.
select lives_ok(
  $$ select public.onboarding_select_account_type('professional','installer_technician') $$,
  'account type CAN now be selected before the contact step (Increment 7 removed that precondition)');
reset role;
delete from public.onboarding_progress where user_id='44444444-4444-4444-8444-444444444444';
-- audit_log is append-only (app.forbid_mutation() forbids DELETE, even for a
-- superuser) — the premature call above already recorded its own
-- 'onboarding.completed' row and that row cannot be undone. The later
-- "emits an audit event" assertion is adjusted to expect 2 rather than 1 for
-- exactly that reason, rather than pretending this demonstration call never
-- happened.
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';

-- ===== profile step =====
select lives_ok(
  $$ select public.onboarding_save_profile('  Omar Hassan  ', 'ar') $$,
  'profile step saves display name + locale');
select is((select display_name from public.profiles where user_id='44444444-4444-4444-8444-444444444444'),
  'Omar Hassan', 'display name is trimmed and persisted to the shared profile');
select is((select locale from public.users where id='44444444-4444-4444-8444-444444444444'),
  'ar', 'preferred locale is persisted on the identity');
select is((select public.my_registration_state()), 'account_type_pending',
  'after the profile step the next state is account_type_pending');
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
-- record Tradespeople intent (Engineer is Coming Soon since Increment 13)
select lives_ok(
  $$ select public.onboarding_select_account_type('professional','installer_technician') $$,
  'account-type step records the professional intent');
select is((select selected_persona::text from public.onboarding_progress where user_id='44444444-4444-4444-8444-444444444444'),
  'installer_technician', 'the selected account type is recorded as intent');
-- CRITICAL: intent never changes the canonical account type this sprint
select is((select primary_account_type::text from public.users where id='44444444-4444-4444-8444-444444444444'),
  'end_consumer', 'onboarding never mutates users.primary_account_type');
-- Increment 7: once account_type_completed_at is set, the very next (and
-- now only remaining) gate is the mandatory username step — the persona/
-- consumer/organization-setup handoff sub-states no longer exist as return
-- values of my_registration_state().
select is((select public.my_registration_state()), 'username_pending',
  'a professional selection with no username yet lands on username_pending');
-- handoff is audited (audit_log is admin-read-only under RLS, so read as superuser)
reset role;
select is(
  (select count(*)::int from public.audit_log
   where action='onboarding.completed' and subject_id='44444444-4444-4444-8444-444444444444'),
  -- 2, not 1: the early demonstration call above (line ~46) that account type
  -- can now be selected before the contact step ALSO reached this handoff and
  -- recorded its own audit row. audit_log is append-only, so that row cannot
  -- be undone — this expectation is adjusted rather than the history erased.
  2, 'reaching the handoff emits an onboarding.completed audit event (once per real call)');
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';

-- ===== track terminals: consumer + business =====
-- consumer keeps a null concrete type and lands on the consumer handoff
select lives_ok(
  $$ select public.onboarding_select_account_type('consumer', null) $$,
  're-selecting the consumer track is allowed (account type not silently locked)');
select is((select selected_persona from public.onboarding_progress where user_id='44444444-4444-4444-8444-444444444444'),
  null, 'the consumer track stores a null concrete account type');
select is((select public.my_registration_state()), 'username_pending',
  'a consumer selection with no username yet also lands on username_pending');
-- business track -> still gated on the mandatory username step, same as every track
select lives_ok(
  $$ select public.onboarding_select_account_type('business','supplier') $$,
  'a business selection is recorded');
select is((select public.my_registration_state()), 'username_pending',
  'a business selection with no username yet also lands on username_pending');

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
