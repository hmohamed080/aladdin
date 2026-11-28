-- my_active_sessions / revoke_my_session / known_devices: own-row only, never another user's.
create extension if not exists pgtap;
begin;
select no_plan();

-- Fixtures: two sessions for user A (one is "current"), one for user B.
insert into auth.sessions (id, user_id, created_at, updated_at, user_agent, ip)
values
  ('a0000000-0000-4000-8000-0000000000a1', '70000010-0000-4000-8000-000000000010', now() - interval '2 hours', now() - interval '1 hour', 'Mozilla/5.0 (Windows NT 10.0) Chrome/126.0', '203.0.113.5'),
  ('a0000000-0000-4000-8000-0000000000a2', '70000010-0000-4000-8000-000000000010', now() - interval '3 hours', now() - interval '2 hours', 'Mozilla/5.0 (iPhone) Safari/605.1', '203.0.113.9'),
  ('b0000000-0000-4000-8000-0000000000b1', '70000001-0000-4000-8000-000000000001', now() - interval '1 hour', now(), 'Mozilla/5.0 (X11) Firefox/127.0', '198.51.100.7');

select ok(not has_function_privilege('anon', 'public.my_active_sessions()', 'execute'), 'anonymous caller cannot list sessions');
select ok(not has_function_privilege('anon', 'public.revoke_my_session(uuid)', 'execute'), 'anonymous caller cannot end sessions');
select ok(not has_table_privilege('authenticated', 'public.known_devices', 'insert'), 'no direct known_devices writes');
select ok(not has_table_privilege('anon', 'public.known_devices', 'select'), 'anonymous caller cannot read known_devices');

set local role authenticated;
set local request.jwt.claims = '{"sub":"70000010-0000-4000-8000-000000000010","role":"authenticated","session_id":"a0000000-0000-4000-8000-0000000000a1"}';

select is((select count(*)::integer from public.my_active_sessions() where id::text like 'a0000000%'), 2, 'caller sees their own two sessions');
select is((select count(*)::integer from public.my_active_sessions() where id::text like 'b0000000%'), 0, 'caller never sees another user''s session');
select is((select id::text from public.my_active_sessions() where is_current), 'a0000000-0000-4000-8000-0000000000a1', 'the JWT session is marked current');
select is((select ip from public.my_active_sessions() where id = 'a0000000-0000-4000-8000-0000000000a2'), '203.0.113.9', 'ip is returned as plain text');

select is(public.revoke_my_session('a0000000-0000-4000-8000-0000000000a1'), false, 'the current session cannot be ended here');
select is(public.revoke_my_session('b0000000-0000-4000-8000-0000000000b1'), false, 'another user''s session cannot be ended');
select is(public.revoke_my_session('a0000000-0000-4000-8000-0000000000a2'), true, 'another of the caller''s own sessions can be ended');
select is((select count(*)::integer from public.my_active_sessions() where id::text like 'a0000000%'), 1, 'the ended session is gone');

-- Known devices
select lives_ok($$select public.touch_known_device('d0000000-0000-4000-8000-0000000000d1', 'Mozilla/5.0 Chrome/126')$$, 'a device is recorded');
select lives_ok($$select public.touch_known_device('d0000000-0000-4000-8000-0000000000d1', 'Mozilla/5.0 Chrome/127')$$, 'recording the same device again refreshes it');
select is((select count(*)::integer from public.known_devices), 1, 'one row per device');
select is((select user_agent from public.known_devices), 'Mozilla/5.0 Chrome/127', 'the latest user agent is kept');
select is((select last_session_id::text from public.known_devices), 'a0000000-0000-4000-8000-0000000000a1', 'the signing-in session is remembered');
select throws_ok($$select public.touch_known_device(null, 'x')$$, '22023', null, 'a device id is required');

-- Another user's view and removal attempts
set local request.jwt.claims = '{"sub":"70000001-0000-4000-8000-000000000001","role":"authenticated","session_id":"b0000000-0000-4000-8000-0000000000b1"}';
select is((select count(*)::integer from public.known_devices), 0, 'another caller sees no known devices');
select is(public.forget_known_device('d0000000-0000-4000-8000-0000000000d1'), false, 'another caller cannot remove it');

-- Removing a device ends its session (a second device with its own session)
set local request.jwt.claims = '{"sub":"70000010-0000-4000-8000-000000000010","role":"authenticated","session_id":"a0000000-0000-4000-8000-0000000000a1"}';
reset role;
insert into auth.sessions (id, user_id, created_at, updated_at, user_agent) values ('a0000000-0000-4000-8000-0000000000a3', '70000010-0000-4000-8000-000000000010', now(), now(), 'Mozilla/5.0 Edge');
insert into public.known_devices (user_id, device_id, user_agent, last_session_id) values ('70000010-0000-4000-8000-000000000010', 'd0000000-0000-4000-8000-0000000000d2', 'Mozilla/5.0 Edge', 'a0000000-0000-4000-8000-0000000000a3');
set local role authenticated;
set local request.jwt.claims = '{"sub":"70000010-0000-4000-8000-000000000010","role":"authenticated","session_id":"a0000000-0000-4000-8000-0000000000a1"}';
select is(public.forget_known_device('d0000000-0000-4000-8000-0000000000d2'), true, 'the caller removes their other device');
select is((select count(*)::integer from public.my_active_sessions() where id = 'a0000000-0000-4000-8000-0000000000a3'), 0, 'removing a device ended its session');
select is((select count(*)::integer from public.my_active_sessions() where id = 'a0000000-0000-4000-8000-0000000000a1'), 1, 'the current session is untouched');

reset role;
select * from finish();
rollback;
