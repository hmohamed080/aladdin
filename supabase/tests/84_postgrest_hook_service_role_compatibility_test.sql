-- pgTAP: the PostgREST pre-request hook entry point (20260930100005_postgrest_hook_service_role_compatibility.sql).
--
-- 20260930100002 pointed pgrst.db_pre_request at app.api_pre_request. service_role has no USAGE on
-- schema app, and PostgREST prepares the hook statement under whichever role first uses a pooled
-- connection, so service-role requests intermittently failed with "permission denied for schema app"
-- on cold connections. The entry point now lives in its own schema, pgrst_hooks, that holds exactly
-- one function; schema app stays closed to service_role. (The HTTP-level proof of the cold-connection
-- behavior is supabase/tests/pgrst_pre_request_hook_api_test.mjs; this file proves the structure,
-- the grants and the behavior for EVERY request role.)
--
--   A. Schema and function structure        B. Grants: only what is needed; app untouched
--   C. Role configuration                   D. Behavior for anon / authenticated / admin / service_role
--   E. Suspended and deactivated accounts   F. Delegation equals the original hook
create extension if not exists pgtap;

begin;
select plan(34);

-- ===========================================================================
-- A. Structure
-- ===========================================================================
select has_schema('pgrst_hooks', 'the hook schema exists');
select is((select nspowner::regrole::text from pg_namespace where nspname = 'pgrst_hooks'), 'postgres', 'it is owned by postgres');
select is((select count(*)::int from pg_proc where pronamespace = 'pgrst_hooks'::regnamespace), 1, 'it holds exactly one function');
select is((select count(*)::int from pg_class where relnamespace = 'pgrst_hooks'::regnamespace), 0, 'and no table, view, sequence or index');
select is((select count(*)::int from pg_type where typnamespace = 'pgrst_hooks'::regnamespace and typtype <> 'c'), 0, 'and no type');
select is((select p.proname from pg_proc p where p.pronamespace = 'pgrst_hooks'::regnamespace), 'pre_request', 'the one function is pre_request');
select is((select p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=""']
           from pg_proc p where p.pronamespace = 'pgrst_hooks'::regnamespace and p.proname = 'pre_request'),
  true, 'pre_request is SECURITY DEFINER, STABLE and pins search_path = ""');

-- ===========================================================================
-- B. Grants
-- ===========================================================================
select ok(has_schema_privilege('anon', 'pgrst_hooks', 'usage')
      and has_schema_privilege('authenticated', 'pgrst_hooks', 'usage')
      and has_schema_privilege('service_role', 'pgrst_hooks', 'usage'),
  'anon, authenticated and service_role can resolve the hook schema');
select is((select count(*)::int from pg_namespace n, aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) a
           where n.nspname = 'pgrst_hooks' and a.grantee = 0), 0, 'PUBLIC has no access to the hook schema');
select ok(has_function_privilege('anon', 'pgrst_hooks.pre_request()', 'execute')
      and has_function_privilege('authenticated', 'pgrst_hooks.pre_request()', 'execute')
      and has_function_privilege('service_role', 'pgrst_hooks.pre_request()', 'execute'),
  'the three request roles can execute the entry point');
select is((select count(*)::int from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
           where p.pronamespace = 'pgrst_hooks'::regnamespace and a.grantee = 0), 0, 'PUBLIC cannot execute it');
-- schema app is NOT widened: service_role still has no USAGE; the ACL is exactly what it was.
select ok(not has_schema_privilege('service_role', 'app', 'usage'), 'service_role still has NO usage on schema app');
select is((select nspacl::text from pg_namespace where nspname = 'app'),
  '{postgres=UC/postgres,anon=U/postgres,authenticated=U/postgres}', 'the app schema ACL is unchanged');
select ok(has_function_privilege('anon', 'app.api_pre_request()', 'execute')
      and has_function_privilege('authenticated', 'app.api_pre_request()', 'execute')
      and has_function_privilege('service_role', 'app.api_pre_request()', 'execute'),
  'app.api_pre_request keeps its grants (the entry point delegates to it)');

-- ===========================================================================
-- C. Role configuration
-- ===========================================================================
select ok((select rolconfig::text from pg_roles where rolname = 'authenticator') like '%pgrst.db_pre_request=pgrst_hooks.pre_request%',
  'authenticator points db_pre_request at the new entry point');
select ok((select rolconfig::text from pg_roles where rolname = 'authenticator') not like '%app.api_pre_request%',
  'and no longer at app.api_pre_request');

-- ===========================================================================
-- D. Behavior for every request role, through the ENTRY POINT PostgREST calls
-- ===========================================================================
-- Fixtures (as the database owner): an active non-staff user, an admin, a suspended and a deactivated user.
create temp table who as
  select (select id from public.users where id = '11111111-1111-4111-8111-111111111111') as active_user,
         (select a.user_id from public.admin_role_assignments a where a.is_active limit 1) as admin_user,
         '71000008-0000-4000-8000-000000000008'::uuid as suspended_user,
         '71000009-0000-4000-8000-000000000009'::uuid as deactivated_user;
