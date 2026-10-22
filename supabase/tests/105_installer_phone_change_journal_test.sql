-- pgTAP: M3 - installer phone-change journal (database side of a recoverable phone change).
--
-- The login alias lives in auth.users.email and can only be changed through the Auth Admin API, which
-- pgTAP cannot call. Everywhere below that says "the Admin API landed" SIMULATES that effect with a direct
-- UPDATE of auth.users.email made by the test owner (what GoTrue's own write amounts to). The real GoTrue
-- round trip is proven by the separate live script, not here. This file proves, on the real schema:
--   * journal structure, RLS, and that no API role can touch it or call any new function except service_role;
--   * BEGIN spends the M2 receipt atomically (wrong user / operation / number / expired / replayed refused,
--     and a refused begin burns nothing), refuses ineligible accounts, and collisions are generic;
--   * begin is idempotent, there is one active change per user, and M1's profile_set_phone cannot disturb
--     a pending change;
--   * SETTLE decides from the authoritative auth email: done, compensated, needs_attention, lost response,
--     expired lease, restore conflict, late landing - and every outcome is idempotent;
--   * the new phone stays UNVERIFIED (phone_verified_at NULL) and no API role can set it;
--   * installer sign-up, the M1 guard, the M2 gate and the sign-up rollback are unaffected.
create extension if not exists pgtap;

begin;
select plan(133);

-- ---------------------------------------------------------------------------
-- Fixtures. Alias accounts aN (login alias = +2010666000NN, profile phone = the same number):
--   a1 happy path / service_role   a2 compensate   a3 lost response   a4 unexpected alias
--   a5 inconsistent profile        a6 receipts     a7 collisions      a8 idempotency + one-active
--   a9 lease expiry                a10 profile mismatch   a11 restore conflict   a12 late landing
--   a13 verification status        a14 M1 interplay
--   e1 ordinary email account   e2 holds +201066600077   f1 owns an alias (+201066600088) but no profile phone
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
                        email_confirmed_at, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email,
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), now()
from (values
  ('93000000-0000-4000-8000-000000000001', 'p201066600001@craftsman-login.aladdin.invalid'),
  ('93000000-0000-4000-8000-000000000002', 'p201066600002@craftsman-login.aladdin.invalid'),
  ('93000000-0000-4000-8000-000000000003', 'p201066600003@craftsman-login.aladdin.invalid'),
  ('93000000-0000-4000-8000-000000000004', 'p201066600004@craftsman-login.aladdin.invalid'),
  ('93000000-0000-4000-8000-000000000005', 'p201066600005@craftsman-login.aladdin.invalid'),
  ('93000000-0000-4000-8000-000000000006', 'p201066600006@craftsman-login.aladdin.invalid'),
  ('93000000-0000-4000-8000-000000000007', 'p201066600007@craftsman-login.aladdin.invalid'),
  ('93000000-0000-4000-8000-000000000008', 'p201066600008@craftsman-login.aladdin.invalid'),
  ('93000000-0000-4000-8000-000000000009', 'p201066600009@craftsman-login.aladdin.invalid'),
  ('93000000-0000-4000-8000-000000000010', 'p201066600010@craftsman-login.aladdin.invalid'),
  ('93000000-0000-4000-8000-000000000011', 'p201066600011@craftsman-login.aladdin.invalid'),
  ('93000000-0000-4000-8000-000000000012', 'p201066600012@craftsman-login.aladdin.invalid'),
  ('93000000-0000-4000-8000-000000000013', 'p201066600013@craftsman-login.aladdin.invalid'),
  ('93000000-0000-4000-8000-000000000014', 'p201066600014@craftsman-login.aladdin.invalid'),
  ('93000000-0000-4000-8000-0000000000e1', 'p93-email-1@example.test'),
  ('93000000-0000-4000-8000-0000000000e2', 'p93-email-2@example.test'),
  ('93000000-0000-4000-8000-0000000000e3', 'p201066600055@example.test'),
  ('93000000-0000-4000-8000-0000000000f1', 'p201066600088@craftsman-login.aladdin.invalid')) v(id, email);

-- Profile phone = the phone each alias encodes (what installer sign-up leaves behind); a5 has drifted.
alter table public.profiles disable trigger guard_phone_password_identity;  -- fixture
update public.profiles p
   set phone_country_iso2 = 'EG',
       phone_national     = substr(split_part(u.email, '@', 1), 4),
       phone_e164         = '+' || substr(split_part(u.email, '@', 1), 2)
  from auth.users u
 where u.id = p.user_id and u.email ~ '^p2010666000(0[1-9]|1[0-4])@craftsman-login';
alter table public.profiles enable trigger guard_phone_password_identity;
alter table public.profiles disable trigger guard_phone_password_identity;  -- fixture
update public.profiles set phone_e164 = '+201066600099', phone_national = '1066600099' where user_id = '93000000-0000-4000-8000-000000000005';
alter table public.profiles enable trigger guard_phone_password_identity;
alter table public.profiles disable trigger guard_phone_password_identity;  -- fixture
update public.profiles set phone_country_iso2 = 'EG', phone_national = '1066600077', phone_e164 = '+201066600077' where user_id = '93000000-0000-4000-8000-0000000000e2';
alter table public.profiles enable trigger guard_phone_password_identity;
-- e3: an ordinary account whose address merely LOOKS like an alias and whose profile phone matches it.
alter table public.profiles disable trigger guard_phone_password_identity;  -- fixture
update public.profiles set phone_country_iso2 = 'EG', phone_national = '1066600055', phone_e164 = '+201066600055' where user_id = '93000000-0000-4000-8000-0000000000e3';
alter table public.profiles enable trigger guard_phone_password_identity;

