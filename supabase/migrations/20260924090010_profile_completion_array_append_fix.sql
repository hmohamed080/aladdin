-- ===========================================================================
-- Staging-prep Increment 10 — fix: my_profile_completion()'s v_missing
-- concatenation raised a hard error on its very first real call
--
-- REAL BUG, caught by `supabase db lint --schema public` (plpgsql_check) and
-- confirmed live against a real migrated database: every `v_missing :=
-- v_missing || 'some_key'` in 20260924090008_profile_completion.sql
-- (v_missing declared text[]) hits Postgres's operator resolution for `||`
-- ambiguously. Given an untyped string literal on the right, Postgres prefers
-- the array||array overload and tries to CAST the literal itself to text[]
-- before falling back to array||element — and a plain string like 'username'
-- is not a valid array literal, so the cast fails outright:
--
--   ERROR:  malformed array literal: "username"
--   DETAIL: Array value must start with "{" or dimension information.
--
-- This fired on the FIRST real call to my_profile_completion() for ANY caller
-- missing so much as one tracked field — i.e. every caller today, since
-- username is brand new. The RPC backing this whole pass's persistent
-- "Complete your profile" UI was completely broken. Never caught by the
-- pgTAP suite because no existing test file calls this RPC at all (Increment
-- 8 shipped no test of its own for it) — caught only by static analysis plus
-- a direct manual call against the real local database, exactly the gap
-- `supabase db reset` + `supabase test db` alone cannot close.
--
-- Fixed by `array_append`, which has no such ambiguity, everywhere `v_missing
-- || 'literal'` appeared (11 occurrences). Logic is otherwise byte-for-byte
-- identical to 20260924090008_profile_completion.sql.
-- ===========================================================================

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
  if v_profile.username is not null then v_done := v_done + 1; else v_missing := array_append(v_missing, 'username'); end if;
  if v_profile.avatar_media_id is not null then v_done := v_done + 1; else v_missing := array_append(v_missing, 'avatar'); end if;
  if v_profile.phone_e164 is not null then v_done := v_done + 1; else v_missing := array_append(v_missing, 'phone'); end if;
  if v_profile.locality_id is not null then v_done := v_done + 1; else v_missing := array_append(v_missing, 'locality'); end if;
  if v_profile.display_name_confirmed_at is not null then v_done := v_done + 1; else v_missing := array_append(v_missing, 'display_name'); end if;

  if v_persona is not null and v_persona in
     ('installer_technician', 'engineer', 'interior_designer', 'contractor', 'sales') then
    v_total := v_total + 4;
    if v_profile.headline is not null then v_done := v_done + 1; else v_missing := array_append(v_missing, 'headline'); end if;
    if v_io.prof_years_experience is not null then v_done := v_done + 1; else v_missing := array_append(v_missing, 'years_experience'); end if;
    if exists (select 1 from public.user_activities ua where ua.user_id = v_uid) then
      v_done := v_done + 1;
    else
      v_missing := array_append(v_missing, 'activities');
    end if;
    if v_profile.bio is not null then v_done := v_done + 1; else v_missing := array_append(v_missing, 'bio'); end if;
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
        v_missing := array_append(v_missing, 'organization_activities');
      end if;
    else
      v_missing := array_append(v_missing, 'organization_setup');
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
  'INFORMATIONAL ONLY — never consulted by public.my_registration_state() and never gates entry. Drives the persistent "Complete your profile" UI''s checklist/percentage. Also privately retains the "business track, no org yet" style derivation Increment 7 removed from my_registration_state (via has_org) purely for this checklist''s own use. Fixed by Increment 10 (array_append, not the ambiguous ||) after a real-database call proved the original raised 22P02 on every caller missing any tracked field.';
