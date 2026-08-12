-- Migration: personal account activation + generic owner/manager entry (Pilot UAT round 1).
--
-- Two product corrections found during manual Pilot testing. Both are behaviour
-- fixes on EXISTING functions — no new table, no new review system, no new
-- permission model.
--
-- 1. ACTIVATION IS NOT VERIFICATION.
--    Until now a personal (organization-less) account could only ever reach
--    `active_personal` through an ACTIVE ORG MEMBERSHIP, because nothing set
--    `public.users.status = 'active'`. A consumer who finished consumer
--    onboarding, and a professional who submitted their profile, therefore stayed
--    in a terminal onboarding/review screen forever: the account was never usable
--    and an Admin approval was the de-facto activation mechanism.
--
--    Corrected model: finishing onboarding ACTIVATES the personal account.
--    Verification stays a completely independent TRUST state on the existing
--    `public.verifications` row (not_verified / submitted / under_review /
--    needs_more_info / approved / rejected). The professional submission still
--    hands off to `public.request_account_upgrade`, so the Admin queue,
--    `review_*`, `apply_account_upgrade`, the audit trail, and the rule that
--    `users.primary_account_type` + `profiles.public_profile_status = 'listed'`
--    change ONLY on an approved+applied review are all unchanged. Approval adds
--    trust (and the canonical account type); it no longer grants access.
--
-- 2. "ORGANIZATION OWNER / MANAGER" IS NOT A BUSINESS TYPE.
--    `onboarding_select_account_type` demanded a concrete `account_type` for every
--    non-consumer track, so the generic owner/manager choice — which deliberately
--    carries NO concrete type (the real organization type is chosen later, during
--    business onboarding) — always raised and surfaced as "Unable to save. Try
--    again." The business track now accepts a null concrete type, exactly as the
--    `onboarding_progress` table comment already documented.
--
-- Both writers stay security definer, auth.uid()-derived, verified-email gated and
-- search_path-pinned. No grant, RLS policy, or table shape changes.

