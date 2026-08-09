"use client";

import { useActionState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { createRfqAction, type FormState } from "@/server/actions/commerce-forms";
import { Card } from "@/components/ui/primitives";
import { Input, Textarea, LabeledField, SubmitButton } from "@/components/ui/controls";

const initial: FormState = { ok: false };

/**
 * Create an RFQ addressed to a single supplier, seeded from a catalog product.
 * The supplier is fixed by the originating product (an RFQ belongs to exactly one
 * supplier org). Submitting creates a DRAFT RFQ with the first line; more lines
 * (from the same supplier) are added on the RFQ detail page before submission.
 */
export function RfqForm({
  requesterOrgId,
  branchId,
  supplier,
  product,
}: {
  requesterOrgId: string;
  branchId: string | null;
  supplier: { id: string; name: string };
  product: { id: string; name: string };
}) {
  const { t } = useI18n();
  const [state, action] = useActionState(createRfqAction, initial);
  const fe = state.fieldErrors ?? {};

  return (
    <Card className="max-w-2xl">
      {state.code && !state.ok ? (
        <p
          role="alert"
          className="mb-md rounded-sm border border-danger/40 bg-danger/10 px-md py-2 text-body text-danger"
        >
          {t(state.code)}
        </p>
      ) : null}

      <div className="mb-md rounded-sm border bg-surface-2/50 px-md py-2.5 text-body">
        <p className="text-label text-fg-muted">{t("commerce.rfq.supplier")}</p>
        <p className="font-medium text-fg">{supplier.name}</p>
      </div>

      <form action={action} className="grid gap-md tablet:grid-cols-2" noValidate>
        <input type="hidden" name="requesterOrgId" value={requesterOrgId} />
        <input type="hidden" name="supplierOrgId" value={supplier.id} />
        {branchId ? <input type="hidden" name="branchId" value={branchId} /> : null}
        <input type="hidden" name="productId" value={product.id} />

        <div className="tablet:col-span-2">
          <LabeledField
            label={t("commerce.rfq.titleLabel")}
            htmlFor="title"
            error={fe.title ? t(fe.title) : undefined}
          >
            <Input
              id="title"
              name="title"
              required
              maxLength={200}
              defaultValue={t("commerce.rfq.defaultTitle", { product: product.name })}
              aria-invalid={fe.title ? true : undefined}
            />
          </LabeledField>
        </div>

        <LabeledField
          label={t("commerce.rfq.firstItem")}
          htmlFor="productLabel"
        >
          <Input id="productLabel" value={product.name} readOnly disabled />
        </LabeledField>

        <LabeledField
          label={t("commerce.rfq.quantity")}
          htmlFor="quantity"
          error={fe.quantity ? t(fe.quantity) : undefined}
        >
          <Input
            id="quantity"
            name="quantity"
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            required
            defaultValue="1"
            dir="ltr"
            aria-invalid={fe.quantity ? true : undefined}
          />
        </LabeledField>

        <LabeledField
          label={t("commerce.rfq.requiredDate")}
          htmlFor="requiredDate"
          optional={t("common.optional")}
        >
          <Input id="requiredDate" name="requiredDate" type="date" dir="ltr" />
        </LabeledField>

        <div className="tablet:col-span-2">
          <LabeledField label={t("commerce.rfq.note")} htmlFor="note" optional={t("common.optional")}>
            <Textarea id="note" name="note" maxLength={2000} />
          </LabeledField>
        </div>

        <div className="tablet:col-span-2">
          <SubmitButton pendingLabel={t("common.saving")}>{t("commerce.rfq.createDraft")}</SubmitButton>
        </div>
      </form>
    </Card>
  );
}
