-- pgTAP: signup proof + phone-alias creation guard (20261030090002_phone_signup_authority.sql), R1.
--
--   A. Surface: private tables, service_role-only functions, ships DORMANT (all three switches off), the guard is a deferred constraint trigger
--   B. Disabled state is inert
--   C. Happy path: start -> verify -> grant -> alias user created with the grant -> attach sets phone_verified_at for the exact number
--   D. Replay / wrong code / attempt limit / wrong registration / expiry / cross-purpose / number taken meanwhile
--   E. Limits: cooldown, supersede, per-registration, per-number and per-IP caps, input validation, no existence oracle
--   F. The guard: off / observe / enforce; forged, foreign, expired, replayed and anonymous grants; non-alias users untouched
--   G. Attach binding: wrong user, number not set, number changed, twice, window passed, e-mail not the alias; nothing but phone_verified_at changes
--   H. Retention and audit
--
-- Every fixture is created INSIDE this transaction; the file rolls back. The deferred guard is exercised with SET CONSTRAINTS ... IMMEDIATE
-- (a rolled-back test transaction never reaches COMMIT); the real COMMIT-time behaviour against GoTrue is covered by supabase/tests/sec.
create extension if not exists pgtap;

begin;
select plan(103);

\set f1 '72000000-0000-4000-8000-000000000001'
\set reg1 '73000000-0000-4000-8000-000000000001'
\set reg2 '73000000-0000-4000-8000-000000000002'
\set reg3 '73000000-0000-4000-8000-000000000003'
\set reg4 '73000000-0000-4000-8000-000000000004'
\set reg5 '73000000-0000-4000-8000-000000000005'

create function pg_temp.as_dba() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;
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
create function pg_temp.st(p_j jsonb) returns text language sql as $$ select coalesce(p_j ->> 'status', 'err:' || (p_j ->> 'sqlstate')) $$;
create function pg_temp.smac(p_ch uuid, p_reg uuid, p_code text, p_kid text default 'k2') returns text language sql as $$
  select encode(extensions.hmac(convert_to('otp1|' || p_ch || '|' || p_reg || '|signup_proof|' || p_code, 'utf8'), convert_to(p_kid || '-test-key', 'utf8'), 'sha256'), 'hex') $$;
create function pg_temp.ip(p_n int) returns text language sql as $$ select encode(extensions.digest('ip' || p_n, 'sha256'), 'hex') $$;
create function pg_temp.sstart(p_reg uuid, p_phone text, p_ch uuid, p_code text, p_ip int default 1, p_kid text default 'k2') returns jsonb language sql as $$
  select pg_temp.svc(format('public.phone_signup_start(%L,%L,%L,%L,%L,%L)', p_reg, p_phone, p_ch, p_kid, pg_temp.smac(p_ch, p_reg, p_code, p_kid), pg_temp.ip(p_ip))) $$;
create function pg_temp.sverify(p_reg uuid, p_ch uuid, p_code text, p_ip int default 1) returns jsonb language sql as $$
  select pg_temp.svc(format('public.phone_signup_verify(%L,%L,%L::jsonb,%L)', p_reg, p_ch,
    json_build_object('k2', pg_temp.smac(p_ch, p_reg, p_code, 'k2'), 'k1', pg_temp.smac(p_ch, p_reg, p_code, 'k1'))::text, pg_temp.ip(p_ip))) $$;
create function pg_temp.sattach(p_user uuid, p_grant uuid) returns jsonb language sql as $$
  select pg_temp.svc(format('public.phone_signup_attach(%L,%L)', p_user, p_grant)) $$;
create function pg_temp.age(p_ch uuid, p_by interval) returns void language sql as $$
  update app.phone_verification_challenges set created_at = created_at - p_by, expires_at = expires_at - p_by where id = p_ch $$;
create function pg_temp.why(p_ch uuid) returns text language sql as $$
  select coalesce(invalidated_why, case when consumed_at is not null then 'consumed' else 'open' end) from app.phone_verification_challenges where id = p_ch $$;
create function pg_temp.try_sql(p_sql text) returns text language plpgsql as $$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;
create function pg_temp.alias(p_e164 text) returns text language sql as $$ select 'p' || substr(p_e164, 2) || '@craftsman-login.aladdin.invalid' $$;

