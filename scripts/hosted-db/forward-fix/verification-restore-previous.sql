-- Forward-fix "verification": undo 20261115090002..006 (admin-initiated verification and its follow-ups).
-- NOT a down migration and NOT applied anywhere. Use only with the owner's explicit approval, on a hosted database, through the Supabase
-- migration path as a NEW migration (never the SQL Editor), and only if the plan "marketplace" must be undone.
-- Restores the functions, triggers and constraints that existed after 20261115090001. DATA is NOT restored: 20261115090002 and 20261115090005
-- also wrote rows (public.verifications, public.organizations); only a restore-tested backup can undo those.
-- Fails closed (whole script is one transaction): re-adding ck_audit_action_known and ck_verifications_reason_required validates every
-- existing row, so it refuses while an audit row 'verification.admin_initiated' or a verification that only the new rule allows exists.
-- Run AFTER the "marketplace" forward-fix. If the NEW application is live, roll the Worker back to the previous version first.
-- Generated from catalog facts measured on disposable databases: a clean replay of the 212 migrations up to 20261115090001 (before),
-- then the 19 plan migrations (after) and scripts/hosted-db/catalog-diff.mjs. Proven by replaying: after the plan + this script
-- (both files, marketplace first) the catalog fingerprint equals the pre-plan fingerprint (catalog-diff.mjs: no catalog differences).
begin;

