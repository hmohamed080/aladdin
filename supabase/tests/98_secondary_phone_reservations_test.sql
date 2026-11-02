-- pgTAP: secondary phone reservations + current-password confirmation
-- (20261021090004_secondary_phone_reservations.sql).
--
--   A. Password confirmation: receipt binding, single use, 60 s, 5-in-15 lockout, no-password accounts
--   B. Reserve: one per account, canonical E.164, cross-account and primary conflicts, cooldown
--   C. Renew (once, 14 days max), cancel, change, lazy expiry
--   D. Primary claims: blocked by another account's ACTIVE reservation, never by a cooldown; own = conversion
--   E. Conversion: no cooldown; phone-login accounts refused
--   F. Support override: permission, mandatory reason, immutability, audit
--   G. Boundaries: tables closed to clients, anon refused, never a login/contact
--   H. One number is never both the primary and the secondary of one account, in every direction
--
-- Every fixture is created INSIDE this transaction; the file rolls back.
create extension if not exists pgtap;

begin;
select plan(75);

\set u1     '69000000-0000-4000-8000-000000000001'
\set u2     '69000000-0000-4000-8000-000000000002'
\set u3     '69000000-0000-4000-8000-000000000003'
\set social '69000000-0000-4000-8000-000000000004'
\set craft  '69000000-0000-4000-8000-000000000005'
\set sup    '69000000-0000-4000-8000-000000000006'
\set padmin '55555555-5555-4555-8555-555555555555'

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
-- Run one SQL expression as a user: its jsonb result, {"void":true}, or {"sqlstate":..., "msg":...}.
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
create function pg_temp.st(p_user uuid, p_sql text) returns text language sql as $$
  select coalesce(pg_temp.call_as(p_user, p_sql) ->> 'sqlstate', 'ok') $$;
create function pg_temp.receipt(p_user uuid, p_op text, p_phone text, p_pw text default 'Correct-Horse-1') returns uuid language sql as $$
  select (pg_temp.call_as(p_user, format('public.account_password_confirm(%L, %L, %L)', p_pw, p_op, p_phone)) ->> 'receipt')::uuid $$;
create function pg_temp.reserve(p_user uuid, p_phone text) returns jsonb language sql as $$
  select pg_temp.call_as(p_user, format('public.secondary_phone_reserve(%L, %L::uuid)', p_phone,
    pg_temp.receipt(p_user, 'secondary_phone.reserve', p_phone))) $$;
-- Move a reservation's clock back (tests only; the DBA bypasses the closed table).
create function pg_temp.age(p_user uuid, p_by interval) returns void language sql as $$
  update public.secondary_phone_reservations
     set created_at = created_at - p_by, expires_at = expires_at - p_by,
         ended_at = ended_at - p_by
   where user_id = p_user $$;
grant execute on function pg_temp.act_as(uuid), pg_temp.as_dba() to authenticated, anon;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
values
  (:'u1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sp1@probe.test',
   extensions.crypt('Correct-Horse-1', extensions.gen_salt('bf')), now(), '{"full_name":"Sigma One"}', now(), now()),
  (:'u2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sp2@probe.test',
   extensions.crypt('Correct-Horse-1', extensions.gen_salt('bf')), now(), '{"full_name":"Sigma Two"}', now(), now()),
  (:'u3', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sp3@probe.test',
   extensions.crypt('Correct-Horse-1', extensions.gen_salt('bf')), now(), '{"full_name":"Sigma Three"}', now(), now()),
  (:'social', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sp4@probe.test',
   null, now(), '{"full_name":"Sigma Social"}', now(), now()),
  (:'craft', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p201069000005@craftsman-login.aladdin.invalid',
   extensions.crypt('Correct-Horse-1', extensions.gen_salt('bf')), now(), '{"full_name":"Sigma Craft"}', now(), now()),
  (:'sup', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sp6@probe.test',
   extensions.crypt('Correct-Horse-1', extensions.gen_salt('bf')), now(), '{"full_name":"Sigma Support"}', now(), now());
