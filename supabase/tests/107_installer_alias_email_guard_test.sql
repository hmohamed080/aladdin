-- pgTAP: M6 - the installer login-alias guard on auth.users.email, the scoped single-use operator exception, and
-- guard-aware phone-change settlement.
--
-- GoTrue writes auth.users with plain UPDATEs, so every statement below that changes auth.users.email as the test owner
-- exercises exactly the trigger an Admin API / user-scoped GoTrue call hits. (GoTrue's own request handling, auth.identities
-- and the lock races between a REAL Admin API call and settlement are proven by the live GoTrue tests and the multi-session
-- script.) This file proves, on the real schema:
--   * the guard is scoped to alias accounts and to the email column only (no password interception, no bypass switch);
--   * an alias change is allowed ONLY under a matching PENDING journal row or one scoped, unexpired, unrevoked, single-use
--     operator exception, and everything else fails closed (including stale changes after compensation and a missing
--     exception table);
--   * the operator exception is bound to user + old alias + new alias + operator, audited, and unusable twice;
--   * only service_role can issue or revoke, only an administrator can be the operator, and no audit forgery is possible;
--   * settlement compensates at once when the guard is in force and keeps the conservative rule when it is not.
create extension if not exists pgtap;

begin;
select plan(88);

-- Fixtures. g1..g6 alias accounts (profile phone = alias phone); e1 ordinary email account; op administrator; op2 not.
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
                        email_confirmed_at, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email,
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), now()
from (values
  ('95000000-0000-4000-8000-000000000001', 'p201099100001@craftsman-login.aladdin.invalid'),
  ('95000000-0000-4000-8000-000000000002', 'p201099100002@craftsman-login.aladdin.invalid'),
  ('95000000-0000-4000-8000-000000000003', 'p201099100003@craftsman-login.aladdin.invalid'),
  ('95000000-0000-4000-8000-000000000004', 'p201099100004@craftsman-login.aladdin.invalid'),
  ('95000000-0000-4000-8000-000000000005', 'p201099100005@craftsman-login.aladdin.invalid'),
  ('95000000-0000-4000-8000-000000000006', 'p201099100006@craftsman-login.aladdin.invalid'),
  ('95000000-0000-4000-8000-000000000007', 'p201099100007@craftsman-login.aladdin.invalid'),
  ('95000000-0000-4000-8000-0000000000e1', 'p95-email-1@example.test'),
  ('95000000-0000-4000-8000-0000000000a0', 'p95-operator@example.test'),
  ('95000000-0000-4000-8000-0000000000a1', 'p95-operator-2@example.test')) v(id, email);
update public.profiles p
   set phone_country_iso2 = 'EG', phone_national = substr(split_part(u.email, '@', 1), 4), phone_e164 = '+' || substr(split_part(u.email, '@', 1), 2)
  from auth.users u
 where u.id = p.user_id and u.email ~ '^p2010991000(0[1-7])@craftsman-login';
insert into public.admin_role_assignments (user_id, role_id)
select '95000000-0000-4000-8000-0000000000a0', r.id from public.admin_roles r where r.key = 'administrator';
-- The break-glass is authorized by phones.alias_exception (Super Admin by default, delegable through a role):
-- the fixture delegates it to the Administrator role, exactly what Staff - Roles does.
insert into public.admin_role_permissions (role_id, permission_key)
select r.id, 'phones.alias_exception' from public.admin_roles r where r.key = 'administrator'
on conflict do nothing;
-- a1-operator-2 holds only the lowest admin role (support): authenticated as staff, but NOT an administrator.
insert into public.admin_role_assignments (user_id, role_id)
select '95000000-0000-4000-8000-0000000000a1', r.id from public.admin_roles r where r.key = 'support';

create function pg_temp.u(k text) returns uuid language sql as $$
  select (case k when 'e1' then '95000000-0000-4000-8000-0000000000e1' when 'op' then '95000000-0000-4000-8000-0000000000a0'
                 when 'op2' then '95000000-0000-4000-8000-0000000000a1' else '95000000-0000-4000-8000-0000000000' || lpad(substr(k, 2), 2, '0') end)::uuid $$;