ALTER TABLE public.audit_log DROP CONSTRAINT ck_audit_action_known;
ALTER TABLE public.audit_log ADD CONSTRAINT ck_audit_action_known CHECK ((action = ANY (ARRAY['organization.created'::text, 'membership.granted'::text, 'membership.activated'::text, 'membership.role_changed'::text, 'membership.suspended'::text, 'membership.revoked'::text, 'branch.created'::text, 'branch.assignment_changed'::text, 'platform_role.granted'::text, 'platform_role.revoked'::text, 'platform.override_used'::text, 'account.upgrade_requested'::text, 'verification.review_started'::text, 'verification.changes_requested'::text, 'verification.approved'::text, 'verification.rejected'::text, 'account.type_changed'::text, 'profile.listed'::text, 'profile.hidden'::text, 'customer.created'::text, 'customer.updated'::text, 'lead.created'::text, 'lead.assigned'::text, 'lead.reassigned'::text, 'lead.stage_changed'::text, 'lead.won'::text, 'lead.lost'::text, 'lead.reopened'::text, 'lead.archived'::text, 'followup.created'::text, 'followup.reassigned'::text, 'followup.completed'::text, 'followup.reopened'::text, 'customer.reassigned'::text, 'lead.details_changed'::text, 'onboarding.completed'::text, 'onboarding.consumer_completed'::text, 'onboarding.professional_submitted'::text, 'onboarding.organization_created'::text, 'product.created'::text, 'product.updated'::text, 'product.published'::text, 'product.unpublished'::text, 'rfq.created'::text, 'rfq.submitted'::text, 'rfq.updated'::text, 'rfq.cancelled'::text, 'rfq.closed'::text, 'quotation.created'::text, 'quotation.updated'::text, 'quotation.submitted'::text, 'quotation.accepted'::text, 'quotation.rejected'::text, 'order.created'::text, 'order.started'::text, 'order.completed'::text, 'order.cancelled'::text, 'project.created'::text, 'project.activated'::text, 'project.completed'::text, 'organization.verified'::text, 'affiliation.requested'::text, 'affiliation.cancelled'::text, 'affiliation.approved'::text, 'affiliation.rejected'::text, 'referral.submitted'::text, 'referral.approved'::text, 'referral.rejected'::text, 'conversation.opened'::text, 'points.adjusted'::text, 'points.reversed'::text, 'job.created'::text, 'job.updated'::text, 'job.published'::text, 'job.closed'::text, 'job.cancelled'::text, 'job.application.submitted'::text, 'job.application.withdrawn'::text, 'job.application.accepted'::text, 'job.application.rejected'::text, 'job.assignment.started'::text, 'job.assignment.progress_updated'::text, 'job.assignment.completed'::text, 'job.assignment.cancelled'::text, 'job.review.submitted'::text, 'job.review.suppressed'::text, 'job.review.restored'::text, 'network_referral.submitted'::text, 'network_referral.joined'::text, 'network_referral.approved'::text, 'network_referral.rejected'::text, 'network_referral.cancelled'::text, 'profile.username_set'::text, 'profile.phone_set'::text, 'profile.avatar_set'::text, 'organization.activities_set'::text, 'user.activities_set'::text, 'product.archived'::text, 'product.restored'::text, 'product.image_added'::text, 'product.image_removed'::text, 'product.image_reordered'::text, 'offer.created'::text, 'offer.updated'::text, 'offer.published'::text, 'offer.paused'::text, 'offer.resumed'::text, 'offer.archived'::text, 'organization.contact_set'::text, 'profile.contact_visibility_set'::text, 'network_candidate.submitted'::text, 'network_candidate.approved'::text, 'network_candidate.rejected'::text, 'network_candidate.cancelled'::text, 'product.audiences_set'::text, 'purchase_request.created'::text, 'purchase_request.updated'::text, 'purchase_request.published'::text, 'purchase_request.closed'::text, 'purchase_request.cancelled'::text, 'purchase_request.image_added'::text, 'purchase_request.image_removed'::text, 'purchase_request_response.submitted'::text, 'purchase_request_response.withdrawn'::text, 'purchase_request_response.shortlisted'::text, 'purchase_request_response.unshortlisted'::text, 'organization.application_submitted'::text, 'organization.application_abandoned'::text, 'organization.identity_change_requested'::text, 'organization.identity_change_withdrawn'::text, 'organization.identity_changed'::text, 'organization.co_owner_requested'::text, 'organization.co_owner_verified'::text, 'organization.co_owner_revoked'::text, 'branch.verification_requested'::text, 'branch.verified'::text, 'branch.deactivated'::text, 'branch.reactivated'::text, 'branch.verification_revoked'::text, 'publisher.requested'::text, 'publisher.approved'::text, 'publisher.suspended'::text, 'publisher.revoked'::text, 'publisher.reinstated'::text, 'organization.image_set'::text, 'organization.image_removed'::text, 'organization.description_changed'::text, 'account.platform_cleanup'::text, 'account.platform_prepared'::text, 'account.restored'::text, 'account.suspended'::text, 'admin_case.created'::text, 'admin_follow_up.completed'::text, 'admin_follow_up.logged'::text, 'admin_note.created'::text, 'admin_role.archived'::text, 'admin_role.assigned'::text, 'admin_role.assignment_changed'::text, 'admin_role.created'::text, 'admin_role.permissions_changed'::text, 'admin_role.restored'::text, 'admin_role.unassigned'::text, 'admin_role.updated'::text, 'admin_staff.disabled'::text, 'admin_staff.restored'::text, 'organization.duplicate_dismissed'::text, 'organization.duplicate_linked'::text, 'organization.restored'::text, 'organization.suspended'::text, 'organization.legal_name_changed'::text, 'branch.location_changed'::text, 'business_verification.approved'::text, 'business_verification.document_added'::text, 'business_verification.document_removed'::text, 'business_verification.info_requested'::text, 'business_verification.rejected'::text, 'business_verification.review_started'::text, 'business_verification.submitted'::text, 'account.password_confirm_locked'::text, 'account.password_confirmed'::text, 'phone_cooldown.overridden'::text, 'secondary_phone.cancelled'::text, 'secondary_phone.changed'::text, 'secondary_phone.converted'::text, 'secondary_phone.renewed'::text, 'secondary_phone.reserved'::text, 'media.historical_purge'::text, 'profile.password_changed'::text, 'profile.phone_change_compensated'::text, 'profile.phone_change_needs_attention'::text, 'profile.phone_changed'::text, 'profile.phone_alias_exception_issued'::text, 'profile.phone_alias_exception_revoked'::text, 'profile.phone_alias_exception_used'::text, 'contact.email_claim_started'::text, 'contact.email_removed'::text, 'contact.email_verified'::text, 'contact.support_lookup'::text, 'contact.support_released'::text, 'profile.cover_set'::text, 'phone_verification.completed'::text, 'phone_verification.started'::text, 'whatsapp_otp.settings_change_failed'::text, 'whatsapp_otp.settings_changed'::text, 'whatsapp_otp.settings_requested'::text, 'admin_staff.invitation_accepted'::text, 'admin_staff.invitation_revoked'::text, 'admin_staff.invited'::text, 'organization.social_links_changed'::text, 'whatsapp_otp.delivery_change_failed'::text, 'whatsapp_otp.delivery_changed'::text, 'whatsapp_otp.delivery_requested'::text, 'backup.environment_initialized'::text, 'backup.production_activated'::text, 'backup.production_deactivated'::text, 'backup.run_dispatched'::text, 'backup.run_failed'::text, 'backup.run_requested'::text, 'backup.run_verified'::text, 'backup.settings_changed'::text])));
ALTER TABLE public.verifications DROP CONSTRAINT ck_verifications_reason_required;
ALTER TABLE public.verifications ADD CONSTRAINT ck_verifications_reason_required CHECK (((status <> ALL (ARRAY['rejected'::verification_status, 'needs_more_info'::verification_status])) OR ((reason IS NOT NULL) AND (length(btrim(reason)) > 0))));

