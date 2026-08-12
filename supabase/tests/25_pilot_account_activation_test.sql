-- pgTAP: personal account activation + generic owner/manager entry
-- (Pilot UAT round 1 — migration 20260813090001).
--
-- Proves the two behaviour corrections and, just as importantly, the guarantees
-- they must NOT break:
--   * finishing consumer onboarding, and submitting a professional profile,
--     ACTIVATE the personal account (usable terminal state);
--   * the professional's verification stays an INDEPENDENT trust state — still
--     'submitted', still reviewable, and users.primary_account_type is still only
--     written by the approved+applied upgrade workflow;
--   * activation never revives a suspended/deactivated identity;
--   * an unapproved professional is still NOT publicly discoverable;
--   * the generic "organization owner / manager" choice (business track, no
--     concrete account type) saves and resumes, while a consumer type or a
--     non-business type on the business track is still rejected.
create extension if not exists pgtap;

begin;
select plan(22);

-- ---------------------------------------------------------------------------
-- Fixtures: four fresh, verified, non-active users (the bootstrap trigger
-- provisions public.users + public.profiles). Consent + the completed shared
-- steps are seeded as the owner so we can drive the RPCs as each user.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data,
                        raw_user_meta_data, email_confirmed_at, created_at, updated_at)
values
  ('e1000000-0000-4000-8000-0000000000e1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'activate-consumer@example.test',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Activate Consumer","locale":"en"}'::jsonb, now(), now(), now()),
  ('e2000000-0000-4000-8000-0000000000e2', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'activate-engineer@example.test',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Activate Engineer","locale":"en"}'::jsonb, now(), now(), now()),
  ('e3000000-0000-4000-8000-0000000000e3', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'activate-owner@example.test',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Activate Owner","locale":"en"}'::jsonb, now(), now(), now()),
  ('e4000000-0000-4000-8000-0000000000e4', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'activate-suspended@example.test',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Activate Suspended","locale":"en"}'::jsonb, now(), now(), now());

insert into public.consent_receipts (user_id, consent_type, version, locale)
select u.id, t.t, app.current_consent_version(t.t), 'en'
from (values ('e1000000-0000-4000-8000-0000000000e1'::uuid),
             ('e2000000-0000-4000-8000-0000000000e2'::uuid),
             ('e3000000-0000-4000-8000-0000000000e3'::uuid),
             ('e4000000-0000-4000-8000-0000000000e4'::uuid)) u(id)
cross join unnest(array['terms','privacy','pilot']::public.consent_type[]) t(t);

insert into public.onboarding_progress
  (user_id, phone, selected_track, selected_account_type,
   profile_completed_at, contact_completed_at, account_type_completed_at, completed_at)
values
  ('e1000000-0000-4000-8000-0000000000e1', '01012345678', 'consumer',     null,       now(), now(), now(), now()),
  ('e2000000-0000-4000-8000-0000000000e2', '01512345678', 'professional', 'engineer', now(), now(), now(), now()),
  ('e4000000-0000-4000-8000-0000000000e4', '01212345678', 'consumer',     null,       now(), now(), now(), now());
-- The owner/manager fixture only reaches the contact step — the account-type
-- step is the RPC under test.
insert into public.onboarding_progress
  (user_id, phone, profile_completed_at, contact_completed_at)
values ('e3000000-0000-4000-8000-0000000000e3', '01112345678', now(), now());

update public.users set status = 'suspended' where id = 'e4000000-0000-4000-8000-0000000000e4';

-- ===========================================================================
-- 1. Consumer — completion is a USABLE terminal state
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"e1000000-0000-4000-8000-0000000000e1","role":"authenticated"}';

select lives_ok($$ select public.individual_complete_consumer() $$,
  'consumer reaches the onboarding terminal');
select is((select status::text from public.users where id = 'e1000000-0000-4000-8000-0000000000e1'),
  'active', 'consumer completion activates the personal account');
select is(public.my_registration_state(), 'active_personal',
  'the completed consumer resolves to active_personal (lands on /home)');
-- Activation is not an account-type change: a consumer stays a consumer.
select is((select primary_account_type::text from public.users where id = 'e1000000-0000-4000-8000-0000000000e1'),
  'end_consumer', 'consumer activation does not touch the canonical account type');
-- Idempotent: re-running the terminal keeps a single active account.
select lives_ok($$ select public.individual_complete_consumer() $$,
  're-running the consumer terminal is idempotent');

reset role;

-- ===========================================================================
-- 2. Professional — submission activates; the review stays independent
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"e2000000-0000-4000-8000-0000000000e2","role":"authenticated"}';

select lives_ok(
  $$ select public.individual_save_professional(
       'engineer'::public.account_type, 'Structural engineer', 12::smallint, 'structural', null,
       array['design_review','supervision'], null, array['arabic','english'], 'within_week',
       array['new_cairo'], false, 'cairo', 'new_cairo', 30::smallint) $$,
  'professional saves a complete profile');
select lives_ok($$ select public.individual_submit_professional() $$,
  'professional submits for review');

select is((select status::text from public.users where id = 'e2000000-0000-4000-8000-0000000000e2'),
  'active', 'professional submission activates the personal account');
select is(public.my_registration_state(), 'active_personal',
  'the submitted professional is NOT trapped in a review-waiting state');
-- The trust state is preserved and still open for the Admin queue.
select is(
  (select status::text from public.verifications
   where subject_type = 'user' and user_id = 'e2000000-0000-4000-8000-0000000000e2'),
  'submitted', 'the professional verification request is preserved for Admin review');
-- Sprint 12: with no column default, an unapplied persona reads as null rather
-- than a fake consumer one — the same assertion, stated honestly.
select is((select primary_account_type::text from public.users where id = 'e2000000-0000-4000-8000-0000000000e2'),
  null, 'activation NEVER applies the requested account type (review still required)');
-- Usable, but not yet trusted: an unapproved professional stays undiscoverable.
select is(
  (select public_profile_status::text from public.profiles where user_id = 'e2000000-0000-4000-8000-0000000000e2'),
  'hidden', 'an activated but unapproved professional is still not publicly listed');
-- Re-submitting after activation must not fail (the account is already active).
select lives_ok($$ select public.individual_submit_professional() $$,
  're-submitting the professional profile is idempotent');

reset role;

-- ===========================================================================
-- 3. Activation never revives a blocked identity
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"e4000000-0000-4000-8000-0000000000e4","role":"authenticated"}';

