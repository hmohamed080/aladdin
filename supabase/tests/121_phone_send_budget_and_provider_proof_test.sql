-- pgTAP: global send budget + provider-acceptance record on the R1 phone authority (20261102090001_phone_authority_send_budget.sql).
--
--   A. Surface and privileges   B. The budget across signup starts   C. Suppressed challenges spend nothing   D. Rolling window
--   E. One budget for BOTH purposes   F. Exhaustion reveals nothing about an account   G. provider_accepted_at (mark_sent)
--
-- Reconciles PR #116's cost controls into the single authority: no second table, no second sender. Every fixture lives inside this
-- transaction; the file rolls back.
create extension if not exists pgtap;

begin;
select plan(31);

\set u1  '74000000-0000-4000-8000-000000000001'

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
create function pg_temp.ip(p_n int) returns text language sql as $$ select encode(extensions.digest('ip' || p_n, 'sha256'), 'hex') $$;
create function pg_temp.smac(p_ch uuid, p_reg uuid, p_code text) returns text language sql as $$
  select encode(extensions.hmac(convert_to('otp1|' || p_ch || '|' || p_reg || '|signup_proof|' || p_code, 'utf8'), convert_to('k2-test-key', 'utf8'), 'sha256'), 'hex') $$;
create function pg_temp.pmac(p_ch uuid, p_user uuid, p_code text) returns text language sql as $$
  select encode(extensions.hmac(convert_to('otp1|' || p_ch || '|' || p_user || '|primary_proof|' || p_code, 'utf8'), convert_to('k2-test-key', 'utf8'), 'sha256'), 'hex') $$;
create function pg_temp.sstart(p_n int, p_phone text, p_ip int default 1) returns jsonb language sql as $$
  select pg_temp.svc(format('public.phone_signup_start(%L,%L,%L,%L,%L,%L)',
    ('75000000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'))::uuid, p_phone, ('76000000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'))::uuid, 'k2',
    pg_temp.smac(('76000000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'))::uuid, ('75000000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'))::uuid, '123456'), pg_temp.ip(p_ip))) $$;
create function pg_temp.ch(p_n int) returns uuid language sql as $$ select ('76000000-0000-4000-8000-0000000000' || lpad(p_n::text, 2, '0'))::uuid $$;
create function pg_temp.try_sql(p_sql text) returns text language plpgsql as $$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
values (:'u1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'budget1@probe.test',
        extensions.crypt('Correct-Horse-1', extensions.gen_salt('bf')), now(), '{}', now(), now());
update public.profiles set phone_country_iso2 = 'EG', phone_national = '1079100001', phone_e164 = '+201079100001' where user_id = :'u1';

-- ===========================================================================
-- A. Surface and privileges
-- ===========================================================================
select is((select daily_send_budget from app.phone_verification_config), 200, 'A1 the budget ships at a conservative 200 per rolling day');
select is((select enabled from app.phone_verification_config), false, 'A2 and the feature itself still ships disabled');
select is(pg_temp.try_sql('update app.phone_verification_config set daily_send_budget = 0'), '23514', 'A3 a zero budget is refused (it would silently disable sending)');
select is(pg_temp.try_sql('update app.phone_verification_config set daily_send_budget = 100001'), '23514', 'A4 an absurd budget is refused');
select ok(has_function_privilege('service_role', 'public.phone_verification_mark_sent(uuid)', 'execute'), 'A5 mark_sent is executable by service_role');
select ok(not has_function_privilege('anon', 'public.phone_verification_mark_sent(uuid)', 'execute')
          and not has_function_privilege('authenticated', 'public.phone_verification_mark_sent(uuid)', 'execute'), 'A6 and by no client role');

update app.phone_verification_config set enabled = true;
update app.phone_verification_config set alias_guard_mode = 'observe';
update app.phone_verification_config set signup_enabled = true;
update app.phone_verification_config set daily_send_budget = 3;
select is((select count(*)::int from app.phone_verification_config_log where setting = 'daily_send_budget' and old_value = '200' and new_value = '3'), 1,
          'A7 a budget change is recorded (who/when/from/to)');

-- ===========================================================================
-- B. The budget across signup starts (distinct registrations, numbers and IPs)
-- ===========================================================================
select is(pg_temp.st(pg_temp.sstart(1, '+201079100011', 11)), 'challenge_created', 'B1 first start inside the budget');
select is(pg_temp.st(pg_temp.sstart(2, '+201079100012', 12)), 'challenge_created', 'B2 second');
select is(pg_temp.st(pg_temp.sstart(3, '+201079100013', 13)), 'challenge_created', 'B3 third (the budget is now spent)');
select is(pg_temp.st(pg_temp.sstart(4, '+201079100014', 14)), 'unavailable', 'B4 the fourth, from a different registration, number and IP, is refused');
select is((select count(*)::int from app.phone_verification_challenges where id = pg_temp.ch(4)), 0, 'B5 and nothing was created for it');
select is((select count(*)::int from app.phone_verification_challenges where created_at > now() - interval '24 hours' and invalidated_why is distinct from 'suppressed'), 3,
          'B6 exactly the budget is on the books');

