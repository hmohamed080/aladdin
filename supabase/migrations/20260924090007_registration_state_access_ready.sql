-- ===========================================================================
-- Staging-prep Increment 7 — registration-state redesign (commit A: schema/
-- RPC only — the ~29-file frontend consumer adoption is a separate commit,
-- per the explicit "do not combine the semantic rewrite with the mechanical
-- consumer edits" correction).
--
-- THE HIGHEST-RISK CHANGE IN THIS WHOLE PASS, and the one most heavily
-- corrected across two rounds of review:
--
--   1. `active_personal` is a TESTED, load-bearing invariant
--      (supabase/tests/22_business_onboarding_test.sql) meaning "a real
--      active org membership exists, OR users.status='active' via
--      app.activate_personal_account() — which never fires for the business
--      track." An earlier draft would have returned active_personal
--      unconditionally once account_type_completed_at was set, letting a
--      business-track user with ZERO organizations reach a state the test
--      suite and activate_personal_account()'s own design treat as a
--      stronger guarantee than "may enter the app." THIS MIGRATION DOES NOT
--      DO THAT. The active_personal early-return below is byte-for-byte the
--      same guard, in the same position, as every historical version of this
--      function. A new, additive, terminal state — access_ready — carries
--      the new "may enter the app" meaning instead.
--
--   2. Username is MANDATORY REGISTRATION DATA, not optional profile
--      completion (a later product-owner correction, after access_ready was
--      first approved). The final access state therefore requires FOUR
--      things: confirmed identity, current consent, an approved top-level
--      account type, AND a valid stored username. A new, narrower state,
--      username_pending, sits between account_type_pending and access_ready
--      for exactly the case "everything else done, but no username yet" —
--      whether because the caller genuinely never had one (a legacy/direct
--      RPC path) or because their pending-registration username claim
--      collided with someone else's during the verification window (see
--      Increment 6, pending_registrations, and
--      frontend/src/app/preview/auth-password/finish-registration/page.tsx).
--      A refresh or a direct navigation cannot bypass this: it is derived
--      fresh from the database on every call, never from client state.
--
--   3. The pre-existing consent-check ordering (the active-membership/status
--      early-return runs BEFORE the consent check) is DELIBERATELY left
--      exactly where it always was, and is now documented explicitly rather
--      than left implicit: it is a grandfather clause for already-active
--      legacy accounts that predate consent capture, and a genuinely NEW
--      registrant can never reach it before passing consent, because nothing
--      in this codebase creates a membership or sets status='active' before
--      consent is recorded.
-- ===========================================================================

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
  v_has_username boolean;
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

  -- UNCHANGED early-return, UNCHANGED meaning, UNCHANGED position — this
  -- branch is never touched by anything below it. active_personal keeps
  -- exactly its current, tested guarantee (22_business_onboarding_test.sql
  -- keeps passing unmodified). An account that reaches this point never sees
  -- account_type_pending/username_pending/access_ready below, no matter what
  -- state its username/account-type intent is in.
  if exists (select 1 from public.memberships m where m.user_id = v_uid and m.status = 'active')
     or v_status = 'active' then
    return 'active_personal';
  end if;

  select count(distinct cr.consent_type) = 3 into v_has_consent
  from public.consent_receipts cr
  where cr.user_id = v_uid
    and cr.consent_type in ('terms', 'privacy', 'pilot')
    and cr.version = app.current_consent_version(cr.consent_type);
  if not coalesce(v_has_consent, false) then
    return 'consent_pending';
  end if;
  -- Documented explicitly (correction #6 of the staging-prep revision): the
  -- active-membership/status check above runs BEFORE this consent check.
  -- That ordering is pre-existing across every historical version of this
  -- function and is intentional ONLY as a grandfather clause for
  -- already-active legacy accounts that predate consent capture. It cannot
  -- be reached by a genuinely NEW registrant before they pass consent:
  -- nothing in this codebase creates a membership or sets
  -- users.status='active' before consent is recorded, so a new registrant
  -- always fails the membership/status check first and lands on the consent
  -- check on the very same call.

  select * into v_op from public.onboarding_progress where user_id = v_uid;

  -- profile_pending / contact_pending / every track-specific sub-state:
  -- REMOVED as return values of THIS function. They stop gating entry. Their
  -- informational value (e.g. "business track, no org yet") moves to the
  -- new, non-gating public.my_profile_completion() RPC — this function no
  -- longer knows or cares about profile/contact/org completeness.
  if v_op.account_type_completed_at is null then
    return 'account_type_pending';
  end if;

  select exists (
    select 1 from public.profiles p where p.user_id = v_uid and p.username is not null
  ) into v_has_username;
  if not coalesce(v_has_username, false) then
    return 'username_pending';
  end if;

  -- All FOUR conditions hold: session + confirmed email + consent + known
  -- audience + a valid stored username. NEW, additive terminal state —
  -- distinct from active_personal by construction. Never returned by the
  -- early-return above; never implies an active membership; never implies
  -- users.status = 'active'. Business-track callers with zero organizations
  -- land here, not on active_personal — see docs in the plan file for why
  -- that is the corrected, safe design.
  return 'access_ready';
end;
$$;

comment on function public.my_registration_state() is
  'Derived registration/access state. active_personal keeps its original, tested meaning (real active membership, or users.status=''active'' via app.activate_personal_account() — never the business track) — completely unchanged by this migration. access_ready is a NEW, additive terminal state: authentication complete (confirmed email + consent + approved account type + a valid stored username), independent of profile completeness or organization existence. username_pending is a NEW, narrower state between account_type_pending and access_ready. profile/contact/track-sub-states are no longer returned by this function — see public.my_profile_completion() for that informational-only data.';

-- ---------------------------------------------------------------------------
-- onboarding_select_account_type — drop the contact_completed_at
-- prerequisite. Discovered during implementation: the streamlined
-- registration flow this whole pass builds never runs the phone/contact
-- step at all (phone moves to persistent profile completion, not
-- registration), so the existing precondition "complete the contact step
-- first" would unconditionally reject every account-type selection made
-- through the new flow. Removing it is the direct, required consequence of
-- the already-approved decision to drop phone/contact from registration —
-- not a new design choice. Harmless to the canonical wizard, which still
-- happens to run its steps in the same order as before; this only stops the
-- RPC from FORCING that order.
-- ---------------------------------------------------------------------------
create or replace function public.onboarding_select_account_type(
  p_track        public.onboarding_track,
  p_account_type text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := app.require_verified_caller();
  v_choice    text := nullif(btrim(coalesce(p_account_type, '')), '');
  v_persona   public.persona_type;
  v_org_type  public.organization_type;
begin
  if p_track is null then
    raise exception 'an onboarding track is required' using errcode = '22023';
  end if;

  if p_track = 'consumer' then
    if v_choice is not null and v_choice <> 'end_consumer' then
      raise exception 'consumer track takes no professional/business type' using errcode = '22023';
    end if;
  elsif p_track = 'business' then
    if v_choice is not null then
      if not exists (
        select 1 from unnest(enum_range(null::public.organization_type)) e
        where e::text = v_choice
      ) then
        raise exception 'business track requires a business organization type' using errcode = '22023';
      end if;
      v_org_type := v_choice::public.organization_type;
    end if;
  else
    if v_choice is null or v_choice = 'end_consumer' then
      raise exception 'this track requires a concrete account type' using errcode = '22023';
    end if;
    if not exists (
      select 1 from unnest(enum_range(null::public.persona_type)) e
      where e::text = v_choice
    ) then
      raise exception 'professional track requires a personal persona' using errcode = '22023';
    end if;
    v_persona := v_choice::public.persona_type;
  end if;

  -- The "complete the contact step first" precondition that used to sit here
  -- is REMOVED — see this migration's header comment.

  -- Atomic upsert (same idiom as onboarding_save_profile above it in
  -- 20260808090001_shared_onboarding.sql) rather than update-then-insert: the
  -- streamlined registration flow may call this before any
  -- onboarding_progress row exists at all (the old profile/contact steps
  -- that used to create that row are no longer run first).
  insert into public.onboarding_progress (
    user_id, selected_track, selected_persona, selected_org_type,
    account_type_completed_at, completed_at
  ) values (
    v_uid, p_track, v_persona, v_org_type, now(), now()
  )
  on conflict (user_id) do update
    set selected_track            = excluded.selected_track,
        selected_persona          = excluded.selected_persona,
        selected_org_type         = excluded.selected_org_type,
        account_type_completed_at = excluded.account_type_completed_at,
        completed_at              = excluded.completed_at;

  perform app.record_audit_event('onboarding.completed', 'user', v_uid, null,
    jsonb_build_object('track', p_track, 'account_type', v_choice));
end;
$$;
comment on function public.onboarding_select_account_type(public.onboarding_track, text) is
  'Records the registration track and choice as INTENT, routing the choice into the typed column for its taxonomy: selected_persona (professional) or selected_org_type (business). Consumer records neither. Applies nothing to the identity and creates no organization. No longer requires the contact step to be completed first (Increment 7) — the streamlined registration flow never runs that step.';
revoke execute on function public.onboarding_select_account_type(
  public.onboarding_track, text) from public;
grant execute on function public.onboarding_select_account_type(
  public.onboarding_track, text) to authenticated;
