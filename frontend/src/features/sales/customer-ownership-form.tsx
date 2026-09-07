"use client";

import { useI18n } from "@/lib/i18n/context";
import { setCustomerOwnershipAction } from "@/server/actions/sales-forms";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select, LabeledField } from "@/components/ui/controls";
import { useBranchAssignees } from "@/features/sales/use-branch-assignees";
import type { OrgMember } from "@/server/queries/sales";

/**
 * Change a customer's owning branch and/or salesperson (Sprint 6). Rendered only
 * when the caller holds assignment authority. The selects live INSIDE the
 * accessible ConfirmDialog so a branch move is explicitly confirmed with its
 * visibility consequence spelled out; the trusted `set_customer_ownership` RPC
 * enforces scope, assignee branch-compatibility, concurrency, and audit. Selects
 * are controlled so the picked values survive an expected validation/conflict
 * error (the dialog stays open on error). Type is immutable and never shown here.
 *
 * The assignee list is branch-reactive (`membersByBranch`, keyed per branch —
 * see `listOrgMembersByBranch`): picking a different branch re-filters to
 * teammates who can actually reach it. If the branch move would strand the
 * currently-selected assignee, that selection is never silently cleared or
 * submitted — `useBranchAssignees` keeps it visibly selected (flagged stale)
 * and `confirmDisabled` blocks Save until an explicit new choice is made.
 */
export function CustomerOwnershipForm({
  customerId,
  expectedUpdatedAt,
  currentBranchId,
  currentAssigneeId,
  branches,
  membersByBranch,
  canOrgWide,
}: {
  customerId: string;
  expectedUpdatedAt: string;
  currentBranchId: string | null;
  currentAssigneeId: string | null;
  branches: { id: string; name: string }[];
  membersByBranch: Record<string, OrgMember[]>;
  canOrgWide: boolean;
}) {
  const { t } = useI18n();
  const ba = useBranchAssignees(membersByBranch, currentBranchId ?? "", currentAssigneeId ?? "");

  return (
    <ConfirmDialog
      trigger={t("customers.ownershipTitle")}
      triggerVariant="outline"
      title={t("confirm.moveCustomerTitle")}
      body={t("confirm.moveCustomerBody")}
      confirmLabel={t("common.saveChanges")}
      confirmVariant="primary"
      formAction={setCustomerOwnershipAction}
      confirmDisabled={ba.isStale}
    >
      {() => (
        <>
          <input type="hidden" name="customerId" value={customerId} />
          <input type="hidden" name="expectedUpdatedAt" value={expectedUpdatedAt} />
          <input type="hidden" name="currentBranchId" value={currentBranchId ?? ""} />
          <input type="hidden" name="currentAssigneeId" value={currentAssigneeId ?? ""} />

          <LabeledField label={t("customers.branch")} htmlFor="own-branch">
            <Select id="own-branch" name="branchId" value={ba.branch} onChange={(e) => ba.onBranchChange(e.target.value)}>
              {canOrgWide ? <option value="">{t("common.none")}</option> : null}
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </LabeledField>

          <LabeledField
            label={t("customers.assignee")}
            htmlFor="own-assignee"
            error={ba.isStale ? t("states.assigneeBranch") : undefined}
            hint={!ba.branchKnown ? t("common.selectBranchFirst") : undefined}
          >
            <Select
              id="own-assignee"
              name="assigneeMembershipId"
              value={ba.assignee}
              onChange={(e) => ba.onAssigneeChange(e.target.value)}
              disabled={!ba.branchKnown}
              aria-invalid={ba.isStale ? true : undefined}
            >
              <option value="">{t("common.unassigned")}</option>
              {ba.candidates.map((mem) => (
                <option key={mem.membershipId} value={mem.membershipId}>
                  {mem.displayName}
                </option>
              ))}
              {ba.isStale ? (
                <option value={ba.assignee}>{ba.staleLabel ?? t("states.assigneeBranch")}</option>
              ) : null}
            </Select>
          </LabeledField>
        </>
      )}
    </ConfirmDialog>
  );
}
