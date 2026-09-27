-- ===========================================================================
-- Staging-prep Increment 9 — fix: allow-list the new audit actions
--
-- REAL BUG, found running the pgTAP suite against a real migrated database
-- (per the repo's own gate protocol — see docs/operations/RUNTIME_STATE.md).
-- `ck_audit_action_known` (public.audit_log) is a CHECK constraint naming
-- every action string any writer may record, updated by every prior feature
-- migration that introduced one (20260911090001_network_referrals.sql being
-- the most recent). Increments 1/2/3/5 of THIS pass each added a new writer
-- that calls `app.record_audit_event` with a brand-new action string —
-- 'profile.username_set', 'profile.phone_set', 'profile.avatar_set',
-- 'organization.activities_set', 'user.activities_set' — but none of them
-- updated this constraint.
--
-- The practical effect: every one of those five RPCs raised
-- '23514 (ck_audit_action_known)' on its very first successful call,
-- INCLUDING `profile_set_username` — the write path for this pass's own
-- mandatory registration step. Username registration was completely broken.
-- Caught by `supabase/tests/58_staging_prep_registration_test.sql` (tests 2,
-- 4, 8, 9, 12) once run against a real database; masked before that because
-- no prior pass in this branch had executed these RPCs against real Postgres.
-- ===========================================================================

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
  -- Staging-prep Increments 1/2/3/5 — the fix this migration makes.
  'profile.username_set', 'profile.phone_set', 'profile.avatar_set',
  'organization.activities_set', 'user.activities_set'
));
