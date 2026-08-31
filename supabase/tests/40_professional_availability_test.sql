-- pgTAP: Installer Pilot Increment 4 — availability (D6/O3, §8).
--
-- Availability is the smallest piece of state in the Pilot and the easiest to get
-- subtly wrong, because three different mistakes all still "work":
--
--   1. Letting the CLIENT write `availability_updated_at`. Everything looks
--      correct — the flag flips, a timestamp appears — but the one signal a
--      poster has for judging staleness becomes the one thing most worth faking.
--      O3 keeps the timestamp precisely so a human can weigh the claim; a
--      forgeable freshness stamp is worse than none at all.
--   2. Letting a NON-PROFESSIONAL set it. Harmless today (the public directory
--      excludes consumers, so nothing would ever display it) and therefore
--      invisible until the column quietly acquires a second meaning later.
--   3. Treating it as an AUTHORIZATION BOUNDARY or a discovery filter. Nothing
--      may read this flag to decide what anyone can do or see. An unavailable
--      professional stays listed and stays findable — hiding them would be the
--      platform deciding that "not right now" means "not at all", the exact
--      inference O3 refuses to make on someone's behalf.
--
-- Every section below exists to pin one of those three down.
--
-- IT IS ALSO NOT `individual_onboarding.prof_availability`. That is a one-off
-- LEAD-TIME preference (`within_week`/`within_month`/`flexible`) chosen during
-- onboarding and still private. This is a live on/off state. A person can be
-- `flexible` and not currently available; both are kept, and §H asserts the
-- private one did not leak when the public one was published.
--
-- Fixtures, all from seed-pilot:
--   70000009 — canonical installer_technician, LISTED
--   71000006 — canonical installer_technician, LISTED → stays UNAVAILABLE here,
--                to prove availability does not gate discovery
--   70000005 — null canonical → given a DECLARED type here (the review window)
--   70000003 — made a consumer here
--   70000004 — made a trainer here
--   11111111 — business-only identity (null persona)
create extension if not exists pgtap;

begin;
select plan(38);

update auth.users set email_confirmed_at = now()
  where id in ('70000009-0000-4000-8000-000000000009', '71000006-0000-4000-8000-000000000006',
               '70000005-0000-4000-8000-000000000005', '70000003-0000-4000-8000-000000000003',
               '70000004-0000-4000-8000-000000000004', '11111111-1111-4111-8111-111111111111');

-- The transitional professional: declared, canonical still null.
insert into public.individual_onboarding (user_id, prof_concrete_type, professional_completed_at)
values ('70000005-0000-4000-8000-000000000005', 'installer_technician', now())
on conflict (user_id) do update
  set prof_concrete_type = 'installer_technician', professional_completed_at = now();

update public.users set primary_account_type = 'trainer'
  where id = '70000004-0000-4000-8000-000000000004';
update public.users set primary_account_type = 'end_consumer'
  where id = '70000003-0000-4000-8000-000000000003';

-- ===========================================================================
-- A. The shape — columns, defaults, and the grant that is deliberately partial
-- ===========================================================================
select has_column('public'::name, 'profiles'::name, 'available_for_work'::name,
  'profiles.available_for_work exists');
select has_column('public'::name, 'profiles'::name, 'availability_updated_at'::name,
  'profiles.availability_updated_at exists');

select col_not_null('public'::name, 'profiles'::name, 'available_for_work'::name,
  'available_for_work is NOT NULL — there is no third, unknown state');
select col_is_null('public'::name, 'profiles'::name, 'availability_updated_at'::name,
  'availability_updated_at is nullable — NULL means "never set", not "false since forever"');

select col_default_is('public'::name, 'profiles'::name, 'available_for_work'::name, 'false',
  'a new profile defaults to NOT available — the platform never claims availability nobody stated');

-- THE ASYMMETRY THAT MATTERS. One column is the person's to write; the other
-- records when they wrote it and is therefore not theirs to supply.
select ok(
  has_column_privilege('authenticated', 'public.profiles', 'available_for_work', 'UPDATE'),
  'authenticated may update available_for_work — it is the person''s own claim');
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'availability_updated_at', 'UPDATE'),
  'authenticated may NOT update availability_updated_at — a forgeable freshness stamp is worse than none');

-- The existing narrow grant is untouched: this migration added a column to it,
-- it did not replace it.
select ok(
  has_column_privilege('authenticated', 'public.profiles', 'headline', 'UPDATE'),
  'the pre-existing narrow update grant survived (headline still writable)');
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'public_profile_status', 'UPDATE'),
  'and still does not include public_profile_status — nobody self-publishes');

select has_function('app', 'stamp_availability', array[]::name[],
  'the stamping/guard trigger function exists');
select is(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'app' and p.proname = 'stamp_availability'),
  true, 'app.stamp_availability is SECURITY DEFINER (it calls the internal persona predicate)');

