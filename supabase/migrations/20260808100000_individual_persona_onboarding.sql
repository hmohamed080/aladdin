-- Migration: individual persona onboarding (Phase 2 — Sprint 7.4).
--
-- Builds the persona-specific answers ON TOP of the Sprint 7.3 shared engine, for
-- INDIVIDUAL users only (consumer + the four individual professionals). Business/
-- organization onboarding is NOT in scope here.
--
--   * public.individual_onboarding — ONE self-owned row per user holding the
--       answers the base tables cannot: the consumer intent/interests/general
--       location/optional budget, and the common professional profile (years of
--       experience, specialization, services, service areas, availability, remote
--       consult, max travel) plus the RESOLVED concrete professional type
--       (engineer vs interior_designer, etc.). Headline / bio / languages are NOT
--       duplicated here — they are written to public.profiles (reused).
--   * individual_save_consumer / individual_complete_consumer — the consumer branch
--       (every field OPTIONAL; the whole flow is skippable). Completion is a
--       handoff, NOT activation: users.status is never touched, no org is created.
--   * individual_save_professional / individual_submit_professional — the common
--       professional branch. save_ also writes profiles.headline/bio/languages in
--       the SAME transaction. submit_ validates the required professional fields,
--       stamps completion, and hands off to the EXISTING trusted upgrade workflow
--       (public.request_account_upgrade) so a platform review is required before the
--       account type is ever applied. It NEVER mutates users.primary_account_type.
--   * my_registration_state() re-created with two finer terminal states:
--       consumer_onboarding_complete (consumer handoff done, still not activated)
--       and persona_review_pending (professional submitted, awaiting review). Still
--       DERIVED — no stored state column.
--
-- All writers are security-definer, auth.uid()-derived, verified-email gated (via
-- app.require_verified_caller from the 7.3 migration), and pin search_path. RLS is
-- self-select only; every write goes through the RPCs. Phone stays UNVERIFIED (no
-- OTP this sprint). Design: docs/frontend/sprint-7-individual-persona-onboarding.md.