create function pg_temp.al(e164 text) returns text language sql as $$ select 'p' || substr(e164, 2) || '@craftsman-login.aladdin.invalid' $$;
create function pg_temp.cur(k text) returns text language sql as $$ select email from auth.users where id = pg_temp.u(k) $$;
create function pg_temp.mint(k text, ctx text, act text default 'change_phone') returns uuid language plpgsql security definer as $$
-- A receipt exactly as public.account_password_confirm issues it (PR #88 reauth receipts: single-use, 60 s, bound to
-- user + operation + target). The password check itself is covered by 109_reauth_operations_test.sql.
declare r uuid;
begin
  insert into app.reauth_receipts (user_id, operation, target, created_at, expires_at)
  values (pg_temp.u(k),
          case act when 'change_phone' then 'primary_phone.change' when 'change_password' then 'password.change' else act end,
          case when act = 'change_phone' then ctx else 'self' end,
          clock_timestamp(), clock_timestamp() + interval '60 seconds')
  returning id into r;
  return r;
end $$;
create function pg_temp.bgn(k text, e164 text) returns uuid language sql as $$
  select change_id from public.installer_phone_change_begin(pg_temp.u(k), gen_random_uuid(), pg_temp.mint(k, e164), 'EG', substr(e164, 4), e164) $$;
create function pg_temp.guard_off() returns void language plpgsql as $$
begin drop trigger installer_alias_email_guard on auth.users; end $$;
create function pg_temp.guard_on() returns void language plpgsql as $$
begin
  create trigger installer_alias_email_guard before update of email on auth.users
    for each row execute function app.installer_alias_email_guard();
end $$;
create function pg_temp.force_email(u uuid, e text) returns void language plpgsql as $$
begin
  perform pg_temp.guard_off();
  update auth.users set email = e where id = u;
  perform pg_temp.guard_on();
end $$;
create function pg_temp.set_email_sql(k text, e text) returns text language sql as $$
  select format('update auth.users set email = %L where id = %L', e, pg_temp.u(k)) $$;
create temp table ids (k text primary key, v text);
grant all on ids to public;

-- ===========================================================================
-- 1. Structure and privileges
-- ===========================================================================
select is((select count(*)::int from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'installer_alias_email_guard' and not tgisinternal and tgenabled = 'O'), 1,
  'the guard trigger exists on auth.users and is enabled');
select ok((select pg_get_triggerdef(oid) from pg_trigger where tgname = 'installer_alias_email_guard') ~ 'BEFORE UPDATE OF email ON auth.users FOR EACH ROW',
  'it is BEFORE UPDATE OF email, FOR EACH ROW');
select ok((select pg_get_triggerdef(oid) from pg_trigger where tgname = 'installer_alias_email_guard') !~* 'encrypted_password',
  'it does NOT intercept encrypted_password (password changes use GoTrue''s native require-current-password)');
select ok((select prosrc from pg_proc where proname = 'installer_alias_email_guard') !~* 'current_setting|set_config|bypass|enabled',
  'the guard source has no setting-driven or switch-driven bypass');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where proname = 'installer_alias_email_guard'), 'the guard is SECURITY DEFINER with an empty search_path');
select ok(not exists (select 1 from (values ('anon'), ('authenticated'), ('service_role')) r(rolname)
   where has_function_privilege(r.rolname, 'app.installer_alias_email_guard()', 'EXECUTE')
      or has_function_privilege(r.rolname, 'app.installer_alias_exception_audit(uuid,text,uuid,uuid)', 'EXECUTE')
      or has_function_privilege(r.rolname, 'app.installer_alias_guard_active()', 'EXECUTE')), 'no API role can execute the guard, its audit writer or its status helper');
select ok(has_function_privilege('service_role', 'public.installer_alias_exception_issue(uuid,uuid,text,text,integer)', 'EXECUTE')
      and has_function_privilege('service_role', 'public.installer_alias_exception_revoke(uuid,uuid)', 'EXECUTE')
      and has_function_privilege('service_role', 'public.installer_alias_guard_status()', 'EXECUTE'), 'service_role can execute issue / revoke / status');
select ok(not exists (select 1 from (values ('anon'), ('authenticated')) r(rolname) cross join (values
      ('public.installer_alias_exception_issue(uuid,uuid,text,text,integer)'), ('public.installer_alias_exception_revoke(uuid,uuid)'), ('public.installer_alias_guard_status()')) f(sig)
      where has_function_privilege(r.rolname, f.sig, 'EXECUTE')), 'anon and authenticated can execute none of them');
