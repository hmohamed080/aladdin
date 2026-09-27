-- ===========================================================================
-- Staging-prep Increment 12 — lock the declared persona against direct
-- individual_save_professional calls.
--
-- THE GAP. individual_save_professional took p_concrete_type from the caller
-- and wrote it straight into individual_onboarding.prof_concrete_type — the
-- DECLARED persona that, since Increment 11, IS the account's authoritative
-- personal persona. Any professional could therefore call the RPC directly
-- (PostgREST) and turn a Tradesperson account into an Engineer or Contractor —
-- account types the product has not opened ("Coming Soon") — bypassing
-- onboarding_select_account_type, the one authoritative persona-selection path.
--
-- THE RULE (backward compatible — same signature, same ACL, same gate):
--   1. The authority gate and the five-value type allow-list are unchanged and
--      still run first (42501 for a non-professional, 22023 for a non-
--      individual-professional type), so no caller learns more than before.
--   2. The caller's ESTABLISHED persona is resolved: the declared
--      prof_concrete_type, else a professional canonical primary_account_type.
--   3. No established persona → 42501 "select an account type first". This RPC
--      never creates a persona.
--   4. p_concrete_type <> established persona → 42501 "the account type cannot
--      be changed here", raised before any write, so the call is atomic.
--   5. users.primary_account_type is never written (unchanged).
--   6. Every other profile field saves exactly as before.
--
-- Existing accounts lose nothing: seeded/Admin-applied professionals resolve
-- through their canonical persona, and every professional-track registrant has
-- a declared persona (Increment 11 writes it at account-type selection and
-- backfilled earlier registrants). No onboarding step becomes mandatory again.
-- ===========================================================================

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
  v_established public.persona_type;
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

  -- NEW (Increment 12): THE PERSONA IS LOCKED. This is a profile-data writer,
  -- not an account-type switch. The persona it may write is the one the caller
  -- ALREADY has — the declared prof_concrete_type, else a professional canonical
  -- users.primary_account_type (the app.effective_persona rule, narrowed to the
  -- five individual-professional values). Choosing or changing a persona is
  -- public.onboarding_select_account_type's job alone. Consequences:
  --   * a mismatching p_concrete_type is refused BEFORE any write (atomic);
  --   * a caller with no established persona is refused — there is nothing
  --     for the parameter to match, and this RPC must never bootstrap one;
  --   * a Coming Soon type (engineer, contractor, …) can therefore never be
  --     reached through this RPC by a caller who does not already hold it;
  --   * existing holders keep saving under their current persona unchanged.
  select case
           when io.prof_concrete_type in
                ('engineer', 'interior_designer', 'installer_technician', 'contractor', 'sales')
             then io.prof_concrete_type
         end
    into v_established
  from public.individual_onboarding io
  where io.user_id = v_uid;
  if v_established is null then
    select u.primary_account_type into v_established
    from public.users u
    where u.id = v_uid
      and u.primary_account_type in
          ('engineer', 'interior_designer', 'installer_technician', 'contractor', 'sales');
  end if;
  if v_established is null then
    raise exception 'select an account type first' using errcode = '42501';
  end if;
  if p_concrete_type <> v_established then
    raise exception 'the account type cannot be changed here' using errcode = '42501';
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
  'Profile-DATA writer for the caller''s OWN individual professional profile (wizard + standalone editor). Authority is the professional identity (track, canonical or declared persona) — never a caller-supplied id. Since Increment 12 it is NOT an account-type switch: p_concrete_type must equal the caller''s established persona (declared, else professional canonical) or the call fails with 42501 before any write; a caller with no established persona is refused. Never writes users.primary_account_type. Persona selection belongs to onboarding_select_account_type.';
