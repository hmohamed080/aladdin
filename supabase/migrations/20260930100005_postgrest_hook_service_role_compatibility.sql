-- ===========================================================================
-- Forward fix for 20260930100002: make the PostgREST pre-request hook callable by
-- EVERY role PostgREST switches to, WITHOUT widening access to schema `app`.
--
-- WHAT WENT WRONG. 20260930100002 set `pgrst.db_pre_request = app.api_pre_request`.
-- PostgREST runs that function AFTER switching to the request role (anon,
-- authenticated or service_role), so the role needs USAGE on the function's schema
-- just to resolve its name. anon and authenticated hold USAGE on `app`;
-- service_role deliberately does NOT. Every request made with the service-role key
-- therefore failed with `permission denied for schema app` (installer phone
-- sign-up pre-check, pending-registration staging). The 20260930100002 pgTAP file
-- called the function directly, as a role that has `app` USAGE, so it could not see this.
--
-- WHY NOT `GRANT USAGE ON SCHEMA app TO service_role`. service_role can already EXECUTE
-- 37 of the 130 `app` functions (24 explicit grants, 13 via the default PUBLIC grant),
-- including SECURITY DEFINER helpers (organization_create_owned, require_verified_caller,
-- onboarding_selected_track, ...). Today they are unreachable only because the schema is
-- closed to it. A schema-wide USAGE grant would open all 37 for the sake of one function.
--
-- THE FIX. The hook entry point moves to its own schema, `pgrst_hooks`, that holds exactly
-- ONE function and nothing else (no table, view, type or other function). That schema, and
-- only that schema, gets USAGE for anon, authenticated and service_role. The entry point is
-- SECURITY DEFINER (owner postgres) and delegates to the unchanged, already-tested
-- app.api_pre_request(), which keeps its existing grants. Schema `app` is untouched:
-- service_role still has no USAGE on it.
--
-- This migration also (re)points the role setting at the new entry point and reloads
-- PostgREST's config. APPLYING IT TO A DATABASE ACTIVATES THE HOOK: apply it to Production
-- only as a controlled step with real anon / authenticated / admin / service_role
-- requests ready to verify and the documented rollback at hand
-- (alter role authenticator reset pgrst.db_pre_request; notify pgrst, 'reload config';).
-- ===========================================================================

create schema if not exists pgrst_hooks;
comment on schema pgrst_hooks is
  'PostgREST hook entry points ONLY. Holds exactly one function (pre_request) so every request role can resolve the db_pre_request hook without any access to schema app. Never add tables, views or other functions here.';
revoke all on schema pgrst_hooks from public;
grant usage on schema pgrst_hooks to anon, authenticated, service_role;

create or replace function pgrst_hooks.pre_request()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- All logic stays in app.api_pre_request() (refuses suspended/deactivated accounts on
  -- every Data API request except my_account_status; no effect for anon/service_role).
  perform app.api_pre_request();
end;
$$;
revoke all on function pgrst_hooks.pre_request() from public;
grant execute on function pgrst_hooks.pre_request() to anon, authenticated, service_role;
comment on function pgrst_hooks.pre_request() is
  'PostgREST db_pre_request entry point. Delegates to app.api_pre_request() as the function owner, so callers need no access to schema app. Refuses suspended/deactivated accounts; passes anon and service_role.';

alter role authenticator set pgrst.db_pre_request to 'pgrst_hooks.pre_request';
notify pgrst, 'reload config';
