"use client";

import { useActionState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { createCustomerAction, type FormState } from "@/server/actions/sales-forms";
import { Card } from "@/components/ui/primitives";
import { Input, Select, LabeledField, SubmitButton } from "@/components/ui/controls";
import { SALES_SOURCES } from "@/lib/ui/format";
import { useBranchAssignees } from "@/features/sales/use-branch-assignees";
import type { OrgMember } from "@/server/queries/sales";

const initial: FormState = { ok: false };

/**
 * Create-customer form. Binds directly to the trusted create_customer RPC via a
 * Server Action. Branch selection is limited to the caller's own branches; an
 * org-wide (no-branch) customer is only offered to org-wide sales authority.
 * The assignee list is branch-reactive (`membersByBranch`): switching branches
 * re-filters to teammates the write RPC would actually accept for that branch,
 * and a selection that falls out of scope is never silently kept selectable
 * without warning nor silently cleared — see `useBranchAssignees`.
 */
export function CustomerForm({
  orgId,
  branches,
  membersByBranch,
  canManageSales,
  canAssign,
}: {
  orgId: string;
  branches: { id: string; name: string }[];
  membersByBranch: Record<string, OrgMember[]>;
  canManageSales: boolean;
  canAssign: boolean;
}) {
  const { t } = useI18n();
  const [state, action] = useActionState(createCustomerAction, initial);
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
          <LabeledField label={t("customers.name")} htmlFor="displayName" error={fe.displayName ? t(fe.displayName) : undefined}>
            <Input id="displayName" name="displayName" required maxLength={160} aria-invalid={fe.displayName ? true : undefined} />
          </LabeledField>
        </div>

        <LabeledField label={t("customers.type")} htmlFor="customerType">
          <Select id="customerType" name="customerType" defaultValue="individual">
            <option value="individual">{t("customers.typeIndividual")}</option>
            <option value="company">{t("customers.typeCompany")}</option>
          </Select>
        </LabeledField>

        <LabeledField
          label={t("customers.branch")}
          htmlFor="branchId"
          optional={canManageSales ? t("common.optional") : undefined}
        >
          <Select id="branchId" name="branchId" value={ba.branch} onChange={(e) => ba.onBranchChange(e.target.value)}>
            {canManageSales ? <option value="">{t("common.none")}</option> : null}
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </LabeledField>

        <LabeledField label={t("customers.phone")} htmlFor="primaryPhone" optional={t("common.optional")} hint="+20 / 01xxxxxxxxx">
          <Input id="primaryPhone" name="primaryPhone" inputMode="tel" dir="ltr" />
        </LabeledField>

        <LabeledField label={t("customers.email")} htmlFor="email" optional={t("common.optional")}>
          <Input id="email" name="email" type="email" dir="ltr" maxLength={254} />
        </LabeledField>

        <LabeledField label={t("customers.language")} htmlFor="preferredLanguage" optional={t("common.optional")}>
          <Select id="preferredLanguage" name="preferredLanguage" defaultValue="">
            <option value="">{t("common.none")}</option>
            <option value="ar">العربية</option>
            <option value="en">English</option>
          </Select>
        </LabeledField>

        <LabeledField label={t("customers.source")} htmlFor="source" optional={t("common.optional")}>
          <Select id="source" name="source" defaultValue="">
            <option value="">{t("common.none")}</option>
            {SALES_SOURCES.map((s) => (
              <option key={s} value={s}>
                {t(`source.${s}`)}
              </option>
            ))}
          </Select>
        </LabeledField>

        {canAssign && ba.branchKnown ? (
          <LabeledField
            label={t("customers.assignee")}
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
                <option key={mem.membershipId} value={mem.membershipId}>
                  {mem.displayName}
                </option>
              ))}
              {ba.isStale ? (
                <option value={ba.assignee}>{ba.staleLabel ?? t("states.assigneeBranch")}</option>
              ) : null}
            </Select>
          </LabeledField>
        ) : canAssign ? (
          <LabeledField label={t("customers.assignee")} htmlFor="assignedMembershipId" hint={t("common.selectBranchFirst")}>
            <Select id="assignedMembershipId" name="assignedMembershipId" value="" disabled>
              <option value="">{t("common.unassigned")}</option>
            </Select>
          </LabeledField>
        ) : null}

        <div className="tablet:col-span-2">
          <LabeledField label={t("customers.location")} htmlFor="locationSummary" optional={t("common.optional")}>
            <Input id="locationSummary" name="locationSummary" maxLength={240} />
          </LabeledField>
        </div>

        <div className="tablet:col-span-2">
          <SubmitButton pendingLabel={t("common.saving")} disabled={ba.isStale}>
            {t("common.create")}
          </SubmitButton>
        </div>
      </form>
    </Card>
  );
}