-- Create an Auth user with the guard checked IMMEDIATELY. Returns 'ok' or the SQLSTATE the guard raised.
create function pg_temp.mk_user(p_id uuid, p_email text, p_app jsonb default '{}', p_anon boolean default false) returns text language plpgsql as $$
begin
  set constraints auth.phone_alias_guard immediate;
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, is_anonymous, created_at, updated_at)
  values (p_id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email, extensions.crypt('Correct-Horse-1', extensions.gen_salt('bf')),
          now(), p_app, '{}', p_anon, now(), now());
  set constraints auth.phone_alias_guard deferred;
  return 'ok';
exception when others then
  return sqlstate;
end $$;
-- Run the whole proof for (reg, phone): returns the grant row's id.
create function pg_temp.prove(p_reg uuid, p_phone text, p_ch uuid, p_code text default '123456', p_ip int default 1) returns jsonb language plpgsql as $$
declare s jsonb;
begin
  s := pg_temp.sstart(p_reg, p_phone, p_ch, p_code, p_ip);
  if s ->> 'status' <> 'challenge_created' then return s; end if;
  return pg_temp.sverify(p_reg, p_ch, p_code, p_ip);
end $$;

-- ===========================================================================
-- A. Surface
-- ===========================================================================
select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'app' and c.relname in ('phone_signup_grants', 'phone_alias_guard_observations', 'phone_verification_config_log') and c.relrowsecurity), 3::bigint,
          'A1 the three new tables are private (RLS on)');
select is((select count(*) from (values ('phone_signup_grants'), ('phone_alias_guard_observations'), ('phone_verification_config_log')) t(n),
                  (values ('anon'), ('authenticated'), ('service_role')) r(role)
            where has_table_privilege(r.role, 'app.' || t.n, 'select,insert,update,delete')), 0::bigint,
          'A2 no API role has any privilege on them');
select is((select count(*) from (values ('public.phone_signup_start(uuid,text,uuid,text,text,text)'), ('public.phone_signup_verify(uuid,uuid,jsonb,text)'),
                                         ('public.phone_signup_attach(uuid,uuid)'), ('public.phone_signup_invalidate(uuid,uuid,text)')) f(sig)
            where has_function_privilege('service_role', f.sig, 'execute')
              and not has_function_privilege('anon', f.sig, 'execute') and not has_function_privilege('authenticated', f.sig, 'execute')), 4::bigint,
          'A3 the four signup functions are executable by service_role only');
select is((select count(*) from (values ('app.phone_alias_guard()'), ('app.phone_signup_registration_lock(uuid)'), ('app.phone_verification_config_audit()')) f(sig),
                  (values ('anon'), ('authenticated'), ('service_role')) r(role)
            where has_function_privilege(r.role, f.sig, 'execute')), 0::bigint,
          'A4 the internal functions (guard, lock, config audit) are executable by nobody');
select is((select row(signup_enabled, alias_guard_mode, enabled)::text from app.phone_verification_config), '(f,off,f)', 'A5 ships dormant: signup disabled, guard OFF, master switch off');
select is((select count(*) from pg_trigger t where t.tgrelid = 'auth.users'::regclass and t.tgname = 'phone_alias_guard' and t.tgconstraint <> 0 and t.tgdeferrable and t.tginitdeferred and t.tgenabled = 'O'),
          1::bigint, 'A6 the guard is an ENABLED, DEFERRABLE INITIALLY DEFERRED constraint trigger on auth.users');
select ok((select pg_get_triggerdef(t.oid) like '%WHEN%craftsman-login.aladdin.invalid%' from pg_trigger t where t.tgrelid = 'auth.users'::regclass and t.tgname = 'phone_alias_guard'),
          'A7 the trigger only fires for alias-domain e-mails (WHEN clause): e-mail, OAuth and every other sign-up never reach the function');
select col_is_null('app', 'phone_verification_challenges', 'user_id', 'A8 user_id is nullable (signup challenges have no user yet)');
select is((select count(*) from information_schema.columns where table_schema = 'app' and table_name in ('phone_verification_challenges', 'phone_signup_grants') and column_name in ('code', 'raw_code', 'otp', 'secret', 'key', 'hmac_key')), 0::bigint,
          'A9 no column can hold a raw code or key');
select is((select count(*) from pg_constraint where conrelid = 'app.phone_verification_challenges'::regclass and conname in ('ck_pvc_purpose', 'ck_pvc_subject', 'ck_pvc_why_values')), 3::bigint,
          'A10 purpose and subject constraints are in place');