-- Helpers (owner-side code; the real roles are exercised explicitly below).
create function pg_temp.u(k text) returns uuid language sql as $$
  select (case k when 'e1' then '93000000-0000-4000-8000-0000000000e1'
                 when 'e2' then '93000000-0000-4000-8000-0000000000e2'
                 when 'e3' then '93000000-0000-4000-8000-0000000000e3'
                 when 'f1' then '93000000-0000-4000-8000-0000000000f1'
                 when 'b1' then '93000000-0000-4000-8000-0000000000b1'
                 else '93000000-0000-4000-8000-0000000000' || lpad(substr(k, 2), 2, '0') end)::uuid $$;
create function pg_temp.rq(k text, tag text) returns uuid language sql as $$ select md5('93:' || k || ':' || tag)::uuid $$;
create function pg_temp.al(e164 text) returns text language sql as $$ select 'p' || substr(e164, 2) || '@craftsman-login.aladdin.invalid' $$;
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
create function pg_temp.bsql(k text, tag text, rcp uuid, e164 text) returns text language sql as $$
  select format('select * from public.installer_phone_change_begin(%L,%L,%L,%L,%L,%L)', pg_temp.u(k), pg_temp.rq(k, tag), rcp, 'EG', substr(e164, 4), e164) $$;
create function pg_temp.cid(k text) returns uuid language sql as $$
  select c.id from app.installer_phone_changes c where c.user_id = pg_temp.u(k) order by (c.state in ('pending', 'needs_attention')) desc, c.created_at desc limit 1 $$;
create function pg_temp.st(k text) returns text language sql as $$
  select c.state || '/' || coalesce(c.resolution, '-') from app.installer_phone_changes c where c.user_id = pg_temp.u(k) order by (c.state in ('pending', 'needs_attention')) desc, c.created_at desc limit 1 $$;
create function pg_temp.ph(k text) returns text language sql as $$ select phone_e164 from public.profiles where user_id = pg_temp.u(k) $$;
create function pg_temp.settle(k text, fin boolean default false) returns text language sql as $$
  select s.state || '/' || coalesce(s.resolution, '-') from public.installer_phone_change_settle(pg_temp.u(k), pg_temp.cid(k), fin) s $$;
-- Simulates an Auth write that BYPASSES the alias guard (an out-of-band write by an owner). The guard itself is proven in
-- 95_installer_alias_email_guard_test.sql; here the trigger is dropped and re-created around ONE statement (the test
-- transaction is rolled back at the end) so the settlement's reaction to states the guard normally prevents can be tested.
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
create temp table ids (k text primary key, v text);
grant all on ids to public;

-- ===========================================================================
-- 1. Structure, RLS, grants
-- ===========================================================================
select is((select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'app' and c.relname = 'installer_phone_changes' and c.relkind = 'r'), 1,
  'the journal exists in the app schema (not exposed through PostgREST)');
select ok((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'app' and c.relname = 'installer_phone_changes'), 'RLS is enabled on the journal');
select is((select count(*)::int from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'app' and c.relname = 'installer_phone_changes'), 0, 'and no policy exists: deny-all for every API role');
select ok(not exists (
    select 1 from (values ('anon'), ('authenticated'), ('service_role')) r(rolname)
    cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(priv)
    where has_table_privilege(r.rolname, 'app.installer_phone_changes', p.priv)),
  'anon, authenticated and service_role hold NO privilege on the journal');
select is((select count(*)::int from information_schema.columns
            where table_schema = 'app' and table_name = 'installer_phone_changes' and column_name ~* 'pass|token|secret|otp|session|jwt'), 0,
  'no journal column can hold a password, token, secret or session');
select ok((select indexdef from pg_indexes where schemaname = 'app' and indexname = 'uq_installer_phone_changes_active') ~ 'UNIQUE.*user_id.*state.*pending.*needs_attention',
  'one ACTIVE (pending / needs_attention) change per user is enforced by a partial unique index');
select is((select count(*)::int from pg_constraint where conname in ('ck_installer_phone_changes_state', 'ck_installer_phone_changes_resolution', 'uq_installer_phone_changes_request')), 3,
  'state / resolution vocabularies and the per-user request-id uniqueness are constraints');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p
            where p.proname in ('installer_phone_change_begin', 'installer_phone_change_settle', 'installer_phone_change_status', 'installer_phone_change_recoverable')),
  'the four new functions are SECURITY DEFINER with an empty search_path');
select ok(has_function_privilege('service_role', 'public.installer_phone_change_begin(uuid,uuid,uuid,text,text,text)', 'EXECUTE')
      and has_function_privilege('service_role', 'public.installer_phone_change_settle(uuid,uuid,boolean)', 'EXECUTE')
      and has_function_privilege('service_role', 'public.installer_phone_change_status(uuid)', 'EXECUTE')
      and has_function_privilege('service_role', 'public.installer_phone_change_recoverable(integer)', 'EXECUTE'), 'service_role can execute all four');
