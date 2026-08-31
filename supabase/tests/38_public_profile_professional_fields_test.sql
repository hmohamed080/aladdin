-- pgTAP: Installer Pilot Increment 2 — the public professional profile's practice fields.
--
-- Two properties, and the second is the one that would have shipped a regression:
--
--   1. A listed professional's self-declared practice — specialization, core
--      services, years of experience, service areas — is readable through
--      `profile_public_directory`, by `anon` as well as `authenticated`, while
--      NOTHING private travels with it: no consumer answers, no availability, no
--      travel radius, no base address, no user_id, no contact, no timestamps.
--
--   2. The four columns arrive by LEFT JOIN. Every listed profile in the Pilot
--      seed has NO `individual_onboarding` row at all, so an inner join would
--      have emptied the technicians directory, the consultants directory and
--      every public profile page at once — while every assertion about the new
--      columns still passed on the rows that survived.
--
-- And the boundary that must not move: `individual_onboarding` itself stays
-- private. The definer reader may cross into it; a caller may not.
--
-- Fixtures, all from seed-pilot:
--   70000009 — Ahmed Sobhy, installer_technician, LISTED, no onboarding row
--                → given one here, to prove the populated case
--   71000006 — Sayed Abdel-Rahman, installer_technician, LISTED, no onboarding row
--                → left untouched, to prove the null case still lists
--   70000008 — an engineer whose profile is NOT listed
--   70000002 — an unrelated authenticated caller, for the privacy check
create extension if not exists pgtap;

begin;
select plan(39);

-- ---------------------------------------------------------------------------
-- Fixture: one listed installer gains a real professional onboarding row.
-- ---------------------------------------------------------------------------
insert into public.individual_onboarding (
  user_id, prof_concrete_type, prof_specialization, prof_services,
  prof_additional_services, prof_years_experience, prof_service_areas,
  prof_availability, prof_governorate, prof_city, prof_max_travel_km,
  consumer_intent, consumer_interests, consumer_budget
) values (
  '70000009-0000-4000-8000-000000000009',
  'installer_technician',
  'painting_finishing',
  array['wall_painting', 'plastering'],
  array['ceiling_work'],
  12,
  array['nasr_city', 'new_cairo'],
  'within_week',
  'cairo',
  'nasr_city',
  40,
  'planning',
  array['walls'],
  '100_250k'
)
on conflict (user_id) do update set
  prof_specialization      = excluded.prof_specialization,
  prof_services            = excluded.prof_services,
  prof_additional_services = excluded.prof_additional_services,
  prof_years_experience    = excluded.prof_years_experience,
  prof_service_areas       = excluded.prof_service_areas,
  prof_availability        = excluded.prof_availability,
  prof_governorate         = excluded.prof_governorate,
  prof_city                = excluded.prof_city,
  prof_max_travel_km       = excluded.prof_max_travel_km,
  consumer_intent          = excluded.consumer_intent,
  consumer_interests       = excluded.consumer_interests,
  consumer_budget          = excluded.consumer_budget;

-- ---------------------------------------------------------------------------
-- The two profile ids under test, captured while still unrestricted.
-- ---------------------------------------------------------------------------
-- `profiles.id` is a generated uuid, not a seeded constant: it changes on every
-- `db reset`, so it cannot be written into an assertion. Capturing it here also
-- lets the anon section below name a profile it could never look up itself.
create temp table fx as
select
  (select id from public.profiles where user_id = '70000009-0000-4000-8000-000000000009') as with_onboarding,
  (select id from public.profiles where user_id = '71000006-0000-4000-8000-000000000006') as without_onboarding;
grant select on fx to anon, authenticated;

select isnt((select with_onboarding from fx), null, 'the populated fixture profile resolved');
select isnt((select without_onboarding from fx), null, 'the no-onboarding fixture profile resolved');

-- ===========================================================================
-- A. The projection's shape — what it has, and what it must never have
-- ===========================================================================
select has_view('public', 'profile_public_directory', 'the public projection still exists');

select columns_are(
  'public', 'profile_public_directory',
  array['id', 'display_name', 'headline', 'bio', 'avatar_media_id', 'locality_id',
        'languages', 'persona', 'specialization', 'services', 'years_experience',
        'service_areas'],
  'the projection exposes exactly the approved identity + practice columns'
);

-- Stated individually as well as in the set above, because `columns_are` failing
-- says "the list differs" while these say WHICH boundary was crossed.
select hasnt_column('public', 'profile_public_directory', 'user_id',
  'the projection never exposes user_id');
select hasnt_column('public', 'profile_public_directory', 'availability',
  'availability is out of scope for this increment and is not exposed');
select hasnt_column('public', 'profile_public_directory', 'max_travel_km',
  'travel radius stays unexposed — the distance display is unapproved');
select hasnt_column('public', 'profile_public_directory', 'governorate',
  'a base address is not a service area and is not exposed');
select hasnt_column('public', 'profile_public_directory', 'city',
  'a base city is not exposed');
select hasnt_column('public', 'profile_public_directory', 'additional_services',
  'only the CORE services are published');
select hasnt_column('public', 'profile_public_directory', 'consumer_intent',
  'no consumer answer reaches the professional projection');
select hasnt_column('public', 'profile_public_directory', 'consumer_budget',
  'a budget band is never public');
select hasnt_column('public', 'profile_public_directory', 'consumer_interests',
  'consumer interests are never public');
