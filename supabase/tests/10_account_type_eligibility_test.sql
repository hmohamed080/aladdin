-- pgTAP: account-type & public-profile eligibility authorization (Sprint 1.2 fix).
-- primary_account_type, identity verification, and public-profile visibility are
-- ALL server-controlled: a user cannot self-promote to a professional type, cannot
-- self-verify, and cannot self-list for public discovery. Safe preferences (locale)
-- stay self-editable, and the trusted service_role path can transition account type.
create extension if not exists pgtap;

begin;
select plan(12);

-- ---- 1. An end consumer cannot directly UPDATE primary_account_type ------
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';
select throws_ok(
  $$ update public.users set primary_account_type = 'engineer'
     where id = '44444444-4444-4444-8444-444444444444' $$,
  '42501', null,
  'an end consumer cannot self-promote primary_account_type (column not granted)');

-- ---- 2. A user cannot self-set identity verification ---------------------
select throws_ok(
  $$ update public.users set is_verified = true
     where id = '44444444-4444-4444-8444-444444444444' $$,
  '42501', null,
  'a user cannot self-set users.is_verified (server-controlled)');
select throws_ok(
  $$ update public.users set status = 'active'
     where id = '44444444-4444-4444-8444-444444444444' $$,
  '42501', null,
  'a user cannot self-set users.status (server-controlled)');

-- ---- 3. A user cannot self-approve public-profile visibility -------------
select throws_ok(
  $$ update public.profiles set public_profile_status = 'listed'
     where user_id = '44444444-4444-4444-8444-444444444444' $$,
  '42501', null,
  'a user cannot self-list their profile for public discovery (server-controlled)');

-- ---- 8. Safe self-editable preferences still work -----------------------
select lives_ok(
  $$ update public.users set locale = 'ar'
     where id = '44444444-4444-4444-8444-444444444444' $$,
  'a user can still update their own safe preference (locale)');
select lives_ok(
  $$ update public.profiles set display_name = 'Omar Updated'
     where user_id = '44444444-4444-4444-8444-444444444444' $$,
  'a user can still update their own display_name');

-- Confirm the account type genuinely did NOT change from the denied attempts.
reset role;
select is(
  (select primary_account_type::text from public.users where id = '44444444-4444-4444-8444-444444444444'),
  'end_consumer', 'the consumer''s account type is unchanged after the denied self-promotion');
select is(
  (select public_profile_status::text from public.profiles where user_id = '44444444-4444-4444-8444-444444444444'),
  'hidden', 'the consumer''s profile remains hidden after the denied self-listing');

-- ---- 5. An approved professional appears only when all conditions hold ---
-- Karim is a professional account type but hidden → not discoverable; listing him
-- via the trusted path makes him appear.
set local role anon;
set local request.jwt.claims = '';
select is(
  (select count(*)::int from public.profile_public_directory where display_name like 'Karim%'),
  0, 'a professional profile that is not listed does not appear');
reset role;
update public.profiles set public_profile_status = 'listed'
  where user_id = '22222222-2222-4222-8222-222222222222';
set local role anon;
set local request.jwt.claims = '';
select is(
  (select count(*)::int from public.profile_public_directory where display_name like 'Karim%'),
  1, 'once listed via the trusted path, the professional profile appears');

-- ---- 10. The trusted service_role path can transition account type -------
reset role;
set local role service_role;
select lives_ok(
  $$ update public.users set primary_account_type = 'engineer'
     where id = '44444444-4444-4444-8444-444444444444' $$,
  'service_role (trusted upgrade path) can transition primary_account_type');
reset role;
select is(
  (select primary_account_type::text from public.users where id = '44444444-4444-4444-8444-444444444444'),
  'engineer', 'the trusted account-type transition took effect');

select * from finish();
rollback;
