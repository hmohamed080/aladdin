-- pgTAP: M1 - profile_set_phone refuses to move an installer phone-alias account
-- off the number its login alias encodes, without touching ordinary accounts or
-- installer registration.
--
-- An installer registered with phone + password signs in with
--     p<E.164 digits>@craftsman-login.aladdin.invalid
-- (auth.users.email). The profile phone must therefore stay equal to the phone
-- the alias encodes. This file proves, against the real schema:
--   * the initial assignment installer sign-up performs still works;
--   * a same-number re-save works; a different number raises 42501;
--   * a malformed / look-alike alias fails closed or is treated as ordinary
--     exactly as specified;
--   * ordinary email accounts behave exactly as before (incl. uniqueness);
--   * unauthenticated callers are refused;
--   * authenticated / service_role have no direct UPDATE/INSERT path to the
--     phone columns, and the set of functions that write profiles.phone_* is
--     exactly profile_set_phone plus the two service-only installer phone-change
--     journal functions of M3 (a guard against any further writer);
--   * the full installer registration sequence still reaches access_ready.
create extension if not exists pgtap;

begin;
select plan(51);

-- ---------------------------------------------------------------------------
-- Fixtures (all confirmed; the trigger creates public.users + public.profiles).
--   a1 alias +201055500001   a2 alias +201055500002 (number later held by e2)
--   a3 alias +201055500003   a4 alias with UPPER-CASE address (+201055500004)
--   a5 alias +201055500009, profile later drifted to +201055500099 (pre-guard edit)
--   m1/m2/m3/m5 malformed aliases   m4 look-alike domain (NOT an alias)
--   e1/e2 ordinary email accounts   r1 registrant (alias +201055500008)
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
                        email_confirmed_at, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email,
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), now()
from (values
  ('90000000-0000-4000-8000-0000000000a1', 'p201055500001@craftsman-login.aladdin.invalid'),
  ('90000000-0000-4000-8000-0000000000a2', 'p201055500002@craftsman-login.aladdin.invalid'),
  ('90000000-0000-4000-8000-0000000000a3', 'p201055500003@craftsman-login.aladdin.invalid'),
  ('90000000-0000-4000-8000-0000000000a4', 'P201055500004@CRAFTSMAN-LOGIN.ALADDIN.INVALID'),
  ('90000000-0000-4000-8000-0000000000a5', 'p201055500009@craftsman-login.aladdin.invalid'),
  ('90000000-0000-4000-8000-0000000000b1', 'pabc@craftsman-login.aladdin.invalid'),
  ('90000000-0000-4000-8000-0000000000b2', 'p12345@craftsman-login.aladdin.invalid'),
  ('90000000-0000-4000-8000-0000000000b3', 'p0201055500005@craftsman-login.aladdin.invalid'),
  ('90000000-0000-4000-8000-0000000000b4', 'p201055500006@craftsman-login.aladdin.invalid.example.test'),
  ('90000000-0000-4000-8000-0000000000b5', 'x201055500007@craftsman-login.aladdin.invalid'),
  ('90000000-0000-4000-8000-0000000000e1', 'p90-email-1@example.test'),
  ('90000000-0000-4000-8000-0000000000e2', 'p90-email-2@example.test'),
  ('90000000-0000-4000-8000-0000000000c1', 'p201055500008@craftsman-login.aladdin.invalid')) v(id, email);

-- ===========================================================================
-- 1. Installer alias account: initial assignment, same-number, different number
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"90000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select lives_ok($$ select public.profile_set_phone('EG', '1055500001', '+201055500001') $$,
  'alias account: the initial assignment of the number its alias encodes is allowed');
select is((select phone_e164 from public.profiles where user_id = '90000000-0000-4000-8000-0000000000a1'), '+201055500001',
  'alias account: the profile now holds the alias number');
select lives_ok($$ select public.profile_set_phone('EG', '1055500001', '+201055500001') $$,
  'alias account: a same-number re-save is allowed');
select throws_ok($$ select public.profile_set_phone('EG', '1099999999', '+201099999999') $$, '42501',
  'the phone number of this account is its sign-in identifier and cannot be changed here',
  'alias account: a different number raises 42501');
