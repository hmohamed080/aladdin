-- pgTAP: phone verification authority (20261030090001_phone_verification_authority.sql), Phase B1.
--
--   A. Surface: private tables, service_role-only functions, ships DISABLED, no raw code column
--   B. Disabled state is inert
--   C. Happy path: completion updates ONLY the caller's exact current primary; nothing else changes
--   D. Replay / wrong code / attempt limit / wrong account / expiry
--   E. Number changes: before completion (fails), after completion (verification reset), mid-flight with the invalidation trigger OFF
--   F. Resend cooldown, supersede, per-account hourly/daily caps, per-IP start and failure caps
--   G. Eligibility, input validation, key rotation, retention
--   H. Verification never grants login / recovery / MFA / identity changes
--
-- Every fixture is created INSIDE this transaction; the file rolls back. The HMAC key here is a test key: the database only
-- ever compares the MAC the server computed, so how the server derives it is irrelevant to these tests.
create extension if not exists pgtap;

begin;
select plan(114);

\set u1  '71000000-0000-4000-8000-000000000001'
\set u2  '71000000-0000-4000-8000-000000000002'
\set u3  '71000000-0000-4000-8000-000000000003'
\set u4  '71000000-0000-4000-8000-000000000004'
\set u5  '71000000-0000-4000-8000-000000000005'
\set u6  '71000000-0000-4000-8000-000000000006'
\set ghost '71000000-0000-4000-8000-0000000000ff'

create function pg_temp.as_dba() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;
-- Run one SQL expression with a role; return its jsonb result, {"void":true}, or {"sqlstate":..,"msg":..}.
create function pg_temp.call_role(p_role text, p_sql text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  execute 'set local role ' || p_role;
  execute 'select to_jsonb((' || p_sql || '))' into r;
  perform pg_temp.as_dba();
  return coalesce(r, '{"void":true}'::jsonb);
exception when others then
  perform pg_temp.as_dba();
  return jsonb_build_object('sqlstate', sqlstate, 'msg', sqlerrm);
end $$;
create function pg_temp.svc(p_sql text) returns jsonb language sql as $$ select pg_temp.call_role('service_role', p_sql) $$;
create function pg_temp.mac(p_ch uuid, p_user uuid, p_code text, p_kid text default 'k2') returns text language sql as $$
  select encode(extensions.hmac(convert_to('otp1|' || p_ch || '|' || p_user || '|primary_proof|' || p_code, 'utf8'),
                                convert_to(p_kid || '-test-key', 'utf8'), 'sha256'), 'hex') $$;
create function pg_temp.ip(p_n int) returns text language sql as $$ select encode(extensions.digest('ip' || p_n, 'sha256'), 'hex') $$;
create function pg_temp.start(p_user uuid, p_ch uuid, p_code text, p_ip int default 1, p_kid text default 'k2') returns jsonb language sql as $$
  select pg_temp.svc(format('public.phone_verification_start(%L,%L,%L,%L,%L)', p_user, p_ch, p_kid, pg_temp.mac(p_ch, p_user, p_code, p_kid), pg_temp.ip(p_ip))) $$;
create function pg_temp.verify(p_user uuid, p_ch uuid, p_code text, p_ip int default 1) returns jsonb language sql as $$
  select pg_temp.svc(format('public.phone_verification_verify(%L,%L,%L::jsonb,%L)', p_user, p_ch,
    json_build_object('k2', pg_temp.mac(p_ch, p_user, p_code, 'k2'), 'k1', pg_temp.mac(p_ch, p_user, p_code, 'k1'))::text, pg_temp.ip(p_ip))) $$;
create function pg_temp.st(p_j jsonb) returns text language sql as $$ select coalesce(p_j ->> 'status', 'err:' || (p_j ->> 'sqlstate')) $$;
-- Move a challenge (and so its whole window) back in time. Tests only.
create function pg_temp.age(p_ch uuid, p_by interval) returns void language sql as $$
  update app.phone_verification_challenges set created_at = created_at - p_by, expires_at = expires_at - p_by where id = p_ch $$;
create function pg_temp.age_user(p_user uuid, p_by interval) returns void language sql as $$
  update app.phone_verification_challenges set created_at = created_at - p_by, expires_at = expires_at - p_by where user_id = p_user $$;
create function pg_temp.why(p_ch uuid) returns text language sql as $$ select coalesce(invalidated_why, case when consumed_at is not null then 'consumed' else 'open' end) from app.phone_verification_challenges where id = p_ch $$;

-- ---------------------------------------------------------------------------
-- Fixtures (real triggers create public.users / profiles)
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
select v.id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v.email,
       extensions.crypt('Correct-Horse-1', extensions.gen_salt('bf')), now(), '{}', now(), now()
  from (values (:'u1', 'pv1@probe.test'), (:'u2', 'pv2@probe.test'), (:'u3', 'p201079000003@craftsman-login.aladdin.invalid'),
               (:'u4', 'pv4@probe.test'), (:'u5', 'pv5@probe.test'), (:'u6', 'pv6@probe.test')) v(id, email);
update public.profiles set phone_country_iso2 = 'EG', phone_national = '1079000001', phone_e164 = '+201079000001' where user_id = :'u1';
update public.profiles set phone_country_iso2 = 'EG', phone_national = '1079000002', phone_e164 = '+201079000002' where user_id = :'u2';
update public.profiles set phone_country_iso2 = 'EG', phone_national = '1079000003', phone_e164 = '+201079000003' where user_id = :'u3';
update public.profiles set phone_country_iso2 = 'EG', phone_national = '1079000004', phone_e164 = '+201079000004' where user_id = :'u4';
-- u5 has NO phone; u6 is suspended
update public.profiles set phone_country_iso2 = 'EG', phone_national = '1079000006', phone_e164 = '+201079000006' where user_id = :'u6';
update public.users set status = 'suspended' where id = :'u6';

-- ===========================================================================
-- A. Surface
-- ===========================================================================
select is((select enabled from app.phone_verification_config), false, 'A1 ships DISABLED');
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('app.phone_verification_config'::regclass, 'app.phone_verification_challenges'::regclass, 'app.phone_verification_ip_buckets'::regclass)),
          'A2 all three tables have RLS on');
