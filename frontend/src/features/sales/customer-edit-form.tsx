"use client";

import { useActionState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { updateCustomerAction, type FormState } from "@/server/actions/sales-forms";
import { Card } from "@/components/ui/primitives";
import { Input, Select, LabeledField, SubmitButton } from "@/components/ui/controls";
import { SALES_SOURCES } from "@/lib/ui/format";
import type { CustomerRow } from "@/server/queries/sales";

const initial: FormState = { ok: false };

/**
 * Edit a customer through the trusted `update_customer` RPC. Only RPC-supported
 * fields are editable; type/branch/assignee are shown read-only (set at
 * creation, not part of the update RPC). Values survive a validation error
 * because the inputs are uncontrolled and re-seed from the submitted FormData is
 * unnecessary — on a field error the server returns without navigating and the
 * browser keeps the user's typed values.
 */
export function CustomerEditForm({
  customer,
  branchName,
  assigneeName,
}: {
  customer: CustomerRow;
  branchName: string;
  assigneeName: string;
}) {
  const { t } = useI18n();
  const [state, action] = useActionState(updateCustomerAction, initial);
  const fe = state.fieldErrors ?? {};

  return (
    <Card className="max-w-2xl">
      {state.code && !state.ok ? (
        <p role="alert" className="mb-md rounded-sm border border-danger/40 bg-danger/10 px-md py-2 text-body text-danger">
          {t(state.code)}
        </p>
      ) : null}

      <form action={action} className="grid gap-md tablet:grid-cols-2" noValidate>
        <input type="hidden" name="customerId" value={customer.id} />

        <div className="tablet:col-span-2">
          <LabeledField label={t("customers.name")} htmlFor="displayName" error={fe.displayName ? t(fe.displayName) : undefined}>
            <Input
              id="displayName"
              name="displayName"
              required
              maxLength={160}
              defaultValue={customer.display_name}
              aria-invalid={fe.displayName ? true : undefined}
            />
          </LabeledField>
        </div>

        <LabeledField label={t("customers.phone")} htmlFor="primaryPhone" optional={t("common.optional")} hint="+20 / 01xxxxxxxxx">
          <Input id="primaryPhone" name="primaryPhone" inputMode="tel" dir="ltr" defaultValue={customer.primary_phone ?? ""} />
        </LabeledField>

        <LabeledField label={t("customers.email")} htmlFor="email" optional={t("common.optional")}>
          <Input id="email" name="email" type="email" dir="ltr" maxLength={254} defaultValue={customer.email ?? ""} />
        </LabeledField>

        <LabeledField label={t("customers.language")} htmlFor="preferredLanguage" optional={t("common.optional")}>
          <Select id="preferredLanguage" name="preferredLanguage" defaultValue={customer.preferred_language ?? ""}>
            <option value="">{t("common.none")}</option>
            <option value="ar">العربية</option>
            <option value="en">English</option>
          </Select>
        </LabeledField>

        <LabeledField label={t("customers.source")} htmlFor="source" optional={t("common.optional")}>
          <Select id="source" name="source" defaultValue={customer.source ?? ""}>
            <option value="">{t("common.none")}</option>
            {SALES_SOURCES.map((s) => (
              <option key={s} value={s}>
                {t(`source.${s}`)}
              </option>
            ))}
          </Select>
        </LabeledField>

        <div className="tablet:col-span-2">
          <LabeledField label={t("customers.location")} htmlFor="locationSummary" optional={t("common.optional")}>
            <Input id="locationSummary" name="locationSummary" maxLength={240} defaultValue={customer.location_summary ?? ""} />
          </LabeledField>
        </div>

        {/* Read-only fields the update RPC does not change. */}
        <dl className="tablet:col-span-2 grid grid-cols-2 gap-md rounded-sm border border-dashed p-md text-label sm:grid-cols-3">
          <div>
            <dt className="text-fg-muted">{t("customers.type")}</dt>
            <dd className="text-fg">{customer.customer_type === "company" ? t("customers.typeCompany") : t("customers.typeIndividual")}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">{t("customers.branch")}</dt>
            <dd className="text-fg">{branchName}</dd>
          </div>
          <div>
            <dt className="text-fg-muted">{t("customers.assignee")}</dt>
            <dd className="text-fg">{assigneeName}</dd>
          </div>
        </dl>
        <p className="tablet:col-span-2 text-label text-fg-muted">{t("customers.editableNote")}</p>

        <div className="tablet:col-span-2">
          <SubmitButton pendingLabel={t("common.saving")}>{t("common.saveChanges")}</SubmitButton>
        </div>
      </form>
    </Card>
  );
}
