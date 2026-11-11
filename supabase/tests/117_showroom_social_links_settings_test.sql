-- Showroom social links, Settings (docs/frontend/showroom-social-links-onboarding.md, 20261107090002):
-- public.organization_social_links_set, the organization.social_links_changed audit action, the
-- 'organization_links' profile-completion item and the four links in business_verification_detail.
--
-- The two re-created functions are compared with verbatim copies of their previous definitions
-- (pg_temp.profile_completion_before / pg_temp.business_verification_detail_before), so every
-- difference other than the one this migration names fails the test.
create extension if not exists pgtap;
begin;
select no_plan();

-- ---------------------------------------------------------------------------
-- 0. Previous definitions (verbatim bodies) and an error-capture helper
-- ---------------------------------------------------------------------------
-- app.profile_completion as of 20261024090011_installer_profile_completion.sql, minus the username criterion (P1 M1).
create function pg_temp.profile_completion_before(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
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

  -- P1 M1 (20261110090002): the 'username' criterion is retired, so this reference copy drops it too and keeps
  -- comparing only what 20261107090002 changed (organization_links).
  v_total := v_total + 3;
  if v_profile.avatar_media_id is not null then v_done := v_done + 1; else v_missing := array_append(v_missing, 'avatar'); end if;
  if v_profile.phone_e164 is not null then v_done := v_done + 1; else v_missing := array_append(v_missing, 'phone'); end if;
  if v_profile.display_name_confirmed_at is not null then v_done := v_done + 1; else v_missing := array_append(v_missing, 'display_name'); end if;

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

-- public.business_verification_detail as of 20261021090002_business_verification.sql:591.
create function pg_temp.business_verification_detail_before(p_verification_id uuid)
returns jsonb
language plpgsql
stable
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
      'contact_phone', o.contact_phone, 'contact_email', o.contact_email, 'owner', v_owner),
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

-- Runs a statement and returns 'ok' or '<sqlstate>:<hint>'.
create function pg_temp.outcome(p_sql text) returns text language plpgsql as $$
declare v_state text; v_hint text;
begin
  execute p_sql;
  return 'ok';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_hint = pg_exception_hint;
  return v_state || ':' || coalesce(v_hint, '');
end;
$$;

-- Users who manage a showroom (org.manage on an active membership of a showroom_dealer organization).
create function pg_temp.manages_showroom(p_user_id uuid) returns boolean language sql stable as $$
  select exists(select 1 from public.memberships m join public.organizations o on o.id = m.organization_id
                  join public.membership_capabilities c on c.membership_id = m.id and c.capability_key = 'org.manage'
                 where m.user_id = p_user_id and m.status = 'active' and o.org_type = 'showroom_dealer');
$$;

-- ---------------------------------------------------------------------------
-- 1. Users
--   1 legacy showroom owner (old client, no links) · 2 member of that showroom without org.manage
--   3 supplier owner · 4 installer · 5 second showroom owner (outsider to showroom 1)
-- ---------------------------------------------------------------------------
insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('117' || lpad(n::text, 5, '0') || '-0000-4000-8000-000000000117')::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
       'links117-' || n || '@example.test',now(),'{}','{}',now(),now()
from generate_series(1, 5) n;
insert into public.onboarding_progress(user_id,selected_track,selected_org_type,account_type_completed_at,completed_at) values
  ('11700001-0000-4000-8000-000000000117','business','showroom_dealer',now(),now()),
  ('11700003-0000-4000-8000-000000000117','business','supplier',now(),now()),
  ('11700005-0000-4000-8000-000000000117','business','showroom_dealer',now(),now());
update public.users set primary_account_type = 'installer_technician' where id = '11700004-0000-4000-8000-000000000117';

\set u1 '{"sub":"11700001-0000-4000-8000-000000000117","role":"authenticated"}'
\set u2 '{"sub":"11700002-0000-4000-8000-000000000117","role":"authenticated"}'
\set u3 '{"sub":"11700003-0000-4000-8000-000000000117","role":"authenticated"}'
\set u5 '{"sub":"11700005-0000-4000-8000-000000000117","role":"authenticated"}'
\set adm '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}'

create temp table _ids (k text primary key, v text);
grant all on _ids to authenticated;

