-- =============================================================================
-- Public directory hardening — resolve the Supabase Security Advisor
-- "Security Definer View" findings for:
--   * public.organization_public_directory
--   * public.profile_public_directory
--
-- Both were created `with (security_invoker = false)` (identity_core /
-- organizations_tenancy migrations). A definer view runs the underlying query
-- with the VIEW OWNER's rights, which is exactly what Advisor rule 0010
-- flags. We must clear the finding WITHOUT weakening the boundary.
--
-- WHY NOT a blind `security_invoker = true`:
--   anon holds NO grant on the base tables (profiles/users/organizations) — that
--   is deliberate; public discovery is the ONLY anon-facing path. Flipping the
--   views to invoker would (a) break anon discovery entirely, and (b) "fixing"
--   it by granting anon direct base-table SELECT would broaden the anon-facing
--   surface on sensitive tenant/identity tables (enumeration, private columns).
--
-- SELECTED DESIGN (Option C, surfaced through an invoker view):
--   Move the privileged read into a constrained SECURITY DEFINER function in the
--   NON-exposed `app` schema (pinned empty search_path, schema-qualified, PUBLIC
--   execute revoked). The public relation stays a VIEW — now
--   `security_invoker = true` — whose body only calls that function. Result:
--     * the views are no longer definer views  -> Advisor finding cleared;
--     * anon still needs ZERO base-table grants -> no surface broadened;
--     * the relation + exact column set are preserved -> the Data API path and
--       every existing pgTAP assertion keep working;
--     * eligibility (listed / active / verified / not-deleted / professional)
--       is unchanged — enforced inside the function, identical to before.
--
-- Forward-only. Deterministic under a clean reset (the base migrations create the
-- definer views first; this migration replaces them).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Constrained SECURITY DEFINER readers (internal, `app` schema — NOT exposed
--    to the Data API; callable only because the invoker views hold EXECUTE).
--    Every reference is schema-qualified and search_path is pinned empty so the
--    body cannot be redirected. They read the base tables with the owner's
--    rights (owner is RLS-exempt) and apply the approved eligibility filter —
--    the same projection the definer views produced, nothing more.
-- ---------------------------------------------------------------------------

create or replace function app._organization_public_directory()
returns table (
  id             uuid,
  name           text,
  slug           text,
  org_type       public.account_type,
  is_verified    boolean,
  primary_locale text,
  locality_id    uuid,
  logo_media_id  uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.name, o.slug, o.org_type, o.is_verified,
         o.primary_locale, o.locality_id, o.logo_media_id
  from public.organizations o
  where o.status = 'active'::public.org_status
    and o.is_verified
    and o.deleted_at is null;
$$;
comment on function app._organization_public_directory() is
  'Internal SECURITY DEFINER reader backing public.organization_public_directory. Returns ONLY approved public columns of active, verified, non-deleted organizations. Not in an exposed schema; PUBLIC execute revoked. See 20260805100000 hardening.';

create or replace function app._profile_public_directory()
returns table (
  id              uuid,
  display_name    text,
  headline        text,
  bio             text,
  avatar_media_id uuid,
  locality_id     uuid,
  languages       text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.display_name, p.headline, p.bio,
         p.avatar_media_id, p.locality_id, p.languages
  from public.profiles p
  join public.users u on u.id = p.user_id
  where p.deleted_at is null
    and p.public_profile_status = 'listed'::public.public_profile_status
    and u.status = 'active'::public.user_status
    and u.primary_account_type <> 'end_consumer'::public.account_type;
$$;
comment on function app._profile_public_directory() is
  'Internal SECURITY DEFINER reader backing public.profile_public_directory. Returns ONLY approved display columns of listed, active, non-deleted professional profiles (never user_id/contacts/timestamps/verification). Not in an exposed schema; PUBLIC execute revoked. See 20260805100000 hardening.';

-- Lock down execution: remove the default PUBLIC execute, then grant only the
-- roles the invoker views run as. The functions still never reach the Data API
-- directly (the `app` schema is not exposed).
revoke execute on function app._organization_public_directory() from public;
revoke execute on function app._profile_public_directory()      from public;
grant  execute on function app._organization_public_directory() to anon, authenticated, service_role;
grant  execute on function app._profile_public_directory()      to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Replace the definer views with security_invoker views over the readers.
--    Same schema, same relation name, same column set/order -> the Data API
--    path and existing pgTAP assertions are unchanged. security_invoker = true
--    clears Advisor rule 0010; the view body references ONLY the function, so
--    the caller needs execute on the function (granted) — never base-table
--    access.
-- ---------------------------------------------------------------------------

drop view if exists public.organization_public_directory;
create view public.organization_public_directory
  with (security_invoker = true) as
  select id, name, slug, org_type, is_verified, primary_locale, locality_id, logo_media_id
  from app._organization_public_directory();
comment on view public.organization_public_directory is
  'Approved PUBLIC projection of organizations for B2C discovery. security_invoker=true view over the constrained SECURITY DEFINER reader app._organization_public_directory() (Advisor hardening 20260805100000). Only public columns; never created_by/status/deleted_at/timestamps. The base organizations table stays private (member/platform only).';

drop view if exists public.profile_public_directory;
create view public.profile_public_directory
  with (security_invoker = true) as
  select id, display_name, headline, bio, avatar_media_id, locality_id, languages
  from app._profile_public_directory();
comment on view public.profile_public_directory is
  'Approved PUBLIC projection of professional profiles for B2C discovery. security_invoker=true view over the constrained SECURITY DEFINER reader app._profile_public_directory() (Advisor hardening 20260805100000). Requires listed + active + not-deleted + professional account type. Only display columns; never user_id/timestamps/deleted_at. The base profiles table stays private.';

-- ---------------------------------------------------------------------------
-- 3. Directory-object grants: strip Supabase's default TRUNCATE/REFERENCES/
--    TRIGGER (re-applied when the view is recreated) and grant back ONLY SELECT.
--    This also fixes the pre-existing untidy grants on these objects.
-- ---------------------------------------------------------------------------
revoke all on public.organization_public_directory from anon, authenticated, service_role;
revoke all on public.profile_public_directory      from anon, authenticated, service_role;
grant select on public.organization_public_directory to anon, authenticated, service_role;
grant select on public.profile_public_directory      to anon, authenticated, service_role;
