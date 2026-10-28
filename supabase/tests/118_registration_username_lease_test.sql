-- pgTAP: pending-registration username lease + email-resend throttle
-- (20261028090003_registration_username_lease.sql).
--
-- Proves, against the real schema:
--   * a new registration takes a 30-minute lease on its username, which makes
--     the name unavailable to everyone else (username_available, a second
--     registration, and a verified account's profile_set_username);
--   * the holder is never blocked by its own lease;
--   * the row is staged ONCE: a repeat sign-up (which GoTrue answers with the
--     account's real user id, for anyone who knows the email) cannot rename,
--     restage, change the account type of, or extend another registration;
--   * only a just-created, unconfirmed account can stage at all;
--   * an expired lease frees the name for others;
--   * reserved, taken and malformed names are never leased;
--   * consume returns the username only while its lease is active, and a
--     NULL username keeps the account type;
--   * a successful claim releases the holder's lease;
--   * existing confirmed accounts keep their usernames untouched;
--   * grants: save is service_role only, the helpers are callable by nobody;
--   * the shared limiter accepts 'email-resend' with a per-contact cap of 5.
-- Two-session races are covered by registration_username_lease_concurrency_test.sh.
create extension if not exists pgtap;

begin;
select plan(46);

-- Fixtures: p1..p6 just-created unconfirmed registrants, s1 an unconfirmed
-- account created 20 minutes ago, v1 a verified account, e1 an existing
-- confirmed account that already owns "existingname".
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
                        email_confirmed_at, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email,
       '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, confirmed, created, now()
from (values
  ('91180000-0000-4000-8000-0000000000a1', 'lease-p1@example.test', null::timestamptz, now()),
  ('91180000-0000-4000-8000-0000000000a2', 'lease-p2@example.test', null::timestamptz, now()),
  ('91180000-0000-4000-8000-0000000000a3', 'lease-p3@example.test', null::timestamptz, now()),
  ('91180000-0000-4000-8000-0000000000a4', 'lease-p4@example.test', null::timestamptz, now()),
  ('91180000-0000-4000-8000-0000000000a5', 'lease-p5@example.test', null::timestamptz, now()),
  ('91180000-0000-4000-8000-0000000000a6', 'lease-p6@example.test', null::timestamptz, now()),
  ('91180000-0000-4000-8000-0000000000c1', 'lease-s1@example.test', null::timestamptz, now() - interval '20 minutes'),
  ('91180000-0000-4000-8000-0000000000b1', 'lease-v1@example.test', now(), now()),
  ('91180000-0000-4000-8000-0000000000e1', 'lease-e1@example.test', now(), now())) v(id, email, confirmed, created);

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
-- 4. Staged once: a repeat sign-up cannot hijack, rename or extend
-- ===========================================================================
update app.pending_registrations set username_reserved_at = now() - interval '10 minutes'
 where user_id = '91180000-0000-4000-8000-0000000000a1';
set local role service_role;
select is(public.pending_registration_save('91180000-0000-4000-8000-0000000000a1', 'Hijacker', 'organization_type', 'importer'),
  true, 'a repeat sign-up only reports the existing active lease');
reset role;
select results_eq($$ select username, audience_value from app.pending_registrations where user_id = '91180000-0000-4000-8000-0000000000a1' $$,
  $$ values ('Falcon'::text, 'engineer'::text) $$, 'the staged username and account type are unchanged (no hijack)');
select ok((select username_reserved_at from app.pending_registrations where user_id = '91180000-0000-4000-8000-0000000000a1')
          < now() - interval '9 minutes', 'the lease start did NOT move forward');
select ok(public.username_available('Hijacker'), 'the repeat sign-up did not lease its new name');

-- ===========================================================================
-- 5. Expired lease: frees the name for others, is never renewed
-- ===========================================================================
update app.pending_registrations set username_reserved_at = now() - interval '31 minutes'
 where user_id = '91180000-0000-4000-8000-0000000000a1';

set local role anon;
select is(public.username_available('Falcon'), true, 'an expired lease no longer blocks anyone');
reset role;

set local role service_role;
select is(public.pending_registration_save('91180000-0000-4000-8000-0000000000a1', 'Falcon', 'persona_type', 'engineer'),
  false, 'p1 cannot renew its expired lease by signing up again');
select is(public.pending_registration_save('91180000-0000-4000-8000-0000000000a3', 'Falcon', 'persona_type', 'contractor'),
  true, 'p3 can now lease "Falcon"');

-- ===========================================================================
-- 6. Only a just-created, unconfirmed account can stage
-- ===========================================================================
select is(public.pending_registration_save('91180000-0000-4000-8000-0000000000c1', 'Merlin', 'persona_type', 'engineer'),
  false, 'an unconfirmed account created 20 minutes ago cannot stage');
select is(public.pending_registration_save('91180000-0000-4000-8000-0000000000b1', 'Merlin', 'persona_type', 'engineer'),
  false, 'a confirmed account cannot stage');
reset role;
select is((select count(*)::int from app.pending_registrations
            where user_id in ('91180000-0000-4000-8000-0000000000c1', '91180000-0000-4000-8000-0000000000b1')), 0,
  'neither got a pending row');

-- ===========================================================================
-- 7. Reserved, taken and malformed names are never leased
-- ===========================================================================
set local role service_role;
select is(public.pending_registration_save('91180000-0000-4000-8000-0000000000a4', 'Admin', 'persona_type', 'engineer'),
  false, 'a reserved word is never leased');
select is(public.pending_registration_save('91180000-0000-4000-8000-0000000000a5', 'ExistingName', 'persona_type', 'engineer'),
  false, 'a name an existing account owns is never leased');
select is(public.pending_registration_save('91180000-0000-4000-8000-0000000000a6', 'bad name!', 'persona_type', 'engineer'),
  false, 'a malformed name is never leased');
reset role;
select is((select count(*)::int from app.pending_registrations
            where user_id in ('91180000-0000-4000-8000-0000000000a4', '91180000-0000-4000-8000-0000000000a5', '91180000-0000-4000-8000-0000000000a6')
              and username is null and audience_value = 'engineer'), 3,
  'all three are still staged with their account type and no username');

-- ===========================================================================
-- 8. Existing confirmed accounts are untouched
-- ===========================================================================
select is((select username from public.profiles where user_id = '91180000-0000-4000-8000-0000000000e1'),
  'existingname', 'the existing account keeps its username');

-- ===========================================================================
-- 9. A verified account cannot snipe a leased name; the holder can claim it
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
-- 10. consume: username only while its lease is active
-- ===========================================================================
update auth.users set email_confirmed_at = now() where id in
  ('91180000-0000-4000-8000-0000000000a1', '91180000-0000-4000-8000-0000000000a2', '91180000-0000-4000-8000-0000000000a4');

-- p2 holds a fresh lease on a free name (set directly: its own save could not lease "Falcon").
update app.pending_registrations set username = 'Osprey', username_reserved_at = now() - interval '5 minutes'
 where user_id = '91180000-0000-4000-8000-0000000000a2';
set local role authenticated;
set local request.jwt.claims = '{"sub":"91180000-0000-4000-8000-0000000000a2","role":"authenticated"}';
select results_eq($$ select username, audience_value from public.pending_registration_consume() $$,
  $$ values ('Osprey'::text, 'showroom_dealer'::text) $$, 'consume returns the leased name and account type');
select is((select count(*)::int from public.pending_registration_consume()), 0, 'consume is one-shot');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"91180000-0000-4000-8000-0000000000a1","role":"authenticated"}';
select results_eq($$ select username, audience_value from public.pending_registration_consume() $$,
  $$ values (null::text, 'engineer'::text) $$, 'an expired lease consumes as a NULL username with the account type kept');
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
-- 11. email-resend throttle
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