-- Legacy showroom: created by an old client through _v2, so it has no link.
set local role authenticated;
set local request.jwt.claims = :'u1';
select lives_ok($q$select public.business_draft_save_v2(p_display_name=>'Showroom 117',p_legal_name=>'Showroom 117 LLC',p_org_type=>'showroom_dealer',p_governorate=>'cairo',p_city=>'maadi',p_contact_phone=>'+201012345117',p_activity_type=>'decor_showroom',p_detailed_address=>'117 Nile Street')$q$,'legacy owner saves a showroom draft through _v2');
insert into _ids select 'o1', public.business_draft_submit_v2()::text;
set local request.jwt.claims = :'u3';
select lives_ok($q$select public.business_draft_save_v3(p_display_name=>'Supplier 117',p_legal_name=>'Supplier 117 LLC',p_org_type=>'supplier',p_governorate=>'cairo',p_city=>'maadi')$q$,'supplier saves a draft');
insert into _ids select 'o3', public.business_draft_submit_v3()::text;
set local request.jwt.claims = :'u5';
select lives_ok($q$select public.business_draft_save_v3(p_display_name=>'Showroom 117 B',p_legal_name=>'Showroom 117 B LLC',p_org_type=>'showroom_dealer',p_governorate=>'cairo',p_city=>'maadi',p_contact_phone=>'+201012345118',p_activity_type=>'decor_showroom',p_website_url=>'https://showroom-b.example.com')$q$,'second showroom saves a draft with a link');
insert into _ids select 'o5', public.business_draft_submit_v3()::text;
reset role;
-- A member of showroom 1 without org.manage.
insert into public.memberships (user_id, organization_id, status, accepted_at)
select '11700002-0000-4000-8000-000000000117', v::uuid, 'active', now() from _ids where k = 'o1';
select ok(pg_temp.manages_showroom('11700001-0000-4000-8000-000000000117'), 'setup: user 1 manages showroom 1');
select ok(not pg_temp.manages_showroom('11700002-0000-4000-8000-000000000117'), 'setup: user 2 is a member without org.manage');
select is((select row(facebook_url,instagram_url,tiktok_url,website_url)::text from public.organizations where id=(select v::uuid from _ids where k='o1')),
  row(null::text,null::text,null::text,null::text)::text, 'setup: the legacy showroom has no link');

-- ---------------------------------------------------------------------------
-- 2. Audit action and privileges
-- ---------------------------------------------------------------------------
select ok((select pg_get_constraintdef(c.oid) from pg_constraint c where c.conname='ck_audit_action_known' and c.conrelid='public.audit_log'::regclass) like '%''organization.social_links_changed''::text%',
  'organization.social_links_changed is an allowed audit action');
select ok((select pg_get_constraintdef(c.oid) from pg_constraint c where c.conname='ck_audit_action_known' and c.conrelid='public.audit_log'::regclass) like '%''organization.legal_name_changed''::text%',
  'existing audit actions are kept');
select ok(has_function_privilege('authenticated','public.organization_social_links_set(uuid,text,text,text,text)','execute'),'authenticated can execute organization_social_links_set');
select ok(not has_function_privilege('anon','public.organization_social_links_set(uuid,text,text,text,text)','execute'),'anon cannot execute organization_social_links_set');
select ok(not has_function_privilege('service_role','public.organization_social_links_set(uuid,text,text,text,text)','execute'),'service_role cannot execute organization_social_links_set');
select ok((select prosecdef from pg_proc where oid='public.organization_social_links_set(uuid,text,text,text,text)'::regprocedure),'organization_social_links_set is security definer');
select ok(not has_function_privilege('authenticated','app.profile_completion(uuid)','execute'),'profile_completion grants unchanged: authenticated cannot execute');
select ok(not has_function_privilege('anon','app.profile_completion(uuid)','execute'),'profile_completion grants unchanged: anon cannot execute');
select ok(not has_function_privilege('service_role','app.profile_completion(uuid)','execute'),'profile_completion grants unchanged: service_role cannot execute');
select ok(has_function_privilege('authenticated','public.business_verification_detail(uuid)','execute'),'business_verification_detail grants unchanged: authenticated can execute');
select ok(not has_function_privilege('anon','public.business_verification_detail(uuid)','execute'),'business_verification_detail grants unchanged: anon cannot execute');
select ok(not has_function_privilege('service_role','public.business_verification_detail(uuid)','execute'),'business_verification_detail grants unchanged: service_role cannot execute');
set local role anon;
select throws_ok(format('select public.organization_social_links_set(%L, null, null, null, %L)', (select '00000000-0000-0000-0000-000000000000'), 'https://x.example.com'),'42501',null,'anon call is denied');
reset role;