update public.profiles set phone_e164 = '+201069000001' where user_id = :'u1';
update public.profiles set phone_e164 = '+201069000005' where user_id = :'craft';
-- An authorized Support member: the built-in Support role stays read-only, so the override comes through a role.
insert into public.admin_roles (key, name, rank, scope_type) values ('probe_phone_support', 'Phone support', 40, 'platform');
insert into public.admin_role_permissions (role_id, permission_key)
select id, p from public.admin_roles, unnest(array['users.read', 'phones.cooldown_override']) p where key = 'probe_phone_support';
insert into public.admin_role_assignments (user_id, role_id)
select :'sup', id from public.admin_roles where key = 'probe_phone_support';
\set plainsup '69000000-0000-4000-8000-000000000007'
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
values (:'plainsup', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sp7@probe.test', now(), '{}', now(), now());
insert into public.admin_role_assignments (user_id, role_id)
select :'plainsup', id from public.admin_roles where key = 'support';

-- ===========================================================================
-- A. Password confirmation
-- ===========================================================================
select is(pg_temp.call_as(:'u2', $$public.account_password_confirm('Correct-Horse-1', 'secondary_phone.reserve', '+201069100001')$$) ->> 'ok',
          'true', 'A1 the right password issues a receipt');
select is(pg_temp.call_as(:'u2', $$public.account_password_confirm('wrong', 'secondary_phone.reserve', '+201069100001')$$) ->> 'reason',
          'wrong_password', 'A2 a wrong password is refused');
select is((pg_temp.call_as(:'u2', $$public.account_password_confirm('wrong', 'secondary_phone.reserve', '+201069100001')$$) ->> 'remaining')::int,
          3, 'A3 each wrong attempt is counted (a failure is never rolled back)');
do $$ begin
  perform pg_temp.call_as('69000000-0000-4000-8000-000000000002', $q$public.account_password_confirm('wrong', 'secondary_phone.reserve', '+201069100001')$q$);
  perform pg_temp.call_as('69000000-0000-4000-8000-000000000002', $q$public.account_password_confirm('wrong', 'secondary_phone.reserve', '+201069100001')$q$);
end $$;
select is(pg_temp.call_as(:'u2', $$public.account_password_confirm('wrong', 'secondary_phone.reserve', '+201069100001')$$) ->> 'reason',
          'locked', 'A4 the fifth wrong password locks confirmation');
select is(pg_temp.call_as(:'u2', $$public.account_password_confirm('Correct-Horse-1', 'secondary_phone.reserve', '+201069100001')$$) ->> 'reason',
          'locked', 'A5 even the right password is refused while locked');
select ok((select locked_until between now() + interval '14 minutes' and now() + interval '16 minutes'
             from app.password_confirm_attempts where user_id = :'u2'), 'A6 the lockout lasts 15 minutes');
update app.password_confirm_attempts set locked_until = now() - interval '1 second' where user_id = :'u2';
select is(pg_temp.call_as(:'u2', $$public.account_password_confirm('Correct-Horse-1', 'secondary_phone.reserve', '+201069100001')$$) ->> 'ok',
          'true', 'A7 after the lockout the right password works again');
update app.password_confirm_attempts set window_start = now() - interval '16 minutes', failures = 4 where user_id = :'u2';
select is(pg_temp.call_as(:'u2', $$public.account_password_confirm('wrong', 'secondary_phone.reserve', '+201069100001')$$) ->> 'reason',
          'wrong_password', 'A8 failures older than 15 minutes do not count toward the lockout');
select is(pg_temp.call_as(:'social', $$public.account_password_confirm('x', 'secondary_phone.reserve', '+201069100001')$$) ->> 'reason',
          'no_password', 'A9 a social-only account has no password to confirm');
select is(pg_temp.st(:'u2', $$public.account_password_confirm('Correct-Horse-1', 'account.delete', '+201069100001')$$), '22023',
          'A10 an unknown operation is refused');
select is(pg_temp.st(:'u2', $$public.account_password_confirm('Correct-Horse-1', 'secondary_phone.reserve', '01069100001')$$), '22023',
          'A11 the target must be canonical E.164');

-- Receipt binding
select is(pg_temp.st(:'u3', format('public.secondary_phone_reserve(%L, %L::uuid)', '+201069100003',
          pg_temp.receipt(:'u3', 'secondary_phone.reserve', '+201069100099'))), '42501', 'A12 a receipt is bound to its target');
select is(pg_temp.st(:'u3', format('public.secondary_phone_reserve(%L, %L::uuid)', '+201069100003',
          pg_temp.receipt(:'u3', 'secondary_phone.change', '+201069100003'))), '42501', 'A13 a receipt is bound to its operation');
select is(pg_temp.st(:'u3', format('public.secondary_phone_reserve(%L, %L::uuid)', '+201069100003',
          pg_temp.receipt(:'u2', 'secondary_phone.reserve', '+201069100003'))), '42501', 'A14 a receipt is bound to its user');
select is(pg_temp.st(:'u3', format('public.secondary_phone_reserve(%L, %L::uuid)', '+201069100003', extensions.gen_random_uuid())),
          '42501', 'A15 an invented receipt is refused');
select pg_temp.receipt(:'u3', 'secondary_phone.reserve', '+201069100003') as r3 \gset
update app.reauth_receipts set expires_at = clock_timestamp() - interval '1 second' where id = :'r3';
select is(pg_temp.st(:'u3', format('public.secondary_phone_reserve(%L, %L::uuid)', '+201069100003', :'r3')), '42501',
          'A16 a receipt older than 60 seconds is refused');
-- Scoped to THIS file's fixtures (user ids 69000000-0000-4000-8000-*): the table is global, and any other committed receipt
-- (for example the ones the installer phone-change concurrency script leaves behind) must not decide this assertion. The
-- assertion itself is unchanged - every fixture receipt lives exactly 60 s - and it cannot pass vacuously: the set must be non-empty.
select ok((select count(*) > 0 and bool_and(expires_at - created_at = interval '60 seconds') from app.reauth_receipts
            where id <> :'r3' and user_id::text like '69000000-0000-4000-8000-%'), 'A17 receipts live exactly 60 seconds');

-- ===========================================================================
-- B. Reserve
-- ===========================================================================
select pg_temp.receipt(:'u3', 'secondary_phone.reserve', '+201069100003') as r3b \gset
select is(pg_temp.call_as(:'u3', format('public.secondary_phone_reserve(%L, %L::uuid)', '+201069100003', :'r3b')) ->> 'status',
          'active', 'B1 a reservation is created');
select is(pg_temp.st(:'u3', format('public.secondary_phone_reserve(%L, %L::uuid)', '+201069100003', :'r3b')), '42501',
          'B2 a receipt is single-use');
select ok((select expires_at - created_at = interval '7 days' from public.secondary_phone_reservations where user_id = :'u3'),
          'B3 a reservation lasts 7 days');
select is(pg_temp.call_as(:'u3', 'public.my_secondary_phone()') ->> 'verified', 'false', 'B4 a secondary phone is always unverified');
select is(pg_temp.reserve(:'u3', '+201069100033') ->> 'sqlstate', '23505', 'B5 one reservation per account');
select is(pg_temp.reserve(:'u2', '+201069100003') ->> 'sqlstate', '23505', 'B6 another account cannot reserve an actively reserved number');
select is(pg_temp.reserve(:'u2', '+201069000001') ->> 'sqlstate', '23505', 'B7 nobody can reserve another account''s primary phone');
select is(pg_temp.reserve(:'u2', '+201069000005') ->> 'sqlstate', '23505', 'B8 nor a phone-login (Craftsman) number');
select is(pg_temp.reserve(:'u1', '+201069000001') ->> 'sqlstate', '22023', 'B9 your own primary is not a secondary');
select is(pg_temp.reserve(:'u2', '+201069000001') ->> 'msg', 'phone number is unavailable',
          'B10 conflicts never say which account or claim holds the number');
select is(pg_temp.st(:'u2', format('public.secondary_phone_reserve(%L, %L::uuid)', '201069100002',
          pg_temp.receipt(:'u2', 'secondary_phone.reserve', '+201069100002'))), '22023', 'B11 a non-canonical number is refused');
-- Backstop: the unique indexes refuse a second active row even without the RPC's checks.
select throws_ok($$ insert into public.secondary_phone_reservations (user_id, phone_e164, expires_at)
                    values ('69000000-0000-4000-8000-000000000002', '+201069100003', now() + interval '1 day') $$,
                 '23505', null, 'B12 the active-number unique index is the last line against a race');

-- ===========================================================================
-- C. Renew, cancel, change, expiry
-- ===========================================================================
select ok((pg_temp.call_as(:'u3', 'public.secondary_phone_renew()') ->> 'expires_at')::timestamptz
          - (select created_at from public.secondary_phone_reservations where user_id = :'u3' and status = 'active') = interval '14 days',
          'C1 one renewal adds 7 days: 14 days in total');
select is(pg_temp.st(:'u3', 'public.secondary_phone_renew()'), '22023', 'C2 a second renewal is refused');
select is(pg_temp.call_as(:'u3', 'public.my_secondary_phone()') ->> 'can_renew', 'false', 'C3 can_renew says so');
select throws_ok($$ update public.secondary_phone_reservations set expires_at = created_at + interval '15 days'
                    where user_id = '69000000-0000-4000-8000-000000000003' $$,
                 '23514', null, 'C4 the table itself refuses more than 14 days');
-- Expiry (no sweeper): age u3's reservation past its end.
do $$ begin perform pg_temp.age('69000000-0000-4000-8000-000000000003', interval '15 days'); end $$;
select is(pg_temp.call_as(:'u3', 'public.my_secondary_phone()'), '{"void":true}'::jsonb, 'C5 an expired reservation is gone for its owner');
select is(pg_temp.st(:'u3', 'public.secondary_phone_renew()'), 'P0002', 'C6 an expired reservation cannot be renewed (no auto-renewal)');
select is(pg_temp.reserve(:'u2', '+201069100003') ->> 'sqlstate', '23505', 'C7 expiry starts the cooldown: nobody may reserve it');
select ok(pg_temp.reserve(:'u3', '+201069100003') ->> 'msg' like 'phone number is in cooldown until %',
          'C8 its former holder is told it is in cooldown');
select is(pg_temp.reserve(:'u3', '+201069100030') ->> 'status', 'active', 'C9 after expiry the account may reserve another number');
select is((select status::text from public.secondary_phone_reservations where user_id = :'u3' order by created_at limit 1), 'expired',
          'C10 the next successful operation finalized the stale row as expired');
-- Change: old number enters cooldown, new one is reserved, atomically.
select is(pg_temp.call_as(:'u3', format('public.secondary_phone_change(%L, %L::uuid)', '+201069100031',
          pg_temp.receipt(:'u3', 'secondary_phone.change', '+201069100031'))) ->> 'phone', '+201069100031', 'C11 change reserves the new number');
select is(pg_temp.reserve(:'u2', '+201069100030') ->> 'sqlstate', '23505', 'C12 the changed-away number is in cooldown');
select is(pg_temp.call_as(:'u3', format('public.secondary_phone_change(%L, %L::uuid)', '+201069000001',
          pg_temp.receipt(:'u3', 'secondary_phone.change', '+201069000001'))) ->> 'sqlstate', '23505',
          'C13 a failed change keeps the current reservation (atomic)');
select is(pg_temp.call_as(:'u3', 'public.my_secondary_phone()') ->> 'phone', '+201069100031', 'C14 ...which is still active');
-- Cancel
select is(pg_temp.st(:'u3', 'public.secondary_phone_cancel()'), 'ok', 'C15 cancel');
select is(pg_temp.reserve(:'u2', '+201069100031') ->> 'sqlstate', '23505', 'C16 cancellation starts the cooldown');

-- ===========================================================================
-- D. Primary claims
-- ===========================================================================
select is(pg_temp.reserve(:'u2', '+201069100002') ->> 'status', 'active', 'D0 u2 reserves a number');
select is(pg_temp.st(:'u3', $$public.profile_set_phone('EG', '1069100002', '+201069100002')$$), '23505',
          'D1 primary change to another account''s ACTIVE reservation is blocked');
select throws_ok($$ update public.profiles set phone_e164 = '+201069100002' where user_id = '69000000-0000-4000-8000-000000000001' $$,
                 '23505', null, 'D2 every write path to the primary is covered (direct update)');
select is(pg_temp.st(:'u3', $$public.profile_set_phone('EG', '1069100031', '+201069100031')$$), 'ok',
          'D3 primary change is available immediately during a cooldown');
select is(pg_temp.reserve(:'u2', '+201069100031') ->> 'sqlstate', '23505', 'D4 ...and then it is a primary claim');

-- ===========================================================================
-- E. Conversion
-- ===========================================================================
select is(pg_temp.st(:'u2', format('public.secondary_phone_make_primary(%L::uuid, %L, %L)',
          pg_temp.receipt(:'u2', 'secondary_phone.convert', '+201069100002'), 'EG', '1069100002')), 'ok',
          'E1 the owner converts their reserved secondary into their primary');
select is((select phone_e164 from public.profiles where user_id = :'u2'), '+201069100002', 'E2 it is now the primary');
select is((select status::text from public.secondary_phone_reservations where user_id = :'u2' and phone_e164 = '+201069100002'),
          'converted', 'E3 the reservation ended as converted');
select is((select app.phone_cooldown_until('+201069100002')), null, 'E4 conversion starts no cooldown');
select is(pg_temp.st(:'u2', format('public.secondary_phone_make_primary(%L::uuid)',
          pg_temp.receipt(:'u2', 'secondary_phone.convert', '+201069100002'))), 'P0002', 'E5 nothing left to convert');
select is(pg_temp.reserve(:'craft', '+201069100055') ->> 'status', 'active', 'E6 a Craftsman can reserve a secondary');
select is(pg_temp.st(:'craft', format('public.secondary_phone_make_primary(%L::uuid)',
          pg_temp.receipt(:'craft', 'secondary_phone.convert', '+201069100055'))), '42501',
          'E7 a phone-login account cannot move its login phone (fails closed)');
select is(pg_temp.call_as(:'craft', 'public.my_secondary_phone()') ->> 'status', 'active', 'E8 ...and keeps its reservation');

-- ===========================================================================
-- F. Support override
-- ===========================================================================
select is(pg_temp.st(:'u1', $$public.admin_phone_cooldown_override('+201069100030', 'please')$$), '42501',
          'F1 a non-staff account cannot override');
select is(pg_temp.st(:'sup', $$public.admin_phone_cooldown_override('+201069100030', '   ')$$), '22023', 'F2 a reason is mandatory');
select is(pg_temp.st(:'plainsup', $$public.admin_phone_cooldown_override('+201069100030', 'please')$$), '42501',
          'F2b the built-in read-only Support role cannot override without being authorized');
select ok(pg_temp.call_as(:'sup', $$public.admin_phone_cooldown_status('+201069100030')$$) ->> 'cooldown_until' is not null,
          'F3 Support sees the cooldown');
select is(pg_temp.st(:'sup', $$public.admin_phone_cooldown_override('+201069100030', 'Customer proved ownership by call')$$), 'ok',
          'F4 Support overrides with a reason');
select is(pg_temp.reserve(:'u1', '+201069100030') ->> 'status', 'active', 'F5 the number can be reserved again');
select is((select count(*)::int from public.audit_log where action = 'phone_cooldown.overridden'
             and metadata ->> 'reason' = 'Customer proved ownership by call'), 1, 'F6 the override is audited');
select throws_ok($$ update public.phone_cooldown_overrides set reason = 'edited' $$, '42501', null, 'F7 overrides cannot be edited');
select throws_ok($$ delete from public.phone_cooldown_overrides $$, '42501', null, 'F8 ...or deleted');

-- ===========================================================================
-- H. Same number as primary AND secondary on one account (B9 covers reserving your own primary)
-- ===========================================================================
-- u1: primary +201069000001, active secondary +201069100030 (F5).
select is(pg_temp.call_as(:'u1', format('public.secondary_phone_change(%L, %L::uuid)', '+201069000001',
          pg_temp.receipt(:'u1', 'secondary_phone.change', '+201069000001'))) ->> 'msg', 'this is already your primary phone',
          'H1 changing your secondary to your own primary is refused (22023, "already your primary")');
select is(pg_temp.call_as(:'u1', 'public.my_secondary_phone()') ->> 'phone', '+201069100030',
          'H2 ...and the refused change keeps the current secondary (atomic)');
select is(pg_temp.st(:'u1', $$public.profile_set_phone('EG', '1069100030', '+201069100030')$$), 'ok',
          'H3 the normal primary-phone change to your own active secondary succeeds');
select is((select status::text from public.secondary_phone_reservations where user_id = :'u1' and phone_e164 = '+201069100030'),
          'converted', 'H4 ...as a conversion: the secondary reservation ends, it does not stay beside the primary');
select is(pg_temp.call_as(:'u1', 'public.my_secondary_phone()'), '{"void":true}'::jsonb, 'H5 the account has no secondary left');
select is((select count(*)::int from public.profiles p
             join public.secondary_phone_reservations r on r.user_id = p.user_id and r.phone_e164 = p.phone_e164
            where r.status = 'active'), 0, 'H6 no account anywhere holds one number as both primary and active secondary');

-- ===========================================================================
-- G. Boundaries
-- ===========================================================================
select ok(not has_table_privilege('authenticated', 'public.secondary_phone_reservations', 'select'), 'G1 reservations are not client-readable');
select ok(not has_function_privilege('anon', 'public.secondary_phone_reserve(text, uuid)', 'execute')
          and not has_function_privilege('anon', 'public.account_password_confirm(text, text, text)', 'execute'), 'G2 anon cannot call the RPCs');

select * from finish();
rollback;
