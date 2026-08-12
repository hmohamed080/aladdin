-- Migration: decouple PERSONAL persona from BUSINESS classification
-- (Pilot Account & Workspace Model, Sprint 12).
--
-- ONE PERSON = ONE USER ID. A business is an Organization; a Membership links the
-- two. This migration removes the last place where the two were conflated:
-- `public.users.primary_account_type`.
--
--   CANONICAL AFTER THIS MIGRATION
--     users.primary_account_type  -> PERSONAL persona state only, and NULLABLE:
--                                    a business-only identity legitimately has
--                                    NO personal persona.
--     organizations.org_type      -> BUSINESS classification, the only source.
--
-- The column was `not null default 'end_consumer'`, so the schema could not even
-- REPRESENT "this identity has no personal persona" — a business owner was forced
-- to carry a fake consumer persona, or (worse) their org type was mirrored onto
-- their identity. Both are now impossible.
--
-- What this migration does NOT do: it never infers a personal persona from an
-- organization's type, never creates or removes a user, an organization, a
-- membership, a branch, a capability, or any commercial/CRM row. The backfill in
-- section 3 only ever CLEARS a business-valued persona (or restores an explicitly
-- recorded personal one) and is idempotent — re-running it is a no-op because no
-- business-valued persona survives the first run.
--
-- Design: docs/product/PRODUCT_DIRECTION_GUIDE.md (account/organization/workspace
-- model), docs/architecture/ARCHITECTURE_GUIDE.md.

-- ---------------------------------------------------------------------------
-- 1. users.primary_account_type — personal persona, now optional
-- ---------------------------------------------------------------------------
-- Dropping the DEFAULT matters as much as dropping NOT NULL: `app.handle_new_user`
-- inserts without the column, so every new identity previously started life as an
-- `end_consumer` whether or not the person ever claimed that persona. A persona is
-- now recorded only when the person actually selects one.
alter table public.users
  alter column primary_account_type drop not null,
  alter column primary_account_type drop default;

comment on column public.users.primary_account_type is
  'PERSONAL persona only (Consumer / Engineer / Interior Designer / Installer / Contractor / Salesperson ...). NULL = a valid business-only identity with no personal persona. Business classification lives ONLY in organizations.org_type and is NEVER mirrored here. Server-controlled: written only by the approved upgrade/review workflow or a personal onboarding terminal.';

-- ---------------------------------------------------------------------------
-- 2. app.has_personal_persona — is there a usable Personal workspace?
-- ---------------------------------------------------------------------------
-- The Personal work context exists only when the person has EXPLICITLY claimed a
-- personal identity. Three explicit signals, in decreasing strength; none of them
-- looks at an organization:
--   a. a canonical persona has been applied to the identity;
--   b. a personal onboarding terminal was reached (consumer finished / professional
--      submitted) — the professional's canonical persona is still null until an
--      Admin approves, but the person is unambiguously a personal professional;
--   c. a personal onboarding TRACK was selected (mid-flow but already claimed).
create or replace function app.has_personal_persona(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.users u
    where u.id = p_uid and u.primary_account_type is not null
  ) or exists (
    select 1 from public.individual_onboarding io
    where io.user_id = p_uid
      and (io.consumer_completed_at is not null or io.professional_completed_at is not null)
  ) or exists (
    select 1 from public.onboarding_progress op
    where op.user_id = p_uid and op.selected_track in ('consumer', 'professional')
  );
$$;
comment on function app.has_personal_persona(uuid) is
  'True when the identity has an EXPLICIT personal persona (canonical type, a reached personal onboarding terminal, or a selected personal track). Never inferred from an organization — a business-only identity returns false and must not be shown a Personal workspace.';