select lives_ok($$ select public.individual_complete_consumer() $$,
  'a suspended caller may still reach the consumer terminal');
select is((select status::text from public.users where id = 'e4000000-0000-4000-8000-0000000000e4'),
  'suspended', 'onboarding never re-activates a suspended account');
select is(public.my_registration_state(), 'manually_blocked',
  'a suspended caller still resolves to manually_blocked');

reset role;

-- ===========================================================================
-- 4. Generic "organization owner / manager" — business track, no concrete type
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"e3000000-0000-4000-8000-0000000000e3","role":"authenticated"}';

select lives_ok(
  $$ select public.onboarding_select_account_type('business', null) $$,
  'the generic owner/manager choice (business track, no concrete type) is accepted');
select is(
  (select selected_account_type from public.onboarding_progress where user_id = 'e3000000-0000-4000-8000-0000000000e3'),
  null, 'owner/manager records no concrete account type (it is a relationship, not a business type)');
select is(public.my_registration_state(), 'organization_setup_pending',
  'the owner/manager resumes into business onboarding');
-- The real organization type is chosen (and validated) during business onboarding.
select lives_ok(
  $$ select public.business_save('Zayed Marble LLC', 'Zayed Marble', 'wholesaler'::public.account_type,
       null, 'giza', 'sheikh_zayed', 'Main branch', true) $$,
  'the owner then picks a REAL organization type during business onboarding');
-- A consumer type on the business track is still refused.
select throws_ok(
  $$ select public.onboarding_select_account_type('business', 'end_consumer') $$,
  '22023', null, 'the business track still refuses a consumer account type');
-- So is an individual-professional type (owner/manager is not a persona).
select throws_ok(
  $$ select public.onboarding_select_account_type('business', 'engineer') $$,
  '22023', null, 'the business track still refuses a non-business account type');

reset role;

select * from finish();
rollback;