select ok(not exists (select 1 from (values ('anon'), ('authenticated')) r(rolname) cross join (values
      ('public.installer_phone_change_begin(uuid,uuid,uuid,text,text,text)'), ('public.installer_phone_change_settle(uuid,uuid,boolean)'),
      ('public.installer_phone_change_status(uuid)'), ('public.installer_phone_change_recoverable(integer)')) f(sig)
      where has_function_privilege(r.rolname, f.sig, 'EXECUTE')), 'anon and authenticated can execute none of them');
select ok(not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
   where p.proname in ('installer_phone_change_begin', 'installer_phone_change_settle', 'installer_phone_change_status', 'installer_phone_change_recoverable',
                       'profiles_reset_phone_verification') and a.grantee = 0), 'none is executable by PUBLIC');
select ok(not exists (select 1 from (values ('anon'), ('authenticated'), ('service_role')) r(rolname)
   where has_function_privilege(r.rolname, 'app.profiles_reset_phone_verification()', 'EXECUTE')), 'the verification-reset trigger function is callable by no API role');
select ok(not exists (select 1 from (values ('anon'), ('authenticated'), ('service_role')) r(rolname) cross join (values ('UPDATE'), ('INSERT')) p(priv)
   where has_column_privilege(r.rolname, 'public.profiles', 'phone_verified_at', p.priv)), 'no API role can INSERT or UPDATE profiles.phone_verified_at');
select ok((select count(*) from public.profiles where user_id::text like '93000000-%' and phone_verified_at is not null) = 0,
  'phone_verified_at exists and every fixture profile starts unverified (NULL)');

-- ===========================================================================
-- 2. Unauthorized access
-- ===========================================================================
set local role anon;
select throws_ok(pg_temp.bsql('a1', 'anon', gen_random_uuid(), '+201066700001'), '42501', null, 'anon cannot call begin');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"93000000-0000-4000-8000-000000000001","role":"authenticated"}';
select throws_ok(pg_temp.bsql('a1', 'auth', gen_random_uuid(), '+201066700001'), '42501', null, 'an authenticated user cannot call begin (not even for their own id)');
select throws_ok($$ select * from public.installer_phone_change_settle('93000000-0000-4000-8000-000000000001', gen_random_uuid(), true) $$, '42501', null, 'authenticated cannot call settle');
select throws_ok($$ select * from public.installer_phone_change_status('93000000-0000-4000-8000-000000000001') $$, '42501', null, 'authenticated cannot call status');
select throws_ok($$ select * from public.installer_phone_change_recoverable(10) $$, '42501', null, 'authenticated cannot call recoverable');
select throws_ok($$ select * from app.installer_phone_changes $$, '42501', null, 'authenticated cannot read the journal directly');
select throws_ok($$ update public.profiles set phone_verified_at = now() where user_id = '93000000-0000-4000-8000-000000000001' $$, '42501', null,
  'authenticated cannot mark their phone verified');
reset role;
set local role service_role;
select throws_ok($$ select * from app.installer_phone_changes $$, '42501', null, 'service_role cannot read or write the journal table directly either');
reset role;

-- ===========================================================================
-- 3. BEGIN as service_role: the happy path of the database half
-- ===========================================================================
set local role service_role;
insert into ids select 'a1.begin', row_to_json(b)::text
  from public.installer_phone_change_begin(pg_temp.u('a1'), pg_temp.rq('a1', 'r1'), pg_temp.mint('a1', '+201066700001'), 'EG', '1066700001', '+201066700001') b;
reset role;
select is((select v::json->>'state' from ids where k = 'a1.begin'), 'pending', 'begin (service_role) returns a pending change');
select is((select v::json->>'replayed' from ids where k = 'a1.begin'), 'false', 'and it is not a replay');
select is((select v::json->>'new_alias' from ids where k = 'a1.begin'), 'p201066700001@craftsman-login.aladdin.invalid', 'the new alias is DERIVED by the database from the requested E.164');
select is((select v::json->>'old_alias' from ids where k = 'a1.begin'), 'p201066600001@craftsman-login.aladdin.invalid', 'the old alias is the account''s actual current auth email');
select is((select phone_e164 || '/' || phone_national || '/' || phone_country_iso2 from public.profiles where user_id = pg_temp.u('a1')), '+201066700001/1066700001/EG',
  'the profile phone moved to the new number (E.164, national and country together)');
select is((select email from auth.users where id = pg_temp.u('a1')), 'p201066600001@craftsman-login.aladdin.invalid', 'begin never touches auth.users.email');
select is((select count(*)::int from app.installer_phone_changes where user_id = pg_temp.u('a1') and state = 'pending' and lease_expires_at > now()), 1, 'exactly one pending journal row with an open lease');
select ok((select used_at is not null from app.reauth_receipts where user_id = pg_temp.u('a1') and operation = 'primary_phone.change'), 'the receipt was spent by the begin');
select ok((select phone_verified_at is null from public.profiles where user_id = pg_temp.u('a1')), 'the new phone is UNVERIFIED after begin');

