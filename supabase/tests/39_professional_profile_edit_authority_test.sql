-- pgTAP: Installer Pilot Increment 2 — who may edit a professional profile.
--
-- The mismatch this closes: `individual_save_professional` gated on
-- `onboarding_progress.selected_track = 'professional'`, which records HOW an
-- identity was created rather than WHAT it is. NO seeded Pilot identity has a
-- selected_track at all, so every seeded professional — listed in the public
-- directory, rendered a professional home, given a public profile page — could
-- not edit a word of it.
--
-- The properties under test:
--
--   1. A professional identity may edit, whether it is CANONICAL
--      (users.primary_account_type, the applied upgrade) or DECLARED
--      (individual_onboarding.prof_concrete_type, the review window).
--   2. First-time onboarding still works: a caller with ONLY the professional
--      track — no canonical persona, no declared type, because this very call is
--      what writes it — is still admitted. Dropping that branch would have broken
--      the flow the gate was written for.
--   3. A consumer, a trainer/trainee, a business-only identity and a signed-out
--      caller are refused exactly as before.
--   4. The predicate cannot bootstrap itself: the declared type is written ONLY
--      by this function, so a refused caller gains nothing to be recognised by.
--   5. Ownership, registration and validation are untouched.
--
-- Fixtures, all from seed-pilot (none has a selected_track — that is the point):
--   70000009 — canonical installer_technician, no track, no onboarding row
--                → THE seeded case the old gate blocked
--   70000005 — null canonical, no track → given a DECLARED type here
--   70000003 — made a consumer here (track = consumer)
--   70000004 — made a trainer here (canonical persona, not a professional one)
--   11111111 — null canonical, no track, no onboarding row (business-only)
create extension if not exists pgtap;

begin;
select plan(33);

update auth.users set email_confirmed_at = now()
  where id in ('70000009-0000-4000-8000-000000000009', '70000005-0000-4000-8000-000000000005',
               '70000003-0000-4000-8000-000000000003', '70000004-0000-4000-8000-000000000004',
               '70000010-0000-4000-8000-000000000010', '11111111-1111-4111-8111-111111111111');

-- The transitional fixture: a professional between submitting their profile and
-- an Admin applying the upgrade. Canonical is still NULL — exactly the window in
-- which a canonical-only rule locks a real professional out of their own profile.
insert into public.individual_onboarding (user_id, prof_concrete_type, professional_completed_at)
values ('70000005-0000-4000-8000-000000000005', 'installer_technician', now())
on conflict (user_id) do update
  set prof_concrete_type = 'installer_technician', professional_completed_at = now();

-- A consumer, and a trainer. Neither is an individual professional for this flow.
insert into public.onboarding_progress (user_id, selected_track)
values ('70000003-0000-4000-8000-000000000003', 'consumer')
on conflict (user_id) do update set selected_track = 'consumer';

update public.users set primary_account_type = 'trainer'
  where id = '70000004-0000-4000-8000-000000000004';

-- ===========================================================================
-- A. The predicate itself
-- ===========================================================================
select has_function('app', 'is_professional_persona', array['uuid'],
  'the professional-identity predicate exists');

select is(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'is_professional_persona'),
  true, 'app.is_professional_persona is SECURITY DEFINER');

select ok(
  not has_function_privilege('authenticated', 'app.is_professional_persona(uuid)', 'EXECUTE'),
  'the predicate is internal — authenticated cannot call it directly');

select ok(app.is_professional_persona('70000009-0000-4000-8000-000000000009'),
  'a CANONICAL professional is recognised');
select ok(app.is_professional_persona('70000005-0000-4000-8000-000000000005'),
  'a DECLARED professional is recognised while the upgrade is under review');
select ok(not app.is_professional_persona('70000004-0000-4000-8000-000000000004'),
  'a trainer is not an individual professional');
select ok(not app.is_professional_persona('11111111-1111-4111-8111-111111111111'),
  'a business-only identity is not a professional');
select ok(not app.is_professional_persona(null),
  'a null caller is never a professional');