select ok(not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where p.proname in ('installer_alias_exception_issue', 'installer_alias_exception_revoke', 'installer_alias_guard_status', 'installer_alias_email_guard',
                       'installer_alias_exception_audit', 'installer_alias_guard_active') and a.grantee = 0), 'none is executable by PUBLIC');
select is((select relrowsecurity::int + (select count(*)::int from pg_policy where polrelid = c.oid) from pg_class c where c.oid = 'app.installer_alias_exceptions'::regclass), 1,
  'the exceptions table has RLS on and no policy');
select ok(not exists (
    select 1 from (values ('anon'), ('authenticated'), ('service_role')) r(rolname)
    cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(priv)
    where has_table_privilege(r.rolname, 'app.installer_alias_exceptions', p.priv)), 'no API role holds any privilege on the exceptions table');
select is((select app.installer_alias_guard_active()), true, 'the guard reports itself active for an ordinary session');
set local role service_role;
select is((select public.installer_alias_guard_status()), true, 'service_role can read the guard status (deployment check)');
reset role;

-- ===========================================================================
-- 2. What the guard allows and refuses (as the test owner: the same UPDATE GoTrue issues)
-- ===========================================================================
select lives_ok($$ update auth.users set email = 'p95-email-1b@example.test' where id = '95000000-0000-4000-8000-0000000000e1' $$,
  'an ordinary email account can change its email (guard not involved)');
select lives_ok($$ update auth.users set email = email where id = '95000000-0000-4000-8000-000000000001' $$, 'GoTrue re-writing the SAME alias value is allowed');
select lives_ok($$ update auth.users set last_sign_in_at = now(), updated_at = now() where id = '95000000-0000-4000-8000-000000000001' $$,
  'sign-in style updates of other columns on an alias account are untouched');
select lives_ok($$ update auth.users set encrypted_password = extensions.crypt('Whatever-Passw0rd-1!', extensions.gen_salt('bf', 4)) where id = '95000000-0000-4000-8000-000000000001' $$,
  'the password column is NOT guarded (native GoTrue enforcement owns password changes)');
select throws_ok(pg_temp.set_email_sql('g1', 'attacker@example.test'), '42501', 'login alias change is not authorized', 'DIRECT: alias account -> arbitrary email is refused');
select throws_ok(pg_temp.set_email_sql('g1', pg_temp.al('+201099199999')), '42501', 'login alias change is not authorized', 'DIRECT: alias -> another well-formed alias is refused');
select throws_ok(pg_temp.set_email_sql('e1', pg_temp.al('+201099188888')), '42501', 'login alias change is not authorized', 'an ordinary account cannot be moved INTO the alias domain');
select is(pg_temp.cur('g1'), 'p201099100001@craftsman-login.aladdin.invalid', 'refused changes leave the alias exactly as it was');

-- pending journal row authorizes exactly old -> new for that user
select lives_ok(format('select pg_temp.bgn(%L, %L)', 'g1', '+201099200001'), 'g1: begin a phone change (pending journal row)');
select throws_ok(pg_temp.set_email_sql('g1', pg_temp.al('+201099200099')), '42501', null, 'a pending change does NOT authorize a DIFFERENT alias');
select throws_ok(pg_temp.set_email_sql('g1', 'attacker@example.test'), '42501', null, 'nor an arbitrary email');
select throws_ok(pg_temp.set_email_sql('g2', pg_temp.al('+201099200001')), '42501', null, 'nor the same alias on ANOTHER user');
select lives_ok(pg_temp.set_email_sql('g1', pg_temp.al('+201099200001')), 'the matching change (this user, old -> new) is allowed');
select is((select state || '/' || coalesce(resolution, '-') from public.installer_phone_change_settle(pg_temp.u('g1'), (select id from app.installer_phone_changes where user_id = pg_temp.u('g1')), false)), 'done/applied',
  'settlement observes the new alias: done');
select throws_ok(pg_temp.set_email_sql('g1', 'p201099100001@craftsman-login.aladdin.invalid'), '42501', null, 'after the operation is DONE the old alias cannot be restored by a stale write');
select throws_ok(pg_temp.set_email_sql('g1', pg_temp.al('+201099200098')), '42501', null, 'and a completed operation authorizes nothing further');