select throws_ok($$ select public.profile_set_phone('AE', '501234567', '+971501234567') $$, '42501', null,
  'alias account: a number in another country is refused too');
select is((select phone_e164 from public.profiles where user_id = '90000000-0000-4000-8000-0000000000a1'), '+201055500001',
  'alias account: a refused change leaves the profile phone untouched');
select is((select phone_national from public.profiles where user_id = '90000000-0000-4000-8000-0000000000a1'), '1055500001',
  'alias account: ... and its national part');

-- ===========================================================================
-- 2. Alias account with NO phone yet: only its own number may be the first
-- ===========================================================================
set local request.jwt.claims = '{"sub":"90000000-0000-4000-8000-0000000000a3","role":"authenticated"}';
select throws_ok($$ select public.profile_set_phone('EG', '1099999999', '+201099999999') $$, '42501', null,
  'alias account: the FIRST assignment cannot be a number other than the alias number');
select is((select phone_e164 from public.profiles where user_id = '90000000-0000-4000-8000-0000000000a3'), null,
  'alias account: ... and nothing was written');
select throws_ok($$ select public.profile_set_phone('EG', '1055500003', '01055500003') $$, '22023', null,
  'the E.164 shape check still runs first for an alias account');

-- ===========================================================================
-- 3. Upper-case alias address (case-insensitive) and the fail-closed cases
-- ===========================================================================
set local request.jwt.claims = '{"sub":"90000000-0000-4000-8000-0000000000a4","role":"authenticated"}';
select lives_ok($$ select public.profile_set_phone('EG', '1055500004', '+201055500004') $$,
  'alias account: the address is matched case-insensitively and its own number is allowed');
select throws_ok($$ select public.profile_set_phone('EG', '1099999999', '+201099999999') $$, '42501', null,
  'alias account: ... and a different number is refused');

set local request.jwt.claims = '{"sub":"90000000-0000-4000-8000-0000000000b1","role":"authenticated"}';
select throws_ok($$ select public.profile_set_phone('EG', '1055500001', '+201055500001') $$, '42501',
  'sign-in phone alias is malformed', 'alias domain, non-numeric local part: fails closed');
set local request.jwt.claims = '{"sub":"90000000-0000-4000-8000-0000000000b2","role":"authenticated"}';
select throws_ok($$ select public.profile_set_phone('EG', '12345', '+12345') $$, '42501',
  'sign-in phone alias is malformed', 'alias domain, too-short local part: fails closed');
set local request.jwt.claims = '{"sub":"90000000-0000-4000-8000-0000000000b3","role":"authenticated"}';
select throws_ok($$ select public.profile_set_phone('EG', '1055500005', '+201055500005') $$, '42501',
  'sign-in phone alias is malformed', 'alias domain, leading-zero digits: fails closed');
set local request.jwt.claims = '{"sub":"90000000-0000-4000-8000-0000000000b5","role":"authenticated"}';
select throws_ok($$ select public.profile_set_phone('EG', '1055500007', '+201055500007') $$, '42501',
  'sign-in phone alias is malformed', 'alias domain, wrong prefix letter: fails closed');
select is((select count(*)::int from public.profiles where phone_e164 is not null
           and user_id in ('90000000-0000-4000-8000-0000000000b1','90000000-0000-4000-8000-0000000000b2',
                           '90000000-0000-4000-8000-0000000000b3','90000000-0000-4000-8000-0000000000b5')), 0,
  'fail-closed accounts: no phone was written for any of them');

-- A look-alike DOMAIN (the alias domain only as a prefix of a longer domain) is NOT an alias.
set local request.jwt.claims = '{"sub":"90000000-0000-4000-8000-0000000000b4","role":"authenticated"}';
select lives_ok($$ select public.profile_set_phone('EG', '1055500006', '+201055500006') $$,
  'a look-alike domain is an ordinary account: it can set a phone');
select lives_ok($$ select public.profile_set_phone('EG', '1055500016', '+201055500016') $$,
  'a look-alike domain is an ordinary account: it can change its phone');