select hasnt_column('public', 'profile_public_directory', 'created_at',
  'no timestamps travel with the projection');
select hasnt_column('public', 'profile_public_directory', 'deleted_at',
  'soft-delete state is never exposed');
select hasnt_column('public', 'profile_public_directory', 'public_profile_status',
  'the listing decision itself is not published');

-- ===========================================================================
-- B. The populated case — a listed professional WITH an onboarding row
-- ===========================================================================
select is(
  (select specialization from public.profile_public_directory
    where id = (select with_onboarding from fx)),
  'painting_finishing',
  'the self-declared specialization is published'
);

select is(
  (select services from public.profile_public_directory
    where id = (select with_onboarding from fx)),
  array['wall_painting', 'plastering'],
  'the core services are published'
);

select is(
  (select years_experience from public.profile_public_directory
    where id = (select with_onboarding from fx)),
  12::smallint,
  'years of experience is published'
);

select is(
  (select service_areas from public.profile_public_directory
    where id = (select with_onboarding from fx)),
  array['nasr_city', 'new_cairo'],
  'the service areas are published'
);

select is(
  (select persona from public.profile_public_directory
    where id = (select with_onboarding from fx)),
  'installer_technician'::public.persona_type,
  'the persona still gates and labels the row'
);

-- ===========================================================================
-- C. The LEFT JOIN — the regression this increment could most easily have shipped
-- ===========================================================================
select isnt_empty(
  $$ select 1 from public.profile_public_directory
      where id = (select without_onboarding from fx) $$,
  'a listed professional with NO onboarding row still appears'
);

select is(
  (select specialization from public.profile_public_directory
    where id = (select without_onboarding from fx)),
  null,
  'and reports a null specialization rather than vanishing'
);

select is(
  (select services from public.profile_public_directory
    where id = (select without_onboarding from fx)),
  null,
  'and a null service list rather than vanishing'
);

-- The whole-directory version of the same guard: the projection returns exactly
-- the rows the listing predicate selects, onboarding row or not.
select is(
  (select count(*) from public.profile_public_directory),
  (select count(*)
     from public.profiles p
     join public.users u on u.id = p.user_id
    where p.deleted_at is null
      and p.public_profile_status = 'listed'::public.public_profile_status
      and u.status = 'active'::public.user_status
      and u.primary_account_type is not null
      and u.primary_account_type <> 'end_consumer'::public.persona_type),
  'the join adds no rows and — the real risk — drops none'
);

-- ===========================================================================
-- D. The listing predicate is unchanged
-- ===========================================================================
select is_empty(
  $$ select 1 from public.profile_public_directory
      where id in (select id from public.profiles
                    where public_profile_status <> 'listed') $$,
  'an unlisted profile is still absent, new columns or not'
);

select is_empty(
  $$ select 1 from public.profile_public_directory d
      join public.profiles p on p.id = d.id
     where p.deleted_at is not null $$,
  'a soft-deleted profile is still absent'
);

-- ===========================================================================
-- E. individual_onboarding itself stays private
-- ===========================================================================
-- The definer reader crosses into the table; a caller must not. This is the
-- boundary the new join could have quietly moved.
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000002-0000-4000-8000-000000000002","role":"authenticated"}';
select is(
  (select count(*) from public.individual_onboarding
    where user_id = '70000009-0000-4000-8000-000000000009'),
  0::bigint,
  'an unrelated authenticated caller reads NO row of another person''s onboarding'
);

select is(
  (select count(*) from public.individual_onboarding),
  0::bigint,
  'and none of anyone else''s either — RLS is untouched'
);

select policies_are(
  'public', 'individual_onboarding',
  array['individual_onboarding_select_self'],
  'no policy was added to individual_onboarding to serve the projection'
);

-- ===========================================================================
-- F. Anonymous discovery still works, and reaches the same columns
-- ===========================================================================
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

select isnt_empty(
  $$ select 1 from public.profile_public_directory
      where id = (select with_onboarding from fx) $$,
  'anon can still read the public directory'
);

select is(
  (select specialization from public.profile_public_directory
    where id = (select with_onboarding from fx)),
  'painting_finishing',
  'anon sees the published practice fields — the public page is signed-out reachable'
);

select is(
  (select years_experience from public.profile_public_directory
    where id = (select with_onboarding from fx)),
  12::smallint,
  'anon sees years of experience'
);

select throws_ok(
  $$ select 1 from public.individual_onboarding $$,
  '42501',
  null,
  'anon still cannot touch individual_onboarding at all'
);

-- ===========================================================================
-- G. Grants — the ACL the DROP destroyed must be fully reasserted
-- ===========================================================================
reset role;

select ok(
  has_table_privilege('anon', 'public.profile_public_directory', 'SELECT'),
  'anon keeps SELECT on the view'
);
select ok(
  has_table_privilege('authenticated', 'public.profile_public_directory', 'SELECT'),
  'authenticated keeps SELECT on the view'
);
select ok(
  has_function_privilege('anon', 'app._profile_public_directory()', 'EXECUTE'),
  'anon keeps EXECUTE on the reader — the security_invoker view needs it'
);
select ok(
  has_function_privilege('authenticated', 'app._profile_public_directory()', 'EXECUTE'),
  'authenticated keeps EXECUTE on the reader'
);
select ok(
  not has_function_privilege('public', 'app._profile_public_directory()', 'EXECUTE'),
  'PUBLIC execute stays revoked on the reader'
);

select * from finish();
rollback;