-- ===========================================================================
-- B. The seeded case — canonical professional, no track. Previously REFUSED.
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';

select lives_ok(
  $$ select public.individual_save_professional(
       'installer_technician'::public.persona_type, 'Finishing specialist', 12::smallint,
       'gypsum_paint', 'Twelve years of interior finishing.',
       array['finishing'], null, array['arabic'], 'flexible',
       array['nasr_city'], false, 'cairo', null, null) $$,
  'a canonical professional with NO onboarding track can now edit');

select is(
  (select prof_specialization from public.individual_onboarding
    where user_id = '70000009-0000-4000-8000-000000000009'),
  'gypsum_paint', 'and the edit actually persisted');

select is(
  (select headline from public.profiles
    where user_id = '70000009-0000-4000-8000-000000000009'),
  'Finishing specialist', 'including the reused profiles columns');

-- The write is scoped to the caller and nothing else: the function takes no user
-- id, so there is no parameter through which another row could be reached.
select is(
  (select count(*) from public.individual_onboarding
    where prof_specialization = 'gypsum_paint'
      and user_id <> '70000009-0000-4000-8000-000000000009'),
  0::bigint, 'the edit touched no other person''s profile');

-- ===========================================================================
-- C. The transitional case — declared professional, canonical still null
-- ===========================================================================
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000005-0000-4000-8000-000000000005","role":"authenticated"}';

select lives_ok(
  $$ select public.individual_save_professional(
       'installer_technician'::public.persona_type, 'Tiling and plaster', 5::smallint,
       'full_finishing', null, array['renovation'], null, null, null,
       null, false, null, null, null) $$,
  'a DECLARED professional can edit while the upgrade is still under review');

select is(
  (select prof_specialization from public.individual_onboarding
    where user_id = '70000005-0000-4000-8000-000000000005'),
  'full_finishing', 'and that edit persisted too');

select is(
  (select primary_account_type from public.users
    where id = '70000005-0000-4000-8000-000000000005'),
  null, 'editing does NOT apply an upgrade — the canonical persona is untouched');

-- ===========================================================================
-- D. First-time onboarding — the branch that must not be lost
-- ===========================================================================
-- Only a track: no canonical persona, no declared type, because this call is what
-- writes it. This is the flow the original gate existed for.
reset role;
insert into public.onboarding_progress (user_id, selected_track)
values ('70000010-0000-4000-8000-000000000010', 'professional')
on conflict (user_id) do update set selected_track = 'professional';
update public.users set primary_account_type = null
  where id = '70000010-0000-4000-8000-000000000010';

select ok(not app.is_professional_persona('70000010-0000-4000-8000-000000000010'),
  'a first-time caller is NOT yet a professional identity — only a track');

set local role authenticated;
set local request.jwt.claims = '{"sub":"70000010-0000-4000-8000-000000000010","role":"authenticated"}';

select lives_ok(
  $$ select public.individual_save_professional(
       'engineer'::public.persona_type, 'Structural engineer', 3::smallint,
       'structural', null, array['structural_design'], null, null, null,
       null, false, null, null, null) $$,
  'and is admitted by the track alone — first-time onboarding still works');

-- ===========================================================================
-- E. Everyone who must still be refused
-- ===========================================================================
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000003-0000-4000-8000-000000000003","role":"authenticated"}';

select throws_ok(
  $$ select public.individual_save_professional(
       'installer_technician'::public.persona_type, 'I am an installer', 9::smallint,
       null, null, null, null, null, null, null, false, null, null, null) $$,
  '42501', null,
  'a CONSUMER cannot write a professional profile');

-- The bootstrap check: the refusal left nothing behind that would make them a
-- professional identity on a second attempt. Read as postgres, because the
-- predicate is internal — the assertion above proves `authenticated` cannot call
-- it, and that is exactly why this line must drop the role first.
reset role;
select ok(not app.is_professional_persona('70000003-0000-4000-8000-000000000003'),
  'and the refusal created no declared type — the predicate cannot bootstrap itself');

