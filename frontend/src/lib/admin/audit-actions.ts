/**
 * Every audit action the platform can emit, mirroring the `ck_audit_action_known`
 * allow-list in the database (latest definition: migration
 * `20260813090002_organization_verification_apply.sql`).
 *
 * It exists so the Admin audit feed can be PROVEN to have a human label for every
 * action rather than falling back to the raw enum key — which is exactly the
 * defect Pilot UAT found on `/admin/audit`. Keep it in step with the migration
 * whenever the allow-list changes; `audit-actions.test.ts` fails the build if a
 * translation is missing.
 */
export const AUDIT_ACTIONS = [
  "organization.created",
  "organization.verified",
  "membership.granted",
  "membership.activated",
  "membership.role_changed",
  "membership.suspended",
  "membership.revoked",
  "branch.created",
  "branch.assignment_changed",
  "platform_role.granted",
  "platform_role.revoked",
  "platform.override_used",
  "account.upgrade_requested",
  "account.type_changed",
  "verification.review_started",
  "verification.changes_requested",
  "verification.approved",
  "verification.rejected",
  "profile.listed",
  "profile.hidden",
  "onboarding.completed",
  "onboarding.consumer_completed",
  "onboarding.professional_submitted",
  "onboarding.organization_created",
  "customer.created",
  "customer.updated",
  "customer.reassigned",
  "lead.created",
  "lead.assigned",
  "lead.reassigned",
  "lead.stage_changed",
  "lead.details_changed",
  "lead.won",
  "lead.lost",
  "lead.reopened",
  "lead.archived",
  "followup.created",
  "followup.reassigned",
  "followup.completed",
  "followup.reopened",
  "product.created",
  "product.updated",
  "product.published",
  "product.unpublished",
  "rfq.created",
  "rfq.submitted",
  "rfq.updated",
  "rfq.cancelled",
  "rfq.closed",
  "quotation.created",
  "quotation.updated",
  "quotation.submitted",
  "quotation.accepted",
  "quotation.rejected",
  "order.created",
  "order.started",
  "order.completed",
  "order.cancelled",
  "project.created",
  "project.activated",
  "project.completed",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** The i18n key suffix under `admin.actions.*` (the catalog is kept flat). */
export function auditActionKey(action: string): string {
  return action.replaceAll(".", "_");
}