-- ===========================================================================
-- 4. Ordinary email account: unchanged behavior, including uniqueness
-- ===========================================================================
set local request.jwt.claims = '{"sub":"90000000-0000-4000-8000-0000000000e1","role":"authenticated"}';
select lives_ok($$ select public.profile_set_phone('EG', '1055500101', '+201055500101') $$, 'email account: saves a phone');
select lives_ok($$ select public.profile_set_phone('EG', '1055500102', '+201055500102') $$, 'email account: changes its phone freely');
select is((select phone_e164 from public.profiles where user_id = '90000000-0000-4000-8000-0000000000e1'), '+201055500102',
  'email account: the new number is stored');
select throws_ok($$ select public.profile_set_phone('EG', '1055500102', '01055500102') $$, '22023', null,
  'email account: the shape check still refuses a non-E.164 value');

-- Uniqueness: e2 takes the number a2's alias encodes; a2's first assignment must then collide.
set local request.jwt.claims = '{"sub":"90000000-0000-4000-8000-0000000000e2","role":"authenticated"}';
select lives_ok($$ select public.profile_set_phone('EG', '1055500002', '+201055500002') $$, 'email account e2 holds +201055500002');
set local request.jwt.claims = '{"sub":"90000000-0000-4000-8000-0000000000a2","role":"authenticated"}';
select throws_ok($$ select public.profile_set_phone('EG', '1055500002', '+201055500002') $$, '23505',
  'phone number is unavailable', 'alias account: uniqueness is still enforced and still generic');
select is((select phone_e164 from public.profiles where user_id = '90000000-0000-4000-8000-0000000000a2'), null,
  'alias account: a uniqueness refusal writes nothing');
set local request.jwt.claims = '{"sub":"90000000-0000-4000-8000-0000000000e1","role":"authenticated"}';
select throws_ok($$ select public.profile_set_phone('EG', '1055500002', '+201055500002') $$, '23505',
  'phone number is unavailable', 'email account: the same neutral collision error as before');

-- ===========================================================================
-- 5. Unauthenticated callers
-- ===========================================================================
set local request.jwt.claims = '{"role":"authenticated"}';
select throws_ok($$ select public.profile_set_phone('EG', '1055500001', '+201055500001') $$, '42501',
  'authentication required', 'no auth.uid(): refused');
reset role;
set local role anon;
select throws_ok($$ select public.profile_set_phone('EG', '1055500001', '+201055500001') $$, '42501', null,
  'anon: no EXECUTE on the function');
reset role;

-- ===========================================================================
-- 6. No direct write path to the phone columns
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"90000000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select throws_ok($$ update public.profiles set phone_e164 = '+201099999999' where user_id = '90000000-0000-4000-8000-0000000000a1' $$,
  '42501', null, 'authenticated: a direct UPDATE of phone_e164 is denied');
select throws_ok($$ update public.profiles set phone_national = '1099999999' where user_id = '90000000-0000-4000-8000-0000000000a1' $$,
  '42501', null, 'authenticated: a direct UPDATE of phone_national is denied');
select throws_ok($$ update public.profiles set phone_country_iso2 = 'AE' where user_id = '90000000-0000-4000-8000-0000000000a1' $$,
  '42501', null, 'authenticated: a direct UPDATE of phone_country_iso2 is denied');
select throws_ok($$ insert into public.profiles (user_id, display_name, phone_e164) values (gen_random_uuid(), 'x', '+201099999998') $$,
  '42501', null, 'authenticated: a direct INSERT into profiles is denied');
reset role;
set local role service_role;
select throws_ok($$ update public.profiles set phone_e164 = '+201099999999' where user_id = '90000000-0000-4000-8000-0000000000a1' $$,
  '42501', null, 'service_role: a direct UPDATE of the phone is denied as well');
reset role;
select is((select phone_e164 from public.profiles where user_id = '90000000-0000-4000-8000-0000000000a1'), '+201055500001',
  'after every direct-write attempt the alias account still holds its alias number');
