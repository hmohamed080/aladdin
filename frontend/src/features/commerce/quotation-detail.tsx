"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useI18n } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n/locales";
import {
  saveQuotationPricesAction,
  submitQuotationAction,
  decideQuotationAction,
  type FormState,
} from "@/server/actions/commerce-forms";
import { createOrderAction } from "@/server/actions/execution-forms";
import { Card, SectionTitle, Field, InlineError, InlineSuccess } from "@/components/ui/primitives";
import { Input, Textarea, LabeledField, SubmitButton, Button } from "@/components/ui/controls";
import { ReceiptIcon, CheckIcon, XIcon } from "@/components/ui/icons";
import { QuotationStatusBadge, ReadyForOrderBadge } from "@/features/commerce/badges";
import { formatDate, formatDateTime } from "@/lib/ui/format";
import { formatMoney, formatQuantity } from "@/features/commerce/constants";
import type { QuotationRow, QuotationItemRow } from "@/server/queries/commerce";

const initial: FormState = { ok: false };

type Role = {
  isSupplier: boolean;
  canRespond: boolean;
  isRequester: boolean;
  canDecide: boolean;
  canCreateOrder: boolean;
};

export function QuotationDetail({
  quotation,
  items,
  supplierName,
  requesterName,
  rfqTitle,
  rfqId,
  role,
  orderId,
  locale,
}: {
  quotation: QuotationRow;
  items: QuotationItemRow[];
  supplierName: string;
  requesterName: string;
  rfqTitle: string;
  rfqId: string;
  role: Role;
  orderId: string | null;
  locale: Locale;
}) {
  const { t } = useI18n();
  const isDraft = quotation.status === "draft";
  const supplierEditing = isDraft && role.isSupplier && role.canRespond;
  const requesterDeciding =
    quotation.status === "submitted" && role.isRequester && role.canDecide;

  return (
    <div className="flex flex-col gap-lg">
      {/* Header */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-md">
          <div className="min-w-0">
            <div className="mb-1 flex flex-wrap items-center gap-2.5">
              <h1 className="text-headline text-fg">{t("commerce.quotation.forRfq", { rfq: rfqTitle })}</h1>
              <QuotationStatusBadge status={quotation.status} />
              {quotation.status === "accepted" ? <ReadyForOrderBadge /> : null}
            </div>
            <Link href={`/b2b/rfqs/${rfqId}`} className="text-label text-fg-secondary hover:text-fg">
              {t("commerce.quotation.viewRfq")}
            </Link>
          </div>
        </div>
        <dl className="mt-md grid grid-cols-2 gap-md tablet:grid-cols-4">
          <Field label={t("commerce.rfq.supplier")}>{supplierName}</Field>
          <Field label={t("commerce.rfq.requester")}>{requesterName}</Field>
          <Field label={t("commerce.quotation.validity")}>{formatDate(quotation.validity_date, locale)}</Field>
          <Field label={t("commerce.quotation.submittedAt")}>{formatDateTime(quotation.submitted_at, locale)}</Field>
        </dl>
      </Card>

      {/* READY FOR ORDER handoff → create (or open) the order */}
      {quotation.status === "accepted" ? (
        <div
          role="status"
          className="flex flex-col items-center gap-md rounded-md border border-success/40 bg-success/10 px-lg py-md text-center"
        >
          <div>
            <p className="text-title font-semibold text-success">{t("commerce.readyForOrder")}</p>
            <p className="mt-1 text-body text-fg-secondary">{t("commerce.readyForOrderBody")}</p>
          </div>
          {orderId ? (
            <Link href={`/b2b/orders/${orderId}`}>
              <Button variant="accent">{t("commerce.viewOrder")}</Button>
            </Link>
          ) : role.isRequester && role.canCreateOrder ? (
            <CreateOrderForm quotationId={quotation.id} />
          ) : null}
        </div>
      ) : null}

      {/* Lines */}
      <Card>
        <SectionTitle icon={<ReceiptIcon size={18} />}>{t("commerce.quotation.lines")}</SectionTitle>
        {supplierEditing ? (
          <PricingForm quotation={quotation} items={items} locale={locale} />
        ) : (
          <ReadOnlyLines items={items} total={quotation.total} locale={locale} />
        )}
        {quotation.note ? (
          <div className="mt-md border-t pt-md">
            <p className="text-label text-fg-muted">{t("commerce.quotation.note")}</p>
            <p className="mt-0.5 whitespace-pre-wrap text-body text-fg">{quotation.note}</p>
          </div>
        ) : null}
      </Card>

      {/* Supplier submit */}
      {supplierEditing ? (
        <Card>
          <SectionTitle>{t("commerce.quotation.supplierActions")}</SectionTitle>
          <p className="mt-1 text-label text-fg-muted">{t("commerce.quotation.submitHint")}</p>
          <div className="mt-md">
            <SubmitQuotationForm quotationId={quotation.id} version={quotation.version} />
          </div>
        </Card>
      ) : null}

      {/* Requester decision */}
      {requesterDeciding ? (
        <Card>
          <SectionTitle>{t("commerce.quotation.decideActions")}</SectionTitle>
          <p className="mt-1 text-label text-fg-muted">{t("commerce.quotation.decideHint")}</p>
          <div className="mt-md flex flex-wrap items-center gap-md">
            <DecideForm quotationId={quotation.id} version={quotation.version} accept />
            <DecideForm quotationId={quotation.id} version={quotation.version} accept={false} />
          </div>
        </Card>
      ) : null}
    </div>
  );
}

// ---- lines -----------------------------------------------------------------
function ReadOnlyLines({
  items,
  total,
  locale,
}: {
  items: QuotationItemRow[];
  total: number;
  locale: Locale;
}) {
  const { t } = useI18n();
  return (
    <div className="mt-md overflow-x-auto">
      <table className="w-full min-w-[32rem] border-collapse text-body">
        <thead>
          <tr className="border-b text-label text-fg-muted">
            <th className="px-2 py-2 text-start font-medium">{t("commerce.fields.name")}</th>
            <th className="px-2 py-2 text-end font-medium">{t("commerce.rfq.quantity")}</th>
            <th className="px-2 py-2 text-end font-medium">{t("commerce.quotation.unitPrice")}</th>
            <th className="px-2 py-2 text-end font-medium">{t("commerce.quotation.lineTotal")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id} className="border-b last:border-0">
              <td className="px-2 py-2.5 font-medium text-fg">{it.product_name}</td>
              <td className="px-2 py-2.5 text-end tabular-nums" dir="ltr">
                {formatQuantity(it.quantity, locale)} {t(`commerce.units.${it.unit}`)}
              </td>
              <td className="px-2 py-2.5 text-end tabular-nums" dir="ltr">{formatMoney(it.unit_price, locale)}</td>
              <td className="px-2 py-2.5 text-end font-medium tabular-nums" dir="ltr">
                {formatMoney(it.line_total, locale)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2">
            <td colSpan={3} className="px-2 py-2.5 text-end text-label text-fg-muted">
              {t("commerce.quotation.total")}
            </td>
            <td className="px-2 py-2.5 text-end text-title font-semibold tabular-nums text-fg" dir="ltr">
              {formatMoney(total, locale)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function PricingForm({
  quotation,
  items,
  locale,
}: {
  quotation: QuotationRow;
  items: QuotationItemRow[];
  locale: Locale;
}) {
  const { t } = useI18n();
  const [state, action] = useActionState(saveQuotationPricesAction, initial);
  const fe = state.fieldErrors ?? {};
  return (
    <form action={action} className="mt-md flex flex-col gap-md" noValidate>
      <input type="hidden" name="quotationId" value={quotation.id} />
      <input type="hidden" name="expectedVersion" value={quotation.version} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] border-collapse text-body">
          <thead>
            <tr className="border-b text-label text-fg-muted">
              <th className="px-2 py-2 text-start font-medium">{t("commerce.fields.name")}</th>
              <th className="px-2 py-2 text-end font-medium">{t("commerce.rfq.quantity")}</th>
              <th className="px-2 py-2 text-end font-medium">{t("commerce.quotation.unitPrice")}</th>
              <th className="px-2 py-2 text-end font-medium">{t("commerce.quotation.lineTotal")}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="border-b last:border-0">
                <td className="px-2 py-2.5 font-medium text-fg">{it.product_name}</td>
                <td className="px-2 py-2.5 text-end tabular-nums" dir="ltr">
                  {formatQuantity(it.quantity, locale)} {t(`commerce.units.${it.unit}`)}
                </td>
                <td className="px-2 py-2.5 text-end">
                  <Input
                    name={`price_${it.id}`}
                    type="number"
                    min="0"
                    step="0.01"
                    defaultValue={Number(it.unit_price) > 0 ? String(it.unit_price) : ""}
                    placeholder="0.00"
                    dir="ltr"
                    className="min-h-9 w-28 text-end"
                    aria-label={t("commerce.quotation.unitPriceFor", { product: it.product_name })}
                    aria-invalid={fe[`price_${it.id}`] ? true : undefined}
                  />
                </td>
                <td className="px-2 py-2.5 text-end tabular-nums text-fg-secondary" dir="ltr">
                  {formatMoney(it.line_total, locale)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2">
              <td colSpan={3} className="px-2 py-2.5 text-end text-label text-fg-muted">
                {t("commerce.quotation.currentTotal")}
              </td>
              <td className="px-2 py-2.5 text-end text-title font-semibold tabular-nums text-fg" dir="ltr">
                {formatMoney(quotation.total, locale)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="grid gap-md tablet:grid-cols-2">
        <LabeledField label={t("commerce.quotation.validity")} htmlFor="validityDate" optional={t("common.optional")}>
          <Input
            id="validityDate"
            name="validityDate"
            type="date"
            dir="ltr"
            defaultValue={quotation.validity_date ?? ""}
          />
        </LabeledField>
        <div className="tablet:col-span-2">
          <LabeledField label={t("commerce.quotation.note")} htmlFor="note" optional={t("common.optional")}>
            <Textarea id="note" name="note" maxLength={2000} defaultValue={quotation.note ?? ""} />
          </LabeledField>
        </div>
      </div>

      <div className="flex items-center gap-md">
        <SubmitButton pendingLabel={t("common.saving")}>{t("commerce.quotation.savePrices")}</SubmitButton>
        {state.code ? (
          state.ok ? <InlineSuccess>{t(state.code)}</InlineSuccess> : <InlineError>{t(state.code)}</InlineError>
        ) : null}
      </div>
    </form>
  );
}

// ---- action forms ----------------------------------------------------------
function SubmitQuotationForm({ quotationId, version }: { quotationId: string; version: number }) {
  const { t } = useI18n();
  const [state, action] = useActionState(submitQuotationAction, initial);
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="quotationId" value={quotationId} />
      <input type="hidden" name="expectedVersion" value={version} />
      <SubmitButton variant="accent" pendingLabel={t("common.saving")}>
        {t("commerce.quotation.submit")}
      </SubmitButton>
      {state.code && !state.ok ? <InlineError>{t(state.code)}</InlineError> : null}
    </form>
  );
}

function CreateOrderForm({ quotationId }: { quotationId: string }) {
  const { t } = useI18n();
  const [state, action] = useActionState(createOrderAction, initial);
  return (
    <form action={action} className="flex flex-col items-center gap-1">
      <input type="hidden" name="quotationId" value={quotationId} />
      <SubmitButton variant="accent" pendingLabel={t("common.saving")}>
        {t("commerce.createOrder")}
      </SubmitButton>
      {state.code && !state.ok ? <InlineError>{t(state.code)}</InlineError> : null}
    </form>
  );
}

function DecideForm({
  quotationId,
  version,
  accept,
}: {
  quotationId: string;
  version: number;
  accept: boolean;
}) {
  const { t } = useI18n();
  const [state, action] = useActionState(decideQuotationAction, initial);
  return (
    <form action={action} className="flex flex-col gap-1">
      <input type="hidden" name="quotationId" value={quotationId} />
      <input type="hidden" name="expectedVersion" value={version} />
      <input type="hidden" name="accept" value={String(accept)} />
      <SubmitButton variant={accept ? "accent" : "danger"} pendingLabel={t("common.saving")}>
        <span className="inline-flex items-center gap-1.5">
          {accept ? <CheckIcon size={16} /> : <XIcon size={16} />}
          {accept ? t("commerce.quotation.accept") : t("commerce.quotation.reject")}
        </span>
      </SubmitButton>
      {state.code && !state.ok ? <InlineError>{t(state.code)}</InlineError> : null}
    </form>
  );
}