-- ===========================================================================
-- B. A canonical professional sets their own availability
-- ===========================================================================
select is(
  (select availability_updated_at from public.profiles
    where user_id = '70000009-0000-4000-8000-000000000009'),
  null, 'before anyone touches it, the timestamp is NULL — never set');

set local role authenticated;
set local request.jwt.claims = '{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';

select lives_ok(
  $$ update public.profiles set available_for_work = true
       where user_id = '70000009-0000-4000-8000-000000000009' $$,
  'a canonical professional can set their own availability');

reset role;
select is(
  (select available_for_work from public.profiles
    where user_id = '70000009-0000-4000-8000-000000000009'),
  true, 'and the flag persisted');
select ok(
  (select availability_updated_at from public.profiles
    where user_id = '70000009-0000-4000-8000-000000000009') > now() - interval '1 minute',
  'and the timestamp was stamped by the trigger, without the caller supplying it');

-- ===========================================================================
-- C. The transitional professional — declared, canonical still null
-- ===========================================================================
-- The same window Increment 2 opened for profile editing: between submitting a
-- professional profile and an Admin applying the upgrade, the canonical column is
-- still null while the account is fully usable.
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000005-0000-4000-8000-000000000005","role":"authenticated"}';

select lives_ok(
  $$ update public.profiles set available_for_work = true
       where user_id = '70000005-0000-4000-8000-000000000005' $$,
  'a DECLARED professional can set availability while the upgrade is under review');

reset role;
select is(
  (select primary_account_type from public.users
    where id = '70000005-0000-4000-8000-000000000005'),
  null, 'setting availability applies no upgrade — the canonical persona is untouched');

-- ===========================================================================
-- D. Non-professional rejection
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000003-0000-4000-8000-000000000003","role":"authenticated"}';
select throws_ok(
  $$ update public.profiles set available_for_work = true
       where user_id = '70000003-0000-4000-8000-000000000003' $$,
  '42501', null, 'a CONSUMER is refused — availability is professional state');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000004-0000-4000-8000-000000000004","role":"authenticated"}';
select throws_ok(
  $$ update public.profiles set available_for_work = true
       where user_id = '70000004-0000-4000-8000-000000000004' $$,
  '42501', null, 'a TRAINER is refused — not an individual professional for this flow');

reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
select throws_ok(
  $$ update public.profiles set available_for_work = true
       where user_id = '11111111-1111-4111-8111-111111111111' $$,
  '42501', null, 'a BUSINESS-ONLY identity is refused — a person is not their company');

-- WITHDRAWING availability is always allowed. The guard is on the CLAIM, not on
-- every change: an identity that stops being a professional while marked
-- available must still be able to turn it off, or the platform goes on publishing
-- a claim the person is no longer permitted to retract.
reset role;
update public.profiles set available_for_work = true
  where user_id = '70000009-0000-4000-8000-000000000009';
update public.users set primary_account_type = 'end_consumer'
  where id = '70000009-0000-4000-8000-000000000009';

select lives_ok(
  $$ update public.profiles set available_for_work = false
       where user_id = '70000009-0000-4000-8000-000000000009' $$,
  'an identity that is no longer a professional can still WITHDRAW availability');
select is(
  (select available_for_work from public.profiles
    where user_id = '70000009-0000-4000-8000-000000000009'),
  false, 'and it actually came off — nobody is trapped at true');

select throws_ok(
  $$ update public.profiles set available_for_work = true
       where user_id = '70000009-0000-4000-8000-000000000009' $$,
  '42501', null, 'but they cannot claim it again — the guard is intact');

-- Restore the professional persona for the projection section below.
update public.users set primary_account_type = 'installer_technician'
  where id = '70000009-0000-4000-8000-000000000009';

-- ===========================================================================
-- E. Ownership — the row, not just the column
-- ===========================================================================
-- `profiles_update_self` restricts the ROW to its owner, so a professional
-- reaching for someone else's availability does not get an error — they get no
-- row at all, which is the stronger outcome: the target is not merely protected,
-- it is invisible.
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000009-0000-4000-8000-000000000009","role":"authenticated"}';

select lives_ok(
  $$ update public.profiles set available_for_work = true
       where user_id = '71000006-0000-4000-8000-000000000006' $$,
  'reaching for another professional''s availability raises nothing...');

reset role;
select is(
  (select available_for_work from public.profiles
    where user_id = '71000006-0000-4000-8000-000000000006'),
  false, '...because RLS matched no row — the other professional is unchanged');
select is(
  (select availability_updated_at from public.profiles
    where user_id = '71000006-0000-4000-8000-000000000006'),
  null, 'and their timestamp was never stamped');