-- the journal row binds the OLD alias as well: if the alias is no longer the one the operation started from, it authorizes nothing
select lives_ok(format('select pg_temp.bgn(%L, %L)', 'g7', '+201099200007'), 'g7: begin');
select pg_temp.force_email(pg_temp.u('g7'), pg_temp.al('+201099288888'));   -- the alias moved elsewhere by an out-of-band write
select throws_ok(pg_temp.set_email_sql('g7', pg_temp.al('+201099200007')), '42501', null, 'g7: a journal row does NOT authorize a change from an alias other than its recorded old alias');

-- stale write after compensation (Part D)
select lives_ok(format('select pg_temp.bgn(%L, %L)', 'g2', '+201099200002'), 'g2: begin');
select is((select state || '/' || coalesce(resolution, '-') from public.installer_phone_change_settle(pg_temp.u('g2'), (select id from app.installer_phone_changes where user_id = pg_temp.u('g2')), false)),
  'compensated/restored', 'g2: with the guard in force, settlement compensates AT ONCE (no lease wait, caller says nothing about its Auth call)');
select throws_ok(pg_temp.set_email_sql('g2', pg_temp.al('+201099200002')), '42501', null, 'g2: a STALE Admin write after compensation is refused');
select is(pg_temp.cur('g2'), 'p201099100002@craftsman-login.aladdin.invalid', 'g2: the alias is still the original; the user id and profile are untouched');
select is((select phone_e164 from public.profiles where user_id = pg_temp.u('g2')), '+201099100002', 'g2: the profile was restored');

-- needs_attention does not authorize
select lives_ok(format('select pg_temp.bgn(%L, %L)', 'g3', '+201099200003'), 'g3: begin');
select pg_temp.force_email(pg_temp.u('g3'), 'someone-else@example.test');
select is((select state from public.installer_phone_change_settle(pg_temp.u('g3'), (select id from app.installer_phone_changes where user_id = pg_temp.u('g3')), true)), 'needs_attention', 'g3: an unexpected alias -> needs_attention');
select throws_ok(pg_temp.set_email_sql('g3', pg_temp.al('+201099200003')), '42501', null, 'g3: a needs_attention row authorizes nothing (even the journal''s own new alias)');

-- conservative settlement when the guard is NOT in force
select lives_ok(format('select pg_temp.bgn(%L, %L)', 'g4', '+201099200004'), 'g4: begin');
select pg_temp.guard_off();
select is((select app.installer_alias_guard_active()), false, 'with the trigger absent the guard reports NOT active');
select is((select state from public.installer_phone_change_settle(pg_temp.u('g4'), (select id from app.installer_phone_changes where user_id = pg_temp.u('g4')), false)), 'pending',
  'g4: guard not in force -> conservative: an old alias within the lease is NOT compensated');
select is((select state from public.installer_phone_change_settle(pg_temp.u('g4'), (select id from app.installer_phone_changes where user_id = pg_temp.u('g4')), true)), 'compensated',
  'g4: ... and compensated only when the caller says its call has returned');
select pg_temp.guard_on();
select is((select app.installer_alias_guard_active()), true, 'guard back in force');

-- ===========================================================================
-- 3. Operator exception
-- ===========================================================================
set local role anon;
select throws_ok($$ select public.installer_alias_exception_issue('95000000-0000-4000-8000-0000000000a0', '95000000-0000-4000-8000-000000000005', 'p201099300005@craftsman-login.aladdin.invalid', 'support ticket 1234', 300) $$, '42501', null, 'anon cannot issue');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"95000000-0000-4000-8000-0000000000a0","role":"authenticated"}';
select throws_ok($$ select public.installer_alias_exception_issue('95000000-0000-4000-8000-0000000000a0', '95000000-0000-4000-8000-000000000005', 'p201099300005@craftsman-login.aladdin.invalid', 'support ticket 1234', 300) $$, '42501', null,
  'even an authenticated ADMINISTRATOR cannot call it from a user session: service_role only');
select throws_ok($$ select * from app.installer_alias_exceptions $$, '42501', null, 'nor read the exceptions table');
reset role;

