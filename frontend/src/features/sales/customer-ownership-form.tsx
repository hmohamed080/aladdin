"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { setCustomerOwnershipAction } from "@/server/actions/sales-forms";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select, LabeledField } from "@/components/ui/controls";
import type { OrgMember } from "@/server/queries/sales";

/**
 * Change a customer's owning branch and/or salesperson (Sprint 6). Rendered only
 * when the caller holds assignment authority. The selects live INSIDE the
 * accessible ConfirmDialog so a branch move is explicitly confirmed with its
 * visibility consequence spelled out; the trusted `set_customer_ownership` RPC
 * enforces scope, assignee branch-compatibility, concurrency, and audit. Selects
 * are controlled so the picked values survive an expected validation/conflict
 * error (the dialog stays open on error). Type is immutable and never shown here.
 */
export function CustomerOwnershipForm({
  customerId,
  expectedUpdatedAt,
  currentBranchId,
  currentAssigneeId,
  branches,
  members,
  canOrgWide,
}: {
  customerId: string;
  expectedUpdatedAt: string;
  currentBranchId: string | null;
  currentAssigneeId: string | null;
  branches: { id: string; name: string }[];
  members: OrgMember[];
  canOrgWide: boolean;
}) {
  const { t } = useI18n();
  const [branch, setBranch] = useState(currentBranchId ?? "");
  const [assignee, setAssignee] = useState(currentAssigneeId ?? "");

  return (
    <ConfirmDialog
      trigger={t("customers.ownershipTitle")}
      triggerVariant="outline"
      title={t("confirm.moveCustomerTitle")}
      body={t("confirm.moveCustomerBody")}
      confirmLabel={t("common.saveChanges")}
      confirmVariant="primary"
      formAction={setCustomerOwnershipAction}
    >
      {() => (
        <>
          <input type="hidden" name="customerId" value={customerId} />
          <input type="hidden" name="expectedUpdatedAt" value={expectedUpdatedAt} />
          <input type="hidden" name="currentBranchId" value={currentBranchId ?? ""} />
          <input type="hidden" name="currentAssigneeId" value={currentAssigneeId ?? ""} />

          <LabeledField label={t("customers.branch")} htmlFor="own-branch">
            <Select id="own-branch" name="branchId" value={branch} onChange={(e) => setBranch(e.target.value)}>
              {canOrgWide ? <option value="">{t("common.none")}</option> : null}
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </LabeledField>

          <LabeledField label={t("customers.assignee")} htmlFor="own-assignee">
            <Select id="own-assignee" name="assigneeMembershipId" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">{t("common.unassigned")}</option>
              {members.map((mem) => (
                <option key={mem.membershipId} value={mem.membershipId}>
                  {mem.displayName}
                </option>
              ))}
            </Select>
          </LabeledField>
        </>
      )}
    </ConfirmDialog>
  );
}