-- ---------------------------------------------------------------------------
-- 1. individual_onboarding — one self-owned row per user
-- ---------------------------------------------------------------------------
create table public.individual_onboarding (
  user_id                   uuid primary key references public.users (id) on delete cascade,

  -- ---- Consumer branch (all optional; the flow is fully skippable) ----------
  -- What the visitor wants right now: explore | planning | started | finishing | need_help.
  consumer_intent           text,
  -- Interest category keys (UI-provided taxonomy; validated by count/length only).
  consumer_interests        text[],
  -- GENERAL location only — governorate + general city. No detailed address is
  -- requested at onboarding (that is asked later, per-request, with consent).
  consumer_governorate      text,
  consumer_city             text,
  -- Optional budget band: lt_100k | 100_250k | 250_500k | gt_500k | not_decided.
  consumer_budget           text,

  -- ---- Professional common branch -------------------------------------------
  -- The RESOLVED concrete individual professional type the submission requests an
  -- upgrade to. Never a consumer/business type (see check below). For the
  -- engineer/designer selection this disambiguates engineer vs interior_designer.
  prof_concrete_type        public.account_type,
  prof_years_experience     smallint,
  -- Single specialization key from the persona-specific option set (stored as text).
  prof_specialization       text,
  prof_services             text[],
  prof_additional_services  text[],
  -- within_week | within_month | flexible.
  prof_availability         text,
  -- General service areas (area keys / names) — NOT an office address.
  prof_service_areas        text[],
  prof_offers_remote        boolean not null default false,
  prof_governorate          text,
  prof_city                 text,
  prof_max_travel_km        smallint,

  -- ---- Completion stamps (drive the DERIVED terminal state) -----------------
  consumer_completed_at     timestamptz,
  professional_completed_at timestamptz,

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  -- The requested professional type is one of the FOUR individual professionals
  -- (never consumer, never a business/org type). Enforced in the RPC too.
  constraint ck_indiv_prof_concrete_type check (
    prof_concrete_type is null or prof_concrete_type in
      ('engineer', 'interior_designer', 'installer_technician', 'contractor', 'sales')
  ),
  constraint ck_indiv_years check (
    prof_years_experience is null or (prof_years_experience >= 0 and prof_years_experience <= 70)
  ),
  constraint ck_indiv_travel check (
    prof_max_travel_km is null or (prof_max_travel_km >= 0 and prof_max_travel_km <= 2000)
  ),
  constraint ck_indiv_specialization_len check (
    prof_specialization is null or char_length(prof_specialization) <= 80
  ),
  constraint ck_indiv_consumer_gov_len check (
    consumer_governorate is null or char_length(consumer_governorate) <= 80),
  constraint ck_indiv_consumer_city_len check (
    consumer_city is null or char_length(consumer_city) <= 80),
  constraint ck_indiv_prof_gov_len check (
    prof_governorate is null or char_length(prof_governorate) <= 80),
  constraint ck_indiv_prof_city_len check (
    prof_city is null or char_length(prof_city) <= 80),
  -- Bound array sizes so a client cannot store unbounded data.
  constraint ck_indiv_interests_card check (
    consumer_interests is null or array_length(consumer_interests, 1) is null or array_length(consumer_interests, 1) <= 24),
  constraint ck_indiv_services_card check (
    prof_services is null or array_length(prof_services, 1) is null or array_length(prof_services, 1) <= 30),
  constraint ck_indiv_add_services_card check (
    prof_additional_services is null or array_length(prof_additional_services, 1) is null or array_length(prof_additional_services, 1) <= 30),
  constraint ck_indiv_areas_card check (
    prof_service_areas is null or array_length(prof_service_areas, 1) is null or array_length(prof_service_areas, 1) <= 40)
);
comment on table public.individual_onboarding is 'Per-user individual persona onboarding answers (Sprint 7.4): the consumer branch (intent/interests/general location/optional budget) and the common professional branch (experience, specialization, services, service areas, availability, resolved concrete type). Self-owned; written ONLY via the security-definer individual_* RPCs. Headline/bio/languages live in public.profiles (reused, not duplicated). Completion is a handoff, never activation; professional submit hands off to the trusted upgrade/review workflow.';

create trigger set_individual_onboarding_updated_at
  before update on public.individual_onboarding
  for each row execute function app.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Extend the audit action allow-list (persona milestones are meaningful)
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
  'onboarding.completed',
  -- Sprint 7.4 — individual persona milestones.
  'onboarding.consumer_completed', 'onboarding.professional_submitted'
));

-- ===========================================================================
-- 3. Shared helpers
-- ===========================================================================

-- The caller's selected onboarding track (from the 7.3 progress row). NULL until
-- the account-type step is done. Used to keep a consumer OUT of the professional
-- branch and vice-versa, at the database boundary.
create or replace function app.onboarding_selected_track(p_uid uuid)
returns public.onboarding_track
language sql
stable
security definer
set search_path = ''
as $$
  select op.selected_track from public.onboarding_progress op where op.user_id = p_uid;
$$;
revoke execute on function app.onboarding_selected_track(uuid) from public;
grant execute on function app.onboarding_selected_track(uuid) to authenticated, service_role;

-- Trim + drop blanks from a text[] and cap element length, preserving order and
-- de-duplicating. NULL in -> NULL out. Keeps stored taxonomy arrays clean.
create or replace function app.clean_text_array(p_in text[], p_max_len int default 80)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case when p_in is null then null else (
    select coalesce(array_agg(distinct v order by v), array[]::text[])
    from (
      select left(btrim(x), p_max_len) as v
      from unnest(p_in) as t(x)
      where btrim(coalesce(x, '')) <> ''
    ) s
  ) end;
$$;
revoke execute on function app.clean_text_array(text[], int) from public;
grant execute on function app.clean_text_array(text[], int) to authenticated, service_role;

-- ===========================================================================
-- 4. Consumer branch — every field OPTIONAL; completion is a handoff.
-- ===========================================================================

