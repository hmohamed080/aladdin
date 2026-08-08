-- Migration: shared onboarding engine (Phase 2 — Sprint 7.3).
--
-- Adds the smallest coherent persistence for the ONE resumable onboarding flow
-- shared by every account type: Basic Profile -> Contact -> Account-Type -> Handoff.
--   * public.onboarding_progress — the per-step data existing tables cannot hold:
--       an UNVERIFIED phone, the selected account type + track, per-step completion
--       stamps, and the handoff timestamp. One row per user (self-owned).
--   * onboarding_save_profile / onboarding_save_contact / onboarding_select_account_type
--       — trusted, security-definer, auth.uid()-derived writers. Profile writes also
--       set profiles.display_name / users.locale in the SAME transaction. Contact
--       stores an Egyptian mobile as UNVERIFIED (no Phone/WhatsApp OTP this sprint —
--       it is never marked verified). Account-type records INTENT only; it never
--       touches users.primary_account_type (that stays gated by the trusted
--       account-upgrade/review workflow) and rejects the invitation-only path.
--   * my_registration_state() is re-created to emit the finer resumable states so
--       /onboarding can resolve the next incomplete step. No duplicate state column:
--       the state is still DERIVED (now from onboarding_progress too).
--
-- Design: docs/frontend/sprint-7-shared-onboarding-engine.md. Server-controlled
-- columns (users.status / primary_account_type) are never granted to a client.

-- ---------------------------------------------------------------------------
-- 1. onboarding_track — disambiguates the handoff family
-- ---------------------------------------------------------------------------
-- 'organization owner/manager' has no account_type enum value (it is a role via
-- org membership), so the concrete account_type can be null while the TRACK still
-- determines the terminal handoff. consumer -> consumer_onboarding_pending;
-- professional -> persona_onboarding_pending; business -> organization_setup_pending.
create type public.onboarding_track as enum ('consumer', 'professional', 'business');

-- ---------------------------------------------------------------------------
-- 2. onboarding_progress — one self-owned row per user
-- ---------------------------------------------------------------------------
create table public.onboarding_progress (
  user_id                   uuid primary key references public.users (id) on delete cascade,
  -- UNVERIFIED Egyptian mobile collected at the contact step. Never a verified
  -- channel (no OTP this sprint); stored here, not in public.contacts.
  phone                     text,
  -- Chosen at the account-type step. INTENT only — not applied to
  -- users.primary_account_type (that requires the trusted upgrade workflow).
  selected_track            public.onboarding_track,
  selected_account_type     public.account_type,
  profile_completed_at      timestamptz,
  contact_completed_at      timestamptz,
  account_type_completed_at timestamptz,
  -- Set when the handoff (/onboarding/complete) is reached.
  completed_at              timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  -- Egyptian mobile: 01 + operator digit (0/1/2/5) + 8 digits (11 total).
  constraint ck_onboarding_phone check (phone is null or phone ~ '^01[0125][0-9]{8}$'),
  -- A recorded account type is never end_consumer's "upgrade" and never the
  -- invitation-only path; consumer keeps a null concrete type.
  constraint ck_onboarding_selected_type check (
    selected_account_type is null or selected_account_type <> 'end_consumer'
  )
);
comment on table public.onboarding_progress is 'Per-user shared-onboarding progress: unverified phone, selected account-type intent + track, per-step and handoff timestamps. Self-owned; written only via the security-definer onboarding_* RPCs. Intent only — never activates an account or org.';

create trigger set_onboarding_progress_updated_at
  before update on public.onboarding_progress
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. Extend the audit action allow-list (onboarding completion is meaningful)
-- ---------------------------------------------------------------------------
alter table public.audit_log drop constraint ck_audit_action_known;
alter table public.audit_log add constraint ck_audit_action_known check (action in (
  'organization.created',
  'membership.granted', 'membership.activated', 'membership.role_changed',
  'membership.suspended', 'membership.revoked',
  'branch.created', 'branch.assignment_changed',
  'platform_role.granted', 'platform_role.revoked', 'platform.override_used',
  'account.upgrade_requested',
  'verification.review_started', 'verification.changes_requested',
  'verification.approved', 'verification.rejected',
  'account.type_changed', 'profile.listed', 'profile.hidden',
  'customer.created', 'customer.updated',
  'lead.created', 'lead.assigned', 'lead.reassigned', 'lead.stage_changed',
  'lead.won', 'lead.lost', 'lead.reopened', 'lead.archived',
  'followup.created', 'followup.reassigned', 'followup.completed', 'followup.reopened',
  'customer.reassigned', 'lead.details_changed',
  -- Sprint 7.3 — shared onboarding handoff reached.
  'onboarding.completed'
));