set local role service_role;
select throws_ok($$ select public.installer_alias_exception_issue('95000000-0000-4000-8000-0000000000a1', '95000000-0000-4000-8000-000000000005', 'p201099300005@craftsman-login.aladdin.invalid', 'ticket 1234 SIM swap', 300) $$, '42501', 'operator is not authorized', 'a non-administrator operator is refused');
select throws_ok($$ select public.installer_alias_exception_issue('95000000-0000-4000-8000-0000000000a0', '95000000-0000-4000-8000-0000000000a0', 'p201099300005@craftsman-login.aladdin.invalid', 'ticket 1234 SIM swap', 300) $$, '42501', 'an operator cannot authorize a change to their own login', 'even an ADMINISTRATOR cannot authorize a change to their own login');
select throws_ok($$ select public.installer_alias_exception_issue(gen_random_uuid(), '95000000-0000-4000-8000-000000000005', 'p201099300005@craftsman-login.aladdin.invalid', 'ticket 1234 SIM swap', 300) $$, '42501', 'operator is not authorized', 'an unknown operator id is refused');
select throws_ok($$ select public.installer_alias_exception_issue('95000000-0000-4000-8000-0000000000a0', gen_random_uuid(), 'p201099300005@craftsman-login.aladdin.invalid', 'ticket 1234 SIM swap', 300) $$, 'P0002', 'unknown user', 'an unknown user is refused');
select throws_ok($$ select public.installer_alias_exception_issue('95000000-0000-4000-8000-0000000000a0', '95000000-0000-4000-8000-000000000005', 'p201099300005@craftsman-login.aladdin.invalid', 'short', 300) $$, '22023', null, 'a reason under 10 characters is refused');
select throws_ok($$ select public.installer_alias_exception_issue('95000000-0000-4000-8000-0000000000a0', '95000000-0000-4000-8000-000000000005', 'p201099300005@craftsman-login.aladdin.invalid', 'ticket 1234 SIM swap', 5) $$, '22023', null, 'an expiry under 30 seconds is refused');
select throws_ok($$ select public.installer_alias_exception_issue('95000000-0000-4000-8000-0000000000a0', '95000000-0000-4000-8000-000000000005', 'p201099300005@craftsman-login.aladdin.invalid', 'ticket 1234 SIM swap', 3600) $$, '22023', null, 'an expiry over 15 minutes is refused (no generic time window)');
select throws_ok($$ select public.installer_alias_exception_issue('95000000-0000-4000-8000-0000000000a0', '95000000-0000-4000-8000-000000000005', 'garbage@craftsman-login.aladdin.invalid', 'ticket 1234 SIM swap', 300) $$, '22023', 'invalid new login', 'a malformed value in the alias domain is refused');
select throws_ok($$ select public.installer_alias_exception_issue('95000000-0000-4000-8000-0000000000a0', '95000000-0000-4000-8000-0000000000e1', 'other@example.test', 'ticket 1234 SIM swap', 300) $$, '22023', 'not an installer alias change', 'an exception for two ordinary addresses is refused');
select throws_ok($$ select public.installer_alias_exception_issue('95000000-0000-4000-8000-0000000000a0', '95000000-0000-4000-8000-000000000005', 'p201099100005@craftsman-login.aladdin.invalid', 'ticket 1234 SIM swap', 300) $$, '22023', 'invalid new login', 'new = current is refused');
select throws_ok($$ select public.installer_alias_exception_issue('95000000-0000-4000-8000-0000000000a0', '95000000-0000-4000-8000-000000000005', null, 'ticket 1234 SIM swap', 300) $$, '22023', null, 'null arguments are refused');
insert into ids select 'exc1', public.installer_alias_exception_issue('95000000-0000-4000-8000-0000000000a0', '95000000-0000-4000-8000-000000000005', 'p201099300005@craftsman-login.aladdin.invalid', 'ticket 1234: customer lost the SIM, verified by video call', 300)::text;
reset role;
select ok((select v::uuid is not null from ids where k = 'exc1'), 'an administrator operator, through service_role, can issue one exception');
select is((select old_alias || '>' || new_alias from app.installer_alias_exceptions where id = (select v::uuid from ids where k = 'exc1')),
  'p201099100005@craftsman-login.aladdin.invalid>p201099300005@craftsman-login.aladdin.invalid', 'it is bound to the user''s ACTUAL current alias (read, not supplied) and the exact new alias');
