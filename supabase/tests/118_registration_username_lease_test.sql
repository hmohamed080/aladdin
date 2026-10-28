-- pgTAP: pending-registration username lease + email-resend throttle
-- (20261028090003_registration_username_lease.sql).
--
-- Proves, against the real schema:
--   * a pending registration takes a 30-minute lease on its username, which
--     makes the name unavailable to everyone else (username_available, a
--     second registration, and a verified account's profile_set_username);
--   * the holder is never blocked by its own lease;
--   * a repeat sign-up for the same user and name never extends the lease,
--     and an expired lease is not granted again to the same user (no
--     indefinite squatting), while a different name starts a fresh lease;
--   * an expired lease frees the name for others;
--   * reserved and already-taken names are never leased;
--   * consume returns the username only while its lease is active, and a
--     NULL username keeps the account type;
--   * a successful claim releases the holder's lease;
--   * existing confirmed accounts keep their usernames untouched;
--   * grants: save is service_role only, the helpers are callable by nobody;
--   * the shared limiter accepts 'email-resend' with a per-contact cap of 5.
-- Two-session races are covered by registration_username_lease_concurrency_test.sh.
create extension if not exists pgtap;

begin;
select plan(44);

-- Fixtures: p1..p4 unconfirmed registrants, v1 a verified account,
-- e1 an existing confirmed account that already owns "existingname".
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
                        email_confirmed_at, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email,
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, confirmed, now(), now()
from (values
  ('91180000-0000-4000-8000-0000000000a1', 'lease-p1@example.test', null::timestamptz),
  ('91180000-0000-4000-8000-0000000000a2', 'lease-p2@example.test', null::timestamptz),
  ('91180000-0000-4000-8000-0000000000a3', 'lease-p3@example.test', null::timestamptz),
  ('91180000-0000-4000-8000-0000000000a4', 'lease-p4@example.test', null::timestamptz),
  ('91180000-0000-4000-8000-0000000000b1', 'lease-v1@example.test', now()),
  ('91180000-0000-4000-8000-0000000000e1', 'lease-e1@example.test', now())) v(id, email, confirmed);

update public.profiles set username = 'existingname' where user_id = '91180000-0000-4000-8000-0000000000e1';

-- ===========================================================================
-- 1. Grants
-- ===========================================================================
select ok(not has_function_privilege('anon', 'public.pending_registration_save(uuid,text,public.activity_audience_kind,text,integer)', 'execute'),
  'anon cannot stage a pending registration');
select ok(not has_function_privilege('authenticated', 'public.pending_registration_save(uuid,text,public.activity_audience_kind,text,integer)', 'execute'),
  'authenticated cannot stage a pending registration');
select ok(has_function_privilege('service_role', 'public.pending_registration_save(uuid,text,public.activity_audience_kind,text,integer)', 'execute'),
  'service_role can stage a pending registration');
select ok(not has_function_privilege('authenticated', 'app.username_leased_by_other(text,uuid)', 'execute')
      and not has_function_privilege('anon', 'app.username_leased_by_other(text,uuid)', 'execute'),
  'the lease probe is not callable by clients');
select ok(not has_function_privilege('authenticated', 'app.lock_username(text)', 'execute'),
  'the per-name lock is not callable by clients');
select ok(has_function_privilege('anon', 'public.username_available(text)', 'execute'),
  'username_available stays anon-callable');
select is((select format_type(prorettype, null) from pg_proc where oid = 'public.pending_registration_save(uuid,text,public.activity_audience_kind,text,integer)'::regprocedure),
  'boolean', 'pending_registration_save now returns boolean');

-- ===========================================================================
-- 2. A first registration leases its name
-- ===========================================================================
set local role service_role;
select is(public.pending_registration_save('91180000-0000-4000-8000-0000000000a1', 'Falcon', 'persona_type', 'engineer'),
  true, 'p1 takes the lease on "Falcon"');
reset role;

select is((select username from app.pending_registrations where user_id = '91180000-0000-4000-8000-0000000000a1'),
  'Falcon', 'p1 row holds the username');
select ok((select username_reserved_at from app.pending_registrations where user_id = '91180000-0000-4000-8000-0000000000a1') is not null,
  'p1 lease start is recorded');

set local role anon;
select is(public.username_available('falcon'), false, 'anon: a leased name reads unavailable (case-insensitive)');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"91180000-0000-4000-8000-0000000000b1","role":"authenticated"}';
select is(public.username_available('Falcon'), false, 'another signed-in user: a leased name reads unavailable');
reset role;