-- ---------------------------------------------------------------------------
-- 3. Profile completion before the owner sets a link
-- ---------------------------------------------------------------------------
select ok((app.profile_completion('11700001-0000-4000-8000-000000000117')->'missing') ? 'organization_links','legacy showroom owner without a link is asked for organization_links');
select is((app.profile_completion('11700001-0000-4000-8000-000000000117')->'missing') - 'organization_links',
  pg_temp.profile_completion_before('11700001-0000-4000-8000-000000000117')->'missing','every other missing item for the showroom owner is unchanged');
select ok((app.profile_completion('11700001-0000-4000-8000-000000000117')->>'percent')::int < (pg_temp.profile_completion_before('11700001-0000-4000-8000-000000000117')->>'percent')::int,
  'the missing link lowers the showroom owner''s percent');
insert into _ids select 'pct_no_link', app.profile_completion('11700001-0000-4000-8000-000000000117')->>'percent';
select ok(not (app.profile_completion('11700005-0000-4000-8000-000000000117')->'missing') ? 'organization_links','showroom owner with a link is not asked for organization_links');
select ok(not (app.profile_completion('11700002-0000-4000-8000-000000000117')->'missing') ? 'organization_links','member without org.manage is not asked for organization_links');

-- Before/after proof: everyone who does not manage a showroom gets exactly the previous result.
select is((select count(*)::int from public.users u
            where not pg_temp.manages_showroom(u.id)
              and app.profile_completion(u.id) is distinct from pg_temp.profile_completion_before(u.id)), 0,
  'profile_completion is identical to the previous definition for every non-showroom user');
select ok((select count(*) from public.users u where not pg_temp.manages_showroom(u.id)) >= 4, 'the comparison covers seeded users and the installer, supplier and member');
select is(app.profile_completion('11700004-0000-4000-8000-000000000117'), pg_temp.profile_completion_before('11700004-0000-4000-8000-000000000117'),'installer: identical result');
select is(app.profile_completion('11700003-0000-4000-8000-000000000117'), pg_temp.profile_completion_before('11700003-0000-4000-8000-000000000117'),'supplier owner: identical result');
select is(app.profile_completion('11700002-0000-4000-8000-000000000117'), pg_temp.profile_completion_before('11700002-0000-4000-8000-000000000117'),'showroom member without org.manage: identical result');
-- Showroom managers: the only change is one appended item (when no link) and the percent.
select is((select count(*)::int from public.users u
            where pg_temp.manages_showroom(u.id)
              and (app.profile_completion(u.id) - 'percent' - 'missing' is distinct from pg_temp.profile_completion_before(u.id) - 'percent' - 'missing'
                   or (app.profile_completion(u.id)->'missing') - 'organization_links' is distinct from pg_temp.profile_completion_before(u.id)->'missing')), 0,
  'showroom managers: only organization_links (and the percent) differ from the previous definition');

-- ---------------------------------------------------------------------------
-- 4. organization_social_links_set
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = :'u1';
select is(public.organization_social_links_set((select v::uuid from _ids where k='o1'), null, '  https://www.instagram.com/showroom117  ', null, null),
  jsonb_build_object('facebook_url', null, 'instagram_url', 'https://www.instagram.com/showroom117', 'tiktok_url', null, 'website_url', null),
  'owner sets one link and gets the four links back (trimmed)');
reset role;
select is((select row(facebook_url,instagram_url,tiktok_url,website_url)::text from public.organizations where id=(select v::uuid from _ids where k='o1')),
  row(null::text,'https://www.instagram.com/showroom117',null::text,null::text)::text,'the organization row is updated');
select is((select count(*)::int from public.audit_log where action='organization.social_links_changed' and organization_id=(select v::uuid from _ids where k='o1')),1,
  'exactly one organization.social_links_changed audit row');
select is((select metadata from public.audit_log where action='organization.social_links_changed' and organization_id=(select v::uuid from _ids where k='o1')),
  '{"count": 1}'::jsonb,'audit metadata is the link count only');
