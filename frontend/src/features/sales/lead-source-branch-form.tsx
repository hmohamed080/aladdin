"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { setLeadSourceBranchAction } from "@/server/actions/sales-forms";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select, LabeledField } from "@/components/ui/controls";
import { SALES_SOURCES } from "@/lib/ui/format";
import type { OrgMember } from "@/server/queries/sales";

/**
 * Change a lead's source and/or branch (Sprint 6), with an optional compatible
 * reassignment. Lifecycle (stage/won-lost/status) is NOT here — it stays in the
 * lead actions. A branch move is confirmed with its visibility consequence. The
 * trusted `set_lead_source_branch` RPC enforces version, scope, capability, and
 * assignee branch-compatibility (a stranding move is rejected). Controlled selects
 * so picked values survive an expected error. `assign` gates the branch/reassign
 * controls; without it only source is editable.
 */
export function LeadSourceBranchForm({
  leadId,
  version,
  currentSource,
  currentBranchId,
  currentAssigneeId,
  branches,
  members,
  canAssign,
  canOrgWide,
}: {
  leadId: string;
  version: number;
  currentSource: string | null;
  currentBranchId: string | null;
  currentAssigneeId: string | null;
  branches: { id: string; name: string }[];
  members: OrgMember[];
  canAssign: boolean;
  canOrgWide: boolean;
}) {
  const { t } = useI18n();
  const [source, setSource] = useState(currentSource ?? "");
  const [branch, setBranch] = useState(currentBranchId ?? "");
  const [assignee, setAssignee] = useState(currentAssigneeId ?? "");

  return (
    <ConfirmDialog
      trigger={t("leads.ownershipTitle")}
      triggerVariant="outline"
      title={t("confirm.moveLeadTitle")}
      body={t("confirm.moveLeadBody")}
      confirmLabel={t("common.saveChanges")}
      confirmVariant="primary"
      formAction={setLeadSourceBranchAction}
    >
      {() => (
        <>
          <input type="hidden" name="leadId" value={leadId} />
          <input type="hidden" name="version" value={version} />
          <input type="hidden" name="currentSource" value={currentSource ?? ""} />
          <input type="hidden" name="currentBranchId" value={currentBranchId ?? ""} />
          <input type="hidden" name="currentAssigneeId" value={currentAssigneeId ?? ""} />

          <LabeledField label={t("leads.source")} htmlFor="lsb-source">
            <Select id="lsb-source" name="source" value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">{t("common.none")}</option>
              {SALES_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {t(`source.${s}`)}
                </option>
              ))}
            </Select>
          </LabeledField>

          {canAssign ? (
            <>
              <LabeledField label={t("leads.branch")} htmlFor="lsb-branch">
                <Select id="lsb-branch" name="branchId" value={branch} onChange={(e) => setBranch(e.target.value)}>
                  {canOrgWide ? <option value="">{t("common.none")}</option> : null}
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </LabeledField>

              <LabeledField label={t("leads.assignee")} htmlFor="lsb-assignee">
                <Select id="lsb-assignee" name="assigneeMembershipId" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                  <option value="">{t("common.unassigned")}</option>
                  {members.map((mem) => (
                    <option key={mem.membershipId} value={mem.membershipId}>
                      {mem.displayName}
                    </option>
                  ))}
                </Select>
              </LabeledField>
            </>
          ) : null}
        </>
      )}
    </ConfirmDialog>
  );
}
