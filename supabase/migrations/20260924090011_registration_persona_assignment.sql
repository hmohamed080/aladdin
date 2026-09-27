-- ===========================================================================
-- Staging-prep Increment 11 — registration account type → AUTHORITATIVE
-- personal persona (product-owner correction: "Registration Account Type
-- cannot remain merely decorative intent when it represents a user persona").
--
-- THE GAP. The streamlined registration flow calls
-- public.onboarding_select_account_type('professional', 'installer_technician')
-- and nothing else. That recorded onboarding_progress.selected_persona — intent
-- only — while every professional authority in this schema reads a DIFFERENT
-- pair of columns:
--
--   app.is_professional_persona / app.is_sales_persona
--     = users.primary_account_type (canonical, written only by an Admin-applied
--       upgrade) OR individual_onboarding.prof_concrete_type (declared).
--   frontend loadPersonalHome
--     = declared ?? canonical.
--
-- A freshly registered Tradesperson therefore had neither: user_trades_set
-- refused them (42501), /home rendered the CONSUMER variant, and the
-- professional profile editor showed "no professional profile". The legacy
-- six-step wizard used to close the gap by writing prof_concrete_type in its
-- professional step — the step the streamlined flow deliberately never runs.
--
-- THE FIX, INSIDE THE EXISTING AUTHORITY MODEL — no new column, no new state:
--
--   1. onboarding_select_account_type, on the PROFESSIONAL track, now also
--      records the chosen persona as the DECLARED persona
--      (individual_onboarding.prof_concrete_type) — exactly the value the
--      legacy wizard's professional step wrote, and exactly what
--      is_professional_persona / is_sales_persona / loadPersonalHome already
--      treat as "what this account is". The value comes from the RPC's own
--      validated enum argument, applied as the authenticated caller
--      (auth.uid()); it is never read from auth user_metadata. The
--      password-registration path reaches this RPC only through the
--      service-role-staged app.pending_registrations row, which the server
--      action writes after validating the choice against the active,
--      non-coming-soon catalog.
--
--   2. users.primary_account_type is DELIBERATELY NOT WRITTEN. It remains the
--      trust-reviewed canonical persona written only by an Admin-applied
--      upgrade (activation is not verification — 20260813090001). Writing it
--      here would silently skip the verification workflow and make
--      request_account_upgrade refuse the (now no-op) upgrade.
--
--   3. SALES gets the same user-level persona and NOTHING organizational: no
--      organization, no membership, no membership_capabilities row. Sales Rep
--      / Sales Manager authority stays membership-scoped and is reachable only
--      through the existing affiliation request that an Owner/Manager holding
--      org.members.manage approves (20260831090001).
--
--   4. BUSINESS track (Showroom / Supplier / Manufacturer / Importer) is
--      UNCHANGED: selected_org_type stays the intended organization type that
--      /business/new pre-selects; no organization is created; access_ready
--      grants no organization permission.
--
--   5. The declared persona is written only while it is not already
--      established: never when a DIFFERENT canonical (Admin-applied) persona
--      exists, and never over a declaration that has already been submitted
--      (professional_completed_at). A seeded or Admin-applied professional
--      re-running account-type selection can therefore never flip what their
--      account is.
--
--   6. public.user_activities_set and public.my_profile_completion() resolve
--      the persona the same way (declared ?? canonical, via the new internal
--      app.effective_persona) instead of the canonical column alone / the
--      intent column alone, so a registered Salesperson can actually pick
--      Sales Rep / Sales Manager and a seeded canonical professional is asked
--      for the professional items.
--
--   7. my_profile_completion(): the organization_activities item is counted
--      only for an organization the caller can MANAGE (org.manage), because
--      only that caller can reach the organization-activities editor — an
--      employee member is not handed an item they cannot complete. And
--      'locality' stays OUT of the calculation (approved by the product owner
--      2026-09-24): profiles.locality_id and the locality concept remain in
--      the domain untouched; it becomes a completion item again in the same
--      change that ships a real locality/city write path and UI.
--
--   8. Backfill (idempotent): identities that selected a professional persona
--      through the streamlined flow before this migration get the same
--      declared persona they would get today.
--
-- active_personal is untouched: nothing here creates a membership or sets
-- users.status = 'active'. my_registration_state() is not modified.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. app.effective_persona — declared ?? canonical, the loadPersonalHome rule
-- ---------------------------------------------------------------------------
create or replace function app.effective_persona(p_user_id uuid)
returns public.persona_type
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select io.prof_concrete_type from public.individual_onboarding io where io.user_id = p_user_id),
    (select u.primary_account_type from public.users u where u.id = p_user_id)
  );
