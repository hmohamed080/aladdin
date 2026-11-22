-- ADR-0031: the DATABASE enforces registration, not only the UI.
--
-- FINDING (2026-11-22, local probe): app.api_pre_request refused only revoked sessions and suspended/deactivated accounts.
-- An account whose registration was NOT finished (email not confirmed, consent not given, account type not chosen) could
-- call state-changing Data API endpoints directly: e.g. avatar_request_upload succeeded, and a direct INSERT into
-- public.organizations succeeded. Only the UI redirected such an account to onboarding.
--
-- WHAT THIS DOES. app.api_pre_request (PostgREST db_pre_request, runs for every Data API request) now also refuses, with
-- 42501 / hint 'registration_incomplete', a STATE-CHANGING request from an authenticated account whose registration state
-- (app.admin_user_registration_state, the same branch order as public.my_registration_state) is unverified,
-- consent_pending or account_type_pending. Refused:
--   * any non-GET/HEAD request on a table or view (POST / PATCH / PUT / DELETE on /<relation>);
--   * a call to a VOLATILE public function (/rpc/<name>), unless the name is in the sign-up allowlist below.
-- Always allowed: reads (GET/HEAD); STABLE / IMMUTABLE functions (they cannot write); functions the anon role may execute
-- (they are public by definition); the sign-up steps themselves (allowlist); my_account_status (unchanged exemption).
-- The RPC branch FAILS CLOSED: an unknown function name, or any schema other than public (Content-Profile, e.g. graphql_public),
-- is refused for an unfinished registration.
-- Accounts that are access_ready or active_personal (active membership or users.status = 'active') are unaffected, so staff
-- and existing active members behave exactly as before. anon and service_role are not touched (the hook returns early).
--
-- FAIL-OPEN NOTE. If PostgREST does not provide request.method the registration gate is skipped (revoked/suspended checks
-- still run). PostgREST sets it; the owner's post-apply smoke test must confirm a refusal (see the Acceptance gate plan).
--
-- NOT CHANGED: my_registration_state, users.status, RLS policies, any RPC, any grant. Rollout/rollback: CREATE OR REPLACE
-- app.api_pre_request again with the definition from 20261021090013 (forward-fix, never a down migration).

create or replace function app.registration_gate_allows(p_method text, p_path text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_fn      text;
  v_profile text;
begin
  -- Reads never change state (RLS still applies as before).
  if upper(coalesce(p_method, '')) in ('GET', 'HEAD', 'OPTIONS') then
    return true;
  end if;
  if p_path is null or p_path = '' then
    return false;
  end if;
  if p_path like '/rpc/%' then
    v_fn := substr(p_path, 6);
    -- Sign-up steps an incomplete account must be able to take.
    if v_fn in (
      'record_consent', 'onboarding_select_account_type', 'onboarding_save_contact', 'onboarding_save_profile',
      'pending_registration_consume', 'profile_set_display_name', 'profile_set_phone', 'profile_set_username',
      'account_password_confirm', 'identity_password_change_audit', 'identity_password_change_authorize',
      'installer_phone_change_begin', 'installer_phone_change_settle', 'installer_phone_change_status',
      -- Invitation acceptance runs while registration is still unfinished (a new staff invitee deliberately has no account type
      -- until they accept; a member invitation hands off to onboarding). Both authenticate by token + confirmed email match.
      'staff_invitation_accept', 'invitation_accept',
      'my_account_status') then
      return true;
    end if;
    -- Only the public schema is available to an unfinished registration: PostgREST also exposes graphql_public (pg_graphql
    -- mutations) and selects the schema from the Content-Profile header, so any other schema is refused.
    v_profile := nullif(btrim(coalesce(nullif(current_setting('request.headers', true), '')::jsonb ->> 'content-profile', '')), '');
    if v_profile is not null and v_profile <> 'public' then
      return false;
    end if;
    -- Fail closed: allowed only when the name resolves to an existing function that cannot write (stable / immutable) or
    -- that the anon role may execute (public by definition). Unknown names are refused (403 instead of PostgREST's 404).
    -- Worst case over ALL overloads of the name (PostgREST picks the overload from the arguments): at least one must exist and
    -- none may be volatile and non-public.
    return exists (
             select 1 from pg_catalog.pg_proc p
             join pg_catalog.pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = v_fn and p.prokind = 'f')
       and not exists (
             select 1 from pg_catalog.pg_proc p
             join pg_catalog.pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = v_fn and p.prokind = 'f'
               and p.provolatile = 'v' and not pg_catalog.has_function_privilege('anon', p.oid, 'execute'));
  end if;
  -- Any other non-read request is a table/view write.
  return false;
end;
$$;
comment on function app.registration_gate_allows(text, text) is
  'ADR-0031: whether an account with an unfinished registration may make this Data API request. Reads, read-only and public functions and the sign-up steps are allowed; table writes and other volatile functions are not.';
revoke all on function app.registration_gate_allows(text, text) from public, anon, authenticated, service_role;

create or replace function app.api_pre_request()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_claims jsonb;
  v_sub    uuid;
  v_method text;
begin
  v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  if v_claims is null or v_claims ->> 'role' is distinct from 'authenticated' then
    return;
  end if;
  begin
    v_sub := (v_claims ->> 'sub')::uuid;
  exception when others then
    return;
  end;
  if v_sub is null or coalesce(current_setting('request.path', true), '') = '/rpc/my_account_status' then
    return;
  end if;
  if not app.jwt_session_is_live() then
    raise exception 'session revoked' using errcode = '42501', hint = 'session_revoked';
  end if;
  if exists (select 1 from public.users u where u.id = v_sub and u.status in ('suspended', 'deactivated')) then
    raise exception 'account suspended' using errcode = '42501', hint = 'account_suspended';
  end if;

  -- ADR-0031: an unfinished registration may not change state outside the sign-up steps.
  v_method := nullif(current_setting('request.method', true), '');
  if v_method is not null and upper(v_method) not in ('GET', 'HEAD', 'OPTIONS') then
    -- Cheap path first: an active membership or users.status = 'active' (staff, existing members) is never incomplete.
    if not exists (select 1 from public.memberships m where m.user_id = v_sub and m.status = 'active')
       and not exists (select 1 from public.users u where u.id = v_sub and u.status = 'active')
       and app.admin_user_registration_state(v_sub) in ('unverified', 'consent_pending', 'account_type_pending')
       and not app.registration_gate_allows(v_method, coalesce(current_setting('request.path', true), '')) then
      raise exception 'registration incomplete' using errcode = '42501', hint = 'registration_incomplete';
    end if;
  end if;
end;
$$;
comment on function app.api_pre_request() is
  'PostgREST db_pre_request hook (Admin Core 1B-B, PD-010; ADR-0031): refuses every Data API request made by a revoked session or a suspended/deactivated account (except my_account_status), and state-changing requests from an account whose registration is unfinished (except the sign-up steps, reads, read-only and public functions). No effect for anon/service_role.';