-- ===========================================================================
-- 1. app.activate_personal_account — the ONLY personal activation path
-- ===========================================================================
-- Flips a pending identity to `active` so `my_registration_state()` resolves to
-- `active_personal` and the caller reaches their derived landing. Internal
-- (definer-only): reached solely from the onboarding terminals below, never from
-- a client, so `users.status` remains server-controlled. Deliberately narrow —
-- it only ever promotes `pending_verification`, so a suspended or deactivated
-- account can never be revived by re-running onboarding.
create or replace function app.activate_personal_account(p_uid uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.users
     set status = 'active'
   where id = p_uid
     and status = 'pending_verification';
$$;
revoke execute on function app.activate_personal_account(uuid) from public;
comment on function app.activate_personal_account(uuid) is 'Internal: promote a pending personal identity to active when onboarding completes. Activation is independent of verification — an approved verification adds trust/account type, it never grants access.';

-- ===========================================================================
-- 2. individual_complete_consumer — completion now ACTIVATES the account
-- ===========================================================================
-- Unchanged except for the activation call: consumer onboarding is fully
-- skippable, so reaching the terminal is enough to make /home usable.
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

  -- consumer_onboarding_complete is a USABLE terminal state.
  perform app.activate_personal_account(v_uid);

  perform app.record_audit_event('onboarding.consumer_completed', 'user', v_uid, null, '{}'::jsonb);
end;
$$;

-- ===========================================================================
-- 3. individual_submit_professional — submission ACTIVATES; review stays open
-- ===========================================================================
-- The required-field validation and the hand-off to the trusted upgrade/review
-- workflow are byte-for-byte the Sprint 7.4 logic. The only change is that the
-- account is activated after the verification request is filed, so the
-- professional can use their personal account while the request is still
-- `submitted`. `users.primary_account_type` is still NEVER written here.
create or replace function public.individual_submit_professional()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := app.require_verified_caller();
  v_track public.onboarding_track := app.onboarding_selected_track(v_uid);
  v_io    public.individual_onboarding;
  v_hl    text;
  v_vid   uuid;
begin
  if v_track is distinct from 'professional' then
    raise exception 'professional onboarding requires the professional track' using errcode = '42501';
  end if;

  select * into v_io from public.individual_onboarding where user_id = v_uid;
  select headline into v_hl from public.profiles where user_id = v_uid;

  -- Required to submit (portfolio + documents are optional / deferred flows).
  if v_io.prof_concrete_type is null then
    raise exception 'select your professional type first' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(v_hl, '')), '') is null then
    raise exception 'a professional headline is required' using errcode = '22023';
  end if;
  if v_io.prof_years_experience is null then
    raise exception 'years of experience is required' using errcode = '22023';
  end if;
  if v_io.prof_specialization is null then
    raise exception 'a specialization is required' using errcode = '22023';
  end if;
  if v_io.prof_services is null or array_length(v_io.prof_services, 1) is null then
    raise exception 'select at least one service' using errcode = '22023';
  end if;
  if not coalesce(v_io.prof_offers_remote, false)
     and (v_io.prof_service_areas is null or array_length(v_io.prof_service_areas, 1) is null) then
    raise exception 'add a service area or enable remote consultation' using errcode = '22023';
  end if;

  -- Hand off to the trusted upgrade/review workflow (idempotent for the same
  -- type). Skipped only when the reviewed type has ALREADY been applied to the
  -- identity — request_account_upgrade correctly refuses a no-op upgrade, and a
  -- re-submit must not turn that into a save failure.
  if exists (
    select 1 from public.users u
    where u.id = v_uid and u.primary_account_type = v_io.prof_concrete_type
  ) then
    select v.id into v_vid from public.verifications v
    where v.subject_type = 'user' and v.user_id = v_uid
      and v.requested_account_type = v_io.prof_concrete_type
    order by v.submitted_at desc nulls last
    limit 1;
  else
    v_vid := public.request_account_upgrade(v_io.prof_concrete_type);
  end if;

  update public.individual_onboarding
    set professional_completed_at = coalesce(professional_completed_at, now())
    where user_id = v_uid;

  -- The professional account is usable NOW; the verification above is a separate
  -- trust state that an Admin decides on independently.
  perform app.activate_personal_account(v_uid);

  perform app.record_audit_event('onboarding.professional_submitted', 'user', v_uid, null,
    jsonb_build_object('account_type', v_io.prof_concrete_type, 'verification_id', v_vid));
  return v_vid;
end;
$$;

-- ===========================================================================
-- 4. onboarding_select_account_type — accept the generic owner/manager choice
-- ===========================================================================
-- "Organization owner / manager" describes the caller's RELATIONSHIP to an
-- organization, not a business type, so it has no `account_type` enum value. The
-- business track therefore records track-only intent and the REAL organization
-- type (showroom_dealer / supplier / manufacturer / importer / wholesaler) is
-- chosen during business onboarding and validated by `business_save`. The
-- professional track still requires a concrete type.
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

  if p_track = 'consumer' then
    -- Consumer keeps a null concrete type.
    if p_account_type is not null and p_account_type <> 'end_consumer' then
      raise exception 'consumer track takes no professional/business type' using errcode = '22023';
    end if;
    p_account_type := null;
  elsif p_track = 'business' then
    -- Optional: a concrete business type pre-selects the organization type; the
    -- generic owner/manager entry legitimately carries none.
    if p_account_type = 'end_consumer' then
      raise exception 'business track takes no consumer type' using errcode = '22023';
    end if;
    if p_account_type is not null and p_account_type not in
       ('showroom_dealer', 'supplier', 'manufacturer', 'importer', 'wholesaler') then
      raise exception 'business track requires a business organization type' using errcode = '22023';
    end if;
  else
    -- Professional: a concrete individual professional type is required. (The
    -- invited-employee path has no enum value and so can never be recorded here.)
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
-- 5. Backfill — release the accounts already trapped by the old behaviour
-- ===========================================================================
-- Anyone who reached a personal onboarding terminal before this migration is
-- activated once, using exactly the rule above (pending identities only).
update public.users u
   set status = 'active'
 where u.status = 'pending_verification'
   and exists (
     select 1 from public.individual_onboarding io
     where io.user_id = u.id
       and (io.consumer_completed_at is not null or io.professional_completed_at is not null)
   );
