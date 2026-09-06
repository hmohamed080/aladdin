-- ===========================================================================
-- Professional profile editing — authority by IDENTITY, not by onboarding track
-- ===========================================================================
-- THE MISMATCH. `individual_save_professional` gated on one thing:
--
--   `onboarding_progress.selected_track = 'professional'`
--
-- That was correct while the function had exactly one caller — the onboarding
-- wizard, where the track is what the person just chose. Increment 2 gave it a
-- second caller, the standalone profile editor, and there the track is the wrong
-- question. `selected_track` records HOW an identity was created, not WHAT it is.
--
-- An identity that became a professional another way therefore renders a
-- professional home (via the canonical/declared persona fallback in
-- `loadPersonalHome`), is listed in the public directory, appears in the
-- technicians directory, has a public profile page — and could not edit a word of
-- it. That is every seeded Pilot professional and every Admin-applied upgrade:
-- neither writes `onboarding_progress`. The frontend had to render an
-- explanation instead of a form, which is a workaround for a rule that was simply
-- asking the wrong question.
--
-- THE FIX. Authority now follows the same canonical-or-declared professional
-- identity the rest of the repository already resolves — `loadPersonalHome`'s
-- `declaredType ?? canonicalType`, and the shape `app.is_sales_persona` uses for
-- the narrower Sales question (`20260831090001`). The track is KEPT as one
-- sufficient condition, not dropped: during first-time onboarding the person has
-- a track and nothing else — no canonical persona (that awaits the applied
-- upgrade) and no declared type (this very call is what writes it). Removing the
-- track branch would have broken the flow the gate was originally written for.
--
-- So: track OR canonical persona OR declared persona.
--
-- WHY THIS CANNOT BOOTSTRAP ITSELF. The obvious worry is a consumer granting
-- themselves professional authority by writing a declared type. They cannot: the
-- declared type is written only BY this function, so reaching it already requires
-- passing the gate. A consumer has no professional track, no professional
-- canonical persona and no declared type — all three branches are false, and the
-- refusal is unchanged. The new predicate widens who is recognised; it opens no
-- path to becoming recognised.
--
-- WHAT IS PRESERVED, DELIBERATELY AND IN FULL:
--   * OWNERSHIP — `app.require_verified_caller()` still resolves the acting user,
--     and every write is still `where user_id = v_uid`. No caller-supplied id
--     exists, so no one can edit anyone else's profile.
--   * REGISTRATION — an unverified caller is still refused before anything else.
--   * VALIDATION — the concrete-type allow-list, the availability enum, the
--     length caps, the array cleaning and the upsert are byte-for-byte unchanged.
--   * NON-PROFESSIONAL REJECTION — a consumer, a business-only identity, a
--     trainer/trainee and a signed-out caller are all still refused with 42501.
--
-- WHAT IS DELIBERATELY NOT CHANGED. `individual_submit_professional` keeps its
-- track gate. Submitting is an onboarding TERMINAL that files a verification
-- request — it is not editing, and an already-applied professional has no reason
-- to file one. Widening that is a different question for a different increment.
--
-- Forward-only: `create or replace` with identical signatures, so the existing
-- ACLs survive untouched. No table, column, type, policy, index or trigger
-- changes.

-- ---------------------------------------------------------------------------
-- 1. app.is_professional_persona — the identity predicate
-- ---------------------------------------------------------------------------
-- Sibling of `app.is_sales_persona`, and the same two sources for the same
-- reason: `users.primary_account_type` is written ONLY by the approved-and-
-- applied upgrade, so between submitting a professional profile and an Admin
-- applying it the canonical column is still null while the account is active and
-- usable throughout. `individual_onboarding.prof_concrete_type` is what the
-- person declared, and it is the value the product treats as what the account
-- actually is.
--
-- The allow-list is the SAME five values `individual_save_professional` accepts
-- for `p_concrete_type`, and it is written out rather than derived: `persona_type`
-- also holds `end_consumer`, `trainer` and `trainee`, none of which is an
-- individual professional for this flow.
create or replace function app.is_professional_persona(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id is not null and (
    exists (
      select 1 from public.users u
      where u.id = p_user_id
        and u.primary_account_type in (
          'engineer', 'interior_designer', 'installer_technician', 'contractor', 'sales'
        )
    )
    or exists (
      select 1 from public.individual_onboarding io
      where io.user_id = p_user_id
        and io.prof_concrete_type in (
          'engineer', 'interior_designer', 'installer_technician', 'contractor', 'sales'
        )
    )
  );
$$;

comment on function app.is_professional_persona(uuid) is
  'True when the identity is an INDIVIDUAL PROFESSIONAL by canonical persona (users.primary_account_type) or by the declared onboarding type (individual_onboarding.prof_concrete_type). Consumer, trainer, trainee and business-only (null persona) identities are false. Internal only: the declared branch is what keeps a professional editable between submitting their profile and an Admin applying the upgrade. Not an authorization grant by itself — callers still enforce ownership.';

revoke execute on function app.is_professional_persona(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. individual_save_professional — the gate, and only the gate, changes
-- ---------------------------------------------------------------------------
-- Body reproduced verbatim from 20260815090001 apart from the guard below.
create or replace function public.individual_save_professional(
  p_concrete_type        public.persona_type,
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
  -- THE GATE. Either the person is mid-professional-onboarding (the track, which
  -- is all a first-time caller has), or they already ARE a professional identity
  -- (canonical or declared). A consumer, a business-only identity and a
  -- trainer/trainee satisfy none of the three and are refused exactly as before.
  if v_track is distinct from 'professional'
     and not app.is_professional_persona(v_uid) then
    raise exception 'a professional account is required to edit a professional profile'
      using errcode = '42501';
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

comment on function public.individual_save_professional(
  public.persona_type, text, smallint, text, text, text[], text[], text[], text,
  text[], boolean, text, text, smallint) is
  'Re-entrant writer for the caller''s OWN individual professional profile, backing both the onboarding wizard and the standalone editor. Authority is the professional IDENTITY — the professional onboarding track (a first-time caller has only that), the canonical persona, or the declared prof_concrete_type — never a caller-supplied id. Consumer, trainer/trainee and business-only identities are refused with 42501.';
