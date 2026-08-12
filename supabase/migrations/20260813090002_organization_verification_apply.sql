-- Migration: apply an approved ORGANIZATION verification (Pilot UAT round 1).
--
-- Admin functional review found that approving an organization verification had
-- no effect on the organization: `review_approve` records the DECISION (that part
-- is correct and unchanged), and `apply_account_upgrade` only knows how to apply a
-- USER professional upgrade. Nothing ever set `organizations.is_verified`, so an
-- approved organization stayed `pending_verification` and unverified forever.
--
-- This adds the missing counterpart, exactly mirroring `apply_account_upgrade`:
-- platform authority, approved-only, expiry-checked, idempotent through
-- `applied_at`, audited. It is the SAME review system — a second decision surface
-- is not introduced; only the apply step for the organization subject.

-- ---------------------------------------------------------------------------
-- 1. Extend the audit action allow-list
-- ---------------------------------------------------------------------------
alter table public.audit_log drop constraint ck_audit_action_known;
alter table public.audit_log add constraint ck_audit_action_known check (action in (
  'organization.created',
  'membership.granted', 'membership.activated', 'membership.role_changed',
  'membership.suspended', 'membership.revoked',
  'branch.created', 'branch.assignment_changed',
  'platform_role.granted', 'platform_role.revoked', 'platform.override_used',
  'account.upgrade_requested',
  'verification.review_started', 'verification.changes_requested',
  'verification.approved', 'verification.rejected',
  'account.type_changed', 'profile.listed', 'profile.hidden',
  'customer.created', 'customer.updated',
  'lead.created', 'lead.assigned', 'lead.reassigned', 'lead.stage_changed',
  'lead.won', 'lead.lost', 'lead.reopened', 'lead.archived',
  'followup.created', 'followup.reassigned', 'followup.completed', 'followup.reopened',
  'customer.reassigned', 'lead.details_changed',
  'onboarding.completed',
  'onboarding.consumer_completed', 'onboarding.professional_submitted',
  'onboarding.organization_created',
  'product.created', 'product.updated', 'product.published', 'product.unpublished',
  'rfq.created', 'rfq.submitted', 'rfq.updated', 'rfq.cancelled', 'rfq.closed',
  'quotation.created', 'quotation.updated', 'quotation.submitted',
  'quotation.accepted', 'quotation.rejected',
  'order.created', 'order.started', 'order.completed', 'order.cancelled',
  'project.created', 'project.activated', 'project.completed',
  -- Pilot UAT round 1 — an approved organization review was applied.
  'organization.verified'
));

-- ---------------------------------------------------------------------------
-- 2. apply_organization_verification — the organization-subject apply step
-- ---------------------------------------------------------------------------
create or replace function public.apply_organization_verification(p_verification_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_v    public.verifications;
  v_org  public.organizations;
begin
  if not app.is_platform('support') then
    raise exception 'platform authority required' using errcode = '42501';
  end if;
  select * into v_v from public.verifications where id = p_verification_id for update;
  if not found then raise exception 'verification not found'; end if;
  if v_v.status <> 'approved' then
    raise exception 'only an approved verification can be applied (status=%)', v_v.status
      using errcode = '22023';
  end if;
  if v_v.applied_at is not null then return; end if;  -- idempotent
  if v_v.expires_at is not null and v_v.expires_at <= now() then
    raise exception 'an expired verification cannot be applied' using errcode = '22023';
  end if;
  if v_v.subject_type <> 'organization'
     or v_v.verification_type <> 'organization'
     or v_v.organization_id is null then
    raise exception 'verification is not an organization approval' using errcode = '22023';
  end if;

  select * into v_org from public.organizations where id = v_v.organization_id for update;
  if not found then
    raise exception 'verification subject has no organization row' using errcode = '23503';
  end if;

  -- Approval grants the trust flag and releases the organization from the review
  -- hold. A suspended or archived organization is NOT silently reopened — an
  -- approval is a trust decision, not a lifecycle override.
  if not v_org.is_verified or v_org.status in ('draft', 'pending_verification') then
    update public.organizations
       set is_verified = true,
           status = case
                      when status in ('draft', 'pending_verification') then 'active'::public.org_status
                      else status
                    end
     where id = v_org.id;
    perform app.record_audit_event('organization.verified', 'organization', v_org.id, v_org.id,
      jsonb_build_object('from_status', v_org.status, 'was_verified', v_org.is_verified));
  end if;

  update public.verifications set applied_at = now() where id = p_verification_id;
end;
$$;

revoke execute on function public.apply_organization_verification(uuid) from public;
grant execute on function public.apply_organization_verification(uuid) to authenticated;
comment on function public.apply_organization_verification(uuid) is 'Apply an APPROVED organization verification: sets organizations.is_verified and releases a draft/pending_verification organization to active. Platform-authority only, approved-only, expiry-checked, idempotent via verifications.applied_at, audited as organization.verified. The organization-subject counterpart of apply_account_upgrade — same review system, not a second one.';
