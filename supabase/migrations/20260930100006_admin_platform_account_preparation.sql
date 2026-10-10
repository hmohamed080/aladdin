-- ===========================================================================
-- Admin Core - dedicated platform-staff account preparation.
--
-- PROBLEM. app.admin_bootstrap_super_admin() accepts only an ACTIVE account, but a
-- person who signs up through the product and is meant to be pure platform staff
-- (no persona, no organization) stays `pending_verification`: the canonical
-- registration flow never activates anyone (docs/admin/ADMIN_IMPLEMENTATION_BACKLOG.md
-- BL-033, tracked separately and NOT touched here). Hand-editing users.status is not
-- an auditable, repeatable procedure.
--
-- WHAT THIS ADDS. One DB-owner-only helper, app.admin_prepare_platform_account(),
-- used immediately before the (unchanged) one-time bootstrap. It promotes exactly
-- one explicitly named account pending_verification -> active so that
-- my_registration_state() resolves to active_personal and the normal sign-in chain
-- lands platform staff in /admin without ordinary onboarding. STRICT MODE: it
-- refuses anything that is not a dedicated platform account.
--
--   * target must exist, with a CONFIRMED Auth email and not banned;
--   * suspended / deactivated accounts are refused;
--   * an account holding a PERSONA (users.primary_account_type) or any ACTIVE
--     organization membership is refused - this is not a general activation path;
--   * pending_verification -> active only; an already-active account is a no-op
--     (idempotent, no audit row);
--   * an explicit reason is mandatory; the change is audited as
--     account.platform_prepared (previous status, reason, source);
--   * it creates NO persona, organization, membership, onboarding or consent row, and
--     fakes no onboarding completion;
--   * no client grant (not even service_role); the one-time bootstrap, the
--     last-Super-Admin triggers, RLS and every permission are untouched.
--
-- It also adds the audit action account.platform_cleanup. The disposable-artifact
-- cleanup that precedes a preparation is direct DML on tables that have NO automatic
-- audit trigger, so the operational transaction records one explicit event itself.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Audit vocabulary (the full list, as every feature migration re-states it)
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
  'organization.verified',
  'affiliation.requested', 'affiliation.cancelled',
  'affiliation.approved', 'affiliation.rejected',
  'referral.submitted', 'referral.approved', 'referral.rejected',
  'conversation.opened',
  'points.adjusted', 'points.reversed',
  'job.created', 'job.updated', 'job.published', 'job.closed', 'job.cancelled',
  'job.application.submitted', 'job.application.withdrawn',
  'job.application.accepted', 'job.application.rejected',
  'job.assignment.started', 'job.assignment.progress_updated',
  'job.assignment.completed', 'job.assignment.cancelled',
  'job.review.submitted', 'job.review.suppressed', 'job.review.restored',
  'network_referral.submitted', 'network_referral.joined',
  'network_referral.approved', 'network_referral.rejected', 'network_referral.cancelled',
  'profile.username_set', 'profile.phone_set', 'profile.avatar_set',
  'organization.activities_set', 'user.activities_set',
  -- Admin Core 1A - RBAC.
  'admin_role.created', 'admin_role.updated', 'admin_role.permissions_changed',
  'admin_role.archived', 'admin_role.restored',
  'admin_role.assigned', 'admin_role.unassigned', 'admin_role.assignment_changed',
  'admin_staff.disabled', 'admin_staff.restored',
  -- Admin Core 1B-B - operational workflows.
  'account.suspended', 'account.restored',
  'organization.suspended', 'organization.restored',
  'admin_note.created',
  'admin_follow_up.logged', 'admin_follow_up.completed',
  'admin_case.created',
  'organization.duplicate_linked', 'organization.duplicate_dismissed',
  -- Platform account preparation (this migration).
  'account.platform_prepared',
  -- Explicit record of the disposable sign-up cleanup that precedes a preparation
  -- (written by docs/admin/ops/prepare_platform_admin_account.sql inside its one transaction).
  'account.platform_cleanup'
));

-- ---------------------------------------------------------------------------
-- 2. The helper
-- ---------------------------------------------------------------------------
create or replace function app.admin_prepare_platform_account(p_user_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason    text := app.admin_clean_reason(p_reason);
  v_status    public.user_status;
  v_persona   public.persona_type;
  v_confirmed timestamptz;
  v_banned    timestamptz;
begin
  if v_reason is null then
    raise exception 'a reason is required' using errcode = '22023';
  end if;

  -- Lock the identity so a concurrent suspension or membership change serializes
  -- with this decision.
  select u.status, u.primary_account_type into v_status, v_persona
  from public.users u where u.id = p_user_id for update;
  if not found then
    raise exception 'user not found' using errcode = '22023';
  end if;

  select au.email_confirmed_at, au.banned_until into v_confirmed, v_banned
  from auth.users au where au.id = p_user_id;
  if v_confirmed is null then
    raise exception 'a confirmed email is required' using errcode = '22023';
  end if;
  if v_banned is not null and v_banned > now() then
    raise exception 'a banned account cannot be prepared' using errcode = '22023';
  end if;
  if v_status in ('suspended', 'deactivated') then
    raise exception 'a % account cannot be prepared', v_status using errcode = '22023';
  end if;

  -- Strict mode: dedicated platform accounts only.
  if v_persona is not null then
    raise exception 'an account with a personal persona is not a dedicated platform account' using errcode = '22023';
  end if;
  if exists (select 1 from public.memberships m where m.user_id = p_user_id and m.status = 'active') then
    raise exception 'an account with an active organization membership is not a dedicated platform account' using errcode = '22023';
  end if;

  if v_status = 'active' then
    return false;  -- already prepared / active: nothing to do
  end if;

  update public.users set status = 'active'
  where id = p_user_id and status = 'pending_verification';

  perform app.record_audit_event('account.platform_prepared', 'user', p_user_id, null,
    jsonb_build_object('previous_status', v_status, 'reason', v_reason, 'source', 'dba_platform_prepare'));
  return true;
end;
$$;
revoke all on function app.admin_prepare_platform_account(uuid, text) from public, anon, authenticated, service_role;
comment on function app.admin_prepare_platform_account(uuid, text) is
  'DB-owner-only. Promotes ONE explicitly named, dedicated platform account (confirmed email, not banned, no persona, no active membership) from pending_verification to active so the normal sign-in chain lands it in /admin; run immediately before app.admin_bootstrap_super_admin(). Refuses suspended/deactivated/banned and any account with a persona or active membership. Idempotent. Audited as account.platform_prepared. Creates no persona, organization, onboarding or consent row.';
