import type { Messages } from "@/lib/i18n/messages/en";
import type { Locale } from "@/lib/i18n/locales";
import { StatePanel } from "@/components/ui/primitives";
import { FileTextIcon, ReceiptIcon } from "@/components/ui/icons";
import { RfqStatusBadge, QuotationStatusBadge } from "@/features/commerce/badges";
import { DataTable, RecordCell, type Column } from "@/components/ui/data-table";
import { formatDate, formatCount } from "@/lib/ui/format";
import { formatMoney } from "@/features/commerce/constants";
import type { RfqListRow, QuotationListRow } from "@/server/queries/commerce";

/**
 * Purchase-request and offer tables.
 *
 * `perspective` is the whole point of these components. The same RFQ row means two
 * different jobs depending on which side of it you sit: as the requester it is
 * "a price I asked a supplier for", as the supplier it is "a price someone wants
 * from me". Before Sprint 14 both were stacked on one page under one heading,
 * which is why "my requests" and "my purchases" read as interchangeable. Each
 * table now states one side and names its counterparty column accordingly.
 *
 * Server components — they take the resolved catalog, so no client bundle grows.
 */
export function RfqTable({
  rfqs,
  perspective,
  locale,
  m,
}: {
  rfqs: RfqListRow[];
  perspective: "requester" | "supplier";
  locale: Locale;
  m: Messages;
}) {
  const columns: Column<RfqListRow>[] = [
    {
      key: "title",
      header: m.commerce.rfq.column.request,
      cell: (r) => (
        <RecordCell
          title={r.title ?? "—"}
          meta={m.commerce.rfq.itemCountShort.replace("{count}", formatCount(r.item_count ?? 0, locale))}
          href={`/b2b/rfqs/${r.id}`}
        />
      ),
    },
    {
      key: "counterparty",
      header: perspective === "requester" ? m.commerce.rfq.column.supplier : m.commerce.rfq.column.requester,
      cell: (r) => (perspective === "requester" ? r.supplier_name : r.requester_name) ?? "—",
    },
    {
      key: "status",
      header: m.commerce.rfq.column.status,
      cell: (r) => <RfqStatusBadge status={r.status ?? "draft"} />,
    },
    {
      key: "required",
      header: m.commerce.rfq.column.requiredBy,
      numeric: true,
      desktopOnly: true,
      cell: (r) => (r.required_date ? formatDate(r.required_date, locale) : "—"),
    },
    {
      key: "updated",
      header: m.commerce.rfq.column.updated,
      numeric: true,
      cell: (r) => (r.updated_at ? formatDate(r.updated_at, locale) : "—"),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rfqs}
      rowKey={(r) => r.id ?? ""}
      caption={m.commerce.rfq.title}
      empty={
        <StatePanel
          icon={<FileTextIcon size={22} />}
          title={m.commerce.rfq.empty[`${perspective}Title`]}
          body={m.commerce.rfq.empty[`${perspective}Body`]}
        />
      }
    />
  );
}

export function QuotationTable({
  quotations,
  perspective,
  locale,
  m,
}: {
  quotations: QuotationListRow[];
  perspective: "supplier" | "requester";
  locale: Locale;
  m: Messages;
}) {
  const columns: Column<QuotationListRow>[] = [
    {
      key: "rfq",
      header: m.commerce.quotation.column.offer,
      cell: (q) => (
        <RecordCell
          title={q.rfq_title ?? "—"}
          meta={perspective === "requester" ? (q.supplier_name ?? undefined) : (q.requester_name ?? undefined)}
          href={`/b2b/quotations/${q.id}`}
        />
      ),
    },
    {
      key: "counterparty",
      header:
        perspective === "requester"
          ? m.commerce.quotation.column.supplier
          : m.commerce.quotation.column.requester,
      secondary: true,
      desktopOnly: true,
      cell: (q) => (perspective === "requester" ? q.supplier_name : q.requester_name) ?? "—",
    },
    {
      key: "total",
      header: m.commerce.quotation.column.total,
      numeric: true,
      cell: (q) => formatMoney(q.total, locale),
    },
    {
      key: "status",
      header: m.commerce.quotation.column.status,
      cell: (q) => <QuotationStatusBadge status={q.status ?? "draft"} />,
    },
    {
      key: "validUntil",
      header: m.commerce.quotation.column.validUntil,
      numeric: true,
      desktopOnly: true,
      cell: (q) => (q.validity_date ? formatDate(q.validity_date, locale) : "—"),
    },
    {
      key: "updated",
      header: m.commerce.quotation.column.received,
      numeric: true,
      cell: (q) => (q.updated_at ? formatDate(q.updated_at, locale) : "—"),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={quotations}
      rowKey={(q) => q.id ?? ""}
      caption={m.commerce.quotation.title}
      empty={
        <StatePanel
          icon={<ReceiptIcon size={22} />}
          title={m.commerce.quotation.empty[`${perspective}Title`]}
          body={m.commerce.quotation.empty[`${perspective}Body`]}
        />
      }
    />
  );
}
