"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n/locales";
import { Card, StatePanel } from "@/components/ui/primitives";
import { FileTextIcon, ReceiptIcon } from "@/components/ui/icons";
import { RfqStatusBadge, QuotationStatusBadge } from "@/features/commerce/badges";
import { formatDate } from "@/lib/ui/format";
import { formatMoney } from "@/features/commerce/constants";
import type { RfqListRow, QuotationListRow } from "@/server/queries/commerce";

/** RFQ list. `perspective` picks which counterparty name to emphasize. */
export function RfqList({
  rfqs,
  perspective,
  locale,
}: {
  rfqs: RfqListRow[];
  perspective: "requester" | "supplier";
  locale: Locale;
}) {
  const { t } = useI18n();
  if (rfqs.length === 0) {
    return (
      <StatePanel
        icon={<FileTextIcon size={22} />}
        title={t(`commerce.rfq.empty.${perspective}Title`)}
        body={t(`commerce.rfq.empty.${perspective}Body`)}
      />
    );
  }
  return (
    <div className="flex flex-col gap-sm">
      {rfqs.map((r) => (
        <Link key={r.id} href={`/b2b/rfqs/${r.id}`} className="block">
          <Card pad="sm" className="transition-colors hover:border-strong">
            <div className="flex items-start justify-between gap-md">
              <div className="min-w-0">
                <p className="truncate font-medium text-fg">{r.title}</p>
                <p className="mt-0.5 text-label text-fg-muted">
                  {perspective === "requester"
                    ? t("commerce.rfq.toSupplier", { supplier: r.supplier_name ?? "—" })
                    : t("commerce.rfq.fromRequester", { requester: r.requester_name ?? "—" })}
                  {" · "}
                  {t("commerce.rfq.itemCount", { count: r.item_count ?? 0 })}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <RfqStatusBadge status={r.status ?? "draft"} />
                {r.required_date ? (
                  <span className="text-label text-fg-muted">{formatDate(r.required_date, locale)}</span>
                ) : null}
              </div>
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}

/** Quotation list. `perspective` = supplier (mine) or requester (received). */
export function QuotationList({
  quotations,
  perspective,
  locale,
}: {
  quotations: QuotationListRow[];
  perspective: "supplier" | "requester";
  locale: Locale;
}) {
  const { t } = useI18n();
  if (quotations.length === 0) {
    return (
      <StatePanel
        icon={<ReceiptIcon size={22} />}
        title={t(`commerce.quotation.empty.${perspective}Title`)}
        body={t(`commerce.quotation.empty.${perspective}Body`)}
      />
    );
  }
  return (
    <div className="flex flex-col gap-sm">
      {quotations.map((q) => (
        <Link key={q.id} href={`/b2b/quotations/${q.id}`} className="block">
          <Card pad="sm" className="transition-colors hover:border-strong">
            <div className="flex items-start justify-between gap-md">
              <div className="min-w-0">
                <p className="truncate font-medium text-fg">{q.rfq_title}</p>
                <p className="mt-0.5 text-label text-fg-muted">
                  {perspective === "supplier"
                    ? t("commerce.rfq.fromRequester", { requester: q.requester_name ?? "—" })
                    : t("commerce.rfq.toSupplier", { supplier: q.supplier_name ?? "—" })}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <QuotationStatusBadge status={q.status ?? "draft"} />
                <span className="text-label font-medium tabular-nums text-fg" dir="ltr">
                  {formatMoney(q.total, locale)}
                </span>
              </div>
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}