grant select on who to anon, authenticated, service_role;
update public.users set status = 'suspended'   where id = '71000008-0000-4000-8000-000000000008';
update public.users set status = 'deactivated' where id = '71000009-0000-4000-8000-000000000009';

-- anon (no claims)
select set_config('request.jwt.claims', '', true);
select set_config('request.path', '/profile_public_directory', true);
set local role anon;
select lives_ok('select pgrst_hooks.pre_request()', 'anon: passes the hook');
reset role;

-- service_role: with a service-role JWT, and with no claims at all
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select set_config('request.path', '/profiles', true);
set local role service_role;
select lives_ok('select pgrst_hooks.pre_request()', 'service_role (service-role JWT): passes the hook - the case that failed in Production');
reset role;
select set_config('request.jwt.claims', '', true);
set local role service_role;
select lives_ok('select pgrst_hooks.pre_request()', 'service_role (no claims): passes the hook');
reset role;

-- authenticated active user
select set_config('request.jwt.claims', json_build_object('sub', (select active_user from who), 'role', 'authenticated')::text, true);
select set_config('request.path', '/profiles', true);
set local role authenticated;
select lives_ok('select pgrst_hooks.pre_request()', 'authenticated active user: passes the hook');
reset role;

-- admin
select set_config('request.jwt.claims', json_build_object('sub', (select admin_user from who), 'role', 'authenticated')::text, true);
set local role authenticated;
select lives_ok('select pgrst_hooks.pre_request()', 'admin: passes the hook');
reset role;

-- a token for a subject that is not a user row, and a malformed subject
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000aa","role":"authenticated"}', true);
set local role authenticated;
select lives_ok('select pgrst_hooks.pre_request()', 'unknown subject: passes (the data layer decides)');
reset role;
select set_config('request.jwt.claims', '{"sub":"not-a-uuid","role":"authenticated"}', true);
set local role authenticated;
select lives_ok('select pgrst_hooks.pre_request()', 'malformed subject: passes and does not crash the hook');
reset role;

-- ===========================================================================
-- E. Suspended and deactivated accounts
-- ===========================================================================
select set_config('request.jwt.claims', json_build_object('sub', (select suspended_user from who), 'role', 'authenticated')::text, true);
select set_config('request.path', '/profiles', true);
set local role authenticated;
select throws_ok('select pgrst_hooks.pre_request()', '42501', 'account suspended', 'suspended: every normal request is refused');
select set_config('request.path', '/rpc/my_account_status', true);
select lives_ok('select pgrst_hooks.pre_request()', 'suspended: my_account_status stays reachable');
reset role;

select set_config('request.jwt.claims', json_build_object('sub', (select deactivated_user from who), 'role', 'authenticated')::text, true);
select set_config('request.path', '/profiles', true);
set local role authenticated;
select throws_ok('select pgrst_hooks.pre_request()', '42501', 'account suspended', 'deactivated: every normal request is refused');
reset role;

-- a suspended account's subject never blocks anon or service_role requests
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select lives_ok('select pgrst_hooks.pre_request()', 'service_role is unaffected while accounts are suspended');
reset role;

-- ===========================================================================
-- F. Delegation: the entry point and the original hook agree, and app stays closed to service_role
-- ===========================================================================
select set_config('request.jwt.claims', json_build_object('sub', (select suspended_user from who), 'role', 'authenticated')::text, true);
select set_config('request.path', '/profiles', true);
set local role authenticated;
select throws_ok('select app.api_pre_request()', '42501', 'account suspended', 'app.api_pre_request itself still refuses a suspended account');
reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select throws_ok('select app.api_pre_request()', '42501', 'permission denied for schema app',
  'service_role still cannot reach schema app directly (no widening)');
select throws_ok('select app.organization_create_owned(''x'', ''supplier'', ''en'', null)', '42501', 'permission denied for schema app',
  'nor a SECURITY DEFINER helper such as app.organization_create_owned');
reset role;
select is((select count(*)::int from pg_proc where pronamespace = 'pgrst_hooks'::regnamespace and prosecdef), 1, 'the entry point is the only SECURITY DEFINER function in pgrst_hooks');

-- ===========================================================================
-- G. The new objects are not part of the public Data API surface
-- ===========================================================================
select ok(not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('pre_request', 'api_pre_request')),
  'no hook function is exposed in schema public (so it is not an RPC endpoint)');
select ok(not has_schema_privilege('public', 'pgrst_hooks', 'usage'), 'PUBLIC cannot use the hook schema (explicit)');
select is((select string_agg(distinct a.privilege_type, ',') from pg_namespace n, aclexplode(n.nspacl) a, pg_roles r
           where n.nspname = 'pgrst_hooks' and a.grantee = r.oid and r.rolname = 'service_role'), 'USAGE',
  'service_role holds exactly USAGE (no CREATE) on the hook schema');

select * from finish();
rollback;