-- ===========================================================================
-- B. Disabled state is inert
-- ===========================================================================
select is(pg_temp.st(pg_temp.sstart(:'reg1', '+201079100001', '74000000-0000-4000-8000-000000000001', '111111')), 'unavailable', 'B1 start answers unavailable while disabled');
select is(pg_temp.st(pg_temp.sverify(:'reg1', '74000000-0000-4000-8000-000000000001', '111111')), 'unavailable', 'B2 verify answers unavailable while disabled');
select is(pg_temp.st(pg_temp.sattach(:'f1', '75000000-0000-4000-8000-000000000001')), 'unavailable', 'B3 attach answers unavailable while disabled');
select is((select count(*) from app.phone_verification_challenges where purpose = 'signup_proof'), 0::bigint, 'B4 nothing was written');
-- B1 switch alone does not open signup
update app.phone_verification_config set enabled = true;
select is(pg_temp.st(pg_temp.sstart(:'reg1', '+201079100001', '74000000-0000-4000-8000-000000000001', '111111')), 'unavailable', 'B5 the master switch alone does not enable signup_proof');
select is(pg_temp.try_sql('update app.phone_verification_config set signup_enabled = true'), '23514', 'B6 signup verification CANNOT be enabled while the guard is off (a grant nobody consumes would be useless and unprotected)');
update app.phone_verification_config set alias_guard_mode = 'observe';
update app.phone_verification_config set signup_enabled = true;
select is((select count(*) from app.phone_verification_config_log where setting in ('enabled', 'signup_enabled', 'alias_guard_mode')), 3::bigint, 'B7 every switch change is logged (who/when/from/to)');

-- ===========================================================================
-- C. Happy path
-- ===========================================================================
select is(pg_temp.st(pg_temp.sstart(:'reg1', '+201079100001', '74000000-0000-4000-8000-000000000001', '123456')), 'challenge_created', 'C1 start opens a signup challenge');
select is((select row(purpose, user_id is null, registration_id = :'reg1', phone_e164)::text from app.phone_verification_challenges where id = '74000000-0000-4000-8000-000000000001'),
          '(signup_proof,t,t,+201079100001)', 'C2 the row is bound to the registration and the number, with no user');
select is((pg_temp.sstart(:'reg2', '+201079100002', '74000000-0000-4000-8000-000000000002', '222222') ->> 'deliver'), 'true', 'C3 a free number is marked deliverable');
select is((select count(*) from app.phone_verification_challenges where code_mac is null or octet_length(code_mac) <> 32), 0::bigint, 'C4 only a 32-byte MAC is stored');
select is(pg_temp.st(pg_temp.sverify(:'reg1', '74000000-0000-4000-8000-000000000001', '123456')), 'verified', 'C5 the correct code verifies and mints a grant');
select is((select row(alias = pg_temp.alias('+201079100001'), phone_e164, intent, registration_id = :'reg1', consumed_at is null, attached_at is null)::text
             from app.phone_signup_grants where challenge_id = '74000000-0000-4000-8000-000000000001'),
          '(t,+201079100001,phone_signup,t,t,t)', 'C6 the grant is bound to the exact alias, number, intent and registration; unused and unattached');
select is((select count(*) from auth.users where lower(email) = pg_temp.alias('+201079100001')), 0::bigint, 'C7 verifying creates NO Auth user');

-- activate the guard in enforce mode from here on
update app.phone_verification_config set alias_guard_mode = 'enforce';
create temp table t_g1 as select (g.id)::text as gid from app.phone_signup_grants g where g.challenge_id = '74000000-0000-4000-8000-000000000001';
select is(pg_temp.mk_user('72000000-0000-4000-8000-0000000000a1', pg_temp.alias('+201079100001'),
            jsonb_build_object('phone_signup_grant', (select gid from t_g1), 'phone_signup_registration', :'reg1')), 'ok', 'C8 enforce: the alias user is created with its grant');
select is((select row(consumed_user_id = '72000000-0000-4000-8000-0000000000a1', consumed_at is not null)::text from app.phone_signup_grants where id = (select gid::uuid from t_g1)), '(t,t)', 'C9 the grant is consumed by exactly that user');
select is((select phone_verified_at is null from public.profiles where user_id = '72000000-0000-4000-8000-0000000000a1'), true, 'C10 creating the user does not verify anything');
update public.profiles set phone_country_iso2 = 'EG', phone_national = '1079100001', phone_e164 = '+201079100001' where user_id = '72000000-0000-4000-8000-0000000000a1';
select is(pg_temp.st(pg_temp.sattach('72000000-0000-4000-8000-0000000000a1', (select gid::uuid from t_g1))), 'attached', 'C11 attach succeeds for the consuming user once the number is on the profile');
select is((select phone_verified_at is not null from public.profiles where user_id = '72000000-0000-4000-8000-0000000000a1'), true, 'C12 profiles.phone_verified_at is set for the exact proven number');
select is((select row(phone, (select count(*) from auth.mfa_factors f where f.user_id = u.id), (select count(*) from auth.identities i where i.user_id = u.id))::text
             from auth.users u where u.id = '72000000-0000-4000-8000-0000000000a1'), '(,0,0)', 'C13 attach grants nothing else: no auth phone, no MFA factor, no identity');
