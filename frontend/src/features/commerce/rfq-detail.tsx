"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useI18n } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n/locales";
import {
  addRfqItemAction,
  removeRfqItemAction,
  submitRfqAction,
  cancelRfqAction,
  createQuotationAction,
  type FormState,
} from "@/server/actions/commerce-forms";
import { Card, SectionTitle, Field, InlineError, InlineSuccess } from "@/components/ui/primitives";
import { Input, Select, LabeledField, SubmitButton, Button } from "@/components/ui/controls";
import { PackageIcon, FileTextIcon } from "@/components/ui/icons";
import { RfqStatusBadge } from "@/features/commerce/badges";
import { OpenConversationButton } from "@/features/chat/open-conversation-button";
import { formatDate, formatDateTime } from "@/lib/ui/format";
import { formatQuantity } from "@/features/commerce/constants";
import type { RfqRow, RfqItemRow } from "@/server/queries/commerce";

const initial: FormState = { ok: false };

type Role = {
  isRequester: boolean;
  isSupplier: boolean;
  canRfq: boolean;
  canRespond: boolean;
};

export function RfqDetail({
  rfq,
  requesterName,
  supplierName,
  items,
  role,
  supplierProducts,
  liveQuotation,
  locale,
}: {
  rfq: RfqRow;
  requesterName: string;
  supplierName: string;
  items: RfqItemRow[];
  role: Role;
  supplierProducts: { id: string; name: string }[];
  liveQuotation: { id: string; status: string } | null;
  locale: Locale;
}) {
  const { t } = useI18n();
  const isDraft = rfq.status === "draft";
  const editable = isDraft && role.isRequester && role.canRfq;

  return (
    <div className="flex flex-col gap-lg">
      {/* Header */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-md">
          <div className="min-w-0">
            <div className="mb-1 flex items-center gap-2.5">
              <h1 className="text-headline text-fg">{rfq.title}</h1>
              <RfqStatusBadge status={rfq.status} />
            </div>
            <p className="text-body text-fg-secondary">
              {t("commerce.rfq.toSupplier", { supplier: supplierName })}
            </p>
          </div>
          {/* One chat entry per screen, for either party — the conversation is a
              property of THIS request, and the database decides who may open it.
              Hidden on drafts: a draft is private to its owning side, so there
              is nothing legitimate to open yet (chat-core.md §10.1). */}
          {rfq.status !== "draft" ? (
            <OpenConversationButton subjectType="rfq" subjectId={rfq.id} />
          ) : null}
        </div>
        <dl className="mt-md grid grid-cols-2 gap-md tablet:grid-cols-4">
          <Field label={t("commerce.rfq.requester")}>{requesterName}</Field>
          <Field label={t("commerce.rfq.supplier")}>{supplierName}</Field>
          <Field label={t("commerce.rfq.requiredDate")}>{formatDate(rfq.required_date, locale)}</Field>
          <Field label={t("commerce.rfq.submittedAt")}>{formatDateTime(rfq.submitted_at, locale)}</Field>
        </dl>
        {rfq.note ? (
          <div className="mt-md border-t pt-md">
            <p className="text-label text-fg-muted">{t("commerce.rfq.note")}</p>
            <p className="mt-0.5 whitespace-pre-wrap text-body text-fg">{rfq.note}</p>
          </div>
        ) : null}
      </Card>

      {/* Items */}
      <Card>
        <SectionTitle icon={<PackageIcon size={18} />}>{t("commerce.rfq.items")}</SectionTitle>
        {items.length === 0 ? (
          <p className="mt-md text-body text-fg-secondary">{t("commerce.rfq.noItems")}</p>
        ) : (
          <div className="mt-md overflow-x-auto">
            <table className="w-full min-w-[28rem] border-collapse text-body">
              <thead>
                <tr className="border-b text-label text-fg-muted">
                  <th className="px-2 py-2 text-start font-medium">{t("commerce.fields.name")}</th>
                  <th className="px-2 py-2 text-end font-medium">{t("commerce.rfq.quantity")}</th>
                  <th className="px-2 py-2 text-start font-medium">{t("commerce.fields.unit")}</th>
                  {editable ? <th className="px-2 py-2" /> : null}
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className="border-b last:border-0">
                    <td className="px-2 py-2.5 font-medium text-fg">
                      {it.product_name}
                      {it.note ? <span className="ms-2 text-label text-fg-muted">{it.note}</span> : null}
                    </td>
                    <td className="px-2 py-2.5 text-end tabular-nums" dir="ltr">
                      {formatQuantity(it.quantity, locale)}
                    </td>
                    <td className="px-2 py-2.5 text-fg-secondary">{t(`commerce.units.${it.unit}`)}</td>
                    {editable ? (
                      <td className="px-2 py-2.5 text-end">
                        <RemoveItemButton itemId={it.id} rfqId={rfq.id} />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {editable ? (
          <div className="mt-md border-t pt-md">
            <AddItemForm rfqId={rfq.id} products={supplierProducts} />
          </div>
        ) : null}
      </Card>

      {/* Requester actions */}
      {role.isRequester && role.canRfq && rfq.status !== "closed" && rfq.status !== "cancelled" ? (
        <Card>
          <SectionTitle>{t("commerce.rfq.actions")}</SectionTitle>
          <div className="mt-md flex flex-wrap items-center gap-md">
            {isDraft ? (
              <SubmitRfqForm rfqId={rfq.id} version={rfq.version} disabled={items.length === 0} />
            ) : null}
            <CancelRfqForm rfqId={rfq.id} />
          </div>
          {isDraft && items.length === 0 ? (
            <p className="mt-sm text-label text-fg-muted">{t("commerce.rfq.addItemFirst")}</p>
          ) : null}
        </Card>
      ) : null}

      {/* Supplier actions */}
      {role.isSupplier && role.canRespond && rfq.status !== "draft" ? (
        <Card>
          <SectionTitle icon={<FileTextIcon size={18} />}>{t("commerce.quotation.supplierActions")}</SectionTitle>
          <div className="mt-md">
            {liveQuotation ? (
              <Link href={`/b2b/quotations/${liveQuotation.id}`}>
                <Button variant="outline">{t("commerce.quotation.openQuotation")}</Button>
              </Link>
            ) : rfq.status === "closed" || rfq.status === "cancelled" ? (
              <p className="text-body text-fg-secondary">{t("commerce.quotation.rfqFinalized")}</p>
            ) : (
              <CreateQuotationForm rfqId={rfq.id} />
            )}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

// ---- inline forms ----------------------------------------------------------
function AddItemForm({ rfqId, products }: { rfqId: string; products: { id: string; name: string }[] }) {
  const { t } = useI18n();
  const [state, action] = useActionState(addRfqItemAction, initial);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="flex flex-wrap items-end gap-sm" noValidate>
      <input type="hidden" name="rfqId" value={rfqId} />
      <div className="min-w-48 flex-1">
        <LabeledField
          label={t("commerce.rfq.addProduct")}
          htmlFor="productId"
          error={fe.productId ? t(fe.productId) : undefined}
        >
          <Select id="productId" name="productId" defaultValue="">
            <option value="" disabled>
              {t("commerce.rfq.selectProduct")}
            </option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </LabeledField>
      </div>
      <div className="w-28">
        <LabeledField
          label={t("commerce.rfq.quantity")}
          htmlFor="quantity"
          error={fe.quantity ? t(fe.quantity) : undefined}
        >
          <Input id="quantity" name="quantity" type="number" min="0.01" step="0.01" defaultValue="1" dir="ltr" />
        </LabeledField>
      </div>
      <SubmitButton variant="outline" pendingLabel={t("common.saving")}>
        {t("commerce.rfq.addItem")}
      </SubmitButton>
      {state.code && !state.ok ? <InlineError>{t(state.code)}</InlineError> : null}
    </form>
  );
}

function RemoveItemButton({ itemId, rfqId }: { itemId: string; rfqId: string }) {
  const { t } = useI18n();
  const [, action] = useActionState(removeRfqItemAction, initial);
  return (
    <form action={action}>
      <input type="hidden" name="itemId" value={itemId} />
      <input type="hidden" name="rfqId" value={rfqId} />
      <SubmitButton variant="ghost" size="sm">
        {t("common.remove")}
      </SubmitButton>
    </form>
  );
}

function SubmitRfqForm({ rfqId, version, disabled }: { rfqId: string; version: number; disabled: boolean }) {
  const { t } = useI18n();
  const [state, action] = useActionState(submitRfqAction, initial);
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="rfqId" value={rfqId} />
      <input type="hidden" name="expectedVersion" value={version} />
      <SubmitButton variant="accent" pendingLabel={t("common.saving")} disabled={disabled}>
        {t("commerce.rfq.submit")}
      </SubmitButton>
      {state.code ? state.ok ? <InlineSuccess>{t(state.code)}</InlineSuccess> : <InlineError>{t(state.code)}</InlineError> : null}
    </form>
  );
}

function CancelRfqForm({ rfqId }: { rfqId: string }) {
  const { t } = useI18n();
  const [state, action] = useActionState(cancelRfqAction, initial);
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="rfqId" value={rfqId} />
      <SubmitButton variant="danger" pendingLabel={t("common.saving")}>
        {t("commerce.rfq.cancel")}
      </SubmitButton>
      {state.code && !state.ok ? <InlineError>{t(state.code)}</InlineError> : null}
    </form>
  );
}

function CreateQuotationForm({ rfqId }: { rfqId: string }) {
  const { t } = useI18n();
  const [state, action] = useActionState(createQuotationAction, initial);
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="rfqId" value={rfqId} />
      <SubmitButton variant="accent" pendingLabel={t("common.saving")}>
        {t("commerce.quotation.create")}
      </SubmitButton>
      {state.code && !state.ok ? <InlineError>{t(state.code)}</InlineError> : null}
    </form>
  );
}
