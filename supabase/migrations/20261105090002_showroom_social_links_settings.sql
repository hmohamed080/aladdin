-- Showroom social links, Settings (docs/frontend/showroom-social-links-onboarding.md, "Data").
--
-- Purpose:
--   * public.organization_social_links_set: a showroom manager (org.manage) replaces the four links of the
--     organization from Settings. Validated by app.social_link_valid (20261105090001), audited as
--     organization.social_links_changed with the link COUNT only (links never go into logs), and not blocked by
--     the verified-identity lock: links are business information, not identity.
--   * app.profile_completion: one more item, 'organization_links', for a caller who manages a showroom, missing
--     while none of the showrooms they manage has a link (a legacy showroom created by an old client).
--   * public.business_verification_detail: the four links in the 'organization' object, for the Admin reviewer.
--
-- The two re-created functions are copied from their latest definitions (app.profile_completion:
-- 20261024090011_installer_profile_completion.sql; public.business_verification_detail:
-- 20261021090002_business_verification.sql) and change only what is listed above. CREATE OR REPLACE keeps their
-- grants; the same revokes are repeated so the intended privileges are stated here too.
-- Rollback: re-create those two definitions and drop organization_social_links_set.

select app.audit_actions_add(array['organization.social_links_changed']);

-- 1. Settings RPC -----------------------------------------------------------------------------------------------
create or replace function public.organization_social_links_set(
  p_org_id        uuid,
  p_facebook_url  text,
  p_instagram_url text,
  p_tiktok_url    text,
  p_website_url   text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_facebook  text := nullif(btrim(p_facebook_url), '');
  v_instagram text := nullif(btrim(p_instagram_url), '');
  v_tiktok    text := nullif(btrim(p_tiktok_url), '');
  v_website   text := nullif(btrim(p_website_url), '');
  v_org_type  public.organization_type;
  v_count     int;
begin
  perform app.require_verified_caller();
  if p_org_id is null then
    raise exception 'organization id is required' using errcode = '22023';
  end if;
  if not app.has_capability(p_org_id, 'org.manage') then
    raise exception 'org.manage required' using errcode = '42501';
  end if;
  select o.org_type into v_org_type from public.organizations o where o.id = p_org_id and o.deleted_at is null for update;
  if not found then
    raise exception 'organization not found' using errcode = '22023';
  end if;
  if v_org_type <> 'showroom_dealer' then
    raise exception 'social links are only kept for a showroom' using errcode = '22023';
  end if;

  if not app.social_link_valid('facebook', v_facebook) then
    raise exception 'invalid facebook social link' using errcode = '22023';
  end if;
  if not app.social_link_valid('instagram', v_instagram) then
    raise exception 'invalid instagram social link' using errcode = '22023';
  end if;
  if not app.social_link_valid('tiktok', v_tiktok) then
    raise exception 'invalid tiktok social link' using errcode = '22023';
  end if;
  if not app.social_link_valid('website', v_website) then
    raise exception 'invalid website social link' using errcode = '22023';
  end if;

  v_count := num_nonnulls(v_facebook, v_instagram, v_tiktok, v_website);
  if v_count = 0 then
    raise exception 'at least one showroom link is required' using errcode = '22023', hint = 'links_required';
  end if;

  update public.organizations set
    facebook_url  = v_facebook,
    instagram_url = v_instagram,
    tiktok_url    = v_tiktok,
    website_url   = v_website
  where id = p_org_id;

  perform app.record_audit_event('organization.social_links_changed', 'organization', p_org_id, p_org_id,
    jsonb_build_object('count', v_count));

  return jsonb_build_object('facebook_url', v_facebook, 'instagram_url', v_instagram,
                            'tiktok_url', v_tiktok, 'website_url', v_website);
end;
$$;
revoke execute on function public.organization_social_links_set(uuid, text, text, text, text) from public, anon, service_role;
grant  execute on function public.organization_social_links_set(uuid, text, text, text, text) to authenticated;

-- 2. Profile completion: + 'organization_links' -----------------------------------------------------------------
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

    -- A showroom needs at least one social or website link (a legacy showroom created by an old client has none).
    v_total := v_total + 1;
    if exists(select 1 from public.memberships m join public.organizations o on o.id=m.organization_id join public.membership_capabilities c on c.membership_id=m.id and c.capability_key='org.manage' where m.user_id=v_uid and m.status='active' and o.org_type='showroom_dealer' and num_nonnulls(o.facebook_url, o.instagram_url, o.tiktok_url, o.website_url) > 0) then
      v_done := v_done + 1;
    else
      v_missing := array_append(v_missing,'organization_links');
    end if;
  end if;
  return jsonb_build_object(
    'percent', case when v_total = 0 then 100 else round(100.0 * v_done / v_total) end,
    'missing', to_jsonb(v_missing),
    'audience', jsonb_build_object('persona', v_persona, 'organization_type', v_org_type),
    'has_org', v_has_org
  );
end;
$function$;
revoke execute on function app.profile_completion(uuid) from public,anon,authenticated,service_role;

-- 3. Admin business-verification detail: + the four links ------------------------------------------------------
create or replace function public.business_verification_detail(p_verification_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v   public.verifications;
  o   public.organizations;
  v_owner jsonb;
begin
  if not app.is_business_verification_reviewer() then
    raise exception 'admin permission organizations.verify required' using errcode = '42501';
  end if;
  select * into v from public.verifications where id = p_verification_id and verification_type = 'business';
  if not found then raise exception 'verification not found' using errcode = 'P0002'; end if;
  select * into o from public.organizations where id = v.organization_id;
  select jsonb_build_object('id', u.id, 'display_name', pr.display_name, 'email', a.email)
    into v_owner
    from public.users u join auth.users a on a.id = u.id left join public.profiles pr on pr.user_id = u.id
   where u.id = o.created_by;
  return jsonb_build_object(
    'id', v.id, 'status', app.bv_status_label(v.status), 'reason', v.reason, 'reviewer_id', v.reviewer_id,
    'reviewer_name', (select pr.display_name from public.profiles pr where pr.user_id = v.reviewer_id),
    'submitted_at', v.submitted_at, 'decided_at', v.decided_at,
    'is_own_organization', app.is_org_member(o.id),
    'can_review', app.has_admin_permission('organizations.verify') or app.has_admin_permission('verification.approve'),
    'can_decide', app.has_admin_permission('verification.approve'),
    'organization', jsonb_build_object(
      'id', o.id, 'name', o.name, 'name_ar', o.name_ar, 'name_en', o.name_en, 'legal_name', o.legal_name,
      'org_type', o.org_type, 'status', o.status, 'is_verified', o.is_verified,
      'business_verified_at', o.business_verified_at, 'created_at', o.created_at,
      'contact_phone', o.contact_phone, 'contact_email', o.contact_email,
      'facebook_url', o.facebook_url, 'instagram_url', o.instagram_url, 'tiktok_url', o.tiktok_url, 'website_url', o.website_url,
      'owner', v_owner),
    'submissions', coalesce((select jsonb_agg(jsonb_build_object(
         'id', s.id, 'round', s.round, 'note', s.note, 'submitted_at', s.submitted_at,
         'submitted_by', (select pr.display_name from public.profiles pr where pr.user_id = s.submitted_by),
         'documents', app.bv_documents_json(o.id, s.id, false)) order by s.round desc)
       from public.business_verification_submissions s where s.verification_id = v.id), '[]'::jsonb),
    'previous', coalesce((select jsonb_agg(jsonb_build_object(
         'id', h.id, 'status', app.bv_status_label(h.status), 'reason', h.reason,
         'submitted_at', h.submitted_at, 'decided_at', h.decided_at) order by h.submitted_at desc)
       from public.verifications h
      where h.organization_id = o.id and h.verification_type = 'business' and h.id <> v.id and h.status <> 'cancelled'), '[]'::jsonb),
    'application', (select jsonb_build_object('status', a.status, 'decided_at', a.decided_at)
                      from public.verifications a
                     where a.organization_id = o.id and a.verification_type = 'organization'
                     order by a.submitted_at desc limit 1));
end;
$$;
revoke all on function public.business_verification_detail(uuid) from public, anon, service_role;
grant execute on function public.business_verification_detail(uuid) to authenticated;

notify pgrst, 'reload schema';
