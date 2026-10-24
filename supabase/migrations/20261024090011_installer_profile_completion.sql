-- Installer profile completion follows the approved "Complete your profile" page.
--
-- The dashboard banner, Settings and /home/profile all read app.profile_completion(). For an Installer it used
-- the general professional checklist (headline, bio), which the approved page does not ask for, so the figure
-- could never reach 100% from that page and did not move when the page was saved. Installers now count what the
-- page asks for: experience, specialties, availability, primary governorate/city and at least one portfolio
-- project, plus the shared username, photo, phone and confirmed name. Every other persona is unchanged.
-- Rollback: re-create the previous definition (20261021090006_reconcile_rc2_media_function_permissions.sql).

create or replace function app.profile_completion(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid       uuid := p_user_id;
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
  select * into v_profile from public.profiles where user_id = v_uid;
  select * into v_op from public.onboarding_progress where user_id = v_uid;
  select * into v_io from public.individual_onboarding where user_id = v_uid;
  v_persona := coalesce(app.effective_persona(v_uid), v_op.selected_persona);
  v_org_type := v_op.selected_org_type;

  -- ALL-AUDIENCES criteria. 'locality' is intentionally absent (product-owner
  -- decision 2026-09-24, see 20260924090011 header §7).
  v_total := v_total + 4;
  if v_profile.username is not null then v_done := v_done + 1; else v_missing := array_append(v_missing, 'username'); end if;
  if v_profile.avatar_media_id is not null then v_done := v_done + 1; else v_missing := array_append(v_missing, 'avatar'); end if;
  if v_profile.phone_e164 is not null then v_done := v_done + 1; else v_missing := array_append(v_missing, 'phone'); end if;
  if v_profile.display_name_confirmed_at is not null then v_done := v_done + 1; else v_missing := array_append(v_missing, 'display_name'); end if;

  -- Installers: the approved "Complete your profile" page (/home/profile) has no headline and makes "about me"
  -- optional, so they are not counted. It asks for experience, specialties, availability, a governorate and city,
  -- and at least one portfolio project, and those are what count.
  if v_persona = 'installer_technician' then
    v_total := v_total + 5;
    if coalesce(v_io.prof_years_experience, 0) > 0 then v_done := v_done + 1; else v_missing := array_append(v_missing, 'years_experience'); end if;
    if exists (select 1 from public.user_trades ut join public.trades t on t.id = ut.trade_id
                where ut.user_id = v_uid and t.is_active) then
      v_done := v_done + 1;
    else
      v_missing := array_append(v_missing, 'activities');
    end if;
    if v_io.prof_availability is not null then v_done := v_done + 1; else v_missing := array_append(v_missing, 'availability'); end if;
    if exists (select 1 from public.user_service_areas a where a.user_id = v_uid and a.is_primary) then
      v_done := v_done + 1;
    else
      v_missing := array_append(v_missing, 'location');
    end if;
    if exists (select 1 from public.portfolio_projects p where p.owner_user_id = v_uid) then
      v_done := v_done + 1;
    else
      v_missing := array_append(v_missing, 'portfolio');
    end if;
  elsif v_persona is not null and v_persona in
     ('installer_technician', 'engineer', 'contractor', 'sales') then
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

  if exists(select 1 from public.memberships m join public.organizations o on o.id=m.organization_id join public.membership_capabilities c on c.membership_id=m.id and c.capability_key='org.manage' where m.user_id=v_uid and m.status='active' and o.org_type='showroom_dealer') then
    v_total := v_total + 1;
    if exists(select 1 from public.memberships m join public.organizations o on o.id=m.organization_id join public.membership_capabilities c on c.membership_id=m.id and c.capability_key='org.manage' where m.user_id=v_uid and m.status='active' and o.org_type='showroom_dealer' and not app.showroom_address_complete(o.id)) then
      v_missing := array_append(v_missing,'organization_address');
    else v_done := v_done + 1; end if;
  end if;
  return jsonb_build_object(
    'percent', case when v_total = 0 then 100 else round(100.0 * v_done / v_total) end,
    'missing', to_jsonb(v_missing),
    'audience', jsonb_build_object('persona', v_persona, 'organization_type', v_org_type),
    'has_org', v_has_org
  );
end;
$function$;