-- ===========================================================================
-- 4. Receipt refusals (user a6; every refusal rolls back, so nothing is burned)
-- ===========================================================================
insert into ids values ('a6.other_user_receipt', pg_temp.mint('a2', '+201066700006')::text);
select throws_ok(pg_temp.bsql('a6', 'x1', (select v::uuid from ids where k = 'a6.other_user_receipt'), '+201066700006'), '42501', 'verification required',
  'another user''s receipt is refused');
select is((select used_at from app.reauth_receipts where id = (select v::uuid from ids where k = 'a6.other_user_receipt')), null::timestamptz,
  'and the refused begin did not burn that receipt');
select throws_ok(pg_temp.bsql('a6', 'x2', pg_temp.mint('a6', null, 'change_password'), '+201066700006'), '42501', 'verification required',
  'a change_password receipt cannot authorize a phone change (wrong operation)');
select throws_ok(pg_temp.bsql('a6', 'x3', pg_temp.mint('a6', '+201066700099'), '+201066700006'), '42501', 'verification required',
  'a receipt minted for a different number is refused (different phone)');
insert into ids values ('a6.expired', pg_temp.mint('a6', '+201066700006')::text);
update app.reauth_receipts set created_at = now() - interval '2 minutes', expires_at = now() - interval '1 minute' where id = (select v::uuid from ids where k = 'a6.expired');
select throws_ok(pg_temp.bsql('a6', 'x4', (select v::uuid from ids where k = 'a6.expired'), '+201066700006'), '42501', 'verification required', 'an expired receipt is refused');
select throws_ok(pg_temp.bsql('a6', 'x5', gen_random_uuid(), '+201066700006'), '42501', 'verification required', 'an unknown receipt is refused');
select throws_ok(format('select * from public.installer_phone_change_begin(%L,%L,null,%L,%L,%L)', pg_temp.u('a6'), pg_temp.rq('a6', 'x6'), 'EG', '1066700006', '+201066700006'),
  '22023', null, 'a missing receipt is refused as an invalid request');
select is((select pg_temp.ph('a6') || '/' || (select count(*) from app.installer_phone_changes where user_id = pg_temp.u('a6'))), '+201066600006/0',
  'after all those refusals the a6 profile is untouched and no journal row exists');
insert into ids values ('a6.good', pg_temp.mint('a6', '+201066700006')::text);
select lives_ok(pg_temp.bsql('a6', 'ok', (select v::uuid from ids where k = 'a6.good'), '+201066700006'), 'the correct receipt (user, operation, exact number, unexpired) is accepted');
select throws_ok(pg_temp.bsql('a6', 'again', (select v::uuid from ids where k = 'a6.good'), '+201066700006'), '42501', 'verification required',
  'replaying the SAME receipt is refused (single use), before anything else is revealed');

-- ===========================================================================
-- 5. Eligibility (valid receipts; each refusal rolls the spend back)
-- ===========================================================================
insert into ids values ('e1.r', pg_temp.mint('e1', '+201066700101')::text);
select throws_ok(pg_temp.bsql('e1', 'e', (select v::uuid from ids where k = 'e1.r'), '+201066700101'), '55000', 'account is not eligible for a phone change',
  'an ordinary (non-alias) account is refused');
select is((select used_at from app.reauth_receipts where id = (select v::uuid from ids where k = 'e1.r')), null::timestamptz, 'and its receipt is still unspent');
select throws_ok(pg_temp.bsql('e3', 'look', pg_temp.mint('e3', '+201066700155'), '+201066700155'), '55000', 'account is not eligible for a phone change',
  'an ordinary account whose address merely looks like an alias (wrong domain) is refused even when its profile phone matches');
select throws_ok(pg_temp.bsql('a5', 'e', pg_temp.mint('a5', '+201066700105'), '+201066700105'), '55000', 'account is not eligible for a phone change',
  'an alias account whose profile disagrees with its alias is refused (fail closed)');
select throws_ok(pg_temp.bsql('a7', 'same', pg_temp.mint('a7', '+201066600007'), '+201066600007'), '22023', 'the new phone number is the current one', 'changing to the current number is refused');
select throws_ok(format('select * from public.installer_phone_change_begin(%L,%L,%L,%L,%L,%L)', pg_temp.u('a7'), pg_temp.rq('a7', 'bad'), gen_random_uuid(), 'EG', '1066700007', '+0123'),
  '22023', 'phone number is not in a valid format', 'a malformed E.164 is refused');
select throws_ok(format('select * from public.installer_phone_change_begin(%L,%L,%L,%L,%L,%L)', pg_temp.u('a7'), pg_temp.rq('a7', 'bad2'), gen_random_uuid(), 'EG', '10 667', '+201066700007'),
  '22023', 'phone number is not in a valid format', 'a non-numeric national number is refused');
select throws_ok(format('select * from public.installer_phone_change_begin(%L,%L,%L,%L,%L,%L)', gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'EG', '1066700107', '+201066700107'),
  '55000', 'account is not eligible for a phone change', 'an unknown user id is refused');