-- 4a. Save the consumer answers (full accumulated state; any field may be null).
-- Requires the consumer track (a professional/business caller is rejected).
create or replace function public.individual_save_consumer(
  p_intent       text default null,
  p_interests    text[] default null,
  p_governorate  text default null,
  p_city         text default null,
  p_budget       text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := app.require_verified_caller();
  v_track  public.onboarding_track := app.onboarding_selected_track(v_uid);
begin
  if v_track is distinct from 'consumer' then
    raise exception 'consumer onboarding requires the consumer track' using errcode = '42501';
  end if;
  if p_intent is not null and p_intent not in
     ('explore', 'planning', 'started', 'finishing', 'need_help') then
    raise exception 'invalid consumer intent' using errcode = '22023';
  end if;
  if p_budget is not null and p_budget not in
     ('lt_100k', '100_250k', '250_500k', 'gt_500k', 'not_decided') then
    raise exception 'invalid consumer budget band' using errcode = '22023';
  end if;

  insert into public.individual_onboarding as io
    (user_id, consumer_intent, consumer_interests, consumer_governorate, consumer_city, consumer_budget)
  values (
    v_uid,
    p_intent,
    app.clean_text_array(p_interests, 40),
    nullif(left(btrim(coalesce(p_governorate, '')), 80), ''),
    nullif(left(btrim(coalesce(p_city, '')), 80), ''),
    p_budget
  )
  on conflict (user_id) do update set
    consumer_intent      = excluded.consumer_intent,
    consumer_interests   = excluded.consumer_interests,
    consumer_governorate = excluded.consumer_governorate,
    consumer_city        = excluded.consumer_city,
    consumer_budget      = excluded.consumer_budget;
end;
$$;

-- 4b. Reach the consumer handoff. Idempotent; NEVER activates the account.
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

  perform app.record_audit_event('onboarding.consumer_completed', 'user', v_uid, null, '{}'::jsonb);
end;
$$;

-- ===========================================================================
-- 5. Professional common branch — save (with profile writes) + submit.
-- ===========================================================================

-- 5a. Save the common professional profile. Requires the professional track.
-- Also writes the REUSED profile columns (headline/bio/languages) transactionally
-- so they are never duplicated in this table. p_concrete_type is validated to be
-- one of the four individual professional types.
create or replace function public.individual_save_professional(
  p_concrete_type        public.account_type,
  p_headline             text default null,
  p_years_experience     smallint default null,
  p_specialization       text default null,
  p_bio                  text default null,
  p_services             text[] default null,
  p_additional_services  text[] default null,
  p_languages            text[] default null,
  p_availability         text default null,
  p_service_areas        text[] default null,
  p_offers_remote        boolean default false,
  p_governorate          text default null,
  p_city                 text default null,
  p_max_travel_km        smallint default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := app.require_verified_caller();
  v_track     public.onboarding_track := app.onboarding_selected_track(v_uid);
  v_headline  text := nullif(left(btrim(coalesce(p_headline, '')), 120), '');
  v_bio       text := nullif(left(btrim(coalesce(p_bio, '')), 1000), '');
begin
  if v_track is distinct from 'professional' then
    raise exception 'professional onboarding requires the professional track' using errcode = '42501';
  end if;
  if p_concrete_type is null or p_concrete_type not in
     ('engineer', 'interior_designer', 'installer_technician', 'contractor', 'sales') then
    raise exception 'a valid individual professional type is required' using errcode = '22023';
  end if;
  if p_availability is not null and p_availability not in
     ('within_week', 'within_month', 'flexible') then
    raise exception 'invalid availability' using errcode = '22023';
  end if;

  -- Reused profile columns (private until the upgrade is approved & listed).
  update public.profiles
    set headline  = v_headline,
        bio       = v_bio,
        languages = app.clean_text_array(p_languages, 40)
    where user_id = v_uid;

  insert into public.individual_onboarding as io (
    user_id, prof_concrete_type, prof_years_experience, prof_specialization,
    prof_services, prof_additional_services, prof_availability, prof_service_areas,
    prof_offers_remote, prof_governorate, prof_city, prof_max_travel_km
  ) values (
    v_uid,
    p_concrete_type,
    p_years_experience,
    nullif(left(btrim(coalesce(p_specialization, '')), 80), ''),
    app.clean_text_array(p_services, 60),
    app.clean_text_array(p_additional_services, 60),
    p_availability,
    app.clean_text_array(p_service_areas, 80),
    coalesce(p_offers_remote, false),
    nullif(left(btrim(coalesce(p_governorate, '')), 80), ''),
    nullif(left(btrim(coalesce(p_city, '')), 80), ''),
    p_max_travel_km
  )
  on conflict (user_id) do update set
    prof_concrete_type       = excluded.prof_concrete_type,
    prof_years_experience    = excluded.prof_years_experience,
    prof_specialization      = excluded.prof_specialization,
    prof_services            = excluded.prof_services,
    prof_additional_services = excluded.prof_additional_services,
    prof_availability        = excluded.prof_availability,
    prof_service_areas       = excluded.prof_service_areas,
    prof_offers_remote       = excluded.prof_offers_remote,
    prof_governorate         = excluded.prof_governorate,
    prof_city                = excluded.prof_city,
    prof_max_travel_km       = excluded.prof_max_travel_km;
end;
$$;

-- 5b. Submit the professional profile for review. Validates the required fields,
-- stamps completion, and HANDS OFF to the existing trusted upgrade workflow
-- (request_account_upgrade) — which creates a 'submitted' verification. It never
-- mutates users.primary_account_type; a platform review + apply is still required.
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

  -- Hand off to the trusted upgrade/review workflow (idempotent for the same type).
  v_vid := public.request_account_upgrade(v_io.prof_concrete_type);

  update public.individual_onboarding
    set professional_completed_at = coalesce(professional_completed_at, now())
    where user_id = v_uid;

  perform app.record_audit_event('onboarding.professional_submitted', 'user', v_uid, null,
    jsonb_build_object('account_type', v_io.prof_concrete_type, 'verification_id', v_vid));
  return v_vid;
end;
$$;

-- ===========================================================================
-- 6. my_registration_state — re-created with the two finer terminal states.
-- ===========================================================================
-- Adds consumer_onboarding_complete (consumer handoff reached, still not
-- activated) and persona_review_pending (professional submitted, awaiting review).
-- Everything else is unchanged from the 7.3 definition. Still fully DERIVED.
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
  v_io          public.individual_onboarding;
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

  select * into v_io from public.individual_onboarding where user_id = v_uid;

  -- Handoff reached — the terminal state depends on the chosen track and whether
  -- the persona flow has been finished.
  if v_op.selected_track = 'consumer' then
    if v_io.consumer_completed_at is not null then
      return 'consumer_onboarding_complete';
    end if;
    return 'consumer_onboarding_pending';
  elsif v_op.selected_track = 'professional' then
    if v_io.professional_completed_at is not null then
      return 'persona_review_pending';
    end if;
    return 'persona_onboarding_pending';
  elsif v_op.selected_track = 'business' then
    return 'organization_setup_pending';
  end if;

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
-- 7. RLS — self read; writes only via the security-definer RPCs
-- ---------------------------------------------------------------------------
alter table public.individual_onboarding enable row level security;

create policy individual_onboarding_select_self on public.individual_onboarding
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 8. Grants (deny-by-default; strip Supabase defaults first)
-- ---------------------------------------------------------------------------
revoke all on public.individual_onboarding from anon, authenticated, service_role;
grant select on public.individual_onboarding to authenticated;
grant select, insert, update on public.individual_onboarding to service_role;

revoke execute on function public.individual_save_consumer(text, text[], text, text, text) from public;
revoke execute on function public.individual_complete_consumer() from public;
revoke execute on function public.individual_save_professional(
  public.account_type, text, smallint, text, text, text[], text[], text[], text, text[], boolean, text, text, smallint) from public;
revoke execute on function public.individual_submit_professional() from public;

grant execute on function public.individual_save_consumer(text, text[], text, text, text) to authenticated;
grant execute on function public.individual_complete_consumer() to authenticated;
grant execute on function public.individual_save_professional(
  public.account_type, text, smallint, text, text, text[], text[], text[], text, text[], boolean, text, text, smallint) to authenticated;
grant execute on function public.individual_submit_professional() to authenticated;
