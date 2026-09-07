"use client";

import { useActionState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { createLeadAction, type FormState } from "@/server/actions/sales-forms";
import { Card } from "@/components/ui/primitives";
import { Input, Select, LabeledField, SubmitButton } from "@/components/ui/controls";
import { SALES_SOURCES, PRIORITIES } from "@/lib/ui/format";
import { useBranchAssignees } from "@/features/sales/use-branch-assignees";
import type { OrgMember } from "@/server/queries/sales";

const initial: FormState = { ok: false };

/**
 * The assignee list is branch-reactive (`membersByBranch`): switching
 * branches re-filters to teammates the write RPC would actually accept for
 * that branch — see `useBranchAssignees`.
 */
export function LeadForm({
  orgId,
  branches,
  customers,
  membersByBranch,
  canManageSales,
  canAssign,
  presetCustomerId,
}: {
  orgId: string;
  branches: { id: string; name: string }[];
  customers: { id: string; name: string }[];
  membersByBranch: Record<string, OrgMember[]>;
  canManageSales: boolean;
  canAssign: boolean;
  presetCustomerId?: string;
}) {
  const { t } = useI18n();
  const [state, action] = useActionState(createLeadAction, initial);
  const fe = state.fieldErrors ?? {};
  const ba = useBranchAssignees(membersByBranch, branches[0]?.id ?? "", "");

  return (
    <Card className="max-w-2xl">
      {state.code && !state.ok ? (
        <p role="alert" className="mb-md rounded-sm border border-danger/40 bg-danger/10 px-md py-2 text-body text-danger">
          {t(state.code)}
        </p>
      ) : null}

      <form action={action} className="grid gap-md tablet:grid-cols-2" noValidate>
        <input type="hidden" name="orgId" value={orgId} />

        <div className="tablet:col-span-2">
          <LabeledField label={t("leads.leadTitle")} htmlFor="title" error={fe.title ? t(fe.title) : undefined}>
            <Input id="title" name="title" required maxLength={200} aria-invalid={fe.title ? true : undefined} />
          </LabeledField>
        </div>

        <LabeledField label={t("leads.customer")} htmlFor="customerId" optional={t("common.optional")}>
          <Select id="customerId" name="customerId" defaultValue={presetCustomerId ?? ""}>
            <option value="">{t("common.none")}</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </LabeledField>

        <LabeledField label={t("leads.branch")} htmlFor="branchId" optional={canManageSales ? t("common.optional") : undefined}>
          <Select id="branchId" name="branchId" value={ba.branch} onChange={(e) => ba.onBranchChange(e.target.value)}>
            {canManageSales ? <option value="">{t("common.none")}</option> : null}
            {branches.map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </Select>
        </LabeledField>

        <LabeledField label={t("leads.priority")} htmlFor="priority">
          <Select id="priority" name="priority" defaultValue="normal">
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>{t(`priority.${p}`)}</option>
            ))}
          </Select>
        </LabeledField>

        <LabeledField label={t("customers.source")} htmlFor="source" optional={t("common.optional")}>
          <Select id="source" name="source" defaultValue="">
            <option value="">{t("common.none")}</option>
            {SALES_SOURCES.map((s) => (
              <option key={s} value={s}>{t(`source.${s}`)}</option>
            ))}
          </Select>
        </LabeledField>

        {canAssign && ba.branchKnown ? (
          <LabeledField
            label={t("leads.assignee")}
            htmlFor="assignedMembershipId"
            optional={t("common.optional")}
            error={ba.isStale ? t("states.assigneeBranch") : undefined}
          >
            <Select
              id="assignedMembershipId"
              name="assignedMembershipId"
              value={ba.assignee}
              onChange={(e) => ba.onAssigneeChange(e.target.value)}
              aria-invalid={ba.isStale ? true : undefined}
            >
              <option value="">{t("common.unassigned")}</option>
              {ba.candidates.map((mem) => (
                <option key={mem.membershipId} value={mem.membershipId}>{mem.displayName}</option>
              ))}
              {ba.isStale ? (
                <option value={ba.assignee}>{ba.staleLabel ?? t("states.assigneeBranch")}</option>
              ) : null}
            </Select>
          </LabeledField>
        ) : canAssign ? (
          <LabeledField label={t("leads.assignee")} htmlFor="assignedMembershipId" hint={t("common.selectBranchFirst")}>
            <Select id="assignedMembershipId" name="assignedMembershipId" value="" disabled>
              <option value="">{t("common.unassigned")}</option>
            </Select>
          </LabeledField>
        ) : null}

        <div className="tablet:col-span-2 flex flex-col gap-1">
          <SubmitButton pendingLabel={t("common.saving")} disabled={ba.isStale}>{t("common.create")}</SubmitButton>
          <p className="text-label text-fg-muted">{t("leads.intentHint")}</p>
        </div>
      </form>
    </Card>
  );
}