-- ===========================================================================
-- 6. Collisions are GENERIC and burn nothing (user a7)
-- ===========================================================================
insert into ids values ('a7.c1', pg_temp.mint('a7', '+201066600077')::text), ('a7.c2', pg_temp.mint('a7', '+201066600088')::text);
select throws_ok(pg_temp.bsql('a7', 'c1', (select v::uuid from ids where k = 'a7.c1'), '+201066600077'), '23505', 'phone number is unavailable',
  'a number held by ANOTHER profile is refused with the generic message');
select throws_ok(pg_temp.bsql('a7', 'c2', (select v::uuid from ids where k = 'a7.c2'), '+201066600088'), '23505', 'phone number is unavailable',
  'a number whose login alias another account already owns is refused with the SAME generic message');
select is((select pg_temp.ph('a7') || '/' || (select count(*) from app.installer_phone_changes where user_id = pg_temp.u('a7'))
            || '/' || (select count(*) from app.reauth_receipts where user_id = pg_temp.u('a7') and used_at is not null)), '+201066600007/0/0',
  'after the collisions a7 is untouched: same phone, no journal row, no receipt spent');

-- ===========================================================================
-- 7. Idempotent begin and ONE active change per user (user a8)
-- ===========================================================================
insert into ids select 'a8.first', row_to_json(b)::text
  from public.installer_phone_change_begin(pg_temp.u('a8'), pg_temp.rq('a8', 'r'), pg_temp.mint('a8', '+201066700008'), 'EG', '1066700008', '+201066700008') b;
insert into ids select 'a8.replay', row_to_json(b)::text
  from public.installer_phone_change_begin(pg_temp.u('a8'), pg_temp.rq('a8', 'r'), gen_random_uuid(), 'EG', '1066700008', '+201066700008') b;
select is((select v::json->>'replayed' from ids where k = 'a8.replay'), 'true', 'the same request id is a replay (and needs no new receipt)');
select is((select v::json->>'change_id' from ids where k = 'a8.replay'), (select v::json->>'change_id' from ids where k = 'a8.first'), 'a replay returns the SAME change');
select is((select count(*)::int from app.installer_phone_changes where user_id = pg_temp.u('a8')), 1, 'a replay creates no second journal row');
select throws_ok(format('select * from public.installer_phone_change_begin(%L,%L,%L,%L,%L,%L)', pg_temp.u('a8'), pg_temp.rq('a8', 'r'), gen_random_uuid(), 'EG', '1066700999', '+201066700999'),
  '22023', 'request id was already used for a different change', 'the same request id for a DIFFERENT number is refused');
select is((select count(*)::int from app.reauth_receipts where user_id = pg_temp.u('a8') and used_at is not null), 1, 'only one receipt was spent for the whole idempotent exchange');
insert into ids values ('a8.second', pg_temp.mint('a8', '+201066700108')::text);
select throws_ok(pg_temp.bsql('a8', 'second', (select v::uuid from ids where k = 'a8.second'), '+201066700108'), '55006', 'a phone number change is in progress',
  'a second change while one is active is refused');
select is((select used_at from app.reauth_receipts where id = (select v::uuid from ids where k = 'a8.second')), null::timestamptz, 'and the refused begin did not spend its receipt');
select throws_ok(format($f$ insert into app.installer_phone_changes (user_id, request_id, old_e164, old_alias, new_e164, new_country_iso2, new_national, new_alias, receipt_id, lease_expires_at)
   values (%L, gen_random_uuid(), '+201066600008', 'p201066600008@craftsman-login.aladdin.invalid', '+201066700208', 'EG', '1066700208', 'p201066700208@craftsman-login.aladdin.invalid', gen_random_uuid(), now()) $f$, pg_temp.u('a8')),
  '23505', null, 'the partial unique index independently refuses a second active row');
select is((select count(*)::int from public.installer_phone_change_status(pg_temp.u('a8'))), 1, 'status shows the active change');
select is((select count(*)::int from public.installer_phone_change_status(pg_temp.u('a7'))), 0, 'status is empty for a user with no active change');
select is((select count(*)::int from public.installer_phone_change_recoverable(200) where user_id = pg_temp.u('a8')), 0, 'a change with an open lease is not offered for recovery');

-- ===========================================================================
-- 8. M1 interplay: profile_set_phone cannot disturb a pending change (user a14)
-- ===========================================================================
select lives_ok(pg_temp.bsql('a14', 'r', pg_temp.mint('a14', '+201066700014'), '+201066700014'), 'a14: begin');
set local role authenticated;
set local request.jwt.claims = '{"sub":"93000000-0000-4000-8000-000000000014","role":"authenticated"}';
select throws_ok($$ select public.profile_set_phone('EG', '1066600014', '+201066600014') $$, '55006', 'a phone number change is in progress',
  'the user cannot write the OLD number back mid-change (the M1 heal branch is closed)');
select throws_ok($$ select public.profile_set_phone('EG', '1066700014', '+201066700014') $$, '55006', 'a phone number change is in progress',
  'nor re-save the new number');
