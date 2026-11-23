-- Verification notifications: complete the account-owner / business-owner coverage (corrective, forward-only).
--
-- 1. public.review_approve: a personal/professional approval now notifies the account owner (review_reject already told the
--    owner of a personal subject, but approval notified only organization owners). Retries cannot duplicate it: an already
--    approved verification returns before this point.
-- 2. app.bv_decide (Business Verification approve/reject): the rejection notification now carries the reviewer's reason
--    (the reason is REQUIRED by app.bv_reason, so it is always present).
-- 3. public.business_verification_request_info: the "more information" notification now carries the requested changes/reason.
-- Everything else is unchanged in all three functions: signatures, owners, search_path, authority checks, required-reason
-- policy, state transitions, audit events. Notifications use the existing centralized writers (app.notify / app.notify_org)
-- and the existing i18n key scheme, in the same transaction as the decision and only after it succeeded.

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
  elsif v_v.user_id is not null then
    -- The account owner is told of an approval too (the rejection path already did this for a personal subject).
    -- Reached once per decision: a retry of an approved verification returns above, before this point.
    perform app.notify(
      v_v.user_id, null,
      'verification.approved', 'verification', p_verification_id,
      '/home/profile',
      'notifications.verification.userApproved.title',
      case when coalesce(p_grant_public_listing, false) then 'notifications.verification.userApproved.bodyListed'
           else 'notifications.verification.userApproved.body' end,
      '{}'::jsonb);
  end if;
end;
$$;

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
      'notifications.businessVerification.rejected.bodyReason', jsonb_build_object('reason', v_reason));
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
    'notifications.businessVerification.infoRequested.bodyReason', jsonb_build_object('reason', v_reason));
end;
$function$;
