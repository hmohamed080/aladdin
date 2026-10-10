-- ===========================================================================
-- Admin Core Phase 1B-B (1/4) — permissions and audit vocabulary for the
-- Users / Organizations operational workflows.
--
-- users.suspend / organizations.suspend already exist (Phase 1A). Notes,
-- follow-ups, internal cases and duplicate resolution are NOT edits of the
-- user or organization, so they get their own resource.action keys rather
-- than overloading users.read / organizations.read (docs/admin/
-- ADMIN_USER_ORG_OPERATIONS.md §2). Support stays read-only (PD-004): it
-- gains only the three .read keys.
-- ===========================================================================

insert into public.admin_permissions (key, resource, action, description, sort_order) values
  ('notes.read',         'notes',      'read',    'Read internal Admin Notes on users and organizations.', 90),
  ('notes.create',       'notes',      'create',  'Append an internal Admin Note (notes are never edited or deleted).', 91),
  ('follow_ups.read',    'follow_ups', 'read',    'Read the Admin follow-up history of users and organizations.', 92),
  ('follow_ups.manage',  'follow_ups', 'manage',  'Log, assign and complete Admin follow-ups.', 93),
  ('cases.read',         'cases',      'read',    'Read internal Admin reports / cases.', 94),
  ('cases.create',       'cases',      'create',  'Open an internal Admin report / case.', 95),
  ('duplicates.resolve', 'duplicates', 'resolve', 'Link a duplicate organization to its existing record, or dismiss the suggestion (no merge).', 96);

insert into public.admin_role_permissions (role_id, permission_key, is_locked)
select r.id, p.key, r.key = 'super_admin'
from public.admin_roles r
join public.admin_permissions p on p.key in (
  'notes.read', 'notes.create', 'follow_ups.read', 'follow_ups.manage',
  'cases.read', 'cases.create', 'duplicates.resolve')
where r.is_system
  and (r.key in ('super_admin', 'administrator', 'moderator')
       or (r.key = 'support' and p.key in ('notes.read', 'follow_ups.read', 'cases.read')));

-- The Phase 1A catalog descriptions promised "no write path yet"; 1B-B adds it.
update public.admin_permissions set description = 'Suspend and restore user accounts (PD-010).' where key = 'users.suspend';
update public.admin_permissions set description = 'Suspend and restore organizations (PD-011).' where key = 'organizations.suspend';

-- ---------------------------------------------------------------------------
-- Audit vocabulary (the full list, as every feature migration re-states it).
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
  'organization.duplicate_linked', 'organization.duplicate_dismissed'
));