reset role;
select is(pg_temp.ph('a14'), '+201066700014', 'the profile still holds the journal''s new number');
update auth.users set email = pg_temp.al('+201066700014') where id = pg_temp.u('a14');   -- the Admin API landed
select is(pg_temp.settle('a14'), 'done/applied', 'a14: settle observes the new alias and finishes');
set local role authenticated;
set local request.jwt.claims = '{"sub":"93000000-0000-4000-8000-000000000014","role":"authenticated"}';
select lives_ok($$ select public.profile_set_phone('EG', '1066700014', '+201066700014') $$, 'once the change is done, M1''s same-number save works again (alias = new number)');
select throws_ok($$ select public.profile_set_phone('EG', '1066600014', '+201066600014') $$, '42501', null, 'and the OLD number is now a different number for this alias (M1 guard)');
reset role;

-- ===========================================================================
-- 9. SETTLE
-- ===========================================================================
-- a1: lease still open, alias unchanged, caller has not finished -> do not compensate a change that may still land.
-- Guard NOT in force (trigger absent): the conservative M3 rule applies.
select pg_temp.guard_off();
select is(pg_temp.settle('a1'), 'pending/-', 'a1: guard not in force, alias still old, lease open, attempt not finished: stays pending (nothing is guessed)');
select pg_temp.guard_on();
select is(pg_temp.ph('a1'), '+201066700001', 'a1: and the profile is untouched by that early settle');
update auth.users set email = pg_temp.al('+201066700001') where id = pg_temp.u('a1');   -- the Admin API landed; the response was "lost"
select is(pg_temp.settle('a1'), 'done/applied', 'CASE A/E a1: the alias is the new one: done (a lost response is not compensated)');
select is(pg_temp.settle('a1'), 'done/applied', 'a1: settle is idempotent');
select is((select count(*)::int from public.installer_phone_change_status(pg_temp.u('a1'))), 0, 'a1: a finished change is no longer reported as active');
select is((select count(*)::int from auth.users where id = pg_temp.u('a1') and email = pg_temp.al('+201066700001')), 1, 'a1: same auth user, now keyed by the new alias');
select ok((select phone_verified_at is null from public.profiles where user_id = pg_temp.u('a1')), 'a1: the changed phone is still UNVERIFIED after done');
select ok((select settled_at is not null from app.installer_phone_changes where id = pg_temp.cid('a1')), 'a1: the journal row carries settled_at');

-- a2: CASE B - the Auth step failed definitively.
select lives_ok(pg_temp.bsql('a2', 'r', pg_temp.mint('a2', '+201066700002'), '+201066700002'), 'a2: begin');
select is(pg_temp.settle('a2', true), 'compensated/restored', 'CASE B a2: alias still old and the call has returned: the profile is restored');
select is(pg_temp.ph('a2') || '/' || (select phone_national from public.profiles where user_id = pg_temp.u('a2')), '+201066600002/1066600002', 'a2: old phone and national number are back');
select is((select email from auth.users where id = pg_temp.u('a2')), 'p201066600002@craftsman-login.aladdin.invalid', 'a2: the original login is preserved');
select is(pg_temp.settle('a2', true), 'compensated/restored', 'a2: compensation is idempotent');
select lives_ok(pg_temp.bsql('a2', 'again', pg_temp.mint('a2', '+201066700002'), '+201066700002'), 'a2: after compensation the user can begin again (the active slot is free)');
update auth.users set email = pg_temp.al('+201066700002') where id = pg_temp.u('a2');
select is(pg_temp.settle('a2'), 'done/applied', 'a2: and the second attempt completes');

-- a3: CASE D/E - the caller says its call returned, but the alias IS the new one: believe the database.
select lives_ok(pg_temp.bsql('a3', 'r', pg_temp.mint('a3', '+201066700003'), '+201066700003'), 'a3: begin');
update auth.users set email = pg_temp.al('+201066700003') where id = pg_temp.u('a3');
select is(pg_temp.settle('a3', true), 'done/applied', 'CASE E a3: attempt_finished=true does not make the database compensate a change that did land');

-- a4: CASE C - neither expected alias.
select lives_ok(pg_temp.bsql('a4', 'r', pg_temp.mint('a4', '+201066700004'), '+201066700004'), 'a4: begin');
select pg_temp.force_email(pg_temp.u('a4'), 'someone-else@example.test');
select is(pg_temp.settle('a4', true), 'needs_attention/alias_unexpected', 'CASE C a4: an alias that is neither old nor new fails closed');
select is((select email from auth.users where id = pg_temp.u('a4')) || '/' || pg_temp.ph('a4'), 'someone-else@example.test/+201066700004', 'a4: neither the identity nor the profile was overwritten');
select throws_ok(pg_temp.bsql('a4', 'x', pg_temp.mint('a4', '+201066700204'), '+201066700204'), '55006', null, 'a4: needs_attention keeps the active slot (no new change)');
set local role authenticated;
set local request.jwt.claims = '{"sub":"93000000-0000-4000-8000-000000000004","role":"authenticated"}';
select throws_ok($$ select public.profile_set_phone('EG', '1066700004', '+201066700004') $$, '55006', null, 'a4: and profile_set_phone stays refused');
reset role;
select is(pg_temp.settle('a4', true), 'needs_attention/alias_unexpected', 'a4: settling again is idempotent');
select pg_temp.force_email(pg_temp.u('a4'), pg_temp.al('+201066700004'));
select is(pg_temp.settle('a4'), 'done/applied', 'a4: once the identity is consistent again, re-settling resolves it (re-observation, not a guess)');

