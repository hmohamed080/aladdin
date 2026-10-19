-- The Data API refuses a signed-out, expired (not_after), banned or deleted session
-- on its next request (migration 20261019140000), while my_account_status stays
-- reachable and reports `session_active`.
create extension if not exists pgtap;
begin;
select no_plan();

\set u '11111111-1111-4111-8111-111111111111'
\set live 'e1000000-0000-4000-8000-000000000001'
\set gone 'e1000000-0000-4000-8000-000000000002'
\set ended 'e1000000-0000-4000-8000-000000000003'
insert into auth.sessions(id, user_id, created_at, aal, not_after) values
  (:'live',  :'u', now(), 'aal1', null),
  (:'ended', :'u', now(), 'aal1', now() - interval '1 minute');

-- authenticated may execute it since 20261019163000 (Storage/Realtime policies run as the caller).
select ok(not has_function_privilege(r, 'app.jwt_session_is_live()', 'EXECUTE'), format('%s cannot call the helper directly', r))
  from unnest(array['anon', 'service_role']) r;

-- The hook as PostgREST runs it: claims and path set, request role switched.
create function pg_temp.call_as(p_session text, p_path text default '/trades') returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', '11111111-1111-4111-8111-111111111111',
    'role', 'authenticated', 'session_id', p_session)::text, true);
  perform set_config('request.path', p_path, true);
  perform pgrst_hooks.pre_request();
  return 'allowed';
exception when insufficient_privilege then
  return sqlerrm;
end $$;
grant execute on function pg_temp.call_as(text, text) to authenticated;

set local role authenticated;
select is(pg_temp.call_as(:'live'), 'allowed', 'a live session is served');
select is(pg_temp.call_as(:'gone'), 'session revoked', 'a signed-out session (row deleted) is refused');
select is(pg_temp.call_as(:'ended'), 'session revoked', 'a session past not_after is refused');
select is(pg_temp.call_as(null), 'allowed', 'a token without a session claim is judged by suspension alone');
select is(pg_temp.call_as(:'gone', '/rpc/my_account_status'), 'allowed', 'my_account_status stays reachable');
select is((public.my_account_status() ->> 'session_active')::boolean, false, 'and reports the session as inactive');
select set_config('request.jwt.claims', json_build_object('sub', :'u', 'role', 'authenticated', 'session_id', :'live')::text, true);
select is((public.my_account_status() ->> 'session_active')::boolean, true, 'a live session is reported active');

reset role;
update auth.users set banned_until = now() + interval '1 day' where id = :'u';
set local role authenticated;
select is(pg_temp.call_as(:'live'), 'session revoked', 'a banned user''s live session is refused');
reset role;
update auth.users set banned_until = null, deleted_at = now() where id = :'u';
set local role authenticated;
select is(pg_temp.call_as(:'live'), 'session revoked', 'a soft-deleted user''s session is refused');
reset role;
update auth.users set deleted_at = null where id = :'u';

-- anon and service_role are untouched.
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select lives_ok($$select pgrst_hooks.pre_request()$$, 'anon passes the hook');
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select lives_ok($$select pgrst_hooks.pre_request()$$, 'service_role passes the hook');

select * from finish();
rollback;
