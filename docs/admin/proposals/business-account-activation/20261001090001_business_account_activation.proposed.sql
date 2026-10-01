-- ===========================================================================
-- Business-track account activation (lifecycle fix).
--
-- PROBLEM. users.status becomes 'active' only through app.activate_personal_account(),
-- which is called from the two PERSONAL onboarding terminals
-- (individual_complete_consumer / individual_submit_professional). A business-track
-- registrant never passes through either, so a fully operational owner (confirmed
-- email, consent, username, an ACTIVE organization membership, resolving to
-- my_registration_state() = 'active_personal') stays 'pending_verification'
-- forever. Admin then reports them as Pending, and anything that requires
-- status = 'active' (e.g. the Super Admin bootstrap) can never accept them.
--
-- RULE (one definition: app.business_account_ready). A pending account is
-- operationally active when ALL of these hold; each is a predicate the registration
-- state machine (20260924090007) already uses, nothing new:
--   * the Auth email is confirmed;
--   * the onboarding track is 'business' and the account-type step is complete;
--   * current consent receipts exist for terms, privacy and pilot;
--   * a username is stored (mandatory registration data);
--   * at least one ACTIVE organization membership (the active_personal predicate).
-- That is the intersection of access_ready and active_personal: it never activates
-- anyone the registration flow would still ask to do something.
--
-- WHEN. Whichever event completes the last missing piece, via four thin AFTER
-- triggers that all call the same helper: membership becomes active, username set,
-- account-type step completed, consent recorded. The order of those events is
-- irrelevant.
--
-- WHAT IT DOES NOT DO. It only ever promotes 'pending_verification' (a suspended or
-- deactivated account is never touched; same guard as activate_personal_account),
-- writes NO persona (primary_account_type), emits NO consumer/professional
-- completion event, creates no verification request, and changes no RBAC
-- permission or role. It is idempotent: an already-active account is a no-op.
-- Each activation is audited as 'account.activated' (source: business_lifecycle |
-- business_backfill) and carries the previous status, so it is reversible by data.
--
-- BACKFILL. The same helper, over existing pending business-track accounts, once at
-- the end of this migration. Nobody is special-cased.
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
  -- Admin Core 1A — RBAC.
  'admin_role.created', 'admin_role.updated', 'admin_role.permissions_changed',
  'admin_role.archived', 'admin_role.restored',
  'admin_role.assigned', 'admin_role.unassigned', 'admin_role.assignment_changed',
  'admin_staff.disabled', 'admin_staff.restored',
  -- Admin Core 1B-B — operational workflows.
  'account.suspended', 'account.restored',
  'organization.suspended', 'organization.restored',
  'admin_note.created',
  'admin_follow_up.logged', 'admin_follow_up.completed',
  'admin_case.created',
  'organization.duplicate_linked', 'organization.duplicate_dismissed',
  -- Business account activation lifecycle (this migration).
  'account.activated'
));

-- ---------------------------------------------------------------------------
-- 2. The one definition of "operationally ready business account"
-- ---------------------------------------------------------------------------
create or replace function app.business_account_ready(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from auth.users au where au.id = p_uid and au.email_confirmed_at is not null)
     and exists (select 1 from public.onboarding_progress op
                 where op.user_id = p_uid and op.selected_track = 'business'
                   and op.account_type_completed_at is not null)
     and exists (select 1 from public.profiles p where p.user_id = p_uid and p.username is not null)
     and (select count(distinct cr.consent_type) from public.consent_receipts cr
          where cr.user_id = p_uid
            and cr.consent_type in ('terms', 'privacy', 'pilot')
            and cr.version = app.current_consent_version(cr.consent_type)) = 3
     and exists (select 1 from public.memberships m where m.user_id = p_uid and m.status = 'active');
$$;
revoke execute on function app.business_account_ready(uuid) from public, anon, authenticated, service_role;
comment on function app.business_account_ready(uuid) is
  'THE business-account activation rule: confirmed email + business track with the account-type step complete + current terms/privacy/pilot consent + a stored username + an active organization membership. The intersection of my_registration_state() access_ready and active_personal. Internal; no client grant.';

-- ---------------------------------------------------------------------------
-- 3. The promotion (idempotent, pending-only, audited)
-- ---------------------------------------------------------------------------
create or replace function app.activate_business_account(p_uid uuid, p_source text default 'business_lifecycle')
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- Cheap exit first: only a pending identity can ever be promoted.
  if not exists (select 1 from public.users u where u.id = p_uid and u.status = 'pending_verification') then
    return false;
  end if;
  if not app.business_account_ready(p_uid) then
    return false;
  end if;
  -- The status predicate is re-checked by the UPDATE itself, so a concurrent
  -- suspension that commits first wins and the account stays suspended.
  update public.users
     set status = 'active'
   where id = p_uid
     and status = 'pending_verification'
  returning id into v_id;
  if v_id is null then
    return false;
  end if;
  perform app.record_audit_event('account.activated', 'user', p_uid, null,
    jsonb_build_object('track', 'business', 'source', p_source, 'previous_status', 'pending_verification'));
  return true;
end;
$$;
revoke execute on function app.activate_business_account(uuid, text) from public, anon, authenticated, service_role;
comment on function app.activate_business_account(uuid, text) is
  'Promotes a pending_verification account to active when app.business_account_ready() holds. Pending-only (suspended/deactivated untouched), idempotent, audited as account.activated. Writes no persona and no consumer/professional event. Internal; reached only from the lifecycle triggers and the backfill.';

-- ---------------------------------------------------------------------------
-- 4. Lifecycle events: thin triggers, one shared function
-- ---------------------------------------------------------------------------
create or replace function app.business_activation_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.activate_business_account(new.user_id, 'business_lifecycle');
  return null;
end;
$$;
revoke execute on function app.business_activation_trigger() from public, anon, authenticated, service_role;

create trigger trg_business_activation_membership
  after insert or update of status on public.memberships
  for each row when (new.status = 'active')
  execute function app.business_activation_trigger();

create trigger trg_business_activation_username
  after insert or update of username on public.profiles
  for each row when (new.username is not null)
  execute function app.business_activation_trigger();

create trigger trg_business_activation_account_type
  after insert or update of selected_track, account_type_completed_at on public.onboarding_progress
  for each row when (new.selected_track = 'business' and new.account_type_completed_at is not null)
  execute function app.business_activation_trigger();

create trigger trg_business_activation_consent
  after insert on public.consent_receipts
  for each row
  execute function app.business_activation_trigger();

-- ---------------------------------------------------------------------------
-- 5. Backfill: the same rule over existing pending business-track accounts
-- ---------------------------------------------------------------------------
create or replace function app.activate_business_accounts_backfill()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_n   int := 0;
begin
  for v_uid in
    select u.id from public.users u
    where u.status = 'pending_verification'
      and exists (select 1 from public.onboarding_progress op
                  where op.user_id = u.id and op.selected_track = 'business')
    order by u.created_at, u.id
  loop
    if app.activate_business_account(v_uid, 'business_backfill') then
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;
revoke execute on function app.activate_business_accounts_backfill() from public, anon, authenticated, service_role;

select app.activate_business_accounts_backfill();