-- a10: alias new but the profile no longer matches.
select lives_ok(pg_temp.bsql('a10', 'r', pg_temp.mint('a10', '+201066700010'), '+201066700010'), 'a10: begin');
update auth.users set email = pg_temp.al('+201066700010') where id = pg_temp.u('a10');
alter table public.profiles disable trigger guard_phone_password_identity;  -- fixture
update public.profiles set phone_e164 = '+201066700999', phone_national = '1066700999' where user_id = pg_temp.u('a10');
alter table public.profiles enable trigger guard_phone_password_identity;
select is(pg_temp.settle('a10'), 'needs_attention/profile_mismatch', 'a10: alias is new but the profile drifted: needs_attention');
select is(pg_temp.ph('a10'), '+201066700999', 'a10: the drifted profile is NOT overwritten');

-- a11: the old number was taken while the change was pending.
select lives_ok(pg_temp.bsql('a11', 'r', pg_temp.mint('a11', '+201066700011'), '+201066700011'), 'a11: begin');
alter table public.profiles disable trigger guard_phone_password_identity;  -- fixture
update public.profiles set phone_country_iso2 = 'EG', phone_national = '1066600011', phone_e164 = '+201066600011' where user_id = pg_temp.u('e1');
alter table public.profiles enable trigger guard_phone_password_identity;
select is(pg_temp.settle('a11', true), 'needs_attention/restore_conflict', 'a11: the old number now belongs to someone else: the restore is not forced');
select is(pg_temp.ph('a11'), '+201066700011', 'a11: the profile stays on the journal number');

-- a12: compensated, then the abandoned Admin API call lands late.
select lives_ok(pg_temp.bsql('a12', 'r', pg_temp.mint('a12', '+201066700012'), '+201066700012'), 'a12: begin');
select is(pg_temp.settle('a12', true), 'compensated/restored', 'a12: compensated');
select pg_temp.force_email(pg_temp.u('a12'), pg_temp.al('+201066700012'));
select is(pg_temp.settle('a12'), 'needs_attention/late_auth_change', 'a12: a late Admin API write after compensation is detected and fails closed');
select is(pg_temp.ph('a12'), '+201066600012', 'a12: and the restored profile is not flipped back automatically');

-- a9: lease expiry makes an abandoned pending change recoverable.
select lives_ok(pg_temp.bsql('a9', 'r', pg_temp.mint('a9', '+201066700009'), '+201066700009'), 'a9: begin');
select is((select count(*)::int from public.installer_phone_change_recoverable(200) where user_id = pg_temp.u('a9')), 0, 'a9: not recoverable while the lease is open');
update app.installer_phone_changes set lease_expires_at = now() - interval '1 second' where id = pg_temp.cid('a9');
select is((select count(*)::int from public.installer_phone_change_recoverable(200) where user_id = pg_temp.u('a9')), 1, 'a9: recoverable once the lease expired (the server that began it is presumed gone)');
select is(pg_temp.settle('a9', false), 'compensated/restored', 'CASE D a9: a sweeper settles the abandoned change by observation and restores the profile');
select is((select count(*)::int from public.installer_phone_change_recoverable(200) where user_id = pg_temp.u('a9')), 0, 'a9: and it is no longer listed');

-- Unknown / foreign / malformed settles.
select throws_ok(format('select * from public.installer_phone_change_settle(%L,%L,true)', pg_temp.u('a1'), gen_random_uuid()), 'P0002', 'unknown phone change', 'settling an unknown change is refused');
select throws_ok(format('select * from public.installer_phone_change_settle(%L,%L,true)', pg_temp.u('a2'), pg_temp.cid('a1')), 'P0002', 'unknown phone change', 'settling ANOTHER user''s change is refused');
select throws_ok(format('select * from public.installer_phone_change_settle(null,%L,true)', pg_temp.cid('a1')), '22023', null, 'a null user is an invalid request');