-- ===========================================================================
-- 3. A second registration cannot take the same name; it keeps its account type
-- ===========================================================================
set local role service_role;
select is(public.pending_registration_save('91180000-0000-4000-8000-0000000000a2', 'FALCON', 'organization_type', 'showroom_dealer'),
  false, 'p2 cannot lease a name p1 holds');
reset role;
select is((select username from app.pending_registrations where user_id = '91180000-0000-4000-8000-0000000000a2'),
  null, 'p2 row has no username');
select is((select audience_value from app.pending_registrations where user_id = '91180000-0000-4000-8000-0000000000a2'),
  'showroom_dealer', 'p2 row still keeps its account type');

-- ===========================================================================
-- 4. Repeat sign-up: same user + same name never extends the lease
-- ===========================================================================
update app.pending_registrations set username_reserved_at = now() - interval '10 minutes'
 where user_id = '91180000-0000-4000-8000-0000000000a1';
set local role service_role;
select is(public.pending_registration_save('91180000-0000-4000-8000-0000000000a1', 'falcon', 'persona_type', 'engineer'),
  true, 'p1 repeat sign-up keeps its active lease');
reset role;
select ok((select username_reserved_at from app.pending_registrations where user_id = '91180000-0000-4000-8000-0000000000a1')
          < now() - interval '9 minutes', 'the lease start did NOT move forward');

-- ===========================================================================
-- 5. Expired lease: frees the name for others, is not re-granted to the same user
-- ===========================================================================
update app.pending_registrations set username_reserved_at = now() - interval '31 minutes'
 where user_id = '91180000-0000-4000-8000-0000000000a1';

set local role anon;
select is(public.username_available('Falcon'), true, 'an expired lease no longer blocks anyone');
reset role;

set local role service_role;
select is(public.pending_registration_save('91180000-0000-4000-8000-0000000000a1', 'Falcon', 'persona_type', 'engineer'),
  false, 'p1 cannot renew its own expired lease on the same name by signing up again');
reset role;
select is((select username from app.pending_registrations where user_id = '91180000-0000-4000-8000-0000000000a1'),
  null, 'p1 row dropped the username');
select is((select audience_value from app.pending_registrations where user_id = '91180000-0000-4000-8000-0000000000a1'),
  'engineer', 'p1 row keeps its account type');

set local role service_role;
select is(public.pending_registration_save('91180000-0000-4000-8000-0000000000a3', 'Falcon', 'persona_type', 'contractor'),
  true, 'p3 can now lease "Falcon"');
select is(public.pending_registration_save('91180000-0000-4000-8000-0000000000a1', 'Eagle', 'persona_type', 'engineer'),
  true, 'p1 can lease a different name');
-- ===========================================================================
-- 6. Reserved and taken names are never leased
-- ===========================================================================
select is(public.pending_registration_save('91180000-0000-4000-8000-0000000000a4', 'Admin', 'persona_type', 'engineer'),
  false, 'a reserved word is never leased');
select is(public.pending_registration_save('91180000-0000-4000-8000-0000000000a4', 'ExistingName', 'persona_type', 'engineer'),
  false, 'a name an existing account owns is never leased');
select is(public.pending_registration_save('91180000-0000-4000-8000-0000000000a4', 'bad name!', 'persona_type', 'engineer'),
  false, 'a malformed name is never leased (row still staged)');
reset role;
select is((select audience_value from app.pending_registrations where user_id = '91180000-0000-4000-8000-0000000000a4'),
  'engineer', 'p4 still has its staged account type');

-- ===========================================================================
-- 7. Existing confirmed accounts are untouched
-- ===========================================================================
select is((select username from public.profiles where user_id = '91180000-0000-4000-8000-0000000000e1'),
  'existingname', 'the existing account keeps its username');