select ok((select metadata::text not ilike '%instagram%' and metadata::text not ilike '%http%' from public.audit_log where action='organization.social_links_changed' and organization_id=(select v::uuid from _ids where k='o1')),
  'audit metadata contains no URL text');
select is((select row(actor_user_id, subject_type, subject_id)::text from public.audit_log where action='organization.social_links_changed' and organization_id=(select v::uuid from _ids where k='o1')),
  row('11700001-0000-4000-8000-000000000117'::uuid, 'organization', (select v::uuid from _ids where k='o1'))::text,'audit row names the actor and the organization');

-- Completion after one link.
select ok(not (app.profile_completion('11700001-0000-4000-8000-000000000117')->'missing') ? 'organization_links','after one link organization_links leaves the checklist');
select ok((app.profile_completion('11700001-0000-4000-8000-000000000117')->>'percent')::int > (select v::int from _ids where k='pct_no_link'),'after one link the percent rises');
select is((app.profile_completion('11700001-0000-4000-8000-000000000117')->'missing'), pg_temp.profile_completion_before('11700001-0000-4000-8000-000000000117')->'missing',
  'with a link the showroom owner''s missing list equals the previous definition');

-- Replace all four (null clears; all four values accepted).
set local role authenticated;
set local request.jwt.claims = :'u1';
select is(public.organization_social_links_set((select v::uuid from _ids where k='o1'), 'https://www.facebook.com/showroom117', null, 'https://www.tiktok.com/@showroom117', 'https://showroom117.example.com/'),
  jsonb_build_object('facebook_url', 'https://www.facebook.com/showroom117', 'instagram_url', null, 'tiktok_url', 'https://www.tiktok.com/@showroom117', 'website_url', 'https://showroom117.example.com/'),
  'owner replaces the links; a null clears instagram');
reset role;
select is((select array_agg((metadata->>'count')::int order by (metadata->>'count')::int) from public.audit_log where action='organization.social_links_changed' and organization_id=(select v::uuid from _ids where k='o1')),
  array[1,3],'second audit row counts three links');
select ok(not exists(select 1 from public.audit_log where action='organization.social_links_changed' and (metadata::text ilike '%http%' or metadata::text ilike '%facebook%' or metadata::text ilike '%tiktok%')),
  'no social_links_changed audit row carries URL text');

-- Refusals.
set local role authenticated;
set local request.jwt.claims = :'u1';
select is(pg_temp.outcome(format('select public.organization_social_links_set(%L, null, null, null, null)', (select v from _ids where k='o1'))),
  '22023:links_required','clearing all four links on a showroom is refused with hint links_required');
select is(pg_temp.outcome(format('select public.organization_social_links_set(%L, %L, %L, %L, %L)', (select v from _ids where k='o1'), ' ', '', '  ', '')),
  '22023:links_required','blank strings count as cleared');
select throws_ok(format('select public.organization_social_links_set(%L, %L, null, null, null)', (select v from _ids where k='o1'), 'https://facebook.com@evil.io/x'),'22023',null,'invalid facebook host is refused');
select throws_ok(format('select public.organization_social_links_set(%L, null, %L, null, null)', (select v from _ids where k='o1'), 'https://www.facebook.com/showroom117'),'22023',null,'a link in the wrong platform column is refused');
select throws_ok(format('select public.organization_social_links_set(%L, null, null, null, %L)', (select v from _ids where k='o1'), 'http://127.0.0.1'),'22023',null,'invalid website is refused');
select throws_ok(format('select public.organization_social_links_set(%L, null, null, %L, null)', (select v from _ids where k='o1'), 'https://www.tiktok.com/showroom117'),'22023',null,'invalid tiktok is refused');
set local request.jwt.claims = :'u3';
select throws_ok(format('select public.organization_social_links_set(%L, null, null, null, %L)', (select v from _ids where k='o3'), 'https://supplier117.example.com'),'22023',null,'a non-showroom organization is refused, even to its manager');
set local request.jwt.claims = :'u1';
select throws_ok(format('select public.organization_social_links_set(null, null, null, null, %L)', 'https://x.example.com'),'22023',null,'a null organization id is refused');
set local request.jwt.claims = :'u2';
select throws_ok(format('select public.organization_social_links_set(%L, null, null, null, %L)', (select v from _ids where k='o1'), 'https://member.example.com'),'42501',null,'a member without org.manage is refused');
set local request.jwt.claims = :'u5';
select throws_ok(format('select public.organization_social_links_set(%L, null, null, null, %L)', (select v from _ids where k='o1'), 'https://outsider.example.com'),'42501',null,'an owner of another showroom is refused');
set local request.jwt.claims = :'u1';
select throws_ok(format('select public.organization_social_links_set(%L, null, null, null, %L)', '00000000-0000-4000-8000-000000000999', 'https://x.example.com'),'42501',null,'an unknown organization is refused');
reset role;
select is((select row(facebook_url,instagram_url,tiktok_url,website_url)::text from public.organizations where id=(select v::uuid from _ids where k='o1')),
  row('https://www.facebook.com/showroom117',null::text,'https://www.tiktok.com/@showroom117','https://showroom117.example.com/')::text,'refused calls leave the links untouched');
