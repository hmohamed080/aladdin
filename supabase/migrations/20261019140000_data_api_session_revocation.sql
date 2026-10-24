-- Session revocation on the Data API: a signed-out, revoked, banned or deleted
-- session is refused on its next request instead of at token expiry.
--
-- Before: PostgREST accepted any validly signed access token until `exp` (jwt_expiry,
-- 3600 s). Signing out everywhere, an admin ban or an account deletion removed the
-- session in Auth, but the already-issued JWT kept reading and writing through RLS
-- for up to an hour. Only the admin surfaces (network `getUser()`) and the media
-- Worker (media_edge_authorize) checked the session itself.
--
-- After: the existing db_pre_request hook (app.api_pre_request, reached through
-- pgrst_hooks.pre_request) also asks `app.jwt_session_is_live()`: the token's
-- `session_id` must still exist in auth.sessions for the same user, not be past its
-- `not_after`, and the user must be neither deleted nor banned. It is the same rule
-- media_edge_authorize already applies (20261019100000). One primary-key lookup per
-- request, inside the hook that already runs on every request.
--
-- `my_account_status` stays reachable, as for suspension, and now reports
-- `session_active`, so the app can send a revoked session to Sign In instead of
-- rendering a page whose every query fails.
--
-- A token without a `session_id` claim (none is issued by Supabase Auth today) is
-- judged by suspension alone, exactly as before. anon and service_role are untouched.
--
-- Rollback: re-create app.api_pre_request() and public.my_account_status() from
-- 20260930100002, then `drop function app.jwt_session_is_live()`.

create or replace function app.jwt_session_is_live()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_claims  jsonb;
  v_sub     uuid;
  v_session uuid;
begin
  v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  if v_claims is null or v_claims ->> 'role' is distinct from 'authenticated' then
    return true;  -- not a user session: nothing to revoke
  end if;
  begin
    v_sub := (v_claims ->> 'sub')::uuid;
    v_session := (v_claims ->> 'session_id')::uuid;
  exception when others then
    return false;  -- a malformed user claim is never live
  end;
  if v_sub is null then
    return false;
  end if;
  if v_session is null then
    return true;   -- no session claim to check; suspension still applies
  end if;
  -- Sign-out (any scope) deletes the session row; bans and deletion end it too.
  return exists (
    select 1
      from auth.sessions s
      join auth.users u on u.id = s.user_id
     where s.id = v_session
       and s.user_id = v_sub
       and (s.not_after is null or s.not_after > now())
       and u.deleted_at is null
       and (u.banned_until is null or u.banned_until <= now()));
end;
$$;
comment on function app.jwt_session_is_live() is
  'True unless the request carries an authenticated JWT whose session was signed out, revoked, expired (not_after), banned or deleted. Used by the db_pre_request hook and my_account_status.';
revoke execute on function app.jwt_session_is_live() from public, anon, authenticated, service_role;

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
end;
$$;
comment on function app.api_pre_request() is
  'PostgREST db_pre_request hook (Admin Core 1B-B, PD-010): refuses every Data API request made by a revoked session (app.jwt_session_is_live) or a suspended/deactivated account, except my_account_status. No effect for anon/service_role.';

create or replace function public.my_account_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'status', u.status,
    'suspended', u.status in ('suspended', 'deactivated'),
    'session_active', app.jwt_session_is_live())
  from public.users u where u.id = (select auth.uid());
$$;