revoke execute on function app.has_personal_persona(uuid) from public;
grant execute on function app.has_personal_persona(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Backfill — release identities carrying a BUSINESS classification
-- ---------------------------------------------------------------------------
-- Existing seeded/legacy owners keep their user id, auth identity, organizations,
-- memberships, branches, capabilities and commercial history untouched. Only the
-- mis-typed personal persona column is corrected.
--
-- 3a. Restore an EXPLICIT personal persona where one was independently recorded.
--     `individual_onboarding.prof_concrete_type` is the person's own declaration of
--     their individual professional identity, made in the personal track — it is
--     unambiguous and has nothing to do with any organization. Only personal
--     professional types qualify (a business value there would be the same bug).
update public.users u
   set primary_account_type = io.prof_concrete_type
  from public.individual_onboarding io
 where io.user_id = u.id
   and u.primary_account_type in
       ('showroom_dealer', 'supplier', 'manufacturer', 'importer', 'wholesaler')
   and io.prof_concrete_type in
       ('engineer', 'interior_designer', 'installer_technician', 'contractor', 'sales',
        'trainer', 'trainee');

-- 3b. Everyone else with a business-valued persona becomes a valid BUSINESS-ONLY
--     identity: no personal persona at all. We deliberately do NOT guess one from
--     organizations.org_type — that is exactly the coupling being removed.
update public.users u
   set primary_account_type = null
 where u.primary_account_type in
       ('showroom_dealer', 'supplier', 'manufacturer', 'importer', 'wholesaler');

-- ---------------------------------------------------------------------------
-- 4. profile_public_directory — explicit about the personaless identity
-- ---------------------------------------------------------------------------
-- A business-only identity has no personal professional profile to discover, so it
-- must never surface here. `null <> 'end_consumer'` already evaluates to NULL (and
-- therefore filters the row out), but the intent is load-bearing enough to state.
-- Column set and every other eligibility rule are unchanged.
create or replace view public.profile_public_directory
  with (security_invoker = false) as
  select p.id, p.display_name, p.headline, p.bio,
         p.avatar_media_id, p.locality_id, p.languages
  from public.profiles p
  join public.users u on u.id = p.user_id
  where p.deleted_at is null
    and p.public_profile_status = 'listed'
    and u.status = 'active'
    and u.primary_account_type is not null
    and u.primary_account_type <> 'end_consumer';
comment on view public.profile_public_directory is 'Approved PUBLIC projection of PERSONAL professional profiles for B2C discovery. Requires public_profile_status = listed (server-controlled) AND an explicit personal professional persona AND active AND not deleted. A business-only identity (null persona) is never listed here — businesses are discovered through organization_public_directory. Only display columns; never user_id/timestamps/deleted_at.';

-- ---------------------------------------------------------------------------
-- 5. request_account_upgrade — null-safe, and personal-personas only
-- ---------------------------------------------------------------------------
-- Two corrections, both consequences of section 1:
--   * the "no identity row" guard tested the VALUE, so a business-only identity
--     (null persona) would have been told it has no identity row at all;
--   * a BUSINESS classification must never be applied to a person. The upgrade
--     workflow writes users.primary_account_type on approval, so business values
--     are rejected at the door — a business is created as an Organization instead.
-- Everything else (one open request per user, idempotent re-request, conflict on a
-- different open target, audit emission) is the Sprint 2 logic unchanged.
create or replace function public.request_account_upgrade(
  p_requested_account_type public.account_type
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_current public.account_type;
  v_id      uuid;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_requested_account_type = 'end_consumer' then
    raise exception 'cannot upgrade to end_consumer';
  end if;
  if p_requested_account_type in
     ('showroom_dealer', 'supplier', 'manufacturer', 'importer', 'wholesaler') then
    raise exception 'a business classification belongs to an organization, not a person'
      using errcode = '22023';
  end if;
  if not exists (select 1 from public.users u where u.id = v_uid) then
    raise exception 'no identity row for caller' using errcode = '42501';
  end if;
  select u.primary_account_type into v_current from public.users u where u.id = v_uid;
  if v_current is not distinct from p_requested_account_type then
    raise exception 'account is already of the requested type';
  end if;

  insert into public.verifications
    (subject_type, user_id, verification_type, requested_account_type, status, submitted_at)
  values ('user', v_uid, 'professional', p_requested_account_type, 'submitted', now())
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    select v.id into v_id from public.verifications v
    where v.subject_type = 'user' and v.user_id = v_uid
      and v.status in ('draft','submitted','under_review','needs_more_info');
    if (select v.requested_account_type from public.verifications v where v.id = v_id)
         is distinct from p_requested_account_type then
      raise exception 'an open upgrade request already exists for a different account type'
        using errcode = '23505';
    end if;
    return v_id;
  end if;

  perform app.record_audit_event('account.upgrade_requested', 'user', v_uid, null,
    jsonb_build_object('requested_account_type', p_requested_account_type));
  return v_id;
end;
$$;
revoke execute on function public.request_account_upgrade(public.account_type) from public;
grant execute on function public.request_account_upgrade(public.account_type) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. individual_complete_consumer — make the consumer persona EXPLICIT
-- ---------------------------------------------------------------------------
-- With the column default gone, a consumer is no longer a consumer by accident of
-- the schema. Finishing consumer onboarding now RECORDS the persona (only when the
-- identity has none — an approved professional persona is never overwritten).
-- Activation behaviour is byte-for-byte the Pilot UAT round 1 logic.
create or replace function public.individual_complete_consumer()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := app.require_verified_caller();
  v_track public.onboarding_track := app.onboarding_selected_track(v_uid);
begin
  if v_track is distinct from 'consumer' then
    raise exception 'consumer onboarding requires the consumer track' using errcode = '42501';
  end if;

  insert into public.individual_onboarding (user_id, consumer_completed_at)
  values (v_uid, now())
  on conflict (user_id) do update set consumer_completed_at = coalesce(public.individual_onboarding.consumer_completed_at, now());

  -- The consumer persona is a real, explicitly claimed personal identity.
  update public.users
     set primary_account_type = 'end_consumer'
   where id = v_uid and primary_account_type is null;

  -- consumer_onboarding_complete is a USABLE terminal state.
  perform app.activate_personal_account(v_uid);

  perform app.record_audit_event('onboarding.consumer_completed', 'user', v_uid, null, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. my_workspaces — the one trusted read behind the workspace switcher
-- ---------------------------------------------------------------------------
-- A WORKSPACE IS DERIVED, never stored: Personal = User + Profile, Business =
-- Organization + active Membership. There is deliberately no `workspaces` table.
--
-- This returns exactly the contexts the CALLER may work in, ordered Personal
-- first. It is a convenience projection, NOT an authorization source: selecting a
-- workspace grants nothing — every subsequent read/write still re-checks
-- authentication, active membership, capability, branch scope and RLS. A
-- suspended/revoked membership simply stops being returned here, and the request
-- it would have scoped is denied independently.
create or replace function public.my_workspaces()
returns table (
  kind            text,
  organization_id uuid,
  name            text,
  org_type        public.account_type,
  relationship    text
)
language sql
stable
security definer
set search_path = ''
as $$
  -- Personal: only when a personal persona was explicitly claimed.
  select 'personal'::text,
         null::uuid,
         coalesce(p.display_name, ''),
         u.primary_account_type,
         null::text
  from public.users u
  left join public.profiles p on p.user_id = u.id and p.deleted_at is null
  where u.id = (select auth.uid())
    and app.has_personal_persona(u.id)
  union all
  -- Business: every organization with an ACTIVE membership for this caller.
  -- "Owner" is a RELATIONSHIP derived from the membership's capabilities, never a
  -- business or account type.
  select 'business'::text,
         o.id,
         o.name,
         o.org_type,
         case
           when exists (
             select 1 from public.membership_capabilities c
             where c.membership_id = m.id and c.capability_key = 'org.manage'
           ) then 'owner'
           when exists (
             select 1 from public.membership_capabilities c
             where c.membership_id = m.id and c.capability_key = 'org.members.manage'
           ) then 'manager'
           else 'member'
         end
  from public.memberships m
  join public.organizations o on o.id = m.organization_id
  where m.user_id = (select auth.uid())
    and m.status = 'active'
    and o.deleted_at is null
  order by 1 desc, 3;   -- 'personal' > 'business' alphabetically, so desc puts Personal first
$$;
comment on function public.my_workspaces() is 'The caller''s derived work contexts: the Personal context (only when a personal persona was explicitly claimed) plus every organization with an ACTIVE membership. Convenience projection only — selecting a workspace is NOT an authorization decision; membership, capability, branch scope and RLS are re-checked on every request.';
revoke execute on function public.my_workspaces() from public;
grant execute on function public.my_workspaces() to authenticated, service_role;
