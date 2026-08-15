import type { Messages } from "@/lib/i18n/messages/en";
import type { Locale } from "@/lib/i18n/locales";
import { StatePanel } from "@/components/ui/primitives";
import { PackageIcon, ActivityIcon } from "@/components/ui/icons";
import { OrderStatusBadge, ProjectStatusBadge } from "@/features/execution/badges";
import { DataTable, RecordCell, type Column } from "@/components/ui/data-table";
import { formatDate } from "@/lib/ui/format";
import { formatMoney } from "@/features/commerce/constants";
import type { OrderListRow, ProjectListRow } from "@/server/queries/execution";

/**
 * Order and project tables. Same perspective rule as the commerce tables: an order
 * is either something this business is BUYING or something it is DELIVERING, and
 * the counterparty column is named for whichever side the caller is on.
 *
 * Money is forced to `dir="ltr"` — an EGP figure keeps Western digit order even in
 * an RTL page, and letting it inherit RTL moves the currency symbol to the wrong
 * end of the number.
 */
export function OrderTable({
  orders,
  perspective,
  locale,
  m,
}: {
  orders: OrderListRow[];
  perspective: "requester" | "supplier";
  locale: Locale;
  m: Messages;
}) {
  const columns: Column<OrderListRow>[] = [
    {
      key: "title",
      header: m.execution.order.column.order,
      cell: (o) => (
        <RecordCell
          title={o.title ?? "—"}
          meta={m.execution.order.itemCountShort.replace("{count}", String(o.item_count ?? 0))}
          href={`/b2b/orders/${o.id}`}
        />
      ),
    },
    {
      key: "counterparty",
      header:
        perspective === "requester" ? m.execution.order.column.supplier : m.execution.order.column.requester,
      cell: (o) => (perspective === "requester" ? o.supplier_name : o.requester_name) ?? "—",
    },
    {
      key: "status",
      header: m.execution.order.column.status,
      cell: (o) => <OrderStatusBadge status={o.status ?? "confirmed"} />,
    },
    {
      key: "total",
      header: m.execution.order.column.total,
      numeric: true,
      cell: (o) => (
        <span dir="ltr" className="font-medium text-fg">
          {formatMoney(o.total, locale)}
        </span>
      ),
    },
    {
      key: "placed",
      header: m.execution.order.column.placed,
      numeric: true,
      desktopOnly: true,
      cell: (o) => (o.created_at ? formatDate(o.created_at, locale) : "—"),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={orders}
      rowKey={(o) => o.id ?? ""}
      caption={m.execution.order.title}
      empty={
        <StatePanel
          icon={<PackageIcon size={22} />}
          title={m.execution.order.empty[`${perspective}Title`]}
          body={m.execution.order.empty[`${perspective}Body`]}
        />
      }
    />
  );
}

export function ProjectTable({
  projects,
  perspective,
  locale,
  m,
}: {
  projects: ProjectListRow[];
  perspective: "executing" | "requester";
  locale: Locale;
  m: Messages;
}) {
  const columns: Column<ProjectListRow>[] = [
    {
      key: "title",
      header: m.execution.project.column.project,
      cell: (p) => <RecordCell title={p.title ?? "—"} href={`/b2b/projects/${p.id}`} />,
    },
    {
      key: "counterparty",
      header:
        perspective === "executing"
          ? m.execution.project.column.client
          : m.execution.project.column.executor,
      cell: (p) => (perspective === "executing" ? p.requester_name : p.executing_name) ?? "—",
    },
    {
      key: "status",
      header: m.execution.project.column.status,
      cell: (p) => <ProjectStatusBadge status={p.status ?? "planned"} />,
    },
    {
      key: "target",
      header: m.execution.project.column.target,
      numeric: true,
      cell: (p) => (p.target_date ? formatDate(p.target_date, locale) : "—"),
    },
    {
      key: "started",
      header: m.execution.project.column.started,
      numeric: true,
      desktopOnly: true,
      cell: (p) => (p.created_at ? formatDate(p.created_at, locale) : "—"),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={projects}
      rowKey={(p) => p.id ?? ""}
      caption={m.execution.project.title}
      empty={
        <StatePanel
          icon={<ActivityIcon size={22} />}
          title={m.execution.project.empty[`${perspective}Title`]}
          body={m.execution.project.empty[`${perspective}Body`]}
        />
      }
    />
  );
}
