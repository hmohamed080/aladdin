-- PROPOSAL - NOT A MIGRATION. NOT APPLIED ANYWHERE. Lives outside supabase/migrations on purpose so no tool applies it by accident.
--
-- Interim mitigation for public phone-alias squatting (docs/security/PHONE_SIGNUP_R2_INTERIM_ALIAS_HOOK.md) while the R1 alias guard and the
-- R2 registration integration are not yet live. A Supabase Auth "Before User Created" hook, as a Postgres function.
--
-- WHAT IT DOES. GoTrue calls it before it creates a user through a PUBLIC path (sign-up, e-mail OTP / magic link, OAuth). It rejects (HTTP 403)
-- any e-mail on the internal alias domain, unless the user object carries a trusted registration_source. Everything else returns {} (allow).
--
-- WHY THIS IS SAFE FOR THE ACCOUNT FLOWS THAT MUST KEEP WORKING (measured, supabase/tests/r2/hook_probe.test.mjs):
--   * Admin API creation (installer / showroom / R2 phone sign-up, all service-role) does NOT invoke the hook on the tested GoTrue versions, so
--     legitimate creation cannot be blocked by it - and a hook outage cannot stop it either. The registration_source allow-list below is
--     defence in depth for a GoTrue version that does call the hook for Admin creation: a public caller cannot set app_metadata.
--   * E-mail addresses on the alias domain are never real mailboxes (".invalid"), so no legitimate e-mail or OAuth sign-up has one. Google and
--     Facebook users (including Facebook with no / unverified e-mail) never match, and an empty or missing e-mail returns {}.
--   * It does not touch existing users: sign-in, password recovery, token refresh and deletion never run a before-user-created hook.
--
-- WHAT IT DOES NOT DO (so it is NOT a substitute for R1): it does not prove possession of a number, does not consume grants, and cannot stop
-- an existing authenticated user from changing their e-mail to an alias (that needs a confirmation mailbox that cannot exist, see the doc).
-- The R1 guard (deferred trigger, 20261030090002) supersedes it; once alias_guard_mode = 'enforce' the hook can be switched off.
--
-- BLAST RADIUS (measured): the hook is consulted for EVERY public user creation. If the function errors, is missing, lacks EXECUTE for
-- supabase_auth_admin, or exceeds the hook timeout, GoTrue refuses public sign-ups of every kind until the hook is disabled. The function below
-- therefore (1) never raises, (2) does one string comparison, (3) returns {} for anything it does not recognise. Disabling the hook (dashboard or
-- Management API, one call, no deploy) is the rollback; dropping the function is NOT (it would leave the hook enabled and pointing nowhere).
--
-- APPLY ORDER (when separately approved): create the function and grants FIRST, test it, THEN enable the hook. ROLLBACK ORDER: disable the hook
-- FIRST, then (optionally) drop the function.

create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_alias boolean := false;
begin
  begin
    v_alias := lower(btrim(coalesce(event #>> '{user,email}', ''))) like '%@craftsman-login.aladdin.invalid';
    if not v_alias then
      return '{}'::jsonb;
    end if;
    -- An alias-domain e-mail: allowed only for the trusted server-side creators (they set app_metadata through the Admin API; a public
    -- caller cannot, GoTrue ignores app_metadata in a public request).
    if coalesce(event #>> '{user,app_metadata,registration_source}', '') in
         ('temporary_craftsman_password_flow', 'temporary_showroom_password_flow', 'phone_whatsapp_sign_up') then
      return '{}'::jsonb;
    end if;
  exception when others then
    -- Whatever went wrong, an alias-domain e-mail stays refused and everything else stays allowed.
    if v_alias then
      return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'This sign-up method is not available.'));
    end if;
    return '{}'::jsonb;
  end;
  return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'This sign-up method is not available.'));
end;
$$;

-- Only GoTrue's own role may call it; no API role can (it would reveal nothing, but there is no reason to expose it).
revoke all on function public.hook_before_user_created(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;

comment on function public.hook_before_user_created(jsonb) is
  'INTERIM (proposal). Auth before-user-created hook: refuses public creation of an e-mail on the internal phone-alias domain. Disable the HOOK to roll back.';

-- Enabling (NOT part of this file; separate owner approval, hosted Auth settings):
--   hook_before_user_created_enabled = true
--   hook_before_user_created_uri     = 'pg-functions://postgres/public/hook_before_user_created'
-- Local equivalent (supabase/config.toml): [auth.hook.before_user_created] enabled = true, uri = "pg-functions://postgres/public/hook_before_user_created"