select is(
  (select array_agg(n.nspname || '.' || p.proname order by p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'app')
      and regexp_replace(lower(p.prosrc), '[[:space:]]+', ' ', 'g') ~ '(update (only )?(public[.])?profiles |insert into (public[.])?profiles[ (])'
      and p.prosrc ~* 'phone_(e164|national|country_iso2)'),
  array['public.installer_phone_change_begin', 'public.installer_phone_change_settle', 'public.phone_verification_verify', 'public.profile_set_phone', 'public.secondary_phone_make_primary'],
  'the only functions in public/app that write profiles.phone_* are profile_set_phone, the two service-only phone-change journal functions (M3), PR #88''s secondary_phone_make_primary (which the identity guard keeps from moving an alias account''s login phone) and, since Phase B1, phone_verification_verify (service-only; it writes ONLY phone_verified_at, never the number - see 119_phone_verification_authority_test.sql)');

-- ===========================================================================
-- 7. Function contract unchanged
-- ===========================================================================
select ok(not has_function_privilege('anon', 'public.profile_set_phone(text,text,text)', 'EXECUTE'), 'grants: anon cannot execute');
select ok(has_function_privilege('authenticated', 'public.profile_set_phone(text,text,text)', 'EXECUTE'), 'grants: authenticated can execute');
select ok((select prosecdef from pg_proc where oid = 'public.profile_set_phone(text,text,text)'::regprocedure), 'still SECURITY DEFINER');
select ok((select proconfig from pg_proc where oid = 'public.profile_set_phone(text,text,text)'::regprocedure) @> array['search_path=""'],
  'search_path stays pinned to empty');

-- Audit: exactly the two accepted writes by a1 (initial + same-number); refusals leave no event.
select is((select count(*)::int from public.audit_log where action = 'profile.phone_set'
            and subject_id = '90000000-0000-4000-8000-0000000000a1'), 2,
  'audit: only the accepted alias-account writes are recorded');

-- ===========================================================================
-- 8. Installer registration regression: the exact server-side sequence
--    (record_consent -> account type -> profile_set_phone -> username -> state)
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"90000000-0000-4000-8000-0000000000c1","role":"authenticated"}';
select lives_ok($$ select public.record_consent(array['terms','privacy','pilot']::public.consent_type[], 'ar') $$,
  'registration: consent is recorded');
select lives_ok($$ select public.onboarding_select_account_type('professional', 'installer_technician') $$,
  'registration: the installer account type is selected');
select lives_ok($$ select public.profile_set_phone('EG', '1055500008', '+201055500008') $$,
  'registration: the initial phone assignment (the alias number) succeeds');
select lives_ok($$ select public.profile_set_username('craftsman9r1x') $$, 'registration: the username is claimed');
select is(public.my_registration_state(), 'access_ready', 'registration: the account reaches access_ready');
select is((select phone_e164 from public.profiles where user_id = '90000000-0000-4000-8000-0000000000c1'), '+201055500008',
  'registration: the stored phone equals the alias number');
select throws_ok($$ select public.profile_set_phone('EG', '1099999999', '+201099999999') $$, '42501', null,
  'registration: once registered, a different number is refused');
reset role;

-- ===========================================================================
-- 9. A pre-guard drifted account (profile phone != alias phone)
-- ===========================================================================
alter table public.profiles disable trigger guard_phone_password_identity;  -- fixture
update public.profiles set phone_country_iso2 = 'EG', phone_national = '1055500099', phone_e164 = '+201055500099'
 where user_id = '90000000-0000-4000-8000-0000000000a5';
alter table public.profiles enable trigger guard_phone_password_identity;
set local role authenticated;
set local request.jwt.claims = '{"sub":"90000000-0000-4000-8000-0000000000a5","role":"authenticated"}';
select throws_ok($$ select public.profile_set_phone('EG', '1055500099', '+201055500099') $$, '42501', null,
  'drifted account: the divergent number cannot be re-saved');
select lives_ok($$ select public.profile_set_phone('EG', '1055500009', '+201055500009') $$,
  'drifted account: the alias number can be saved (this re-aligns it with its login)');
select is((select phone_e164 from public.profiles where user_id = '90000000-0000-4000-8000-0000000000a5'), '+201055500009',
  'drifted account: the profile now matches the login alias');
reset role;

select * from finish();
rollback;