-- ===========================================================================
-- 10. Verification status (user a13)
-- ===========================================================================
update public.profiles set phone_verified_at = timestamptz '2026-01-01 00:00:00+00' where user_id = pg_temp.u('a13');
select lives_ok(pg_temp.bsql('a13', 'r', pg_temp.mint('a13', '+201066700013'), '+201066700013'), 'a13: begin from a (hypothetically) verified phone');
select ok((select phone_verified_at is null from public.profiles where user_id = pg_temp.u('a13')), 'a13: the NEW number is not verified (no verification carried across numbers)');
select is(pg_temp.settle('a13', true), 'compensated/restored', 'a13: compensate');
select is((select phone_verified_at from public.profiles where user_id = pg_temp.u('a13')), timestamptz '2026-01-01 00:00:00+00', 'a13: restoring the OLD number restores its own verification');
select lives_ok(pg_temp.bsql('a13', 'r2', pg_temp.mint('a13', '+201066700013'), '+201066700013'), 'a13: begin again');
update auth.users set email = pg_temp.al('+201066700013') where id = pg_temp.u('a13');
select is(pg_temp.settle('a13'), 'done/applied', 'a13: done');
select ok((select phone_verified_at is null from public.profiles where user_id = pg_temp.u('a13')), 'a13: a password-only phone change leaves phone_verified_at NULL; no timestamp is fabricated');
update public.profiles set phone_verified_at = now() where user_id = pg_temp.u('a13');
alter table public.profiles disable trigger guard_phone_password_identity;  -- fixture
update public.profiles set phone_e164 = '+201066700313', phone_national = '1066700313' where user_id = pg_temp.u('a13');
alter table public.profiles enable trigger guard_phone_password_identity;
select ok((select phone_verified_at is null from public.profiles where user_id = pg_temp.u('a13')), 'trigger: any other writer that changes the number also clears the verification');
alter table public.profiles disable trigger guard_phone_password_identity;  -- fixture
update public.profiles set phone_e164 = '+201066700413', phone_national = '1066700413', phone_verified_at = timestamptz '2026-02-02 00:00:00+00' where user_id = pg_temp.u('a13');
alter table public.profiles enable trigger guard_phone_password_identity;
select is((select phone_verified_at from public.profiles where user_id = pg_temp.u('a13')), timestamptz '2026-02-02 00:00:00+00', 'trigger: a statement that sets the verification together with the number keeps it (the future OTP path)');

-- ===========================================================================
-- 11. Compatibility with registration, M1, M2 and the sign-up rollback
-- ===========================================================================
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
values ('93000000-0000-4000-8000-0000000000c1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'p201066800001@craftsman-login.aladdin.invalid', '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), now());
set local role authenticated;
set local request.jwt.claims = '{"sub":"93000000-0000-4000-8000-0000000000c1","role":"authenticated"}';
select lives_ok($$ select public.profile_set_phone('EG', '1066800001', '+201066800001') $$, 'installer sign-up: the first assignment of the alias number still works');
select throws_ok($$ select public.profile_set_phone('EG', '1066800009', '+201066800009') $$, '42501', null, 'M1: a different number is still refused outside a journaled change');
reset role;
select is((select count(*)::int from app.installer_phone_changes where user_id = '93000000-0000-4000-8000-0000000000c1'), 0, 'sign-up never creates a journal row');
set local role authenticated;
set local request.jwt.claims = '{"sub":"93000000-0000-4000-8000-0000000000e2","role":"authenticated"}';
select lives_ok($$ select public.profile_set_phone('EG', '1066800002', '+201066800002') $$, 'an ordinary email account still edits its phone exactly as before');
reset role;
select ok(has_function_privilege('authenticated', 'public.profile_set_phone(text,text,text)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.profile_set_phone(text,text,text)', 'EXECUTE'), 'profile_set_phone keeps its grants (authenticated only)');
select ok((select prosrc from pg_proc where oid = 'public.profile_set_phone(text,text,text)'::regprocedure) ~ 'sign-in phone alias is malformed'
      and (select prosrc from pg_proc where oid = 'public.profile_set_phone(text,text,text)'::regprocedure) ~ 'phone number change is in progress', 'profile_set_phone keeps the M1 guard and adds the pending-change refusal');
select ok(to_regprocedure('public.identity_gate_reserve(uuid,text)') is null and to_regclass('app.sensitive_action_receipts') is null,
  'the rehearsal''s competing M2 gate is not installed (PR #88 reauth receipts are the only password proof)');
select is((select app.consume_reauth_receipt_for(pg_temp.u('a1'), (select id from app.reauth_receipts where user_id = pg_temp.u('a1') and operation = 'primary_phone.change'), 'primary_phone.change', '+201066700001')),
  false, 'a receipt already spent by begin cannot be spent again');

-- Sign-up rollback / account deletion with a PENDING change and gate state.
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
values ('93000000-0000-4000-8000-0000000000b1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'p201066900001@craftsman-login.aladdin.invalid', '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(), now());
alter table public.profiles disable trigger guard_phone_password_identity;  -- fixture
update public.profiles set phone_country_iso2 = 'EG', phone_national = '1066900001', phone_e164 = '+201066900001' where user_id = '93000000-0000-4000-8000-0000000000b1';
alter table public.profiles enable trigger guard_phone_password_identity;
insert into ids values ('b1.r', pg_temp.mint('b1', '+201066900002')::text);
select lives_ok(format('select * from public.installer_phone_change_begin(%L,%L,%L,%L,%L,%L)', '93000000-0000-4000-8000-0000000000b1', gen_random_uuid(), (select v::uuid from ids where k = 'b1.r'), 'EG', '1066900002', '+201066900002'),
  'b1: a pending change exists');
select lives_ok($$ delete from auth.users where id = '93000000-0000-4000-8000-0000000000b1' $$, 'deleting the account (the sign-up rollback path) works with a pending journal row');
select is((select count(*)::int from app.installer_phone_changes where user_id = '93000000-0000-4000-8000-0000000000b1')
        + (select count(*)::int from app.reauth_receipts where user_id = '93000000-0000-4000-8000-0000000000b1'), 0, 'and the user''s journal and gate rows are removed with it');
select ok((select count(*) from app.installer_phone_changes where user_id = pg_temp.u('a1')) = 1, 'other users'' journal rows are untouched');

select * from finish();
rollback;