select ok(not exists (select 1 from information_schema.role_table_grants where table_schema = 'app' and table_name like 'phone_verification_%'
                        and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')),
          'A3 no API role holds any privilege on the private tables');
select ok(not exists (select 1 from pg_policy where polrelid in ('app.phone_verification_config'::regclass, 'app.phone_verification_challenges'::regclass, 'app.phone_verification_ip_buckets'::regclass)),
          'A4 no RLS policy exists (nothing is client-readable)');
select ok(not exists (select 1 from information_schema.columns where table_schema = 'app' and table_name = 'phone_verification_challenges' and column_name ~* '(^code$|otp|secret|key$|raw)'),
          'A5 the challenge table has no column that could hold a raw code or a key');
select ok(exists (select 1 from information_schema.columns where table_schema = 'app' and table_name = 'phone_verification_challenges' and column_name = 'code_mac' and data_type = 'bytea'),
          'A6 only a MAC (bytea) is stored');
select ok((select bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE') and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
                           and not has_function_privilege('anon', p.oid, 'EXECUTE') and p.prosecdef and p.proconfig = array['search_path=""'])
             from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'phone_verification\_%'),
          'A7 every public phone_verification_* function is SECURITY DEFINER, search_path pinned, service_role only');
select ok(not exists (select 1 from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname like 'phone_verification\_%'
                        and (has_function_privilege('service_role', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE') or has_function_privilege('anon', p.oid, 'EXECUTE'))),
          'A8 the internal app.phone_verification_* helpers are executable by no API role');
select is(pg_temp.call_role('authenticated', format('public.phone_verification_start(%L,%L,%L,%L,%L)', :'u1', gen_random_uuid(), 'k2', repeat('a', 64), repeat('b', 64))) ->> 'sqlstate',
          '42501', 'A9 a signed-in user cannot call start directly');
select is(pg_temp.call_role('anon', format('public.phone_verification_verify(%L,%L,%L::jsonb,%L)', :'u1', gen_random_uuid(), '{"k2":"' || repeat('a', 64) || '"}', repeat('b', 64))) ->> 'sqlstate',
          '42501', 'A10 anon cannot call verify');
select is((select count(*)::int from pg_trigger where tgrelid = 'public.profiles'::regclass and tgname = 'phone_verification_on_phone_change'), 1, 'A11 the phone-change invalidation trigger exists');

-- ===========================================================================
-- B. Disabled state is inert
-- ===========================================================================
select is(pg_temp.st(pg_temp.start(:'u1', '71aa0000-0000-4000-8000-000000000001', '123456')), 'unavailable', 'B1 start answers unavailable while disabled');
select is(pg_temp.st(pg_temp.verify(:'u1', '71aa0000-0000-4000-8000-000000000001', '123456')), 'unavailable', 'B2 verify answers unavailable while disabled');
select is((select count(*)::int from app.phone_verification_challenges where user_id in ('71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000003','71000000-0000-4000-8000-000000000004','71000000-0000-4000-8000-000000000005','71000000-0000-4000-8000-000000000006')), 0, 'B3 nothing was written while disabled');
select is((select count(*)::int from public.audit_log where action like 'phone_verification.%' and subject_id in ('71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000003','71000000-0000-4000-8000-000000000004','71000000-0000-4000-8000-000000000005','71000000-0000-4000-8000-000000000006')), 0, 'B4 no audit event while disabled');

update app.phone_verification_config set enabled = true;   -- test-only switch, rolled back with the file

-- ===========================================================================
-- C. Happy path: completion updates only the caller's exact current primary
-- ===========================================================================
create temp table snap as
select 'u2_profile' k, md5(p::text) h from public.profiles p where p.user_id = :'u2'
union all select 'u1_auth', md5(u::text) from auth.users u where u.id = :'u1'
union all select 'u1_identities', count(*)::text from auth.identities i where i.user_id = :'u1'
union all select 'u1_user', md5(x::text) from public.users x where x.id = :'u1'
union all select 'u1_profile_nonverify', md5((to_jsonb(p) - 'phone_verified_at' - 'updated_at')::text) from public.profiles p where p.user_id = :'u1';

select is(pg_temp.st(pg_temp.start(:'u1', '71c00000-0000-4000-8000-000000000001', '424242')), 'challenge_created', 'C1 start creates a challenge');
select is((select phone_e164 from jsonb_to_record(pg_temp.start(:'u1', '71c00000-0000-4000-8000-0000000000aa', '000000')) as x(phone_e164 text)), null, 'C2 a rate-limited retry returns no phone');
select is((pg_temp.svc(format('public.phone_verification_start(%L,%L,%L,%L,%L)', :'u2', '71c00000-0000-4000-8000-000000000002', 'k2', pg_temp.mac('71c00000-0000-4000-8000-000000000002', :'u2', '111111'), pg_temp.ip(2)))) ->> 'phone_e164',
          '+201079000002', 'C3 start returns the destination number to the trusted server (for the delivery adapter)');
select is(pg_temp.st(pg_temp.verify(:'u2', '71c00000-0000-4000-8000-000000000002', '000001')), 'invalid', 'C3b u2 wrong code stays invalid (so u2 profile stays untouched below)');
select is((select kid from app.phone_verification_challenges where id = '71c00000-0000-4000-8000-000000000001'), 'k2', 'C4 the key id is recorded');
select ok((select octet_length(code_mac) = 32 and code_mac <> convert_to('424242', 'utf8') from app.phone_verification_challenges where id = '71c00000-0000-4000-8000-000000000001'),
          'C5 only a 32-byte MAC is stored, not the code');
select ok((select expires_at - created_at = interval '5 minutes' from app.phone_verification_challenges where id = '71c00000-0000-4000-8000-000000000001'), 'C6 the challenge lives 5 minutes');
select is((select phone_verified_at is null from public.profiles where user_id = :'u1'), true, 'C7 starting verifies nothing');

select is(pg_temp.st(pg_temp.verify(:'u1', '71c00000-0000-4000-8000-000000000001', '424242')), 'verified', 'C8 the right code verifies');
select ok((select phone_verified_at between now() - interval '1 minute' and clock_timestamp() from public.profiles where user_id = :'u1'), 'C9 phone_verified_at is set on the caller''s profile');
select is((select phone_e164 from public.profiles where user_id = :'u1'), '+201079000001', 'C10 the number is unchanged');
select is((select count(*)::int from public.profiles where phone_verified_at is not null and user_id in ('71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000003','71000000-0000-4000-8000-000000000004','71000000-0000-4000-8000-000000000005','71000000-0000-4000-8000-000000000006')), 1, 'C11 exactly one of the fixture profiles is verified');
select is((select h from snap where k = 'u2_profile'), (select md5(p::text) from public.profiles p where p.user_id = :'u2'), 'C12 another account''s profile row is byte-identical');
select is((select h from snap where k = 'u1_auth'), (select md5(u::text) from auth.users u where u.id = :'u1'), 'C13 the Auth user row is byte-identical');
select is((select h from snap where k = 'u1_identities'), (select count(*)::text from auth.identities i where i.user_id = :'u1'), 'C13b the identity rows of the account are unchanged');
select is((select h from snap where k = 'u1_user'), (select md5(x::text) from public.users x where x.id = :'u1'), 'C14 the public.users row is byte-identical');
select is((select h from snap where k = 'u1_profile_nonverify'), (select md5((to_jsonb(p) - 'phone_verified_at' - 'updated_at')::text) from public.profiles p where p.user_id = :'u1'),
          'C15 every profile column except phone_verified_at (and updated_at) is unchanged');
select is((select consumed_at is not null from app.phone_verification_challenges where id = '71c00000-0000-4000-8000-000000000001'), true, 'C16 the challenge is consumed');
select is((select count(*)::int from public.audit_log where action = 'phone_verification.completed' and subject_id = :'u1'), 1, 'C17 one completion audit event');
select ok(not exists (select 1 from public.audit_log where action like 'phone_verification.%' and metadata::text ~ '(\+20|1079000|mac|code)'),
          'C18 audit metadata holds no phone number, code or MAC');
select is(pg_temp.st(pg_temp.start(:'u1', '71c00000-0000-4000-8000-000000000003', '999999')), 'already_verified', 'C19 starting again after success is already_verified');
select is((select count(*)::int from app.phone_verification_challenges where user_id = :'u1'), 1, 'C20 and issues no new challenge');

-- ===========================================================================
-- D. Replay, wrong code, attempts, wrong account, expiry
-- ===========================================================================
select is(pg_temp.st(pg_temp.verify(:'u1', '71c00000-0000-4000-8000-000000000001', '424242')), 'invalid', 'D1 replaying the consumed code is invalid');
select is((select count(*)::int from public.audit_log where action = 'phone_verification.completed' and subject_id = :'u1'), 1, 'D2 replay creates no second completion');

-- u4: attempts. (u2 already holds one failed attempt on its challenge.)
select is(pg_temp.st(pg_temp.start(:'u4', '71d00000-0000-4000-8000-000000000004', '135790', 4)), 'challenge_created', 'D3 u4 challenge');
select is(pg_temp.st(pg_temp.verify(:'u4', '71d00000-0000-4000-8000-000000000004', '000000', 4)), 'invalid', 'D4 wrong code is invalid');
select is((select attempts from app.phone_verification_challenges where id = '71d00000-0000-4000-8000-000000000004'), 1::smallint, 'D5 the attempt is counted (the failure commits)');
-- wrong account presents u4's challenge with the CORRECT code (computed for u2's id: still wrong binding)
select is(pg_temp.st(pg_temp.verify(:'u2', '71d00000-0000-4000-8000-000000000004', '135790', 4)), 'invalid', 'D6 another account cannot use the challenge');
select is((select attempts from app.phone_verification_challenges where id = '71d00000-0000-4000-8000-000000000004'), 1::smallint, 'D7 and cannot burn the owner''s attempts');
select is(pg_temp.why('71d00000-0000-4000-8000-000000000004'), 'open', 'D8 the owner''s challenge is still open');
select is(pg_temp.st(pg_temp.verify(:'u4', '71d00000-0000-4000-8000-000000000004', '000001', 4)), 'invalid', 'D9 wrong #2');
select is(pg_temp.st(pg_temp.verify(:'u4', '71d00000-0000-4000-8000-000000000004', '000002', 4)), 'invalid', 'D10 wrong #3');
select is(pg_temp.st(pg_temp.verify(:'u4', '71d00000-0000-4000-8000-000000000004', '000003', 4)), 'invalid', 'D11 wrong #4');
select is(pg_temp.st(pg_temp.verify(:'u4', '71d00000-0000-4000-8000-000000000004', '000004', 4)), 'invalid', 'D12 wrong #5');
select is(pg_temp.why('71d00000-0000-4000-8000-000000000004'), 'too_many_attempts', 'D13 the fifth wrong code kills the challenge');
select is(pg_temp.st(pg_temp.verify(:'u4', '71d00000-0000-4000-8000-000000000004', '135790', 4)), 'invalid', 'D14 the correct code is refused afterwards');
select is((select phone_verified_at is null from public.profiles where user_id = :'u4'), true, 'D15 u4 stays unverified');

-- a foreign / unknown challenge id behaves exactly like a wrong code (non-enumerating)
select is(pg_temp.verify(:'u2', '71ee0000-0000-4000-8000-000000000000', '123456', 5), pg_temp.verify(:'u2', '71d00000-0000-4000-8000-000000000004', '123456', 5), 'D16 unknown id and foreign id give the identical answer');

-- expiry (u2: has an open challenge from C3)
select pg_temp.age('71c00000-0000-4000-8000-000000000002', interval '6 minutes');
select is(pg_temp.st(pg_temp.verify(:'u2', '71c00000-0000-4000-8000-000000000002', '111111', 2)), 'invalid', 'D17 an expired challenge is refused even with the right code');
select is(pg_temp.why('71c00000-0000-4000-8000-000000000002'), 'expired', 'D18 and recorded as expired');
select is((select phone_verified_at is null from public.profiles where user_id = :'u2'), true, 'D19 u2 stays unverified');

-- ===========================================================================
-- E. Number changes
-- ===========================================================================
-- E1: change BEFORE completion, trigger ON -> challenge closed, nothing verified
select pg_temp.age_user(:'u2', interval '10 minutes');
select is(pg_temp.st(pg_temp.start(:'u2', '71e00000-0000-4000-8000-000000000001', '777777', 2)), 'challenge_created', 'E1 u2 starts a challenge for the old number');
update public.profiles set phone_e164 = '+201079000102', phone_national = '1079000102' where user_id = :'u2';
select is(pg_temp.why('71e00000-0000-4000-8000-000000000001'), 'claim_changed', 'E2 changing the number closes the open challenge');
select is(pg_temp.st(pg_temp.verify(:'u2', '71e00000-0000-4000-8000-000000000001', '777777', 2)), 'invalid', 'E3 the old code cannot verify the NEW number');
select is((select phone_verified_at is null from public.profiles where user_id = :'u2'), true, 'E4 nothing is verified');

-- E5: trigger OFF (defence in depth): verify itself re-checks the live number under the row lock
alter table public.profiles disable trigger phone_verification_on_phone_change;
select pg_temp.age_user(:'u2', interval '10 minutes');
select is(pg_temp.st(pg_temp.start(:'u2', '71e00000-0000-4000-8000-000000000002', '888888', 2)), 'challenge_created', 'E5 u2 starts a challenge for the new number');
update public.profiles set phone_e164 = '+201079000202', phone_national = '1079000202' where user_id = :'u2';
select is(pg_temp.why('71e00000-0000-4000-8000-000000000002'), 'open', 'E6 with the trigger off the challenge is still open');
select is(pg_temp.st(pg_temp.verify(:'u2', '71e00000-0000-4000-8000-000000000002', '888888', 2)), 'invalid', 'E7 verify refuses because the live number differs');
select is(pg_temp.why('71e00000-0000-4000-8000-000000000002'), 'claim_changed', 'E8 and records claim_changed');
select is((select phone_verified_at is null from public.profiles where user_id = :'u2'), true, 'E9 nothing is verified');
alter table public.profiles enable trigger phone_verification_on_phone_change;

-- E10: change AFTER completion -> the existing trigger resets verification
update public.profiles set phone_e164 = '+201079000301', phone_national = '1079000301' where user_id = :'u1';
select is((select phone_verified_at is null from public.profiles where user_id = :'u1'), true, 'E10 a later number change resets phone_verified_at to NULL (existing trigger)');
select is(pg_temp.st(pg_temp.verify(:'u1', '71c00000-0000-4000-8000-000000000001', '424242', 1)), 'invalid', 'E11 the consumed proof cannot be reused for the new number');

-- E12: a phone-change journal in progress blocks start (alias account u3)
insert into app.installer_phone_changes (user_id, request_id, state, old_e164, old_alias, new_e164, new_country_iso2, new_national, new_alias, receipt_id, lease_expires_at)
values (:'u3', gen_random_uuid(), 'pending', '+201079000003', 'p201079000003@craftsman-login.aladdin.invalid', '+201079000303', 'EG', '1079000303', 'p201079000303@craftsman-login.aladdin.invalid', gen_random_uuid(), now() + interval '1 hour');
select is(pg_temp.st(pg_temp.start(:'u3', '71e30000-0000-4000-8000-000000000001', '121212', 3)), 'unavailable', 'E12 start is unavailable while a phone change is pending');
delete from app.installer_phone_changes where user_id = :'u3';
select is(pg_temp.st(pg_temp.start(:'u3', '71e30000-0000-4000-8000-000000000001', '121212', 3)), 'challenge_created', 'E13 and works again once the change is gone');

-- ===========================================================================
-- F. Cooldown, supersede, caps
-- ===========================================================================
select is(pg_temp.st(pg_temp.start(:'u3', '71f00000-0000-4000-8000-000000000001', '343434', 3)), 'rate_limited', 'F1 a second start inside the 60 s cooldown is rate limited');
select ok((pg_temp.start(:'u3', '71f00000-0000-4000-8000-000000000001', '343434', 3) ->> 'retry_after_seconds')::int between 1 and 60, 'F2 with a retry hint');
select pg_temp.age_user(:'u3', interval '2 minutes');
select is(pg_temp.st(pg_temp.start(:'u3', '71f00000-0000-4000-8000-000000000002', '565656', 3)), 'challenge_created', 'F3 after the cooldown a new challenge is issued');
select is(pg_temp.why('71e30000-0000-4000-8000-000000000001'), 'superseded', 'F4 and the previous challenge is superseded');
select is(pg_temp.st(pg_temp.verify(:'u3', '71e30000-0000-4000-8000-000000000001', '121212', 3)), 'invalid', 'F5 the superseded code no longer works');
select is((select count(*)::int from app.phone_verification_challenges where user_id = :'u3' and consumed_at is null and invalidated_at is null), 1, 'F6 exactly one open challenge per account');

-- hourly cap: 6/h. u3 has 2 so far in the window; add 4 more (aging each by 2 min), the 7th is refused.
do $$ begin
  for n in 1..4 loop
    perform pg_temp.age_user('71000000-0000-4000-8000-000000000003', interval '2 minutes');
    perform pg_temp.start('71000000-0000-4000-8000-000000000003', ('71f10000-0000-4000-8000-00000000000' || n)::uuid, '000000', 3);
  end loop;
end $$;
select is((select count(*)::int from app.phone_verification_challenges where user_id = :'u3' and created_at > now() - interval '1 hour'), 6, 'F7 six starts fit in the hour');
select pg_temp.age_user(:'u3', interval '2 minutes');
select is(pg_temp.st(pg_temp.start(:'u3', '71f10000-0000-4000-8000-000000000009', '000000', 3)), 'rate_limited', 'F8 the seventh start in an hour is rate limited');
select ok((pg_temp.start(:'u3', '71f10000-0000-4000-8000-000000000009', '000000', 3) ->> 'retry_after_seconds')::int > 0, 'F9 with a retry hint');
-- daily cap
update app.phone_verification_config set user_hourly_starts = 20, user_daily_starts = 7;
select pg_temp.age_user(:'u3', interval '70 minutes');
select is(pg_temp.st(pg_temp.start(:'u3', '71f10000-0000-4000-8000-00000000000a', '000000', 3)), 'challenge_created', 'F10 the 7th start of the day (hourly window clear) is allowed');
select pg_temp.age_user(:'u3', interval '2 minutes');
select is(pg_temp.st(pg_temp.start(:'u3', '71f10000-0000-4000-8000-00000000000b', '000000', 3)), 'rate_limited', 'F11 the daily cap stops the 8th');
update app.phone_verification_config set user_hourly_starts = 6, user_daily_starts = 10;

-- per-IP start cap (two different accounts, one IP key)
update app.phone_verification_config set ip_hourly_starts = 2;
select pg_temp.age_user(:'u4', interval '5 minutes');
select pg_temp.age_user(:'u2', interval '5 minutes');
select is(pg_temp.st(pg_temp.start(:'u4', '71f20000-0000-4000-8000-000000000001', '111111', 9)), 'challenge_created', 'F12 first start from an IP key');
select is(pg_temp.st(pg_temp.start(:'u2', '71f20000-0000-4000-8000-000000000002', '111111', 9)), 'challenge_created', 'F13 second start from the same IP key');
select pg_temp.age_user(:'u4', interval '2 minutes');
select is(pg_temp.st(pg_temp.start(:'u4', '71f20000-0000-4000-8000-000000000003', '111111', 9)), 'rate_limited', 'F14 the third start from that IP key is rate limited');
select is((select count(*)::int from app.phone_verification_challenges where id = '71f20000-0000-4000-8000-000000000003'), 0, 'F15 and creates no challenge');
update app.phone_verification_config set ip_hourly_starts = 20;

-- per-IP failure cap
update app.phone_verification_config set ip_failures_15m = 3;
select pg_temp.verify(:'u4', '71f20000-0000-4000-8000-000000000001', '000001', 7);
select pg_temp.verify(:'u4', '71f20000-0000-4000-8000-000000000001', '000002', 7);
select pg_temp.verify(:'u4', '71f20000-0000-4000-8000-000000000001', '000003', 7);
select is(pg_temp.st(pg_temp.verify(:'u4', '71f20000-0000-4000-8000-000000000001', '111111', 7)), 'rate_limited', 'F16 after 3 failures an IP key is refused even with the right code');
select is(pg_temp.why('71f20000-0000-4000-8000-000000000001'), 'open', 'F17 the refusal burned no attempt');
update app.phone_verification_config set ip_failures_15m = 30;
select is(pg_temp.st(pg_temp.verify(:'u4', '71f20000-0000-4000-8000-000000000001', '111111', 8)), 'verified', 'F18 a different IP key with the right code still verifies (limits are per key)');

-- ===========================================================================
-- G. Eligibility, validation, rotation, retention
-- ===========================================================================
select is(pg_temp.st(pg_temp.start(:'u5', '71a50000-0000-4000-8000-000000000001', '111111', 11)), 'unavailable', 'G1 an account without a phone is unavailable');
select is(pg_temp.st(pg_temp.start(:'u6', '71a60000-0000-4000-8000-000000000001', '111111', 11)), 'unavailable', 'G2 a suspended account is unavailable');
select is(pg_temp.st(pg_temp.start(:'ghost', '71a60000-0000-4000-8000-000000000002', '111111', 11)), 'unavailable', 'G3 an unknown account is unavailable');
select is(pg_temp.svc(format('public.phone_verification_start(%L,%L,%L,%L,%L)', :'u1', gen_random_uuid(), 'k2', 'not-hex', pg_temp.ip(1))) ->> 'sqlstate', '22023', 'G4 a malformed MAC is rejected as a bad request');
select is(pg_temp.svc(format('public.phone_verification_start(%L,%L,%L,%L,%L)', :'u1', gen_random_uuid(), 'bad kid!', repeat('a', 64), pg_temp.ip(1))) ->> 'sqlstate', '22023', 'G5 a malformed key id is rejected');
select is(pg_temp.svc(format('public.phone_verification_verify(%L,%L,%L::jsonb,%L)', :'u1', gen_random_uuid(), '{}', pg_temp.ip(1))) ->> 'sqlstate', '22023', 'G6 an empty candidate set is rejected');
select is(pg_temp.svc(format('public.phone_verification_verify(%L,%L,%L::jsonb,%L)', :'u1', gen_random_uuid(),
          json_build_object('a', repeat('a', 64), 'b', repeat('a', 64), 'c', repeat('a', 64), 'd', repeat('a', 64))::text, pg_temp.ip(1))) ->> 'sqlstate', '22023', 'G7 more than three candidates are rejected');
select is(pg_temp.svc(format('public.phone_verification_verify(%L,%L,%L::jsonb,%L)', :'u1', gen_random_uuid(), '{"k2":"zz"}', pg_temp.ip(1))) ->> 'sqlstate', '22023', 'G8 a non-hex candidate is rejected');
select is(pg_temp.svc(format('public.phone_verification_invalidate(%L,%L,%L)', :'u1', gen_random_uuid(), 'because')) ->> 'sqlstate', '22023', 'G9 invalidate accepts only delivery_failed');

-- rotation: a challenge issued under k1 verifies when the server offers k1; fails closed when k1 was retired
select pg_temp.age_user(:'u2', interval '10 minutes');
select is(pg_temp.st(pg_temp.start(:'u2', '71b00000-0000-4000-8000-000000000001', '246810', 12, 'k1')), 'challenge_created', 'G10 a challenge issued under key k1');
select is((select kid from app.phone_verification_challenges where id = '71b00000-0000-4000-8000-000000000001'), 'k1', 'G11 its kid is k1');
select is(pg_temp.st(pg_temp.svc(format('public.phone_verification_verify(%L,%L,%L::jsonb,%L)', :'u2', '71b00000-0000-4000-8000-000000000001',
          json_build_object('k2', pg_temp.mac('71b00000-0000-4000-8000-000000000001', :'u2', '246810', 'k2'))::text, pg_temp.ip(12)))), 'invalid', 'G12 with k1 retired (not offered) the challenge fails closed');
select is((select attempts from app.phone_verification_challenges where id = '71b00000-0000-4000-8000-000000000001'), 1::smallint, 'G13 and the miss is counted as an attempt');
select is(pg_temp.st(pg_temp.verify(:'u2', '71b00000-0000-4000-8000-000000000001', '246810', 12)), 'verified', 'G14 while k1 is still accepted it verifies');

-- delivery failure closes the challenge
select pg_temp.age_user(:'u3', interval '2 hours');
select is(pg_temp.st(pg_temp.start(:'u3', '71b10000-0000-4000-8000-000000000001', '131313', 13)), 'challenge_created', 'G15 u3 challenge');
select is(pg_temp.svc(format('public.phone_verification_invalidate(%L,%L,%L)', :'u3', '71b10000-0000-4000-8000-000000000001', 'delivery_failed'))::text, 'true', 'G16 delivery failure closes it');
select is(pg_temp.why('71b10000-0000-4000-8000-000000000001'), 'delivery_failed', 'G17 with the reason recorded');
select is(pg_temp.svc(format('public.phone_verification_invalidate(%L,%L,%L)', :'u1', '71b10000-0000-4000-8000-000000000001', 'delivery_failed'))::text, 'false', 'G18 another account cannot close it');

-- retention
select pg_temp.age_user(:'u3', interval '40 days');
select is((pg_temp.svc('public.phone_verification_purge(interval ''30 days'')') ->> 'challenges_deleted')::int >= 1, true, 'G19 purge removes closed challenges older than the retention');
select is((select count(*)::int from app.phone_verification_challenges where user_id = :'u3'), 0, 'G20 and they are gone');
select is(pg_temp.svc('public.phone_verification_purge(interval ''1 hour'')') ->> 'sqlstate', '22023', 'G21 retention under a day is refused');

-- ===========================================================================
-- H. Verification grants nothing but the timestamp
-- ===========================================================================
select is((select count(*)::int from auth.users where phone is not null and id in ('71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000003','71000000-0000-4000-8000-000000000004','71000000-0000-4000-8000-000000000005','71000000-0000-4000-8000-000000000006')), 0, 'H1 no fixture Auth user has a phone (no phone identity was created)');
select is((select count(*)::int from auth.identities where provider <> 'email' and user_id in ('71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000003','71000000-0000-4000-8000-000000000004','71000000-0000-4000-8000-000000000005','71000000-0000-4000-8000-000000000006')), 0, 'H2 no fixture has a non-email identity');
select is((select count(*)::int from auth.mfa_factors where user_id in ('71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000003','71000000-0000-4000-8000-000000000004','71000000-0000-4000-8000-000000000005','71000000-0000-4000-8000-000000000006')), 0, 'H3 no fixture has an MFA factor');
select is((select count(*)::int from public.profiles where phone_verified_at is not null and user_id in ('71000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000003','71000000-0000-4000-8000-000000000004','71000000-0000-4000-8000-000000000005','71000000-0000-4000-8000-000000000006')), 2, 'H4 only the two accounts that completed a challenge and kept their number (u2, u4) are verified; u1 was reset by its number change');
select ok(not exists (select 1 from pg_proc p where p.pronamespace in ('public'::regnamespace, 'app'::regnamespace) and p.proname !~ '^(phone_verification|profiles_reset_phone_verification|installer_phone_change_settle|installer_phone_change_begin)'
                        and p.prosrc ~* 'phone_verified_at\s*(=|:=)'),
          'H5 no other function writes phone_verified_at');
select ok(not exists (select 1 from pg_policy pol join pg_class c on c.oid = pol.polrelid
                       where coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') || coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') ~* 'phone_verified_at'),
          'H6 no RLS policy depends on phone_verified_at (it cannot gate access)');

select * from finish();
rollback;