-- ===========================================================================
-- 4. Writers — security-definer, auth.uid()-derived, verified-email gated
-- ===========================================================================

-- Shared gate: the caller is authenticated AND their email is verified. Every
-- onboarding write requires a real verified identity (mirrors record_consent).
create or replace function app.require_verified_caller()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from auth.users au where au.id = v_uid and au.email_confirmed_at is not null
  ) then
    raise exception 'a verified email is required' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;
revoke execute on function app.require_verified_caller() from public;
grant execute on function app.require_verified_caller() to authenticated, service_role;

-- 4a. Basic Profile — display name + preferred locale. Writes the shared profile
-- and identity locale transactionally, then stamps the step. First/last name are
-- intentionally not collected (the profile model has no such columns).
create or replace function public.onboarding_save_profile(
  p_display_name text,
  p_locale       text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := app.require_verified_caller();
  v_name text := btrim(coalesce(p_display_name, ''));
  v_loc  text := case when p_locale in ('en', 'ar') then p_locale else 'en' end;
begin
  if char_length(v_name) < 1 or char_length(v_name) > 80 then
    raise exception 'display name must be 1..80 characters' using errcode = '22023';
  end if;

  update public.profiles set display_name = v_name where user_id = v_uid;
  update public.users set locale = v_loc where id = v_uid;

  insert into public.onboarding_progress (user_id, profile_completed_at)
  values (v_uid, now())
  on conflict (user_id) do update set profile_completed_at = now();
end;
$$;

-- 4b. Contact Information — an UNVERIFIED Egyptian mobile. Never a verified
-- channel; no OTP is sent. Requires the profile step first (resume ordering).
create or replace function public.onboarding_save_contact(
  p_phone text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := app.require_verified_caller();
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
begin
  if v_phone is null or v_phone !~ '^01[0125][0-9]{8}$' then
    raise exception 'a valid Egyptian mobile number is required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.onboarding_progress op
    where op.user_id = v_uid and op.profile_completed_at is not null
  ) then
    raise exception 'complete the profile step first' using errcode = '22023';
  end if;

  update public.onboarding_progress
    set phone = v_phone, contact_completed_at = now()
    where user_id = v_uid;
end;
$$;

-- 4c. Account-Type Selection — records the chosen track + concrete type (INTENT
-- only) and reaches the handoff. Never mutates users.primary_account_type and
-- never accepts the invitation-only employee path. Requires the contact step.
create or replace function public.onboarding_select_account_type(
  p_track        public.onboarding_track,
  p_account_type public.account_type default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_uid uuid := app.require_verified_caller();
begin
  if p_track is null then
    raise exception 'an onboarding track is required' using errcode = '22023';
  end if;
  -- Consumer keeps a null concrete type; every other track needs a concrete,
  -- non-consumer account type. (The invited-employee path has no enum value and
  -- so can never be recorded here — it is joined via an invitation token.)
  if p_track = 'consumer' then
    if p_account_type is not null and p_account_type <> 'end_consumer' then
      raise exception 'consumer track takes no professional/business type' using errcode = '22023';
    end if;
    p_account_type := null;
  else
    if p_account_type is null or p_account_type = 'end_consumer' then
      raise exception 'this track requires a concrete account type' using errcode = '22023';
    end if;
  end if;

  if not exists (
    select 1 from public.onboarding_progress op
    where op.user_id = v_uid and op.contact_completed_at is not null
  ) then
    raise exception 'complete the contact step first' using errcode = '22023';
  end if;

  update public.onboarding_progress
    set selected_track = p_track,
        selected_account_type = p_account_type,
        account_type_completed_at = now(),
        completed_at = now()
    where user_id = v_uid;

  perform app.record_audit_event('onboarding.completed', 'user', v_uid, null,
    jsonb_build_object('track', p_track, 'account_type', p_account_type));
end;
$$;

-- ===========================================================================
-- 5. my_registration_state — re-created with the finer resumable states
-- ===========================================================================
-- unverified | consent_pending | profile_pending | contact_pending |
-- account_type_pending | consumer_onboarding_pending | persona_onboarding_pending |
-- organization_setup_pending | invitation_pending | active_personal |
-- manually_blocked. Still DERIVED (now also from onboarding_progress) — no stored
-- state column. Active members / activated accounts short-circuit to the workspace.
create or replace function public.my_registration_state()
returns text
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_uid         uuid := (select auth.uid());
  v_confirmed   boolean;
  v_status      public.user_status;
  v_has_consent boolean;
  v_op          public.onboarding_progress;
  v_pending_mem boolean;
  v_setup_org   boolean;
begin
  if v_uid is null then
    return 'unverified';
  end if;
  select (au.email_confirmed_at is not null) into v_confirmed from auth.users au where au.id = v_uid;
  if not coalesce(v_confirmed, false) then
    return 'unverified';
  end if;

  select u.status into v_status from public.users u where u.id = v_uid;
  if v_status in ('suspended', 'deactivated') then
    return 'manually_blocked';
  end if;

  -- Operational identities skip onboarding entirely.
  if exists (select 1 from public.memberships m where m.user_id = v_uid and m.status = 'active')
     or v_status = 'active' then
    return 'active_personal';
  end if;

  -- All three required consents at their CURRENT versions.
  select count(distinct cr.consent_type) = 3 into v_has_consent
  from public.consent_receipts cr
  where cr.user_id = v_uid
    and cr.consent_type in ('terms', 'privacy', 'pilot')
    and cr.version = app.current_consent_version(cr.consent_type);
  if not coalesce(v_has_consent, false) then
    return 'consent_pending';
  end if;

  -- Walk the shared onboarding steps in order.
  select * into v_op from public.onboarding_progress where user_id = v_uid;
  if v_op.profile_completed_at is null then
    return 'profile_pending';
  end if;
  if v_op.contact_completed_at is null then
    return 'contact_pending';
  end if;
  if v_op.account_type_completed_at is null then
    return 'account_type_pending';
  end if;

  -- Handoff reached — the terminal state depends on the chosen track.
  if v_op.selected_track = 'consumer' then
    return 'consumer_onboarding_pending';
  elsif v_op.selected_track = 'professional' then
    return 'persona_onboarding_pending';
  elsif v_op.selected_track = 'business' then
    return 'organization_setup_pending';
  end if;

  -- Fallbacks: a still-pending invitation, or a draft org the user created.
  select exists (
    select 1 from public.memberships m where m.user_id = v_uid and m.status = 'invited'
  ) into v_pending_mem;
  if v_pending_mem then
    return 'invitation_pending';
  end if;
  select exists (
    select 1 from public.organizations o
    where o.created_by = v_uid and o.status in ('draft', 'pending_verification') and o.deleted_at is null
  ) into v_setup_org;
  if v_setup_org then
    return 'organization_setup_pending';
  end if;

  return 'account_type_pending';
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. RLS — self read; writes only via the security-definer RPCs
-- ---------------------------------------------------------------------------
alter table public.onboarding_progress enable row level security;

create policy onboarding_progress_select_self on public.onboarding_progress
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 7. Grants (deny-by-default; strip Supabase defaults first)
-- ---------------------------------------------------------------------------
revoke all on public.onboarding_progress from anon, authenticated, service_role;
grant select on public.onboarding_progress to authenticated;
grant select, insert, update on public.onboarding_progress to service_role;

revoke execute on function public.onboarding_save_profile(text, text) from public;
revoke execute on function public.onboarding_save_contact(text) from public;
revoke execute on function public.onboarding_select_account_type(public.onboarding_track, public.account_type) from public;
grant execute on function public.onboarding_save_profile(text, text) to authenticated;
grant execute on function public.onboarding_save_contact(text) to authenticated;
grant execute on function public.onboarding_select_account_type(public.onboarding_track, public.account_type) to authenticated;