-- ===========================================================================
-- 8. A verified account cannot snipe a leased name; the holder can claim it
-- ===========================================================================
set local role authenticated;
set local request.jwt.claims = '{"sub":"91180000-0000-4000-8000-0000000000b1","role":"authenticated"}';
select throws_ok($$ select public.profile_set_username('falcon') $$, '23505', 'username is unavailable',
  'a verified account cannot claim a name another registration leases');
select lives_ok($$ select public.profile_set_username('Kestrel') $$, 'the verified account can claim a free name');
reset role;

-- p3 confirms its email, then claims its own leased name.
update auth.users set email_confirmed_at = now() where id = '91180000-0000-4000-8000-0000000000a3';
set local role authenticated;
set local request.jwt.claims = '{"sub":"91180000-0000-4000-8000-0000000000a3","role":"authenticated"}';
select is(public.username_available('Falcon'), true, 'the lease holder is not blocked by its own lease');
select lives_ok($$ select public.profile_set_username('Falcon') $$, 'the lease holder claims its name');
reset role;
select is((select username from app.pending_registrations where user_id = '91180000-0000-4000-8000-0000000000a3'),
  null, 'a successful claim releases the holder''s lease');
select is((select audience_value from app.pending_registrations where user_id = '91180000-0000-4000-8000-0000000000a3'),
  'contractor', 'the claim leaves the staged account type for consume');

-- ===========================================================================
-- 9. consume: username only while its lease is active
-- ===========================================================================
update auth.users set email_confirmed_at = now() where id in
  ('91180000-0000-4000-8000-0000000000a1', '91180000-0000-4000-8000-0000000000a2', '91180000-0000-4000-8000-0000000000a4');

set local role authenticated;
set local request.jwt.claims = '{"sub":"91180000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select results_eq($$ select username, audience_value from public.pending_registration_consume() $$,
  $$ values ('Eagle'::text, 'engineer'::text) $$, 'consume returns the leased name and account type');
select is((select count(*)::int from public.pending_registration_consume()), 0, 'consume is one-shot');
reset role;

update app.pending_registrations set username = 'Osprey', username_reserved_at = now() - interval '40 minutes'
 where user_id = '91180000-0000-4000-8000-0000000000a2';
set local role authenticated;
set local request.jwt.claims = '{"sub":"91180000-0000-4000-8000-0000000000a2","role":"authenticated"}';
select results_eq($$ select username, audience_value from public.pending_registration_consume() $$,
  $$ values (null::text, 'showroom_dealer'::text) $$, 'an expired lease consumes as a NULL username with the account type kept');
reset role;

update app.pending_registrations set expires_at = now() - interval '1 minute'
 where user_id = '91180000-0000-4000-8000-0000000000a4';
set local role authenticated;
set local request.jwt.claims = '{"sub":"91180000-0000-4000-8000-0000000000a4","role":"authenticated"}';
select is((select count(*)::int from public.pending_registration_consume()), 0, 'an expired pending row restores nothing');
reset role;
select is((select count(*)::int from app.pending_registrations where user_id = '91180000-0000-4000-8000-0000000000a4'), 0,
  'and the stale row is removed');

-- ===========================================================================
-- 10. email-resend throttle
-- ===========================================================================
set local role service_role;
select ok(public.phone_auth_consume_limit('email-resend', repeat('a', 64), repeat('b', 64)), 'resend 1 allowed');
select ok(public.phone_auth_consume_limit('email-resend', repeat('a', 64), repeat('b', 64))
      and public.phone_auth_consume_limit('email-resend', repeat('a', 64), repeat('b', 64))
      and public.phone_auth_consume_limit('email-resend', repeat('a', 64), repeat('b', 64))
      and public.phone_auth_consume_limit('email-resend', repeat('a', 64), repeat('b', 64)), 'resends 2-5 allowed');
select is(public.phone_auth_consume_limit('email-resend', repeat('a', 64), repeat('b', 64)), false,
  'resend 6 for the same email within 15 minutes is refused');
select ok(public.phone_auth_consume_limit('email-resend', repeat('a', 64), repeat('c', 64)),
  'a different email from the same IP is still allowed');
select throws_ok($$ select public.phone_auth_consume_limit('email-blast', repeat('a', 64), repeat('b', 64)) $$, '22023',
  'invalid throttle input', 'an unknown limiter action is refused');
reset role;

select * from finish();
rollback;