select is((select count(*)::int from public.audit_log where action='organization.social_links_changed' and organization_id=(select v::uuid from _ids where k='o1')),2,
  'refused calls write no audit row');

-- Not blocked by the verified-identity lock: links are not identity.
insert into public.verifications (id, subject_type, organization_id, verification_type, status, submitted_at)
values ('117a0000-0000-4000-8000-000000000117', 'organization', (select v::uuid from _ids where k='o1'), 'organization', 'submitted', now());
set local role authenticated;
set local request.jwt.claims = :'adm';
select lives_ok($q$select public.review_start('117a0000-0000-4000-8000-000000000117')$q$, 'setup: administrator starts the application review');
select lives_ok($q$select public.review_approve('117a0000-0000-4000-8000-000000000117', false)$q$, 'setup: administrator approves the application');
reset role;
select ok(app.org_identity_locked((select v::uuid from _ids where k='o1')),'setup: showroom 1 identity is now locked');
set local role authenticated;
set local request.jwt.claims = :'u1';
select lives_ok(format('select public.organization_social_links_set(%L, null, %L, null, null)', (select v from _ids where k='o1'), 'https://www.instagram.com/showroom117'),'a verified showroom still edits its links');
reset role;

-- ---------------------------------------------------------------------------
-- 5. business_verification_detail
-- ---------------------------------------------------------------------------
insert into public.verifications (id, subject_type, organization_id, verification_type, status, submitted_at) values
  ('117a0001-0000-4000-8000-000000000117', 'organization', (select v::uuid from _ids where k='o1'), 'business', 'submitted', now()),
  ('117a0003-0000-4000-8000-000000000117', 'organization', (select v::uuid from _ids where k='o3'), 'business', 'submitted', now());
set local request.jwt.claims = :'adm';
insert into _ids select 'before1', pg_temp.business_verification_detail_before('117a0001-0000-4000-8000-000000000117')::text;
insert into _ids select 'before3', pg_temp.business_verification_detail_before('117a0003-0000-4000-8000-000000000117')::text;
set local role authenticated;
select is(public.business_verification_detail('117a0001-0000-4000-8000-000000000117')->'organization'->>'instagram_url','https://www.instagram.com/showroom117','reviewer sees instagram_url');
select is((select jsonb_object_agg(k, public.business_verification_detail('117a0001-0000-4000-8000-000000000117')->'organization'->k) from unnest(array['facebook_url','instagram_url','tiktok_url','website_url']) k),
  jsonb_build_object('facebook_url', null, 'instagram_url', 'https://www.instagram.com/showroom117', 'tiktok_url', null, 'website_url', null),
  'reviewer sees the four link keys with the showroom values');
select ok((public.business_verification_detail('117a0003-0000-4000-8000-000000000117')->'organization') ?& array['facebook_url','instagram_url','tiktok_url','website_url'],'the four keys are present for an organization without links');
select is((select count(*)::int from unnest(array['facebook_url','instagram_url','tiktok_url','website_url']) k
            where jsonb_typeof(public.business_verification_detail('117a0003-0000-4000-8000-000000000117')->'organization'->k) <> 'null'),0,'and are null');
