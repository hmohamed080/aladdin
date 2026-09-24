-- ===========================================================================
-- Staging-prep Increment 8 — profile completion (non-gating) + display-name
-- confirmation signal
--
-- CORRECTED DISPLAY-NAME SIGNAL. An earlier draft proposed reusing
-- onboarding_progress.profile_completed_at to mean "the user saved anything
-- in the new profile form" as the Display Name completion signal. Per
-- explicit product-owner correction, that conflates two different facts and
-- risks treating the trigger-generated 'Member' fallback
-- (app.handle_new_user(), confirmed elsewhere to ALWAYS produce a non-null
-- display_name) as if the user had confirmed it. This migration instead adds
-- an explicit, single-purpose column, profiles.display_name_confirmed_at,
-- set ONLY by a real, intentional call to public.profile_set_display_name —
-- never by the account-creation trigger, and never implied by any other
-- write.
--
-- public.my_profile_completion() is INFORMATIONAL ONLY. It never gates
-- entry (public.my_registration_state() does that, and does not call this
-- function) — it exists purely for the persistent "Complete your profile"
-- UI's checklist/percentage.
-- ===========================================================================

alter table public.profiles
  add column display_name_confirmed_at timestamptz;

comment on column public.profiles.display_name_confirmed_at is
  'Set ONLY by an explicit call to public.profile_set_display_name — never by app.handle_new_user()''s account-creation fallback (which always produces a non-null display_name, so nullability alone cannot signal "the user confirmed this"). NULL means the caller has never deliberately reviewed/saved their display name, even though display_name itself already holds a value.';

create or replace function public.profile_set_display_name(p_display_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_name text := btrim(coalesce(p_display_name, ''));
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 80 then
    raise exception 'display name must be 1..80 characters' using errcode = '22023';
  end if;

  update public.profiles
    set display_name = v_name,
        display_name_confirmed_at = now()
    where user_id = v_uid;

  if not found then
    raise exception 'profile not found for the current user' using errcode = 'P0002';
  end if;
end;
$$;
comment on function public.profile_set_display_name(text) is
  'The only write path that sets profiles.display_name_confirmed_at. Distinct from the legacy onboarding_save_profile (which sets display_name and locale together as part of the old wizard) — this is the new persistent profile-completion form''s entry point and is the ONLY thing that marks Display Name complete for public.my_profile_completion().';
revoke execute on function public.profile_set_display_name(text) from public;
grant execute on function public.profile_set_display_name(text) to authenticated;

-- ---------------------------------------------------------------------------
-- public.my_profile_completion — informational only, never a gate.
-- ---------------------------------------------------------------------------
create or replace function public.my_profile_completion()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_profile   public.profiles;
  v_op        public.onboarding_progress;
  v_io        public.individual_onboarding;
  v_persona   public.persona_type;
  v_org_type  public.organization_type;
  v_missing   text[] := '{}';
  v_total     int := 0;
  v_done      int := 0;
  v_has_org   boolean := false;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into v_profile from public.profiles where user_id = v_uid;
  select * into v_op from public.onboarding_progress where user_id = v_uid;
  select * into v_io from public.individual_onboarding where user_id = v_uid;
  v_persona := v_op.selected_persona;
  v_org_type := v_op.selected_org_type;

  -- ALL-AUDIENCES criteria.
  v_total := v_total + 5;
  if v_profile.username is not null then v_done := v_done + 1; else v_missing := v_missing || 'username'; end if;
  if v_profile.avatar_media_id is not null then v_done := v_done + 1; else v_missing := v_missing || 'avatar'; end if;
  if v_profile.phone_e164 is not null then v_done := v_done + 1; else v_missing := v_missing || 'phone'; end if;
  if v_profile.locality_id is not null then v_done := v_done + 1; else v_missing := v_missing || 'locality'; end if;
  if v_profile.display_name_confirmed_at is not null then v_done := v_done + 1; else v_missing := v_missing || 'display_name'; end if;

  if v_persona is not null and v_persona in
     ('installer_technician', 'engineer', 'interior_designer', 'contractor', 'sales') then
    v_total := v_total + 4;
    if v_profile.headline is not null then v_done := v_done + 1; else v_missing := v_missing || 'headline'; end if;
    if v_io.prof_years_experience is not null then v_done := v_done + 1; else v_missing := v_missing || 'years_experience'; end if;
    if exists (select 1 from public.user_activities ua where ua.user_id = v_uid) then
      v_done := v_done + 1;
    else
      v_missing := v_missing || 'activities';
    end if;
    if v_profile.bio is not null then v_done := v_done + 1; else v_missing := v_missing || 'bio'; end if;
  end if;

  if v_org_type is not null then
    v_total := v_total + 2;
    select exists (
      select 1 from public.memberships m where m.user_id = v_uid and m.status = 'active'
    ) into v_has_org;
    if v_has_org then
      v_done := v_done + 1;
      if exists (
        select 1 from public.memberships m
        join public.organization_activities oa on oa.organization_id = m.organization_id
        where m.user_id = v_uid and m.status = 'active'
      ) then
        v_done := v_done + 1;
      else
        v_missing := v_missing || 'organization_activities';
      end if;
    else
      v_missing := v_missing || 'organization_setup';
    end if;
  end if;

  return jsonb_build_object(
    'percent', case when v_total = 0 then 100 else round(100.0 * v_done / v_total) end,
    'missing', to_jsonb(v_missing),
    'audience', jsonb_build_object('persona', v_persona, 'organization_type', v_org_type),
    'has_org', v_has_org
  );
end;
$$;
comment on function public.my_profile_completion() is
  'INFORMATIONAL ONLY — never consulted by public.my_registration_state() and never gates entry. Drives the persistent "Complete your profile" UI''s checklist/percentage. Also privately retains the "business track, no org yet" style derivation Increment 7 removed from my_registration_state (via has_org) purely for this checklist''s own use.';
revoke execute on function public.my_profile_completion() from public;
grant execute on function public.my_profile_completion() to authenticated;
