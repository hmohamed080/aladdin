"use client";

import { useActionState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { createLeadAction, type FormState } from "@/server/actions/sales-forms";
import { Card } from "@/components/ui/primitives";
import { Input, Select, Textarea, LabeledField, SubmitButton } from "@/components/ui/controls";
import { SALES_SOURCES, PRIORITIES } from "@/lib/ui/format";

const initial: FormState = { ok: false };

export function LeadForm({
  orgId,
  branches,
  customers,
  members,
  canManageSales,
  canAssign,
  presetCustomerId,
}: {
  orgId: string;
  branches: { id: string; name: string }[];
  customers: { id: string; name: string }[];
  members: { membershipId: string; displayName: string }[];
  canManageSales: boolean;
  canAssign: boolean;
  presetCustomerId?: string;
}) {
  const { t } = useI18n();
  const [state, action] = useActionState(createLeadAction, initial);
  const fe = state.fieldErrors ?? {};

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
          <Select id="branchId" name="branchId" defaultValue={branches[0]?.id ?? ""}>
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

        {canAssign && members.length > 0 ? (
          <LabeledField label={t("leads.assignee")} htmlFor="assignedMembershipId" optional={t("common.optional")}>
            <Select id="assignedMembershipId" name="assignedMembershipId" defaultValue="">
              <option value="">{t("common.unassigned")}</option>
              {members.map((m) => (
                <option key={m.membershipId} value={m.membershipId}>{m.displayName}</option>
              ))}
            </Select>
          </LabeledField>
        ) : null}

        <div className="tablet:col-span-2">
          <LabeledField label={t("leads.intent")} htmlFor="intent" optional={t("common.optional")}>
            <Textarea id="intent" name="intent" maxLength={2000} />
          </LabeledField>
        </div>

        <div className="tablet:col-span-2">
          <SubmitButton pendingLabel={t("common.saving")}>{t("common.create")}</SubmitButton>
        </div>
      </form>
    </Card>
  );
}