select ok((select operator_user_id = '95000000-0000-4000-8000-0000000000a0'::uuid and user_id = pg_temp.u('g5') and expires_at <= created_at + interval '15 minutes' and consumed_at is null and revoked_at is null
             and char_length(reason) > 10 from app.installer_alias_exceptions where id = (select v::uuid from ids where k = 'exc1')), 'operator, user, short expiry and reason are recorded; unconsumed');
select is((select count(*)::int from public.audit_log where action = 'profile.phone_alias_exception_issued' and actor_user_id = pg_temp.u('op') and subject_id = pg_temp.u('g5')), 1,
  'issuing is audited with the OPERATOR as the actor and the user as the subject');
select ok((select metadata::text !~* 'ticket|SIM|craftsman|2010|reason' and (select array_agg(k) from jsonb_object_keys(metadata) k) = array['exception_id'] from public.audit_log where action = 'profile.phone_alias_exception_issued' and subject_id = pg_temp.u('g5')),
  'the audit metadata holds only the exception id: no reason, alias or phone');
set local role service_role;
select throws_ok($$ select public.installer_alias_exception_issue('95000000-0000-4000-8000-0000000000a0', '95000000-0000-4000-8000-000000000005', 'p201099300055@craftsman-login.aladdin.invalid', 'ticket 9999: second request', 300) $$, '55006', null, 'a second OPEN exception for the same user is refused');
reset role;

-- scope: only user + old + new, exactly
select throws_ok(pg_temp.set_email_sql('g5', pg_temp.al('+201099399999')), '42501', null, 'the exception is NOT a wildcard: a different new alias is refused');
select throws_ok(pg_temp.set_email_sql('g5', 'attacker@example.test'), '42501', null, 'nor an arbitrary email');
select throws_ok(pg_temp.set_email_sql('g6', pg_temp.al('+201099300005')), '42501', null, 'nor the same new alias on another user');
select lives_ok(pg_temp.set_email_sql('g5', pg_temp.al('+201099300005')), 'the exact change (user, old, new) is allowed once');
select ok((select consumed_at is not null from app.installer_alias_exceptions where id = (select v::uuid from ids where k = 'exc1')), 'and the exception was consumed by it');
select is((select count(*)::int from public.audit_log where action = 'profile.phone_alias_exception_used' and actor_user_id = pg_temp.u('op') and subject_id = pg_temp.u('g5')), 1, 'use is audited with the operator as actor');
select pg_temp.force_email(pg_temp.u('g5'), 'p201099100005@craftsman-login.aladdin.invalid');   -- put the alias back by an out-of-band write
select throws_ok(pg_temp.set_email_sql('g5', pg_temp.al('+201099300005')), '42501', null, 'SINGLE USE: the identical change a second time is refused');
set local role service_role;
insert into ids select 'exc1b', public.installer_alias_exception_issue('95000000-0000-4000-8000-0000000000a0', '95000000-0000-4000-8000-000000000005', 'p201099300055@craftsman-login.aladdin.invalid', 'ticket 1235: second repair, tests old-alias binding', 300)::text;
reset role;
select pg_temp.force_email(pg_temp.u('g5'), pg_temp.al('+201099177777'));   -- the alias is no longer the one the exception was issued for
select throws_ok(pg_temp.set_email_sql('g5', pg_temp.al('+201099300055')), '42501', null, 'the exception binds the OLD alias too: from a different current alias it authorizes nothing');
select pg_temp.force_email(pg_temp.u('g5'), 'p201099100005@craftsman-login.aladdin.invalid');
select lives_ok(pg_temp.set_email_sql('g5', pg_temp.al('+201099300055')), 'and from the exact alias it was issued for, it is used (once)');
select pg_temp.force_email(pg_temp.u('g5'), 'p201099100005@craftsman-login.aladdin.invalid');
set local role service_role;
select is((select public.installer_alias_exception_revoke('95000000-0000-4000-8000-0000000000a0', (select v::uuid from ids where k = 'exc1'))), false, 'a consumed exception cannot be revoked (nothing to revoke)');
reset role;