DROP FUNCTION IF EXISTS public.admin_initiate_verification(p_subject_type text, p_subject_id uuid, p_reason text);

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
 if new.org_type='showroom_dealer' and ((new.status='active' and new.status is distinct from old.status) or (new.is_verified and new.is_verified is distinct from old.is_verified))
 and not (old.is_verified and new.is_verified and exists(select 1 from app.showroom_legacy_seller_exceptions e where e.organization_id=new.id and e.closed_at is null)) and not app.showroom_profile_complete(new.id) then
 raise exception 'showroom business information and detailed address are required before activation' using errcode='22023'; end if;
 return new;
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
          'decided_at', v.decided_at)
        order by v.submitted_at desc, v.id desc)
      from public.verifications v
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
          'decided_at', v.decided_at)
        order by v.submitted_at desc, v.id desc)
      from public.verifications v
      where v.organization_id = o.id and v.subject_type = 'organization'), '[]'::jsonb)
  )
  into v_result
  from public.organizations o
  where o.id = p_organization_id and o.deleted_at is null;

  return v_result;  -- NULL: no such (non-deleted) organization
end;
$function$;

CREATE OR REPLACE FUNCTION public.review_reject(p_verification_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_v public.verifications;
begin
  if not app.can_review_verification(p_verification_id) then
    raise exception 'platform reviewer authority required' using errcode = '42501';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 or length(btrim(p_reason)) > 2000 then
    raise exception 'a reason of 1 to 2000 characters is required when rejecting'
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
    set status = 'rejected', reason = btrim(p_reason), decided_at = now()
    where id = p_verification_id;
  perform app.record_audit_event('verification.rejected', 'verification', p_verification_id,
    v_v.organization_id, jsonb_build_object('reason', btrim(p_reason)));
  if v_v.organization_id is not null then
    perform app.notify_org(
      v_v.organization_id, 'org.manage',
      'verification.rejected', 'verification', p_verification_id,
      '/b2b/organization',
      'notifications.verification.rejected.title', 'notifications.verification.rejected.body',
      '{}'::jsonb);
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION app.bv_decide(p_verification_id uuid, p_approve boolean, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v        public.verifications;
  v_uid    uuid := (select auth.uid());
  v_reason text := app.bv_reason(p_reason, case when p_approve then 'approving' else 'rejecting' end);
  v_org    public.organizations;
begin
  if not app.has_admin_permission('verification.approve') then
    raise exception 'admin permission verification.approve required' using errcode = '42501';
  end if;
  v := app.bv_lock_for_review(p_verification_id);
  if v.status = 'submitted' then
    update public.verifications set status = 'under_review', reviewer_id = v_uid where id = v.id;
    perform app.record_audit_event('business_verification.review_started', 'verification', v.id, v.organization_id, '{}'::jsonb);
  elsif v.status <> 'under_review' then
    raise exception 'invalid transition to % from %', case when p_approve then 'approved' else 'rejected' end, v.status
      using errcode = '22023';
  end if;

  if p_approve then
    select * into v_org from public.organizations where id = v.organization_id for update;
    if v_org.status <> 'active' or v_org.deleted_at is not null then
      raise exception 'only an active organization can be verified' using errcode = '22023';
    end if;
    update public.verifications set status = 'approved', reason = v_reason, reviewer_id = v_uid, decided_at = now()
     where id = v.id;
    update public.organizations set business_verified_at = now(), business_verification_id = v.id where id = v.organization_id;
    update public.verifications set applied_at = now() where id = v.id;
    perform app.record_audit_event('business_verification.approved', 'verification', v.id, v.organization_id,
      jsonb_build_object('reason', v_reason));
    perform app.notify_org(v.organization_id, 'org.manage', 'verification.approved', 'verification', v.id,
      '/showroom/verification', 'notifications.businessVerification.approved.title',
      'notifications.businessVerification.approved.body', '{}'::jsonb);
  else
    update public.verifications set status = 'rejected', reason = v_reason, reviewer_id = v_uid, decided_at = now()
     where id = v.id;
    perform app.record_audit_event('business_verification.rejected', 'verification', v.id, v.organization_id,
      jsonb_build_object('reason', v_reason));
    perform app.notify_org(v.organization_id, 'org.manage', 'verification.rejected', 'verification', v.id,
      '/showroom/verification', 'notifications.businessVerification.rejected.title',
      'notifications.businessVerification.rejected.body', '{}'::jsonb);
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION app.admin_user_status_tab(p_status user_status, p_latest verification_status)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    when p_status = 'suspended' then 'suspended'
    when p_latest = 'rejected' then 'rejected'
    when p_status = 'active' then 'verified'
    when p_status = 'pending_verification' then 'pending'
  end
$function$;

CREATE OR REPLACE FUNCTION public.review_approve(p_verification_id uuid, p_grant_public_listing boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    v_v.organization_id, jsonb_build_object('grants_public_listing', coalesce(p_grant_public_listing, false)));
  if v_v.organization_id is not null then
    perform app.notify_org(
      v_v.organization_id, 'org.manage',
      'verification.approved', 'verification', p_verification_id,
      '/b2b/organization',
      'notifications.verification.approved.title', 'notifications.verification.approved.body',
      '{}'::jsonb);
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.business_verification_request_info(p_verification_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v        public.verifications;
  v_reason text := app.bv_reason(p_reason, 'requesting more information');
begin
  if not app.is_business_verification_reviewer() then
    raise exception 'admin permission organizations.verify required' using errcode = '42501';
  end if;
  v := app.bv_lock_for_review(p_verification_id);
  if v.status <> 'under_review' then
    raise exception 'invalid transition to needs_more_info from %', v.status using errcode = '22023';
  end if;
  -- The assigned reviewer, or an approver taking over.
  if v.reviewer_id is distinct from (select auth.uid()) and not app.has_admin_permission('verification.approve') then
    raise exception 'only the assigned reviewer may request more information' using errcode = '42501';
  end if;
  update public.verifications set status = 'needs_more_info', reason = v_reason, reviewer_id = (select auth.uid())
   where id = v.id;
  perform app.record_audit_event('business_verification.info_requested', 'verification', v.id, v.organization_id,
    jsonb_build_object('reason', v_reason));
  perform app.notify_org(v.organization_id, 'org.manage', 'verification.changes_requested', 'verification', v.id,
    '/showroom/verification', 'notifications.businessVerification.infoRequested.title',
    'notifications.businessVerification.infoRequested.body', '{}'::jsonb);
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
  if p_status is not null and p_status not in ('pending', 'verified', 'suspended', 'rejected') then
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
           app.admin_user_status_tab(u.status, lv.status) as tab
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
    select * from scoped where p_status is null or tab = p_status
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
        'rejected', count(*) filter (where tab = 'rejected'))
      from scoped)
  ) into v_result;

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION app.showroom_review_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if new.status='approved' and new.status is distinct from old.status and new.subject_type='organization' and exists(select 1 from public.organizations o where o.id=new.organization_id and o.org_type='showroom_dealer') and not app.showroom_profile_complete(new.organization_id) then
 raise exception 'complete showroom business information before approval' using errcode='22023'; end if;
 return new;
end;
$function$;

REVOKE ALL ON FUNCTION app.showroom_review_guard() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION app.craftsman_review_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.status = 'approved' and new.status is distinct from old.status
     and new.subject_type = 'user' and new.verification_type = 'professional'
     and new.requested_account_type = 'installer_technician'
     and app.effective_persona(new.user_id) = 'installer_technician'
     and coalesce((app.profile_completion(new.user_id) ->> 'percent')::integer, 0) < 100 then
    raise exception 'complete the craftsman profile before approval' using errcode = '22023';
  end if;
  return new;
end;
$function$;

REVOKE ALL ON FUNCTION app.craftsman_review_guard() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER showroom_review_complete BEFORE UPDATE OF status ON public.verifications FOR EACH ROW EXECUTE FUNCTION app.showroom_review_guard();
CREATE TRIGGER craftsman_review_complete BEFORE UPDATE ON public.verifications FOR EACH ROW EXECUTE FUNCTION app.craftsman_review_guard();

commit;