-- ===========================================================================
-- C. A suppressed challenge (number already has an account: nothing is sent) spends nothing
-- ===========================================================================
update app.phone_verification_challenges set invalidated_at = clock_timestamp(), invalidated_why = 'suppressed' where id = pg_temp.ch(1);
select is(pg_temp.st(pg_temp.sstart(4, '+201079100014', 14)), 'challenge_created', 'C1 a suppressed challenge frees its place');
select is(pg_temp.st(pg_temp.sstart(5, '+201079100015', 15)), 'unavailable', 'C2 and the budget is spent again');

-- ===========================================================================
-- D. Rolling window
-- ===========================================================================
update app.phone_verification_challenges set created_at = created_at - interval '25 hours', expires_at = expires_at - interval '25 hours' where id = pg_temp.ch(2);
select is(pg_temp.st(pg_temp.sstart(5, '+201079100015', 15)), 'challenge_created', 'D1 a challenge older than 24 hours no longer counts');
select is(pg_temp.st(pg_temp.sstart(6, '+201079100016', 16)), 'unavailable', 'D2 the window is rolling, not a calendar day');

-- ===========================================================================
-- E. ONE budget for both purposes
-- ===========================================================================
select is(pg_temp.st(pg_temp.svc(format('public.phone_verification_start(%L,%L,%L,%L,%L)', :'u1', '77000000-0000-4000-8000-000000000001', 'k2',
          pg_temp.pmac('77000000-0000-4000-8000-000000000001', :'u1', '123456'), pg_temp.ip(21)))), 'unavailable',
          'E1 an existing account''s primary-phone proof is refused while the shared budget is spent');
update app.phone_verification_config set daily_send_budget = 100;
select is(pg_temp.st(pg_temp.svc(format('public.phone_verification_start(%L,%L,%L,%L,%L)', :'u1', '77000000-0000-4000-8000-000000000001', 'k2',
          pg_temp.pmac('77000000-0000-4000-8000-000000000001', :'u1', '123456'), pg_temp.ip(21)))), 'challenge_created',
          'E2 the same call succeeds once the budget allows it');
select is((select count(*)::int from app.phone_verification_challenges where created_at > now() - interval '24 hours' and invalidated_why is distinct from 'suppressed'), 4,
          'E3 and it is counted in the same pool (3 signup + 1 primary)');

-- ===========================================================================
-- F. Exhaustion reveals nothing about an account
-- ===========================================================================
update app.phone_verification_config set daily_send_budget = 4;
select is(pg_temp.sstart(7, '+201079100017', 17), pg_temp.sstart(8, '+201079100001', 18),
          'F1 with the budget spent, a FREE number and a number that already belongs to u1 get the identical reply');
select is(pg_temp.st(pg_temp.sstart(8, '+201079100001', 18)), 'unavailable', 'F2 which is the same one a disabled feature gives');

-- ===========================================================================
-- G. provider_accepted_at
-- ===========================================================================
select is((select provider_accepted_at from app.phone_verification_challenges where id = pg_temp.ch(3)), null, 'G1 a new challenge is not marked as accepted');
select is(pg_temp.svc(format('public.phone_verification_mark_sent(%L)', pg_temp.ch(3))), 'true'::jsonb, 'G2 mark_sent stamps an open challenge');
select ok((select provider_accepted_at from app.phone_verification_challenges where id = pg_temp.ch(3)) is not null, 'G3 and the timestamp is set');
select is(pg_temp.svc(format('public.phone_verification_mark_sent(%L)', pg_temp.ch(3))), 'false'::jsonb, 'G4 it is idempotent (a second call changes nothing)');
select is(pg_temp.svc(format('public.phone_verification_mark_sent(%L)', gen_random_uuid())), 'false'::jsonb, 'G5 an unknown challenge is a no-op');
select is(pg_temp.svc(format('public.phone_verification_mark_sent(%L)', pg_temp.ch(1))), 'false'::jsonb, 'G6 a closed (suppressed) challenge is never stamped');
select is(pg_temp.st(pg_temp.svc('public.phone_verification_mark_sent(null)')), 'err:22023', 'G7 a null id is a server bug, not a user outcome');
select is(pg_temp.st(pg_temp.call_role('anon', format('public.phone_verification_mark_sent(%L)', pg_temp.ch(3)))), 'err:42501', 'G8 a client role cannot call it');
select is((select attempts from app.phone_verification_challenges where id = pg_temp.ch(3)), 0::smallint, 'G9 stamping changes no proof state');

select * from finish();
rollback;
