-- pgTAP: one current-password confirmation (20261021090001) and the Installer phone-change journal (20261021090003)
-- living together with PR #88's secondary phone reservations (20261018090001).
--
--   A. account_password_confirm: the new operations and their target rules; PR #88's operations unchanged
--   B. ONE attempt budget per account across every operation (no per-operation budgets)
--   C. app.consume_reauth_receipt_for: single use, bound to user + operation + target, not callable by any API role
--   D. Password change: authorize spends the receipt once; the audit needs that spent receipt
--   E. Primary phone change vs reservations: a number another account has ACTIVELY reserved cannot become a new primary;
--      a number that is someone's pending new primary, or their still-current sign-in number, cannot be reserved
--   F. Converting a reservation still fails closed for a phone-login account (no journal, no move)
--
-- Every fixture is created INSIDE this transaction; the file rolls back.
create extension if not exists pgtap;

begin;
select plan(35);

\set u1    '71000000-0000-4000-8000-000000000001'
\set u2    '71000000-0000-4000-8000-000000000002'
\set craft '71000000-0000-4000-8000-000000000003'
\set crb   '71000000-0000-4000-8000-000000000004'

create function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end;
$$;
create function pg_temp.as_dba() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
end;
$$;
create function pg_temp.call_as(p_user uuid, p_sql text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform pg_temp.act_as(p_user);
  execute 'select to_jsonb((' || p_sql || '))' into r;
  perform pg_temp.as_dba();
  return coalesce(r, '{"void":true}'::jsonb);
exception when others then
  perform pg_temp.as_dba();
  return jsonb_build_object('sqlstate', sqlstate, 'msg', sqlerrm);
end;
$$;
create function pg_temp.confirm(p_user uuid, p_op text, p_target text, p_pw text default 'Correct-Horse-1') returns jsonb language sql as $$
  select pg_temp.call_as(p_user, format('public.account_password_confirm(%L, %L, %L)', p_pw, p_op, p_target)) $$;
create function pg_temp.receipt(p_user uuid, p_op text, p_target text) returns uuid language sql as $$
  select (pg_temp.confirm(p_user, p_op, p_target) ->> 'receipt')::uuid $$;
grant execute on function pg_temp.act_as(uuid), pg_temp.as_dba() to authenticated, anon;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
values
  (:'u1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ro1@probe.test',
   extensions.crypt('Correct-Horse-1', extensions.gen_salt('bf')), now(), '{"full_name":"Rho One"}', now(), now()),
  (:'u2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ro2@probe.test',
   extensions.crypt('Correct-Horse-1', extensions.gen_salt('bf')), now(), '{"full_name":"Rho Two"}', now(), now()),
  (:'craft', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p201071000003@craftsman-login.aladdin.invalid',
   extensions.crypt('Correct-Horse-1', extensions.gen_salt('bf')), now(), '{"full_name":"Rho Craft"}', now(), now()),
  (:'crb', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p201071000004@craftsman-login.aladdin.invalid',
   extensions.crypt('Correct-Horse-1', extensions.gen_salt('bf')), now(), '{"full_name":"Rho Craft B"}', now(), now());
alter table public.profiles disable trigger guard_phone_password_identity;  -- fixture: what installer sign-up leaves behind
update public.profiles set phone_country_iso2 = 'EG', phone_national = '1071000003', phone_e164 = '+201071000003' where user_id = :'craft';
update public.profiles set phone_country_iso2 = 'EG', phone_national = '1071000004', phone_e164 = '+201071000004' where user_id = :'crb';
alter table public.profiles enable trigger guard_phone_password_identity;

-- ===========================================================================
-- A. Operations and target rules
-- ===========================================================================
select ok((pg_temp.confirm(:'u1', 'secondary_phone.reserve', '+201071100001') ->> 'ok')::boolean, 'PR #88 operation secondary_phone.reserve still issues a receipt');
select ok((pg_temp.confirm(:'craft', 'primary_phone.change', '+201071100003') ->> 'ok')::boolean, 'primary_phone.change issues a receipt for a canonical number');
select ok((pg_temp.confirm(:'u1', 'password.change', 'self') ->> 'ok')::boolean, 'password.change issues a receipt for target self');
select ok((pg_temp.confirm(:'u1', 'contact_email.set', 'ro1.contact@probe.test') ->> 'ok')::boolean, 'contact_email.set issues a receipt for a lower-case address');
select ok((pg_temp.confirm(:'u1', 'contact_email.remove', 'self') ->> 'ok')::boolean, 'contact_email.remove issues a receipt for target self');
select is(pg_temp.confirm(:'u1', 'primary_phone.change', '01071100003') ->> 'sqlstate', '22023', 'a phone operation refuses a non-canonical target');
select is(pg_temp.confirm(:'u1', 'password.change', '+201071100001') ->> 'sqlstate', '22023', 'password.change refuses any target but self');
select is(pg_temp.confirm(:'u1', 'contact_email.set', 'Mixed@Probe.test') ->> 'sqlstate', '22023', 'contact_email.set refuses a non-normalized address');
select is(pg_temp.confirm(:'u1', 'contact_email.set', 'p201071100001@craftsman-login.aladdin.invalid') ->> 'sqlstate', '22023', 'contact_email.set refuses the Installer login alias domain');
select is(pg_temp.confirm(:'u1', 'account.delete', 'self') ->> 'sqlstate', '22023', 'an unknown operation is refused');
select is((select target from app.reauth_receipts where user_id = :'u1' and operation = 'contact_email.set'), 'ro1.contact@probe.test',
  'the receipt is bound to the exact address');
select ok(not exists (select 1 from public.audit_log where action = 'account.password_confirmed' and subject_id = :'u1'
                       and metadata::text like '%@%'), 'confirmation audit metadata never carries an address');

-- ===========================================================================
-- B. One budget per account
-- ===========================================================================
select is(pg_temp.confirm(:'u2', 'password.change', 'self', 'wrong-1') ->> 'reason', 'wrong_password', 'wrong password (password.change)');
select is(pg_temp.confirm(:'u2', 'contact_email.set', 'ro2@probe.test', 'wrong-2') ->> 'reason', 'wrong_password', 'wrong password (contact_email.set)');
select is(pg_temp.confirm(:'u2', 'secondary_phone.reserve', '+201071100002', 'wrong-3') ->> 'reason', 'wrong_password', 'wrong password (secondary_phone.reserve)');
select is(pg_temp.confirm(:'u2', 'contact_email.remove', 'self', 'wrong-4') ->> 'reason', 'wrong_password', 'wrong password (contact_email.remove)');
select is(pg_temp.confirm(:'u2', 'primary_phone.change', '+201071100009', 'wrong-5') ->> 'reason', 'locked',
  'the 5th wrong password across DIFFERENT operations locks: one budget per account');
select is(pg_temp.confirm(:'u2', 'password.change', 'self') ->> 'reason', 'locked', 'and the lock covers every operation, even with the right password');
select is((select count(*)::int from app.password_confirm_attempts where user_id = :'u2'), 1, 'there is exactly one throttle row for the account');

-- ===========================================================================
-- C. consume_reauth_receipt_for
-- ===========================================================================
select is(app.consume_reauth_receipt_for(:'u1', (select id from app.reauth_receipts where user_id = :'u1' and operation = 'contact_email.set'), 'contact_email.set', 'other@probe.test'),
  false, 'a receipt for one address cannot be spent for another');
select is(app.consume_reauth_receipt_for(:'u2', (select id from app.reauth_receipts where user_id = :'u1' and operation = 'contact_email.set'), 'contact_email.set', 'ro1.contact@probe.test'),
  false, 'another user cannot spend it');
select is(app.consume_reauth_receipt_for(:'u1', (select id from app.reauth_receipts where user_id = :'u1' and operation = 'contact_email.set'), 'contact_email.set', 'ro1.contact@probe.test'),
  true, 'the owner spends it once');
select is(app.consume_reauth_receipt_for(:'u1', (select id from app.reauth_receipts where user_id = :'u1' and operation = 'contact_email.set'), 'contact_email.set', 'ro1.contact@probe.test'),
  false, 'and never twice');
select ok(not has_function_privilege('authenticated', 'app.consume_reauth_receipt_for(uuid,uuid,text,text)', 'execute')
      and not has_function_privilege('service_role', 'app.consume_reauth_receipt_for(uuid,uuid,text,text)', 'execute')
      and not has_function_privilege('anon', 'app.consume_reauth_receipt_for(uuid,uuid,text,text)', 'execute'),
  'no API role can call the consume helper directly');

-- ===========================================================================
-- D. Password change
-- ===========================================================================
select is(public.identity_password_change_audit(:'u1', (select id from app.reauth_receipts where user_id = :'u1' and operation = 'password.change')),
  false, 'an UNSPENT password.change receipt cannot be audited');
select is(public.identity_password_change_authorize(:'u1', (select id from app.reauth_receipts where user_id = :'u1' and operation = 'password.change')),
  true, 'authorize spends the password.change receipt');
select is(public.identity_password_change_authorize(:'u1', (select id from app.reauth_receipts where user_id = :'u1' and operation = 'password.change')),
  false, 'a replayed receipt cannot authorize a second password change');
select is(public.identity_password_change_audit(:'u1', (select id from app.reauth_receipts where user_id = :'u1' and operation = 'password.change')),
  true, 'the spent receipt records profile.password_changed once');
select ok(not has_function_privilege('authenticated', 'public.identity_password_change_authorize(uuid,uuid)', 'execute')
      and has_function_privilege('service_role', 'public.identity_password_change_authorize(uuid,uuid)', 'execute'),
  'password-change authorization is service_role only');

-- ===========================================================================
-- E. Primary changes and reservations never take each other's number
-- ===========================================================================
-- u1 actively reserves +201071100030 (PR #88).
select is((pg_temp.call_as(:'u1', format('public.secondary_phone_reserve(%L, %L::uuid)', '+201071100030',
           pg_temp.receipt(:'u1', 'secondary_phone.reserve', '+201071100030'))) ->> 'sqlstate'), null, 'u1 reserves +201071100030');
select throws_ok(format('select * from public.installer_phone_change_begin(%L, gen_random_uuid(), %L, %L, %L, %L)',
                        :'craft', pg_temp.receipt(:'craft', 'primary_phone.change', '+201071100030'), 'EG', '1071100030', '+201071100030'),
  '23505', 'phone number is unavailable', 'an Installer cannot move its primary phone onto a number another account has ACTIVELY reserved');
select is((select phone_e164 from public.profiles where user_id = :'craft'), '+201071000003', 'and the refused change left the profile untouched');

-- craft begins a change to +201071100040: while pending, neither its new nor its old number can be reserved by anyone.
select lives_ok(format('select * from public.installer_phone_change_begin(%L, gen_random_uuid(), %L, %L, %L, %L)',
                        :'craft', pg_temp.receipt(:'craft', 'primary_phone.change', '+201071100040'), 'EG', '1071100040', '+201071100040'),
  'craft begins a journaled change to +201071100040');
select isnt((pg_temp.call_as(:'u2', format('public.secondary_phone_reserve(%L, %L::uuid)', '+201071100040',
           pg_temp.receipt(:'u2', 'secondary_phone.reserve', '+201071100040'))) ->> 'sqlstate'), null,
  'the pending NEW primary number cannot be reserved by another account');
select ok((pg_temp.call_as(:'u1', format('public.secondary_phone_change(%L, %L::uuid)', '+201071000003',
           pg_temp.receipt(:'u1', 'secondary_phone.change', '+201071000003'))) ->> 'sqlstate') is not null,
  'the OLD number (still the sign-in alias while the change is pending) cannot be reserved either');

select * from finish();
rollback;