-- ===========================================================================
-- F. Timestamp behaviour
-- ===========================================================================
-- The stamp is DERIVED, never accepted. Run as the table owner — the strongest
-- writer there is — and the supplied value is still discarded.
-- The flag must actually CHANGE for the trigger to fire — that is the WHEN
-- clause, and it is why a headline edit does not re-stamp. 70000009 is `false`
-- at this point (§D withdrew it), so the change here is back to `true`.
update public.profiles
  set available_for_work = true,
      availability_updated_at = timestamptz '2020-01-01 00:00:00+00'
  where user_id = '70000009-0000-4000-8000-000000000009';

select ok(
  (select availability_updated_at from public.profiles
    where user_id = '70000009-0000-4000-8000-000000000009') > now() - interval '1 minute',
  'a caller-supplied timestamp is DISCARDED — even from the table owner');
select is(
  (select available_for_work from public.profiles
    where user_id = '70000009-0000-4000-8000-000000000009'),
  true, 'while the flag itself took the value that was written');

-- An unrelated profile edit must not disturb the stamp: `availability_updated_at`
-- means "when availability changed", not "when this row was last written". If a
-- headline edit re-stamped it, the age a poster reads would be meaningless.
create temp table stamp_before as
  select availability_updated_at as v from public.profiles
   where user_id = '70000009-0000-4000-8000-000000000009';

update public.profiles set headline = 'An unrelated edit'
  where user_id = '70000009-0000-4000-8000-000000000009';

select is(
  (select availability_updated_at from public.profiles
    where user_id = '70000009-0000-4000-8000-000000000009'),
  (select v from stamp_before),
  'editing a headline does NOT re-stamp availability — the age stays truthful');

-- Setting the SAME value is not a change, so it does not re-stamp either. Without
-- this, a client that wrote the current value on every page load would keep the
-- profile looking permanently fresh while nobody ever revisited the claim.
update public.profiles set available_for_work = false
  where user_id = '70000005-0000-4000-8000-000000000005';
select is(
  (select available_for_work from public.profiles
    where user_id = '70000005-0000-4000-8000-000000000005'),
  false, 'a real change from true to false is applied');

-- ===========================================================================
-- G. No automatic expiry (O3)
-- ===========================================================================
-- The guarantee is structural: the ONLY trigger that can touch these columns is
-- the stamping one, and it fires solely on an explicit change. Nothing scheduled,
-- nothing cascading, nothing that flips the flag on its own.
select is(
  (select count(*)::int from pg_trigger tg
     join pg_class c on c.oid = tg.tgrelid
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'profiles'
      and not tg.tgisinternal
      and tg.tgname = 'stamp_profiles_availability'),
  1, 'exactly one availability trigger exists on profiles');

select is(
  (select count(*)::int from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('app', 'public')
      and p.prosrc like '%available_for_work%'
      and p.proname <> 'stamp_availability'
      and p.proname <> '_profile_public_directory'),
  0, 'no other function in app/public writes or reads available_for_work — no expiry job exists');

-- ===========================================================================
-- H. The public projection (§8.4) — and what did NOT travel with it
-- ===========================================================================
update public.profiles set available_for_work = true
  where user_id = '70000009-0000-4000-8000-000000000009';

-- `profiles.id` is gen_random_uuid() and is NOT seeded, so the public ids have to
-- be resolved BEFORE dropping to anon — anon cannot read the base table at all,
-- which is exactly the boundary under test three assertions below.
create temp table fx as
  select user_id, id from public.profiles
   where user_id in ('70000009-0000-4000-8000-000000000009',
                     '71000006-0000-4000-8000-000000000006');
grant select on fx to anon, authenticated;

set local role anon;
set local request.jwt.claims = '';

select is(
  (select available_for_work from public.profile_public_directory
    where id = (select id from fx where user_id = '70000009-0000-4000-8000-000000000009')),
  true, 'anon sees the availability the professional set');

select ok(
  (select availability_updated_at from public.profile_public_directory
    where id = (select id from fx where user_id = '70000009-0000-4000-8000-000000000009')) is not null,
  'and the timestamp travels with it, so the age can be shown');

-- AVAILABILITY IS NOT A DISCOVERY FILTER. 71000006 is listed and NOT available.
select ok(
  exists (select 1 from public.profile_public_directory
           where id = (select id from fx where user_id = '71000006-0000-4000-8000-000000000006')),
  'an UNAVAILABLE professional is still listed — the flag gates nothing');

select is(
  (select available_for_work from public.profile_public_directory
    where id = (select id from fx where user_id = '71000006-0000-4000-8000-000000000006')),
  false, 'and reads as unavailable rather than being hidden');

-- The private lead-time preference is a DIFFERENT fact and stays private.
select ok(
  not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profile_public_directory'
       and column_name in ('prof_availability', 'availability')),
  'the private lead-time preference did not leak in alongside the public flag');

select throws_ok(
  $$ select prof_availability from public.individual_onboarding limit 1 $$,
  '42501', null, 'and individual_onboarding itself is still unreadable by anon');

rollback;