-- Before/after proof: removing the four keys gives the previous definition's output exactly.
select is(jsonb_set(public.business_verification_detail('117a0001-0000-4000-8000-000000000117'), '{organization}',
            (public.business_verification_detail('117a0001-0000-4000-8000-000000000117')->'organization') - 'facebook_url' - 'instagram_url' - 'tiktok_url' - 'website_url'),
  (select v::jsonb from _ids where k='before1'),'showroom detail is otherwise identical to the previous definition');
select is(jsonb_set(public.business_verification_detail('117a0003-0000-4000-8000-000000000117'), '{organization}',
            (public.business_verification_detail('117a0003-0000-4000-8000-000000000117')->'organization') - 'facebook_url' - 'instagram_url' - 'tiktok_url' - 'website_url'),
  (select v::jsonb from _ids where k='before3'),'supplier detail is otherwise identical to the previous definition');
set local request.jwt.claims = :'u3';
select throws_ok($q$select public.business_verification_detail('117a0001-0000-4000-8000-000000000117')$q$,'42501',null,'a non-reviewer is still refused');
reset role;

-- ---------------------------------------------------------------------------
-- 7. Mirror of the address rule: ANY managed showroom without a link keeps the item
-- ---------------------------------------------------------------------------
insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('11700006-0000-4000-8000-000000000117','00000000-0000-0000-0000-000000000000','authenticated','authenticated','links117-6@example.test',now(),'{}','{}',now(),now());
insert into public.onboarding_progress(user_id,selected_track,selected_org_type,account_type_completed_at,completed_at)
values('11700006-0000-4000-8000-000000000117','business','showroom_dealer',now(),now());
set local role authenticated;
set local request.jwt.claims = '{"sub":"11700006-0000-4000-8000-000000000117","role":"authenticated"}';
select lives_ok($q$select public.business_draft_save_v3(p_display_name=>'Showroom 117 C',p_legal_name=>'Showroom 117 C LLC',p_org_type=>'showroom_dealer',p_governorate=>'cairo',p_city=>'maadi',p_contact_phone=>'+201012345119',p_activity_type=>'decor_showroom',p_website_url=>'https://showroom-c.example.com')$q$,'owner 6 saves a linked showroom');
insert into _ids select 'o6a', public.business_draft_submit_v3()::text;
reset role;
-- An additional business needs the first one to be active.
set local session_replication_role = replica;
update public.organizations set status = 'active' where id = (select v::uuid from _ids where k='o6a');
set local session_replication_role = origin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"11700006-0000-4000-8000-000000000117","role":"authenticated"}';
select lives_ok($q$select public.business_draft_save_v2(p_display_name=>'Showroom 117 D legacy',p_legal_name=>'Showroom 117 D LLC',p_org_type=>'showroom_dealer',p_governorate=>'cairo',p_city=>'maadi',p_contact_phone=>'+201012345120',p_activity_type=>'decor_showroom')$q$,'owner 6 saves a second, legacy showroom through _v2');
insert into _ids select 'o6b', public.business_draft_submit_v2()::text;
reset role;
select ok(pg_temp.manages_showroom('11700006-0000-4000-8000-000000000117'), 'setup: user 6 manages two showrooms');
select is((select count(*)::int from public.organizations where id in (select v::uuid from _ids where k in ('o6a','o6b')) and num_nonnulls(facebook_url,instagram_url,tiktok_url,website_url)=0),1,'setup: exactly one of them has no link');
select ok((app.profile_completion('11700006-0000-4000-8000-000000000117')->'missing') ? 'organization_links','one linked and one legacy showroom: the item stays');
select is((app.profile_completion('11700006-0000-4000-8000-000000000117')->'missing') - 'organization_links', pg_temp.profile_completion_before('11700006-0000-4000-8000-000000000117')->'missing','nothing else changes for that owner');
set local role authenticated;
set local request.jwt.claims = '{"sub":"11700006-0000-4000-8000-000000000117","role":"authenticated"}';
select lives_ok(format('select public.organization_social_links_set(%L, null, %L, null, null)', (select v from _ids where k='o6b'), 'https://www.instagram.com/showroom117d'),'owner 6 adds a link to the legacy showroom');
reset role;
select ok(not (app.profile_completion('11700006-0000-4000-8000-000000000117')->'missing') ? 'organization_links','both showrooms have a link: the item disappears');

select * from finish();
rollback;
