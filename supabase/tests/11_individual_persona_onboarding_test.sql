-- pgTAP: individual persona onboarding (Phase 2 — Sprint 7.4, revised by the
-- Pilot UAT round 1 activation migration).
-- Proves the persona RPCs derive the actor from auth.uid(), gate consumer vs
-- professional by the shared track, and persist the answers. Completing a persona
-- flow now ACTIVATES the personal account (it is a usable terminal state), while
-- the professional submit still hands off to the trusted upgrade/review workflow
-- (a 'submitted' verification) and NEVER mutates users.primary_account_type —
-- verification is an independent trust state, not the activation mechanism.
create extension if not exists pgtap;

begin;
select plan(18);

-- ---------------------------------------------------------------------------
-- Fixtures: two fresh, verified, non-active users (bootstrap trigger provisions
-- the base user + profile). Consent + completed shared steps are seeded directly
-- as the owner so we can drive the persona RPCs as each user.
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data,
                        raw_user_meta_data, email_confirmed_at, created_at, updated_at)
values
  ('c0000000-0000-4000-8000-0000000000c1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'persona-consumer@example.test',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Persona Consumer","locale":"en"}'::jsonb, now(), now(), now()),
  ('d0000000-0000-4000-8000-0000000000d1', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'persona-pro@example.test',
   '{"provider":"email","providers":["email"]}'::jsonb,
   '{"display_name":"Persona Pro","locale":"en"}'::jsonb, now(), now(), now());

insert into public.consent_receipts (user_id, consent_type, version, locale)
select u.id, t.t, app.current_consent_version(t.t), 'en'
from (values ('c0000000-0000-4000-8000-0000000000c1'::uuid),
             ('d0000000-0000-4000-8000-0000000000d1'::uuid)) u(id)
cross join unnest(array['terms','privacy','pilot']::public.consent_type[]) t(t);

insert into public.onboarding_progress
  (user_id, phone, selected_track, selected_persona,
   profile_completed_at, contact_completed_at, account_type_completed_at, completed_at)
values
  ('c0000000-0000-4000-8000-0000000000c1', '01012345678', 'consumer', null, now(), now(), now(), now()),
  ('d0000000-0000-4000-8000-0000000000d1', '01512345678', 'professional', 'engineer', now(), now(), now(), now());

-- ===========================================================================
-- Consumer branch
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"c0000000-0000-4000-8000-0000000000c1","role":"authenticated"}';

-- Before finishing, the derived state is the consumer flow (not activated).
select is(public.my_registration_state(), 'consumer_onboarding_pending',
  'consumer with the account-type step done resolves to consumer_onboarding_pending');

select lives_ok(
  $$ select public.individual_save_consumer('planning', array['flooring','lighting'], 'cairo', 'new_cairo', '100_250k') $$,
  'consumer can save their (optional) answers');
select is(
  (select consumer_intent from public.individual_onboarding where user_id = 'c0000000-0000-4000-8000-0000000000c1'),
  'planning', 'consumer intent is persisted');
select is(
  (select array_length(consumer_interests, 1) from public.individual_onboarding where user_id = 'c0000000-0000-4000-8000-0000000000c1'),
  2, 'consumer interests are persisted');

select lives_ok($$ select public.individual_complete_consumer() $$, 'consumer can reach the handoff');
-- Pilot UAT round 1: the consumer terminal is a USABLE state — completion
-- activates the personal account, so the derived state short-circuits to
-- active_personal (and the caller lands on /home).
select is(public.my_registration_state(), 'active_personal',
  'after completion the consumer account is active (usable terminal state)');
select is(
  (select status::text from public.users where id = 'c0000000-0000-4000-8000-0000000000c1'),
  'active', 'consumer completion activates the personal account');

-- A consumer cannot enter the professional branch (track gate at the DB).
select throws_ok(
  $$ select public.individual_save_professional('engineer'::public.persona_type) $$,
  '42501', null, 'a consumer-track caller is rejected by the professional RPC');

reset role;

-- ===========================================================================
-- Professional branch
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"d0000000-0000-4000-8000-0000000000d1","role":"authenticated"}';

select is(public.my_registration_state(), 'persona_onboarding_pending',
  'professional with the account-type step done resolves to persona_onboarding_pending');

-- A professional cannot complete the consumer branch.
select throws_ok(
  $$ select public.individual_complete_consumer() $$,
  '42501', null, 'a professional-track caller is rejected by the consumer RPC');

-- Save WITHOUT a headline first → submit must fail on the required-field check.
select lives_ok(
  $$ select public.individual_save_professional(
       'interior_designer'::public.persona_type, null, 8::smallint, 'residential', null,
       array['space_planning','styling'], null, array['arabic'], 'within_week',
       array['nasr_city'], false, 'cairo', 'nasr_city', 30::smallint) $$,
  'professional can save the common profile (concrete type resolved to interior_designer)');
select throws_ok(
  $$ select public.individual_submit_professional() $$,
  '22023', null, 'submit is blocked until the required fields (headline) are present');

-- Provide the headline, then submit succeeds and hands off to review.
select lives_ok(
  $$ select public.individual_save_professional(
       'interior_designer'::public.persona_type, 'Studio for interiors', 8::smallint, 'residential', null,
       array['space_planning','styling'], null, array['arabic'], 'within_week',
       array['nasr_city'], false, 'cairo', 'nasr_city', 30::smallint) $$,
  'professional adds the required headline');
select lives_ok($$ select public.individual_submit_professional() $$, 'professional submits for review');

-- The submit created a 'submitted' verification for the RESOLVED concrete type…
select is(
  (select count(*)::int from public.verifications
   where user_id = 'd0000000-0000-4000-8000-0000000000d1'
     and requested_account_type = 'interior_designer' and status = 'submitted'),
  1, 'submit hands off to the trusted upgrade workflow (a submitted verification)');
-- …and the account type is NEVER applied here. The identity carries no persona
-- yet (Sprint 12: no default), which is precisely the "claimed but not yet
-- granted" state — the declared type lives on the onboarding row until review.
select is(
  (select primary_account_type::text from public.users where id = 'd0000000-0000-4000-8000-0000000000d1'),
  null, 'submit NEVER mutates users.primary_account_type (review still required)');
-- Pilot UAT round 1: submission ACTIVATES the personal account. The review stays
-- open above (verification is an independent trust state), but the professional
-- is never trapped in a review-waiting screen.
select is(public.my_registration_state(), 'active_personal',
  'after submission the professional account is active while the review is still open');
select is(
  (select status::text from public.users where id = 'd0000000-0000-4000-8000-0000000000d1'),
  'active', 'professional submission activates the personal account');

reset role;

select * from finish();
rollback;