select is((select count(*) from public.audit_log where actor_user_id = '72000000-0000-4000-8000-0000000000a1' and action = 'phone_verification.completed' and metadata ->> 'purpose' = 'signup_proof'), 1::bigint,
          'C14 completion is audited with purpose signup_proof');

-- ===========================================================================
-- D. Replay, wrong code, attempts, wrong registration, expiry, cross-purpose, taken meanwhile
-- ===========================================================================
select is(pg_temp.st(pg_temp.sverify(:'reg1', '74000000-0000-4000-8000-000000000001', '123456')), 'invalid', 'D1 replaying the consumed proof is the generic invalid');
select is((select count(*) from app.phone_signup_grants where challenge_id = '74000000-0000-4000-8000-000000000001'), 1::bigint, 'D2 a replay mints no second grant');

select is(pg_temp.st(pg_temp.sstart(:'reg3', '+201079100003', '74000000-0000-4000-8000-000000000003', '333333')), 'challenge_created', 'D3 setup: a challenge for registration 3');
select is(pg_temp.st(pg_temp.sverify(:'reg3', '74000000-0000-4000-8000-000000000003', '000000')), 'invalid', 'D4 a wrong code is invalid');
select is((select attempts from app.phone_verification_challenges where id = '74000000-0000-4000-8000-000000000003'), 1::smallint, 'D5 and counted');
select is(pg_temp.st(pg_temp.sverify(:'reg4', '74000000-0000-4000-8000-000000000003', '333333')), 'invalid', 'D6 another registration presenting the CORRECT code and challenge id gets the same generic invalid');
select is((select attempts from app.phone_verification_challenges where id = '74000000-0000-4000-8000-000000000003'), 1::smallint, 'D7 and the owner''s attempt counter was not burned');
select is(pg_temp.st(pg_temp.sverify(:'reg3', '74000000-0000-4000-8000-000000000003', '333334')), 'invalid', 'D8 a code that belongs to another challenge fails');
select is(pg_temp.st(pg_temp.sverify(:'reg3', '74000000-0000-4000-8000-000000000003', '111111')), 'invalid', 'D9 wrong again');
select is(pg_temp.st(pg_temp.sverify(:'reg3', '74000000-0000-4000-8000-000000000003', '222222')), 'invalid', 'D10 wrong again');
select is(pg_temp.st(pg_temp.sverify(:'reg3', '74000000-0000-4000-8000-000000000003', '444444')), 'invalid', 'D11 wrong again (5th)');
select is(pg_temp.why('74000000-0000-4000-8000-000000000003'), 'too_many_attempts', 'D12 five wrong codes close the challenge');
select is(pg_temp.st(pg_temp.sverify(:'reg3', '74000000-0000-4000-8000-000000000003', '333333')), 'invalid', 'D13 the correct code afterwards is refused');

select is(pg_temp.st(pg_temp.sstart(:'reg4', '+201079100004', '74000000-0000-4000-8000-000000000004', '444444')), 'challenge_created', 'D14 setup: registration 4');
select pg_temp.age('74000000-0000-4000-8000-000000000004', interval '6 minutes');
select is(pg_temp.st(pg_temp.sverify(:'reg4', '74000000-0000-4000-8000-000000000004', '444444')), 'invalid', 'D15 an expired proof is refused even with the correct code');
select is(pg_temp.why('74000000-0000-4000-8000-000000000004'), 'expired', 'D16 and marked expired');

-- cross-purpose: a primary_proof challenge cannot be used through the signup function (and vice versa)
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
values (:'f1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sig1@probe.test', extensions.crypt('Correct-Horse-1', extensions.gen_salt('bf')), now(), '{}', now(), now());
update public.profiles set phone_country_iso2 = 'EG', phone_national = '1079100901', phone_e164 = '+201079100901' where user_id = :'f1';
select is(pg_temp.st(pg_temp.svc(format('public.phone_verification_start(%L,%L,%L,%L,%L)', :'f1', '74000000-0000-4000-8000-0000000000f1', 'k2',
            encode(extensions.hmac(convert_to('otp1|74000000-0000-4000-8000-0000000000f1|' || :'f1' || '|primary_proof|654321', 'utf8'), convert_to('k2-test-key', 'utf8'), 'sha256'), 'hex'), pg_temp.ip(9)))),
          'challenge_created', 'D17 setup: a primary_proof challenge for an existing user');