$$;
comment on function app.effective_persona(uuid) is
  'Internal: the caller''s effective PERSONAL persona — the declared individual_onboarding.prof_concrete_type, else the canonical users.primary_account_type. The same resolution frontend loadPersonalHome uses. Never consults an organization; NULL for a business-only identity. Not an authorization grant by itself.';
revoke execute on function app.effective_persona(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. onboarding_select_account_type — professional track records the persona
-- ---------------------------------------------------------------------------
-- Body identical to 20260924090007 apart from the declared-persona write.
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

  -- NEW (Increment 11): the individual-professional persona becomes the
  -- DECLARED persona — the value every professional authority already reads.
  -- Same five-value allow-list as app.is_professional_persona and
  -- individual_save_professional (trainer/trainee are not individual
  -- professionals). Never touches users.primary_account_type.
  if v_persona in ('engineer', 'interior_designer', 'installer_technician', 'contractor', 'sales')
     and not exists (
       select 1 from public.users u
       where u.id = v_uid and u.primary_account_type is not null
         and u.primary_account_type <> v_persona) then
    insert into public.individual_onboarding as io (user_id, prof_concrete_type)
    values (v_uid, v_persona)
    on conflict (user_id) do update
      set prof_concrete_type = excluded.prof_concrete_type
      where io.prof_concrete_type is null
         or io.professional_completed_at is null;
  end if;

  perform app.record_audit_event('onboarding.completed', 'user', v_uid, null,
    jsonb_build_object('track', p_track, 'account_type', v_choice));
end;
$$;
comment on function public.onboarding_select_account_type(public.onboarding_track, text) is
  'Records the registration track and choice. Business track: selected_org_type is the INTENDED organization type only — no organization, membership or capability is created. Professional track: additionally records the persona as the DECLARED persona (individual_onboarding.prof_concrete_type, Increment 11) so the account is immediately a usable professional identity for app.is_professional_persona / is_sales_persona; users.primary_account_type (canonical, trust-reviewed) is never written. An already-established persona (submitted, or backed by a canonical one) is never overwritten. Sales gets no membership or capability.';
revoke execute on function public.onboarding_select_account_type(
  public.onboarding_track, text) from public;
grant execute on function public.onboarding_select_account_type(
  public.onboarding_track, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. user_activities_set — persona = declared ?? canonical
-- ---------------------------------------------------------------------------
create or replace function public.user_activities_set(
  p_activity_keys text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := app.require_verified_caller();
  v_persona public.persona_type := app.effective_persona(v_uid);
  v_ids     uuid[];
  v_keys    text[];
begin
  select coalesce(array_agg(distinct btrim(k)), '{}'::text[])
    into v_keys
  from unnest(coalesce(p_activity_keys, '{}'::text[])) as u(k)
  where btrim(k) <> '';

  select coalesce(array_agg(a.id), '{}'::uuid[]) into v_ids
  from public.activities a
  where a.persona_type = v_persona and a.key = any(v_keys) and a.is_active;

  if array_length(v_keys, 1) is distinct from array_length(v_ids, 1) then
    raise exception 'one or more activity keys are unknown or inactive for this account type'
      using errcode = '22023';
  end if;

  delete from public.user_activities where user_id = v_uid;
  insert into public.user_activities (user_id, activity_id)
  select v_uid, unnest(v_ids)
  where array_length(v_ids, 1) is not null;

  perform app.record_audit_event('user.activities_set', 'user', v_uid, null,
    jsonb_build_object('activity_keys', v_keys));
end;
$$;
comment on function public.user_activities_set(text[]) is
  'Whole-set write of the caller''s own persona-scoped activities, scoped to app.effective_persona (declared ?? canonical — Increment 11). An unknown or inactive-for-this-persona key refuses the ENTIRE write (no partial application). User-level labels only: grants no organization membership or capability.';
revoke execute on function public.user_activities_set(text[]) from public, anon;
grant execute on function public.user_activities_set(text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. my_profile_completion — effective persona; manageable-org activities
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
  v_missing   text[] := '{}'::text[];
  v_total     int := 0;
  v_done      int := 0;
  v_has_org   boolean := false;
  v_can_manage boolean := false;
  v_needs_activities boolean := false;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into v_profile from public.profiles where user_id = v_uid;
  select * into v_op from public.onboarding_progress where user_id = v_uid;
  select * into v_io from public.individual_onboarding where user_id = v_uid;
  v_persona := coalesce(app.effective_persona(v_uid), v_op.selected_persona);
  v_org_type := v_op.selected_org_type;

  -- ALL-AUDIENCES criteria. 'locality' is intentionally absent (see header §7).
  v_total := v_total + 4;
  if v_profile.username is not null then v_done := v_done + 1; else v_missing := array_append(v_missing, 'username'); end if;
  if v_profile.avatar_media_id is not null then v_done := v_done + 1; else v_missing := array_append(v_missing, 'avatar'); end if;
  if v_profile.phone_e164 is not null then v_done := v_done + 1; else v_missing := array_append(v_missing, 'phone'); end if;
  if v_profile.display_name_confirmed_at is not null then v_done := v_done + 1; else v_missing := array_append(v_missing, 'display_name'); end if;

  if v_persona is not null and v_persona in
     ('installer_technician', 'engineer', 'interior_designer', 'contractor', 'sales') then
    v_total := v_total + 3;
    if v_profile.headline is not null then v_done := v_done + 1; else v_missing := array_append(v_missing, 'headline'); end if;
    if v_io.prof_years_experience is not null then v_done := v_done + 1; else v_missing := array_append(v_missing, 'years_experience'); end if;
    if v_profile.bio is not null then v_done := v_done + 1; else v_missing := array_append(v_missing, 'bio'); end if;

    v_needs_activities := v_persona = 'installer_technician'
      or exists (select 1 from public.activities a where a.persona_type = v_persona and a.is_active);
    if v_needs_activities then
      v_total := v_total + 1;
      if exists (select 1 from public.user_activities ua where ua.user_id = v_uid)
         or (v_persona = 'installer_technician' and exists (
               select 1 from public.user_trades ut
               join public.trades t on t.id = ut.trade_id
               where ut.user_id = v_uid and t.is_active)) then
        v_done := v_done + 1;
      else
        v_missing := array_append(v_missing, 'activities');
      end if;
    end if;
  end if;

  if v_org_type is not null then
    select exists (
      select 1 from public.memberships m where m.user_id = v_uid and m.status = 'active'
    ) into v_has_org;
    select exists (
      select 1 from public.memberships m
      join public.membership_capabilities c on c.membership_id = m.id
      where m.user_id = v_uid and m.status = 'active' and c.capability_key = 'org.manage'
    ) into v_can_manage;

    -- organization_setup: satisfied by ANY active membership (the caller has a
    -- business context). organization_activities: asked only of a caller who
    -- can manage one — the only caller the editor admits.
    v_total := v_total + 1;
    if v_has_org then
      v_done := v_done + 1;
    else
      v_missing := array_append(v_missing, 'organization_setup');
    end if;
    if v_can_manage then
      v_total := v_total + 1;
      if exists (
        select 1 from public.memberships m
        join public.membership_capabilities c on c.membership_id = m.id and c.capability_key = 'org.manage'
        join public.organization_activities oa on oa.organization_id = m.organization_id
        where m.user_id = v_uid and m.status = 'active'
      ) then
        v_done := v_done + 1;
      else
        v_missing := array_append(v_missing, 'organization_activities');
      end if;
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
  'INFORMATIONAL ONLY — never consulted by public.my_registration_state() and never gates entry. Drives the persistent "Complete your profile" checklist. Persona = app.effective_persona (declared ?? canonical), falling back to the registration intent. Every item it can return has a reachable write path for the caller: username/avatar/phone/display_name (/settings/profile), professional items (/home/profile/edit), organization_setup (/business/new), organization_activities only for a caller holding org.manage. locality is deliberately NOT an item until a locality write path exists (product-owner decision 2026-09-24); profiles.locality_id is unchanged.';

-- ---------------------------------------------------------------------------
-- 5. Backfill — streamlined-flow professionals registered before this change
-- ---------------------------------------------------------------------------
insert into public.individual_onboarding (user_id, prof_concrete_type)
select op.user_id, op.selected_persona
from public.onboarding_progress op
where op.selected_track = 'professional'
  and op.account_type_completed_at is not null
  and op.selected_persona in ('engineer', 'interior_designer', 'installer_technician', 'contractor', 'sales')
on conflict (user_id) do update
  set prof_concrete_type = excluded.prof_concrete_type
  where public.individual_onboarding.prof_concrete_type is null;
