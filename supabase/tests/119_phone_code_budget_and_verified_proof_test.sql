-- WhatsApp sign-up: atomic send budget, billable marker, server-only verification proof.
create extension if not exists pgtap;
begin;
select plan(16);

-- Permissions: the proof column stays unwritable by every API role; the three functions are service_role only.
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'phone_verified_at', 'UPDATE')
  and not has_column_privilege('service_role', 'public.profiles', 'phone_verified_at', 'UPDATE')
  and not has_table_privilege('service_role', 'public.profiles', 'UPDATE'),
  'no API role can write profiles.phone_verified_at directly');

select ok(
  has_function_privilege('service_role', 'public.phone_challenge_issue(uuid,text,text,timestamptz,integer,integer)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.phone_challenge_mark_sent(uuid)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.phone_sign_up_mark_verified(uuid,text)', 'EXECUTE'),
  'service_role runs the three functions');

select ok(
  not has_function_privilege('anon', 'public.phone_challenge_issue(uuid,text,text,timestamptz,integer,integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.phone_challenge_issue(uuid,text,text,timestamptz,integer,integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.phone_challenge_mark_sent(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.phone_challenge_mark_sent(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.phone_sign_up_mark_verified(uuid,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.phone_sign_up_mark_verified(uuid,text)', 'EXECUTE'),
  'anon and authenticated cannot run them');

-- Fixtures
insert into auth.users (id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
values ('11901190-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'p201012340001@craftsman-login.aladdin.invalid', '{"provider":"email","providers":["email"]}', '{}', now(), now(), now());
update public.profiles set phone_e164 = '+201012340001', phone_country_iso2 = 'EG', phone_national = '01012340001'
 where user_id = '11901190-0000-4000-8000-000000000001';

delete from public.phone_verification_challenges;
set local role service_role;

-- Issue: budget of 3 per 24 h, 2 per number per hour.
select is(public.phone_challenge_issue('11901190-0000-4000-8000-0000000000a1', '+201012340001', repeat('a', 64), now() + interval '5 minutes', 2, 3), 'issued', 'first code issues');
select is(public.phone_challenge_issue('11901190-0000-4000-8000-0000000000a2', '+201012340001', repeat('b', 64), now() + interval '5 minutes', 2, 3), 'issued', 'second code for the number issues');
select is(public.phone_challenge_issue('11901190-0000-4000-8000-0000000000a3', '+201012340001', repeat('c', 64), now() + interval '5 minutes', 2, 3), 'rate_limited', 'a third code for the same number in an hour is refused');
select is(public.phone_challenge_issue('11901190-0000-4000-8000-0000000000a4', '+201012340002', repeat('d', 64), now() + interval '5 minutes', 2, 3), 'issued', 'another number still has room in the budget');
select is(public.phone_challenge_issue('11901190-0000-4000-8000-0000000000a5', '+201012340003', repeat('e', 64), now() + interval '5 minutes', 2, 3), 'budget_exhausted', 'the global budget stops a fourth code');
select is((select count(*)::int from public.phone_verification_challenges), 3, 'refused requests insert nothing');
select throws_ok(
  $$ select public.phone_challenge_issue('11901190-0000-4000-8000-0000000000a6', '+201012340004', repeat('f', 64), now() + interval '5 minutes', 0, 3) $$,
  '22023', null, 'a non-positive limit is an error, never "unlimited"');

-- Billable marker
select ok(public.phone_challenge_mark_sent('11901190-0000-4000-8000-0000000000a1'), 'accepted by Meta is stamped');
select ok(not public.phone_challenge_mark_sent('11901190-0000-4000-8000-0000000000a1'), 'stamping twice changes nothing');

-- Verified proof: needs a consumed challenge for exactly this number.
select is(public.phone_sign_up_mark_verified('11901190-0000-4000-8000-000000000001', '+201012340001'), false, 'no consumed code means no proof');
update public.phone_verification_challenges set consumed_at = now() where id = '11901190-0000-4000-8000-0000000000a1';
select is(public.phone_sign_up_mark_verified('11901190-0000-4000-8000-000000000001', '+201012340002'), false, 'a code for another number is no proof');
select is(public.phone_sign_up_mark_verified('11901190-0000-4000-8000-000000000001', '+201012340001'), true, 'a consumed code for the number marks it verified');
reset role;
select isnt((select phone_verified_at from public.profiles where user_id = '11901190-0000-4000-8000-000000000001'), null, 'phone_verified_at is set');

select * from finish();
rollback;