select is(
  (select count(*) from public.individual_onboarding
    where user_id = '70000003-0000-4000-8000-000000000003'
      and prof_concrete_type is not null),
  0::bigint, 'no professional row was written for the refused consumer');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000004-0000-4000-8000-000000000004","role":"authenticated"}';

select throws_ok(
  $$ select public.individual_save_professional(
       'contractor'::public.persona_type, 'x', 1::smallint,
       null, null, null, null, null, null, null, false, null, null, null) $$,
  '42501', null,
  'a TRAINER cannot write a professional profile');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';

select throws_ok(
  $$ select public.individual_save_professional(
       'engineer'::public.persona_type, 'x', 1::smallint,
       null, null, null, null, null, null, null, false, null, null, null) $$,
  '42501', null,
  'a BUSINESS-ONLY identity cannot write a personal professional profile');

reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

select throws_ok(
  $$ select public.individual_save_professional(
       'engineer'::public.persona_type, 'x', 1::smallint,
       null, null, null, null, null, null, null, false, null, null, null) $$,
  '42501', null,
  'a signed-out caller is refused — registration still gates everything');

-- ===========================================================================
-- F. Validation is untouched
-- ===========================================================================
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';

select throws_ok(
  $$ select public.individual_save_professional(
       'end_consumer'::public.persona_type, 'x', 1::smallint,
       null, null, null, null, null, null, null, false, null, null, null) $$,
  '22023', null,
  'end_consumer is still not a valid individual professional type');

select throws_ok(
  $$ select public.individual_save_professional(
       'trainer'::public.persona_type, 'x', 1::smallint,
       null, null, null, null, null, null, null, false, null, null, null) $$,
  '22023', null,
  'trainer is still not a valid individual professional type');

select throws_ok(
  $$ select public.individual_save_professional(
       'installer_technician'::public.persona_type, 'x', 1::smallint,
       null, null, null, null, null, 'whenever', null, false, null, null, null) $$,
  '22023', null,
  'an invalid availability is still rejected');

select throws_ok(
  $$ select public.individual_save_professional(
       null::public.persona_type, 'x', 1::smallint,
       null, null, null, null, null, null, null, false, null, null, null) $$,
  '22023', null,
  'a null professional type is still rejected');

-- The authority check runs BEFORE validation, so a non-professional never learns
-- which of their arguments were also wrong.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000003-0000-4000-8000-000000000003","role":"authenticated"}';

select throws_ok(
  $$ select public.individual_save_professional(
       'end_consumer'::public.persona_type, 'x', 1::smallint,
       null, null, null, null, null, 'whenever', null, false, null, null, null) $$,
  '42501', null,
  'a refused caller gets the authority error, not a validation hint');

-- ===========================================================================
-- G. Ownership and grants — structurally unchanged
-- ===========================================================================
reset role;

-- The strongest ownership statement available: there is no parameter through
-- which a caller could name someone else.
select is(
  (select count(*) from unnest(
     (select p.proargnames from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'individual_save_professional')) as a
    where a in ('p_user_id', 'p_uid', 'p_target_user_id')),
  0::bigint,
  'the function accepts no caller-supplied user id');

select is(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'individual_save_professional'),
  true, 'individual_save_professional is still SECURITY DEFINER');

select ok(
  has_function_privilege('authenticated',
    'public.individual_save_professional(public.persona_type, text, smallint, text, text, text[], text[], text[], text, text[], boolean, text, text, smallint)',
    'EXECUTE'),
  'authenticated keeps EXECUTE — create-or-replace preserved the ACL');

select ok(
  not has_function_privilege('anon',
    'public.individual_save_professional(public.persona_type, text, smallint, text, text, text[], text[], text[], text, text[], boolean, text, text, smallint)',
    'EXECUTE'),
  'anon still has no EXECUTE');

-- And the submit terminal was deliberately NOT widened.
select ok(
  (select prosrc like '%professional onboarding requires the professional track%'
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'individual_submit_professional'),
  'individual_submit_professional keeps its track gate — submitting is not editing');

select * from finish();
rollback;