select is(pg_temp.st(pg_temp.sverify(:'f1', '74000000-0000-4000-8000-0000000000f1', '654321')), 'invalid', 'D18 a primary_proof challenge is invisible to the signup verifier (even with the user id as registration)');
select is((select phone_verified_at is null from public.profiles where user_id = :'f1'), true, 'D19 and verifies nothing');

-- the number was taken between start and verify
select is(pg_temp.st(pg_temp.sstart(:'reg5', '+201079100005', '74000000-0000-4000-8000-000000000005', '555555')), 'challenge_created', 'D20 setup: registration 5');
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
values ('72000000-0000-4000-8000-0000000000a5', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sig5@probe.test', extensions.crypt('Correct-Horse-1', extensions.gen_salt('bf')), now(), '{}', now(), now());
update public.profiles set phone_country_iso2 = 'EG', phone_national = '1079100005', phone_e164 = '+201079100005' where user_id = '72000000-0000-4000-8000-0000000000a5';
select is(pg_temp.st(pg_temp.sverify(:'reg5', '74000000-0000-4000-8000-000000000005', '555555')), 'invalid', 'D21 a number claimed by an account in the meantime cannot be proven');
select is(pg_temp.why('74000000-0000-4000-8000-000000000005'), 'claim_changed', 'D22 and the challenge is closed');

-- ===========================================================================
-- E. Limits, validation, no existence oracle
-- ===========================================================================
select is(pg_temp.st(pg_temp.sstart(:'reg1', '+201079100001', '74000000-0000-4000-8000-0000000000e1', '111111')), 'rate_limited', 'E1 a second start inside the resend cooldown is rate limited');
select pg_temp.age('74000000-0000-4000-8000-000000000001', interval '2 minutes');
select pg_temp.age('74000000-0000-4000-8000-000000000002', interval '2 minutes');
select is(pg_temp.st(pg_temp.sstart(:'reg2', '+201079100002', '74000000-0000-4000-8000-0000000000e2', '222222')), 'challenge_created', 'E2 after the cooldown a new start is allowed');
select is(pg_temp.why('74000000-0000-4000-8000-000000000002'), 'superseded', 'E3 and supersedes the previous open challenge');
select is(pg_temp.st(pg_temp.sverify(:'reg2', '74000000-0000-4000-8000-000000000002', '222222')), 'invalid', 'E4 the superseded code is dead');
select is(pg_temp.st(pg_temp.sverify(:'reg2', '74000000-0000-4000-8000-0000000000e2', '222222')), 'verified', 'E5 the new code works');

-- a number that already belongs to an account: identical reply shape, nothing to send, never verifiable
create temp table t_taken as select pg_temp.sstart('73000000-0000-4000-8000-0000000000e3', '+201079100901', '74000000-0000-4000-8000-0000000000e3', '999999', 5) as j;
create temp table t_free as select pg_temp.sstart('73000000-0000-4000-8000-0000000000e4', '+201079100077', '74000000-0000-4000-8000-0000000000e4', '999999', 6) as j;
select is((select array(select jsonb_object_keys(j) order by 1) from t_taken), (select array(select jsonb_object_keys(j) order by 1) from t_free), 'E6 a taken number gets the SAME reply keys as a free one');
select is(((select j from t_taken) ->> 'deliver', (select j from t_free) ->> 'deliver')::text, '(false,true)', 'E7 ... only deliver differs, and only the trusted server sees it');
select is(pg_temp.why('74000000-0000-4000-8000-0000000000e3'), 'suppressed', 'E8 the suppressed challenge is born closed');
select is(pg_temp.st(pg_temp.sverify('73000000-0000-4000-8000-0000000000e3', '74000000-0000-4000-8000-0000000000e3', '999999')), 'invalid', 'E9 and can never verify');
select is(pg_temp.st(pg_temp.sstart('73000000-0000-4000-8000-0000000000e3', '+201079100901', '74000000-0000-4000-8000-0000000000e5', '999999', 5)), 'rate_limited', 'E10 the cooldown applies to a taken number exactly as to a free one (no timing/limit oracle)');

select is(pg_temp.st(pg_temp.svc(format('public.phone_signup_start(%L,%L,%L,%L,%L,%L)', :'reg1', '0100', '74000000-0000-4000-8000-0000000000e6', 'k2', repeat('a', 64), repeat('b', 64)))), 'err:22023', 'E11 a non-canonical number is rejected (22023)');
select is(pg_temp.st(pg_temp.svc(format('public.phone_signup_start(%L,%L,%L,%L,%L,%L)', :'reg1', '+201079100099', '74000000-0000-4000-8000-0000000000e6', 'bad kid', repeat('a', 64), repeat('b', 64)))), 'err:22023', 'E12 a malformed key id is rejected');
select is(pg_temp.st(pg_temp.svc(format('public.phone_signup_verify(%L,%L,%L::jsonb,%L)', :'reg1', '74000000-0000-4000-8000-000000000001', '{"k2":"zz"}', repeat('b', 64)))), 'err:22023', 'E13 a malformed candidate MAC is rejected');
select is(pg_temp.st(pg_temp.svc(format('public.phone_signup_attach(%L,%L)', null, '75000000-0000-4000-8000-000000000001'))), 'err:22023', 'E14 attach rejects a null user');

-- per-number hourly cap (5): fresh registrations against one number
do $$
declare i int;
begin
  for i in 1..5 loop
    perform pg_temp.sstart(('73000000-0000-4000-8000-0000000001' || lpad(i::text, 2, '0'))::uuid, '+201079100555', ('74000000-0000-4000-8000-0000000001' || lpad(i::text, 2, '0'))::uuid, '121212', 20 + i);
  end loop;
end $$;
select is(pg_temp.st(pg_temp.sstart('73000000-0000-4000-8000-000000000199', '+201079100555', '74000000-0000-4000-8000-000000000199', '121212', 30)), 'rate_limited', 'E15 a sixth start for one number inside an hour is rate limited across registrations');

-- per-IP hourly cap (20)
do $$
declare i int;
begin
  for i in 1..20 loop
    perform pg_temp.sstart(gen_random_uuid(), '+2010791' || lpad((20000 + i)::text, 6, '0'), gen_random_uuid(), '131313', 40);
  end loop;
end $$;
select is(pg_temp.st(pg_temp.sstart(gen_random_uuid(), '+201079120099', gen_random_uuid(), '131313', 40)), 'rate_limited', 'E16 the per-IP start cap holds (the database only ever sees an HMAC of the address)');

-- ===========================================================================
-- F. The guard
-- ===========================================================================
create temp table t_g2 as
  select (pg_temp.prove('73000000-0000-4000-8000-0000000002a1', '+201079100201', '74000000-0000-4000-8000-0000000002a1', '202020', 51) ->> 'grant_id') as gid;
create temp table t_g3 as
  select (pg_temp.prove('73000000-0000-4000-8000-0000000002a2', '+201079100202', '74000000-0000-4000-8000-0000000002a2', '202020', 52) ->> 'grant_id') as gid;
select ok((select gid is not null from t_g2) and (select gid is not null from t_g3), 'F0 setup: two grants for two different numbers');

select is(pg_temp.mk_user('72000000-0000-4000-8000-0000000000b1', pg_temp.alias('+201079100999')), '42501', 'F1 enforce: an alias user WITHOUT a grant is refused');
select is(pg_temp.mk_user('72000000-0000-4000-8000-0000000000b2', pg_temp.alias('+201079100201'), jsonb_build_object('phone_signup_grant', gen_random_uuid()::text, 'phone_signup_registration', gen_random_uuid()::text)), '42501', 'F2 a forged grant id is refused');
select is(pg_temp.mk_user('72000000-0000-4000-8000-0000000000b3', pg_temp.alias('+201079100201'), jsonb_build_object('phone_signup_grant', 'not-a-uuid', 'phone_signup_registration', 'x')), '42501', 'F3 malformed markers are refused (no cast error escapes)');
select is(pg_temp.mk_user('72000000-0000-4000-8000-0000000000b4', pg_temp.alias('+201079100201'), jsonb_build_object('phone_signup_grant', (select gid from t_g3), 'phone_signup_registration', '73000000-0000-4000-8000-0000000002a2')), '42501', 'F4 a grant for ANOTHER alias cannot create this alias');
select is(pg_temp.mk_user('72000000-0000-4000-8000-0000000000b5', pg_temp.alias('+201079100201'), jsonb_build_object('phone_signup_grant', (select gid from t_g2), 'phone_signup_registration', '73000000-0000-4000-8000-0000000002a2')), '42501', 'F5 the right grant with the wrong registration is refused');
select is(pg_temp.mk_user('72000000-0000-4000-8000-0000000000b6', pg_temp.alias('+201079100201'), jsonb_build_object('phone_signup_grant', (select gid from t_g2), 'phone_signup_registration', '73000000-0000-4000-8000-0000000002a1'), true), '42501', 'F6 an ANONYMOUS user cannot consume a grant');
select is((select consumed_at is null from app.phone_signup_grants where id = (select gid::uuid from t_g2)), true, 'F7 none of the refusals consumed the grant');
select is(pg_temp.mk_user('72000000-0000-4000-8000-0000000000b7', pg_temp.alias('+201079100201'), jsonb_build_object('phone_signup_grant', (select gid from t_g2), 'phone_signup_registration', '73000000-0000-4000-8000-0000000002a1')), 'ok', 'F8 the right grant + registration creates the user');
select is(pg_temp.mk_user('72000000-0000-4000-8000-0000000000b8', pg_temp.alias('+201079100201'), jsonb_build_object('phone_signup_grant', (select gid from t_g2), 'phone_signup_registration', '73000000-0000-4000-8000-0000000002a1')), '23505', 'F9 a second user on the same alias is stopped by Auth uniqueness (and the grant is spent anyway)');
select is(pg_temp.mk_user('72000000-0000-4000-8000-0000000000b9', pg_temp.alias('+201079100202'), jsonb_build_object('phone_signup_grant', (select gid from t_g2), 'phone_signup_registration', '73000000-0000-4000-8000-0000000002a1')), '42501', 'F10 a spent grant cannot be replayed for another alias');
update app.phone_signup_grants set expires_at = clock_timestamp() - interval '1 second', created_at = created_at - interval '1 minute' where id = (select gid::uuid from t_g3);
select is(pg_temp.mk_user('72000000-0000-4000-8000-0000000000ba', pg_temp.alias('+201079100202'), jsonb_build_object('phone_signup_grant', (select gid from t_g3), 'phone_signup_registration', '73000000-0000-4000-8000-0000000002a2')), '42501', 'F11 an expired grant is refused');
select is(pg_temp.mk_user('72000000-0000-4000-8000-0000000000bb', 'someone.else@probe.test'), 'ok', 'F12 enforce: an ordinary e-mail user is untouched');
select is(pg_temp.mk_user('72000000-0000-4000-8000-0000000000bc', 'fb-' || gen_random_uuid() || '@oauth.probe.test', '{"provider":"facebook"}'), 'ok', 'F13 enforce: an OAuth-style user is untouched');

-- observe mode: never blocks, records what enforce would have refused
update app.phone_verification_config set alias_guard_mode = 'observe';
select is(pg_temp.mk_user('72000000-0000-4000-8000-0000000000bd', pg_temp.alias('+201079100301')), 'ok', 'F14 observe: an alias user without a grant is allowed');
select is((select row(count(*), bool_and(not had_grant))::text from app.phone_alias_guard_observations where user_id = '72000000-0000-4000-8000-0000000000bd'), '(1,t)', 'F15 and recorded (no alias, no number in the observation)');
-- off: inert
update app.phone_verification_config set signup_enabled = false, alias_guard_mode = 'off';
select is(pg_temp.mk_user('72000000-0000-4000-8000-0000000000be', pg_temp.alias('+201079100302')), 'ok', 'F16 off: the installed guard changes nothing');
select is((select count(*) from app.phone_alias_guard_observations where user_id = '72000000-0000-4000-8000-0000000000be'), 0::bigint, 'F17 and records nothing');
select is((select count(*) from app.phone_verification_config_log where setting = 'alias_guard_mode'), 4::bigint, 'F18 each mode change (off->observe->enforce->observe->off) is logged');
update app.phone_verification_config set alias_guard_mode = 'enforce', signup_enabled = true;

-- ===========================================================================
-- G. Attach binding
-- ===========================================================================
create temp table t_g4 as select (pg_temp.prove('73000000-0000-4000-8000-0000000003a1', '+201079100401', '74000000-0000-4000-8000-0000000003a1', '303030', 61) ->> 'grant_id') as gid;
select is(pg_temp.mk_user('72000000-0000-4000-8000-0000000000c1', pg_temp.alias('+201079100401'), jsonb_build_object('phone_signup_grant', (select gid from t_g4), 'phone_signup_registration', '73000000-0000-4000-8000-0000000003a1')), 'ok', 'G0 setup: the user for grant 4');
select is(pg_temp.st(pg_temp.sattach('72000000-0000-4000-8000-0000000000c1', (select gid::uuid from t_g4))), 'invalid', 'G1 attach before the number is on the profile is refused');
select is(pg_temp.st(pg_temp.sattach(:'f1', (select gid::uuid from t_g4))), 'invalid', 'G2 a DIFFERENT user cannot attach someone else''s grant');
select is(pg_temp.try_sql($q$update public.profiles set phone_country_iso2 = 'EG', phone_national = '1079100402', phone_e164 = '+201079100402' where user_id = '72000000-0000-4000-8000-0000000000c1'$q$), '42501',
          'G2b the EXISTING identity guard already refuses to move an alias account to another number (pre-existing protection, unchanged)');
-- from here the existing guard is switched off INSIDE this test only, to prove attach re-checks the number itself (defence in depth)
alter table public.profiles disable trigger guard_phone_password_identity;
update public.profiles set phone_country_iso2 = 'EG', phone_national = '1079100402', phone_e164 = '+201079100402' where user_id = '72000000-0000-4000-8000-0000000000c1';
select is(pg_temp.st(pg_temp.sattach('72000000-0000-4000-8000-0000000000c1', (select gid::uuid from t_g4))), 'invalid', 'G3 a profile number different from the proven one is refused');
select is((select phone_verified_at is null from public.profiles where user_id = '72000000-0000-4000-8000-0000000000c1'), true, 'G4 and nothing was verified');
update public.profiles set phone_country_iso2 = 'EG', phone_national = '1079100401', phone_e164 = '+201079100401' where user_id = '72000000-0000-4000-8000-0000000000c1';
select is(pg_temp.try_sql($q$update auth.users set email = 'moved@probe.test' where id = '72000000-0000-4000-8000-0000000000c1'$q$), '42501', 'G4b the EXISTING alias e-mail guard already refuses to rename an alias account (pre-existing protection, unchanged)');
update app.phone_signup_grants set consumed_at = consumed_at - interval '16 minutes' where id = (select gid::uuid from t_g4);
select is(pg_temp.st(pg_temp.sattach('72000000-0000-4000-8000-0000000000c1', (select gid::uuid from t_g4))), 'invalid', 'G6 attach after the attach window is refused');
update app.phone_signup_grants set consumed_at = consumed_at + interval '16 minutes' where id = (select gid::uuid from t_g4);
select is(pg_temp.st(pg_temp.sattach('72000000-0000-4000-8000-0000000000c1', (select gid::uuid from t_g4))), 'attached', 'G7 within the window, for the right user, number and alias: attached');
select is(pg_temp.st(pg_temp.sattach('72000000-0000-4000-8000-0000000000c1', (select gid::uuid from t_g4))), 'invalid', 'G8 attaching twice is refused');
update public.profiles set phone_country_iso2 = 'EG', phone_national = '1079100403', phone_e164 = '+201079100403' where user_id = '72000000-0000-4000-8000-0000000000c1';
select is((select phone_verified_at is null from public.profiles where user_id = '72000000-0000-4000-8000-0000000000c1'), true, 'G9 a later number change resets the verified flag (existing trigger), so a proof never outlives its number');
select is(pg_temp.st(pg_temp.sattach('72000000-0000-4000-8000-0000000000c1', (select gid::uuid from t_g4))), 'invalid', 'G10 and the spent grant cannot re-verify the new number');
alter table public.profiles enable trigger guard_phone_password_identity;

-- ===========================================================================
-- H. Retention
-- ===========================================================================
update app.phone_verification_challenges set created_at = created_at - interval '40 days', expires_at = expires_at - interval '40 days' where id = '74000000-0000-4000-8000-0000000003a1';
update app.phone_alias_guard_observations set observed_at = observed_at - interval '40 days';
select is(pg_temp.svc('public.phone_verification_purge(interval ''30 days'')') ->> 'observations_deleted', '1', 'H1 purge removes old observations');
select is((select count(*) from app.phone_signup_grants where challenge_id = '74000000-0000-4000-8000-0000000003a1'), 0::bigint, 'H2 an old challenge takes its grant with it (ON DELETE CASCADE)');
select is((select count(*) from app.phone_signup_grants where challenge_id = '74000000-0000-4000-8000-0000000002a1'), 1::bigint, 'H3 recent grants stay');

select * from finish();
rollback;
