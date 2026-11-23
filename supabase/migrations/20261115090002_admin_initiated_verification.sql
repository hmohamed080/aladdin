-- Admin-initiated verification with NO profile-completion or showroom-completeness restriction on Admin approval, optional
-- rejection reasons with owner notifications, decision history in account details, and a derived "Needs attention" view.
-- Forward-only and corrective: 20261115090001 is already applied to Acceptance and is not edited.
--
-- POLICY (owner, final)
--   1. An authorized Admin may initiate, approve or reject verification for any ELIGIBLE user or organization, without a
--      user-submitted request and REGARDLESS of profile completion (including 0%). Neither the Craftsman completion guard
--      (20261115090001) nor the showroom business-completeness checks stand in the way of an Admin approval. RBAC, the
--      authenticated session, the no-self-review and assigned-reviewer rules, and the audit trail are unchanged.
--   2. No reason is required to initiate or approve.
--   3. A rejection reason is OPTIONAL. When given it is stored on the request (the owner sees it), written to the audit log, and
--      carried in the owner's notification; when omitted the rejection succeeds and the owner gets a generic notification.
--      A USER rejection now notifies the user (before: organizations only).
--   4. Every Admin-initiated verification, approval and rejection is in the immutable audit log (actor, action, timestamp)
--      and names the target account (subject_user_id / subject_organization_id). The decision history (reviewer, decision
--      time, whether an Admin started it) is returned by admin_user_detail / admin_organization_detail.
--   5. 100% profile completion stays the requirement ONLY for the automatic user-submitted Craftsman request
--      (public.craftsman_profile_verification_submit, unchanged).
--   6. admin_users_directory gains a DERIVED 'attention' filter/count: a VERIFIED account whose authoritative profile completion
--      (app.profile_completion) is below 100. Nothing is stored; verification is never revoked; the warning clears when
--      completion returns to 100.
--
-- WHAT THIS DOES NOT TOUCH: identity, ownership, e-mail / phone OTP verification, the apply step (account type / listing /
-- organization release), the approved-verification requirement before a showroom may become active.
--
-- 1. public.admin_initiate_verification(subject_type, subject_id, note default null): files ONE ordinary 'submitted' row in
--    verifications (metadata {"initiated_by_admin": true}). Authority: users.verify; organizations.verify AND the
--    Administrator tier for an organization (as review_start demands). Refused for the caller's own account or organization,
--    an inactive or non-professional account, an account already holding an approved professional verification, an
--    organization that is not awaiting approval or has no active owner. An open request is returned, never duplicated.
-- 2. DROPPED: craftsman_review_complete / app.craftsman_review_guard (completion guard) and showroom_review_complete /
--    app.showroom_review_guard (completeness on approval). app.showroom_activation_guard keeps its approved-verification
--    requirement and loses only the completeness clause.
-- 3. review_approve (#192's definition) and review_reject are re-created: the audit rows name the target account;
--    review_reject takes an optional reason and notifies the owner.

select app.audit_actions_add(array['verification.admin_initiated']);

drop trigger if exists craftsman_review_complete on public.verifications;
drop function if exists app.craftsman_review_guard();
drop trigger if exists showroom_review_complete on public.verifications;
drop function if exists app.showroom_review_guard();

-- A rejection no longer needs a reason (owner policy); only 'needs_more_info' still does (the applicant must be told what to fix).
alter table public.verifications drop constraint ck_verifications_reason_required;
alter table public.verifications add constraint ck_verifications_reason_required
  check (status <> 'needs_more_info' or (reason is not null and length(btrim(reason)) > 0));

create or replace function public.admin_initiate_verification(p_subject_type text, p_subject_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
  v_persona public.persona_type;
  v_org     public.organizations;
  v_open    uuid;
  v_id      uuid;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_subject_type is null or p_subject_type not in ('user', 'organization') or p_subject_id is null then
    raise exception 'a user or organization subject is required' using errcode = '22023';
  end if;
  if v_reason is not null and char_length(v_reason) > 500 then
    raise exception 'a note of at most 500 characters is allowed' using errcode = '22023';
  end if;

  if p_subject_type = 'user' then
    if not app.has_admin_permission('users.verify') then
      raise exception 'platform reviewer authority required' using errcode = '42501';
    end if;
    if p_subject_id = v_uid then
      raise exception 'a reviewer may not initiate verification for their own account' using errcode = '42501';
    end if;
    if not exists (select 1 from public.users u where u.id = p_subject_id) then
      raise exception 'verification subject not found' using errcode = '22023';
    end if;
    if not app.account_is_active(p_subject_id) then
      raise exception 'the account is not active' using errcode = '22023';
    end if;
    v_persona := app.effective_persona(p_subject_id);
    if v_persona is null or v_persona not in ('engineer', 'installer_technician', 'contractor', 'sales') then
      raise exception 'only a professional account can be verified' using errcode = '22023';
    end if;
    if exists (select 1 from public.verifications v
                where v.subject_type = 'user' and v.user_id = p_subject_id and v.verification_type = 'professional'
                  and v.requested_account_type = v_persona and v.status = 'approved') then
      raise exception 'this account already holds an approved professional verification' using errcode = '22023';
    end if;
    select v.id into v_open from public.verifications v
     where v.subject_type = 'user' and v.user_id = p_subject_id and v.status in ('draft', 'submitted', 'under_review', 'needs_more_info')
     limit 1;
    if v_open is not null then
      return jsonb_build_object('state', 'already_open', 'verification_id', v_open);
    end if;
    insert into public.verifications
      (subject_type, user_id, verification_type, requested_account_type, status, submitted_at, metadata)
    values ('user', p_subject_id, 'professional', v_persona, 'submitted', now(), jsonb_build_object('initiated_by_admin', true))
    on conflict do nothing
    returning id into v_id;
  else
    if not app.has_admin_permission('organizations.verify') or not app.is_platform('administrator') then
      raise exception 'platform reviewer authority required' using errcode = '42501';
    end if;
    if app.is_org_member(p_subject_id) then
      raise exception 'a reviewer may not initiate verification for their own organization' using errcode = '42501';
    end if;
    select * into v_org from public.organizations o where o.id = p_subject_id and o.deleted_at is null;
    if not found then
      raise exception 'verification subject not found' using errcode = '22023';
    end if;
    if v_org.status not in ('draft', 'pending_verification') then
      raise exception 'the organization is not awaiting approval' using errcode = '22023';
    end if;
    if not exists (select 1 from public.memberships m
                     join public.membership_capabilities c on c.membership_id = m.id and c.capability_key = 'org.manage'
                    where m.organization_id = p_subject_id and m.status = 'active') then
      raise exception 'the organization has no active owner' using errcode = '22023';
    end if;
    select v.id into v_open from public.verifications v
     where v.subject_type = 'organization' and v.organization_id = p_subject_id and v.status in ('draft', 'submitted', 'under_review', 'needs_more_info')
     limit 1;
    if v_open is not null then
      return jsonb_build_object('state', 'already_open', 'verification_id', v_open);
    end if;
    insert into public.verifications
      (subject_type, organization_id, verification_type, status, submitted_at, metadata)
    values ('organization', p_subject_id, 'organization', 'submitted', now(), jsonb_build_object('initiated_by_admin', true))
    on conflict do nothing
    returning id into v_id;
  end if;

  if v_id is null then
    -- Lost a race with another open request (the open-request unique index): report it, file nothing.
    select v.id into v_id from public.verifications v
     where ((p_subject_type = 'user' and v.subject_type = 'user' and v.user_id = p_subject_id)
         or (p_subject_type = 'organization' and v.subject_type = 'organization' and v.organization_id = p_subject_id))
       and v.status in ('draft', 'submitted', 'under_review', 'needs_more_info')
     order by v.submitted_at desc nulls last limit 1;
    return jsonb_build_object('state', 'already_open', 'verification_id', v_id);
  end if;

  perform app.record_audit_event('verification.admin_initiated', 'verification', v_id,
    case when p_subject_type = 'organization' then p_subject_id else null end,
    jsonb_build_object('subject_type', p_subject_type, 'subject_id', p_subject_id,
                       'subject_user_id', case when p_subject_type = 'user' then p_subject_id else null end,
                       'subject_organization_id', case when p_subject_type = 'organization' then p_subject_id else null end)
      || case when v_reason is null then '{}'::jsonb else jsonb_build_object('reason', v_reason) end);
  return jsonb_build_object('state', 'initiated', 'verification_id', v_id);
end;
$$;

revoke all on function public.admin_initiate_verification(text, uuid, text) from public, anon, service_role;
grant execute on function public.admin_initiate_verification(text, uuid, text) to authenticated;
comment on function public.admin_initiate_verification(text, uuid, text) is 'Admin only (users.verify; organizations.verify + Administrator tier for organizations). Files ONE ordinary submitted verification request, marked initiated_by_admin, for a user or organization whose owner has not submitted one, regardless of profile completion. No reason is required; an optional note goes to the audit log only. Never decides, never touches identity / ownership / phone verification; the existing review and apply steps decide.';

CREATE OR REPLACE FUNCTION app.showroom_activation_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if tg_op='INSERT' then
  -- The database owner may bootstrap historical fixtures/migrations. Neither
  -- authenticated nor service-role Data API callers can insert an active or
  -- pre-approved showroom instead of using the existing review/apply process.
  if new.org_type='showroom_dealer' and (new.status='active' or new.is_verified) and coalesce(current_setting('role',true),'none') not in ('none','postgres') then
   raise exception 'create showroom pending approval; activation requires approved verification' using errcode='22023';
  end if;
  return new;
 end if;
 if new.org_type='showroom_dealer' and new.status='active' and new.status is distinct from old.status and not exists(select 1 from app.showroom_legacy_seller_exceptions e where e.organization_id=new.id) and (not new.is_verified or not exists(select 1 from public.verifications v where v.organization_id=new.id and v.subject_type='organization' and v.verification_type='organization' and v.status='approved' and (v.expires_at is null or v.expires_at>now()))) then
 raise exception 'approved organization verification is required before showroom activation' using errcode='22023'; end if;
 return new;
end;
$function$;

create or replace function public.review_approve(p_verification_id uuid, p_grant_public_listing boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_v public.verifications;
begin
  if not app.can_review_verification(p_verification_id) or app.org_review_requires_administrator(p_verification_id) then
    raise exception 'platform reviewer authority required' using errcode = '42501';
  end if;
  select * into v_v from public.verifications where id = p_verification_id for update;
  if not found then raise exception 'verification not found'; end if;
  if v_v.user_id = v_uid
     or (v_v.organization_id is not null and app.is_org_member(v_v.organization_id)) then
    raise exception 'a reviewer may not approve their own verification' using errcode = '42501';
  end if;
  if v_v.status = 'approved' then
    if v_v.reviewer_id is distinct from v_uid then
      raise exception 'only the assigned reviewer may confirm approval' using errcode = '42501';
    end if;
    return;
  end if;
  if v_v.status <> 'under_review' then
    raise exception 'invalid transition to approved from %', v_v.status using errcode = '22023';
  end if;
  if v_v.reviewer_id is distinct from v_uid then
    raise exception 'only the assigned reviewer may approve' using errcode = '42501';
  end if;
  update public.verifications
    set status = 'approved', decided_at = now(),
        grants_public_listing = coalesce(p_grant_public_listing, false)
    where id = p_verification_id;
  perform app.record_audit_event('verification.approved', 'verification', p_verification_id,
    v_v.organization_id,
    jsonb_build_object('grants_public_listing', coalesce(p_grant_public_listing, false),
                       'subject_type', v_v.subject_type, 'subject_user_id', v_v.user_id, 'subject_organization_id', v_v.organization_id,
                       'admin_initiated', coalesce((v_v.metadata ->> 'initiated_by_admin')::boolean, false)));
  if v_v.organization_id is not null then
    perform app.notify_org(
      v_v.organization_id, 'org.manage',
      'verification.approved', 'verification', p_verification_id,
      '/b2b/organization',
      'notifications.verification.approved.title', 'notifications.verification.approved.body',
      '{}'::jsonb);
  end if;
end;
$$;

CREATE OR REPLACE FUNCTION public.review_reject(p_verification_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_v public.verifications;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not app.can_review_verification(p_verification_id) then
    raise exception 'platform reviewer authority required' using errcode = '42501';
  end if;
  -- The reason is OPTIONAL. When given it is shown to the account owner and sent in their notification.
  if v_reason is not null and char_length(v_reason) > 2000 then
    raise exception 'a rejection reason may have at most 2000 characters'
      using errcode = '22023';
  end if;
  select * into v_v from public.verifications where id = p_verification_id for update;
  if not found then raise exception 'verification not found'; end if;
  if v_v.user_id = v_uid
     or (v_v.organization_id is not null and app.is_org_member(v_v.organization_id)) then
    raise exception 'a reviewer may not decide their own verification' using errcode = '42501';
  end if;
  if v_v.status = 'rejected' then
    if v_v.reviewer_id is distinct from v_uid then
      raise exception 'only the assigned reviewer may confirm rejection' using errcode = '42501';
    end if;
    return;
  end if;
  if v_v.status <> 'under_review' then
    raise exception 'invalid transition to rejected from %', v_v.status using errcode = '22023';
  end if;
  if v_v.reviewer_id is distinct from v_uid then
    raise exception 'only the assigned reviewer may reject' using errcode = '42501';
  end if;
  update public.verifications
    set status = 'rejected', reason = v_reason, decided_at = now()
    where id = p_verification_id;
  perform app.record_audit_event('verification.rejected', 'verification', p_verification_id,
    v_v.organization_id,
    jsonb_build_object('subject_type', v_v.subject_type, 'subject_user_id', v_v.user_id, 'subject_organization_id', v_v.organization_id,
                       'admin_initiated', coalesce((v_v.metadata ->> 'initiated_by_admin')::boolean, false))
      || case when v_reason is null then '{}'::jsonb else jsonb_build_object('reason', v_reason) end);
  -- The owner is always told. With a reason the notice carries it; without one it is the generic notice.
  if v_v.organization_id is not null then
    perform app.notify_org(
      v_v.organization_id, 'org.manage',
      'verification.rejected', 'verification', p_verification_id,
      '/b2b/organization',
      'notifications.verification.rejected.title',
      case when v_reason is null then 'notifications.verification.rejected.body' else 'notifications.verification.rejected.bodyReason' end,
      case when v_reason is null then '{}'::jsonb else jsonb_build_object('reason', v_reason) end);
  elsif v_v.user_id is not null then
    perform app.notify(
      v_v.user_id, null,
      'verification.rejected', 'verification', p_verification_id,
      '/home/profile',
      'notifications.verification.userRejected.title',
      case when v_reason is null then 'notifications.verification.userRejected.body' else 'notifications.verification.userRejected.bodyReason' end,
      case when v_reason is null then '{}'::jsonb else jsonb_build_object('reason', v_reason) end);
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_user_detail(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_result jsonb;
begin
  perform app.admin_require('users.read');

  select jsonb_build_object(
    'id', u.id,
    'display_name', coalesce(p.display_name, ''),
    'display_name_ar', p.display_name_ar,
    'display_name_en', p.display_name_en,
    'headline', p.headline,
    'bio', p.bio,
    'email', app.user_facing_email(au.email),
    'phone', p.phone_e164,
    'account_type', app.user_account_type(u.id), 'registered_account', app.registered_account(u.id),
    'status', u.status,
    'is_verified', u.is_verified,
    'locale', u.locale,
    'created_at', u.created_at,
    'last_sign_in_at', au.last_sign_in_at,
    'verification_state', app.admin_user_verification_state(u.is_verified, lv.status),
    'governorate', coalesce(io.prof_governorate, io.consumer_governorate),
    'city', coalesce(io.prof_city, io.consumer_city),
    'completion', (select jsonb_build_object('percent', c -> 'percent', 'missing', c -> 'missing')
                   from app.profile_completion(u.id) c),
    'profile_id', p.id,
    'public_profile_available', p.id is not null
      and exists (select 1 from public.profile_public_directory d where d.id = p.id),
    'memberships', coalesce((
      select jsonb_agg(jsonb_build_object(
          'membership_id', m.id,
          'organization_id', o.id,
          'organization_name', o.name,
          'organization_name_ar', o.name_ar,
          'organization_name_en', o.name_en,
          'org_type', o.org_type,
          'status', m.status,
          'created_at', m.created_at,
          'capabilities', coalesce((
            select jsonb_agg(c.capability_key order by c.capability_key)
            from public.membership_capabilities c where c.membership_id = m.id), '[]'::jsonb))
        order by (m.status = 'active') desc, m.created_at, m.id)
      from public.memberships m
      join public.organizations o on o.id = m.organization_id and o.deleted_at is null
      where m.user_id = u.id), '[]'::jsonb),
    'verifications', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', v.id,
          'verification_type', v.verification_type,
          'requested_account_type', v.requested_account_type,
          'status', v.status,
          'reason', v.reason,
          'submitted_at', v.submitted_at,
          'decided_at', v.decided_at,
          -- decision history for authorized Admins: who decided, and whether an Admin started it
          'reviewer_id', v.reviewer_id,
          'reviewer_name', rp.display_name,
          'initiated_by_admin', coalesce((v.metadata ->> 'initiated_by_admin')::boolean, false),
          -- the immutable Audit Log is the source of truth: who did what, and when (oldest first)
          'events', coalesce((
            select jsonb_agg(jsonb_build_object(
                'action', a.action,
                'actor_id', a.actor_user_id,
                'actor_name', ap.display_name,
                'at', a.created_at)
              -- ties inside one transaction fall back to the workflow order
              order by a.created_at,
                       case a.action when 'verification.admin_initiated' then 0 when 'verification.review_started' then 1
                                     when 'verification.changes_requested' then 2 else 3 end,
                       a.id)
            from public.audit_log a
            left join public.profiles ap on ap.user_id = a.actor_user_id
            where a.subject_type = 'verification' and a.subject_id = v.id
              and a.action in ('verification.admin_initiated', 'verification.review_started', 'verification.changes_requested',
                               'verification.approved', 'verification.rejected')), '[]'::jsonb))
        order by v.submitted_at desc, v.id desc)
      from public.verifications v
      left join public.profiles rp on rp.user_id = v.reviewer_id
      where v.user_id = u.id and v.subject_type = 'user'), '[]'::jsonb)
  )
  into v_result
  from public.users u
  left join public.profiles p on p.user_id = u.id
  left join auth.users au on au.id = u.id
  left join public.individual_onboarding io on io.user_id = u.id
  left join lateral (
    select v.status from public.verifications v
    where v.user_id = u.id and v.subject_type = 'user'
    order by v.submitted_at desc, v.id desc
    limit 1
  ) lv on true
  where u.id = p_user_id;

  return v_result;  -- NULL: no such user
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_organization_detail(p_organization_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_result jsonb;
begin
  perform app.admin_require('organizations.read');

  select jsonb_build_object(
    'id', o.id,
    'name', o.name,
    'name_ar', o.name_ar,
    'name_en', o.name_en,
    'org_type', o.org_type,
    'status', o.status,
    'is_verified', o.is_verified, 'business_verified_at', o.business_verified_at,
    'created_at', o.created_at,
    'source', o.source,
    'referred_by', case when o.referred_by_user_id is null then null else jsonb_build_object(
        'user_id', o.referred_by_user_id,
        'display_name', coalesce((select pr.display_name from public.profiles pr where pr.user_id = o.referred_by_user_id), '')) end,
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
          'membership_id', m.id,
          'user_id', m.user_id,
          'display_name', coalesce(pr.display_name, ''),
          'status', m.status,
          'created_at', m.created_at,
          'capabilities', coalesce((
            select jsonb_agg(c.capability_key order by c.capability_key)
            from public.membership_capabilities c where c.membership_id = m.id), '[]'::jsonb))
        order by (m.status = 'active') desc, m.created_at, m.id)
      from public.memberships m
      left join public.profiles pr on pr.user_id = m.user_id
      where m.organization_id = o.id), '[]'::jsonb),
    'owners', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'display_name', coalesce(pr.display_name, ''))
        order by m.created_at, m.id)
      from public.memberships m
      join public.membership_capabilities c on c.membership_id = m.id and c.capability_key = 'org.manage'
      left join public.profiles pr on pr.user_id = m.user_id
      where m.organization_id = o.id and m.status = 'active'), '[]'::jsonb),
    'branches', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', b.id, 'name', b.name, 'name_ar', b.name_ar, 'name_en', b.name_en, 'is_active', b.is_active)
        order by b.created_at, b.id)
      from public.branches b
      where b.organization_id = o.id and b.deleted_at is null), '[]'::jsonb),
    'verifications', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', v.id,
          'verification_type', v.verification_type,
          'requested_account_type', v.requested_account_type,
          'status', v.status,
          'reason', v.reason,
          'submitted_at', v.submitted_at,
          'decided_at', v.decided_at,
          -- decision history for authorized Admins: who decided, and whether an Admin started it
          'reviewer_id', v.reviewer_id,
          'reviewer_name', rp.display_name,
          'initiated_by_admin', coalesce((v.metadata ->> 'initiated_by_admin')::boolean, false),
          -- the immutable Audit Log is the source of truth: who did what, and when (oldest first)
          'events', coalesce((
            select jsonb_agg(jsonb_build_object(
                'action', a.action,
                'actor_id', a.actor_user_id,
                'actor_name', ap.display_name,
                'at', a.created_at)
              -- ties inside one transaction fall back to the workflow order
              order by a.created_at,
                       case a.action when 'verification.admin_initiated' then 0 when 'verification.review_started' then 1
                                     when 'verification.changes_requested' then 2 else 3 end,
                       a.id)
            from public.audit_log a
            left join public.profiles ap on ap.user_id = a.actor_user_id
            where a.subject_type = 'verification' and a.subject_id = v.id
              and a.action in ('verification.admin_initiated', 'verification.review_started', 'verification.changes_requested',
                               'verification.approved', 'verification.rejected')), '[]'::jsonb))
        order by v.submitted_at desc, v.id desc)
      from public.verifications v
      left join public.profiles rp on rp.user_id = v.reviewer_id
      where v.organization_id = o.id and v.subject_type = 'organization'), '[]'::jsonb)
  )
  into v_result
  from public.organizations o
  where o.id = p_organization_id and o.deleted_at is null;

  return v_result;  -- NULL: no such (non-deleted) organization
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_users_directory(p_search text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_account_type text DEFAULT NULL::text, p_verification text DEFAULT NULL::text, p_governorate text DEFAULT NULL::text, p_sort text DEFAULT 'registered:desc'::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_q      text := nullif(btrim(coalesce(p_search, '')), '');
  v_like   text;
  v_digits text;
  v_phone  text;
  v_local  text;
  v_field  text := split_part(coalesce(p_sort, ''), ':', 1);
  v_dir    text := split_part(coalesce(p_sort, ''), ':', 2);
  v_result jsonb;
begin
  perform app.admin_require('users.read');
  perform app.admin_require_page_args(p_page, p_page_size);
  if p_sort not in ('registered:desc', 'registered:asc', 'completeness:desc', 'completeness:asc') then
    raise exception 'unsupported sort %', p_sort using errcode = '22023';
  end if;
  if p_status is not null and p_status not in ('pending', 'verified', 'suspended', 'rejected', 'attention') then
    raise exception 'unsupported status filter' using errcode = '22023';
  end if;
  if p_account_type is not null and p_account_type not in (
       'showroom_dealer', 'supplier', 'manufacturer', 'importer', 'contractor', 'engineer',
       'installer_technician', 'sales', 'end_consumer', 'none') then
    raise exception 'unsupported account type filter' using errcode = '22023';
  end if;
  if p_verification is not null and p_verification not in ('unverified', 'pending', 'verified', 'rejected') then
    raise exception 'unsupported verification filter' using errcode = '22023';
  end if;
  if v_q is not null then
    if char_length(v_q) > 100 then
      raise exception 'search term too long' using errcode = '22023';
    end if;
    v_like := app.admin_search_pattern(v_q);
    -- Phone: fold Arabic-Indic / Persian digits to ASCII, then match the
    -- canonical E.164 column by digit substring or by the database's own
    -- normalization (app.normalize_phone) of the whole term.
    v_digits := regexp_replace(translate(v_q, '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'), '[^0-9]', '', 'g');
    if char_length(v_digits) >= 3 then
      v_phone := app.normalize_phone(v_digits);
      -- A local number is typed with its trunk 0 (010...), which E.164 drops (+2010...): a partial local
      -- number must match on the digits after that 0.
      if v_digits like '0%' and char_length(v_digits) >= 4 then
        v_local := substr(v_digits, 2);
      end if;
    else
      v_digits := null;
    end if;
  end if;

  with base as materialized (
    select u.id, u.created_at,
           app.admin_user_verification_state(u.is_verified, lv.status) as vstate,
           app.admin_user_status_tab(u.status, lv.status) as tab,
           -- DERIVED, never stored: a verified account whose AUTHORITATIVE profile completion is below 100.
           -- Completion is only evaluated for verified accounts (CASE is lazy).
           case when app.admin_user_verification_state(u.is_verified, lv.status) = 'verified'
                then coalesce((app.profile_completion(u.id) ->> 'percent')::int, 100) < 100
                else false end as attention
    from public.users u
    left join public.profiles p on p.user_id = u.id
    left join public.individual_onboarding io on io.user_id = u.id
    left join lateral (
      select v.status from public.verifications v
      where v.user_id = u.id and v.subject_type = 'user'
      order by v.submitted_at desc, v.id desc
      limit 1
    ) lv on true
    where (p_account_type is null or coalesce(app.user_account_type(u.id), 'none') = p_account_type)
      and (p_governorate is null or coalesce(io.prof_governorate, io.consumer_governorate) = p_governorate)
      and (
        v_q is null
        or p.display_name ilike v_like escape '\'
        or p.display_name_ar ilike v_like escape '\'
        or p.display_name_en ilike v_like escape '\'
        or u.id in (
          select au.id from auth.users au
          where app.user_facing_email(au.email) ilike v_like escape '\')
        or (v_digits is not null and (p.phone_e164 like '%' || v_digits || '%' or p.phone_e164 = v_phone
                                    or (v_local is not null and p.phone_e164 like '%' || v_local || '%')))
      )
  ),
  scoped as materialized (
    select * from base where p_verification is null or vstate = p_verification
  ),
  filtered as materialized (
    select * from scoped
     where p_status is null
        or (p_status = 'attention' and attention)
        or (p_status <> 'attention' and tab = p_status)
  ),
  total as (
    select count(*)::int as n from filtered
  ),
  paging as (
    select least(p_page, greatest(1, ceil(t.n::numeric / p_page_size)::int)) as page from total t
  ),
  -- Completion is computed only when it is the sort key (CASE is lazy), and
  -- users.id is the final key, so equal dates/percentages never reorder
  -- between pages.
  ranked as (
    select f.id, row_number() over (order by
        case when v_field = 'registered' and v_dir = 'desc' then f.created_at end desc nulls last,
        case when v_field = 'registered' and v_dir = 'asc'  then f.created_at end asc  nulls last,
        case when v_field = 'completeness' and v_dir = 'desc' then (app.profile_completion(f.id) ->> 'percent')::int end desc nulls last,
        case when v_field = 'completeness' and v_dir = 'asc'  then (app.profile_completion(f.id) ->> 'percent')::int end asc  nulls last,
        f.id) as ord
    from filtered f
  ),
  page_ids as (
    select r.id, r.ord from ranked r
    where r.ord > ((select page from paging) - 1) * p_page_size
      and r.ord <= (select page from paging) * p_page_size
  ),
  page_rows as (
    select pi.ord, jsonb_build_object(
      'id', u.id,
      'display_name', coalesce(p.display_name, ''),
      'display_name_ar', p.display_name_ar,
      'display_name_en', p.display_name_en,
      'email', app.user_facing_email(au.email),
      'phone', p.phone_e164,
      'account_type', app.user_account_type(u.id), 'registered_account', app.registered_account(u.id),
      'status', u.status,
      'is_verified', u.is_verified,
      'created_at', u.created_at,
      'verification_state', app.admin_user_verification_state(u.is_verified, lv.status),
      'latest_verification_status', lv.status,
      'governorate', coalesce(io.prof_governorate, io.consumer_governorate),
      'city', coalesce(io.prof_city, io.consumer_city),
      'completion', (app.profile_completion(u.id) ->> 'percent')::int,
      'organization', case when org.id is null then null
                           else jsonb_build_object('id', org.id, 'name', org.name, 'name_ar', org.name_ar, 'name_en', org.name_en) end,
      'organization_count', coalesce(org.cnt, 0),
      'profile_id', p.id,
      'public_profile_available', p.id is not null
        and exists (select 1 from public.profile_public_directory d where d.id = p.id),
      'flags', case when lv.status = 'rejected' then '["verification_issue"]'::jsonb else '[]'::jsonb end
    ) as row
    from page_ids pi
    join public.users u on u.id = pi.id
    left join public.profiles p on p.user_id = u.id
    left join auth.users au on au.id = u.id
    left join public.individual_onboarding io on io.user_id = u.id
    left join lateral (
      select v.status from public.verifications v
      where v.user_id = u.id and v.subject_type = 'user'
      order by v.submitted_at desc, v.id desc
      limit 1
    ) lv on true
    left join lateral (
      select o.id, o.name, o.name_ar, o.name_en, count(*) over () as cnt
      from public.memberships m
      join public.organizations o on o.id = m.organization_id and o.deleted_at is null
      where m.user_id = u.id and m.status = 'active'
      order by m.created_at, m.id
      limit 1
    ) org on true
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(pr.row order by pr.ord) from page_rows pr), '[]'::jsonb),
    'total', (select n from total),
    'page', (select page from paging),
    'page_size', p_page_size,
    'sort', p_sort,
    'counts', (
      select jsonb_build_object(
        'all', count(*),
        'pending', count(*) filter (where tab = 'pending'),
        'verified', count(*) filter (where tab = 'verified'),
        'suspended', count(*) filter (where tab = 'suspended'),
        'rejected', count(*) filter (where tab = 'rejected'),
        'attention', count(*) filter (where attention))
      from scoped)
  ) into v_result;

  return v_result;
end;
$function$;
