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

/**
 * Delivery work as an operations table, not a list of titles.
 *
 * The columns are the questions a delivery manager actually asks of a project:
 * where is it, who is it for, what stage is it at, what is it worth, and when is
 * it due. Value comes from the ORDER the project delivers — a project's worth is
 * not a field anyone types, and inventing an editable one would let the two
 * numbers drift apart.
 *
 * There is deliberately no percentage-complete column. The reference screens show
 * one; Aladdin's project model has three states (planned → active → completed) and
 * no task or milestone table underneath them, so any percentage would be a number
 * with nothing behind it. The lifecycle badge says exactly what is known.
 */
export function ProjectTable({
  projects,
  perspective,
  locale,
  m,
  branchNames,
}: {
  projects: ProjectListRow[];
  perspective: "executing" | "requester";
  locale: Locale;
  m: Messages;
  /**
   * Branch id → name for the branch column. Supplied ONLY where the branch is the
   * caller's own — on a project this business EXECUTES, `branch_id` is the
   * requester's branch, which the caller cannot see the name of, so the column
   * would read "—" on every row. A column that is always empty is worse than no
   * column: it implies data is missing rather than not applicable.
   */
  branchNames?: Record<string, string>;
}) {
  const columns: Column<ProjectListRow>[] = [
    {
      key: "title",
      header: m.execution.project.column.project,
      // The site sits under the title rather than in its own column: it is what
      // identifies a project in conversation ("the Maadi one"), not an attribute
      // you scan a column of.
      cell: (p) => (
        <RecordCell title={p.title ?? "—"} meta={p.location ?? undefined} href={`/b2b/projects/${p.id}`} />
      ),
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
      key: "value",
      header: m.execution.project.column.value,
      numeric: true,
      cell: (p) => (
        <span dir="ltr" className="font-medium text-fg">
          {formatMoney(p.order_total, locale)}
        </span>
      ),
    },
    {
      key: "window",
      header: m.execution.project.column.window,
      numeric: true,
      desktopOnly: true,
      // Start and target together, because a target date alone does not say
      // whether the work has a runway or is already behind.
      cell: (p) => (
        <span dir="ltr" className="whitespace-nowrap">
          {p.start_date ? formatDate(p.start_date, locale) : "—"}
          {" → "}
          {p.target_date ? formatDate(p.target_date, locale) : "—"}
        </span>
      ),
    },
  ];

  if (branchNames) {
    columns.push({
      key: "branch",
      header: m.execution.project.column.branch,
      secondary: true,
      desktopOnly: true,
      cell: (p) => (p.branch_id && branchNames[p.branch_id]) || "—",
    });
  }

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