-- expiry, revocation, missing state
set local role service_role;
insert into ids select 'exc2', public.installer_alias_exception_issue('95000000-0000-4000-8000-0000000000a0', '95000000-0000-4000-8000-000000000006', 'p201099300006@craftsman-login.aladdin.invalid', 'ticket 2222: number recycled by the carrier', 60)::text;
reset role;
update app.installer_alias_exceptions set created_at = now() - interval '5 minutes', expires_at = now() - interval '1 minute' where id = (select v::uuid from ids where k = 'exc2');
select throws_ok(pg_temp.set_email_sql('g6', pg_temp.al('+201099300006')), '42501', null, 'an EXPIRED exception authorizes nothing');
set local role service_role;
insert into ids select 'exc3', public.installer_alias_exception_issue('95000000-0000-4000-8000-0000000000a0', '95000000-0000-4000-8000-000000000006', 'p201099300066@craftsman-login.aladdin.invalid', 'ticket 3333: replacement after expiry', 300)::text;
select is((select public.installer_alias_exception_revoke('95000000-0000-4000-8000-0000000000a0', (select v::uuid from ids where k = 'exc3'))), true, 'an open exception can be revoked');
select throws_ok($$ select public.installer_alias_exception_revoke('95000000-0000-4000-8000-0000000000a1', gen_random_uuid()) $$, '42501', null, 'only an administrator can revoke');
reset role;
select throws_ok(pg_temp.set_email_sql('g6', pg_temp.al('+201099300066')), '42501', null, 'a REVOKED exception authorizes nothing');
select is((select count(*)::int from public.audit_log where action = 'profile.phone_alias_exception_revoked' and actor_user_id = pg_temp.u('op')), 1, 'revocation is audited with the operator as actor');
alter table app.installer_alias_exceptions rename to installer_alias_exceptions_gone;
select throws_ok(pg_temp.set_email_sql('g6', pg_temp.al('+201099300077')), null, null, 'MISSING exception state: the alias change FAILS CLOSED (an error, not an allowance)');
select lives_ok($$ update auth.users set email = 'p95-email-1c@example.test' where id = '95000000-0000-4000-8000-0000000000e1' $$, '... while ordinary accounts are unaffected by the broken state');
alter table app.installer_alias_exceptions_gone rename to installer_alias_exceptions;

-- no audit forgery
select throws_ok($$ select app.installer_alias_exception_audit(gen_random_uuid(), 'organization.created', gen_random_uuid(), gen_random_uuid()) $$, '22023', 'unsupported audit action',
  'the internal audit writer accepts only the three exception actions');
set local role service_role;
select throws_ok($$ insert into public.audit_log (action, subject_type) values ('profile.phone_alias_exception_used', 'user') $$, '42501', null, 'service_role still cannot write audit rows directly');
reset role;

-- ===========================================================================
-- 4. Vocabulary preserved; registration compatibility
-- ===========================================================================
select ok((select count(*)::int from regexp_matches((select pg_get_constraintdef(oid) from pg_constraint where conname = 'ck_audit_action_known'), '''[^'']+''::text', 'g')) >= 126,
  'ck_audit_action_known still allows the 126 actions of M6 (later migrations only add more)');
select ok((select bool_and(pg_get_constraintdef(c.oid) like '%''' || a || '''::text%') from pg_constraint c,
            unnest(array['organization.created', 'profile.phone_set', 'profile.phone_changed', 'profile.phone_change_compensated', 'profile.phone_change_needs_attention',
                         'profile.password_changed', 'profile.phone_alias_exception_issued', 'profile.phone_alias_exception_used', 'profile.phone_alias_exception_revoked']) a
           where c.conname = 'ck_audit_action_known'), 'earlier and new actions are all allowed');
select lives_ok($$ insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
   values ('95000000-0000-4000-8000-0000000000f1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p201099500001@craftsman-login.aladdin.invalid',
           '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), now()) $$, 'installer registration (an INSERT of an alias account) is not affected');
set local role authenticated;
set local request.jwt.claims = '{"sub":"95000000-0000-4000-8000-0000000000f1","role":"authenticated"}';
select lives_ok($$ select public.profile_set_phone('EG', '1099500001', '+201099500001') $$, 'and the first phone assignment still works');
reset role;
select lives_ok($$ delete from auth.users where id = '95000000-0000-4000-8000-0000000000f1' $$, 'deleting an alias account (sign-up rollback) is not affected');

select * from finish();
rollback;
