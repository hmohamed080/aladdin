-- pgTAP: identity & profile invariants (Phase 1).
-- Proves the ONE-canonical-identity rule: exactly one base user + one base profile
-- per auth user, created by the server-side bootstrap, and impossible to duplicate.
create extension if not exists pgtap;

begin;
select plan(9);

-- Seeded fixtures exist and are 1-1.
select is(
  (select count(*)::int from public.users where id = '11111111-1111-4111-8111-111111111111'),
  1, 'exactly one base user row for the seeded identity');
select is(
  (select count(*)::int from public.profiles where user_id = '11111111-1111-4111-8111-111111111111'),
  1, 'exactly one base profile row for the seeded identity');

-- Duplicate base profile is structurally impossible (uq_profiles_user_id).
select throws_ok(
  $$ insert into public.profiles (user_id, display_name)
     values ('11111111-1111-4111-8111-111111111111', 'Duplicate') $$,
  '23505', null,
  'a second base profile for the same user violates the unique constraint');

-- Duplicate base user is structurally impossible (PK = auth.uid()).
select throws_ok(
  $$ insert into public.users (id, primary_account_type)
     values ('11111111-1111-4111-8111-111111111111', 'engineer') $$,
  '23505', null,
  'a second base user row for the same id violates the primary key');

-- Account upgrade EXTENDS the identity: changing the account type must not fork
-- the user or create a second profile.
update public.users set primary_account_type = 'engineer'
  where id = '44444444-4444-4444-8444-444444444444';
select is(
  (select count(*)::int from public.users where id = '44444444-4444-4444-8444-444444444444'),
  1, 'account upgrade does not create a second user row');
select is(
  (select count(*)::int from public.profiles where user_id = '44444444-4444-4444-8444-444444444444'),
  1, 'account upgrade does not create a second base profile');

-- Server-side bootstrap: a new auth user auto-provisions users + profiles atomically.
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data,
                        raw_user_meta_data, email_confirmed_at, created_at, updated_at)
values ('99999999-9999-4999-8999-999999999999', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'fresh@example.test',
        '{"provider":"email","providers":["email"]}'::jsonb,
        '{"display_name":"Fresh Signup","locale":"ar"}'::jsonb, now(), now(), now());
select is(
  (select count(*)::int from public.users where id = '99999999-9999-4999-8999-999999999999'),
  1, 'bootstrap trigger created the base user for a new auth user');
select is(
  (select display_name from public.profiles where user_id = '99999999-9999-4999-8999-999999999999'),
  'Fresh Signup', 'bootstrap trigger created the base profile with the supplied display name');
select is(
  (select locale from public.users where id = '99999999-9999-4999-8999-999999999999'),
  'ar', 'bootstrap trigger honored the supplied locale');

select * from finish();
rollback;
