import type { Messages } from "@/lib/i18n/messages/en";
import type { Locale } from "@/lib/i18n/locales";
import { DataTable, RecordCell, Monogram, type Column } from "@/components/ui/data-table";
import { Badge, StatePanel } from "@/components/ui/primitives";
import { BadgeCheckIcon, StorefrontIcon } from "@/components/ui/icons";
import { formatDate } from "@/lib/ui/format";
import { formatMoney } from "@/features/commerce/constants";
import type { CustomerOrganization } from "@/server/queries/directory";

/**
 * The supply side's customer network.
 *
 * Every column is either a COUNT OF THE CALLER'S OWN RECORDS or a column the
 * other business has published publicly. That boundary is the whole design:
 *
 *   - requests / quotations / accepted / orders / value / last activity
 *     → the caller's own commerce with that business. It is a party to every one.
 *   - type / verified
 *     → the hardened public directory projection, the same one the Distributors
 *       and Institutions modules read.
 *
 * There is nothing else, and that is deliberate. The reference set shows a
 * contact person, a phone button, a star rating, an outstanding balance and a
 * credit limit. Aladdin has no rating model, publishes no contact details on a
 * directory row, and has no receivables model at all — so a row here says what is
 * true and stops.
 *
 * An UNLISTED customer is shown rather than hidden: a real trading relationship
 * must not vanish from a seller's own customer list because the other business
 * has not finished verification. It is marked, not dropped.
 */
export function CustomerNetworkTable({
  rows,
  m,
  locale,
  emptyTitle,
  emptyBody,
}: {
  rows: CustomerOrganization[];
  m: Messages;
  locale: Locale;
  emptyTitle: string;
  emptyBody: string;
}) {
  const columns: Column<CustomerOrganization>[] = [
    {
      key: "business",
      header: m.supply.customers.column.business,
      cell: (c) => (
        <RecordCell
          title={c.name}
          avatar={<Monogram name={c.name} />}
          meta={
            c.listed && c.orgType ? (
              m.directory.orgType[c.orgType]
            ) : (
              <span title={m.supply.customers.unlistedHint}>{m.supply.customers.unlisted}</span>
            )
          }
        />
      ),
    },
    {
      key: "verified",
      header: m.directory.column.status,
      secondary: true,
      cell: (c) =>
        c.listed ? (
          <Badge tone="success">
            <BadgeCheckIcon size={13} />
            {m.directory.verified}
          </Badge>
        ) : (
          <Badge tone="neutral">{m.directory.unverified}</Badge>
        ),
    },
    {
      key: "requests",
      header: m.supply.customers.column.requests,
      numeric: true,
      desktopOnly: true,
      cell: (c) => c.requests,
    },
    {
      key: "quotations",
      header: m.supply.customers.column.quotations,
      numeric: true,
      desktopOnly: true,
      // "3 (2 accepted)" says in one cell what two columns would: how much we
      // priced for them, and how much of it they took.
      cell: (c) =>
        c.accepted > 0 ? (
          <span className="tabular-nums">
            {c.quotations}{" "}
            <span className="text-label text-success">
              ({m.supply.customers.column.accepted}: {c.accepted})
            </span>
          </span>
        ) : (
          c.quotations
        ),
    },
    {
      key: "orders",
      header: m.supply.customers.column.orders,
      numeric: true,
      cell: (c) => c.orders,
    },
    {
      key: "value",
      header: m.supply.customers.column.value,
      numeric: true,
      cell: (c) => (
        <span dir="ltr" className="tabular-nums">
          {formatMoney(c.orderValue, locale)}
        </span>
      ),
    },
    {
      key: "last",
      header: m.supply.customers.column.lastActivity,
      numeric: true,
      desktopOnly: true,
      secondary: true,
      cell: (c) => (c.lastActivity ? formatDate(c.lastActivity, locale) : "—"),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(c) => c.organizationId}
      caption={m.supply.customers.title}
      empty={<StatePanel icon={<StorefrontIcon size={22} />} title={emptyTitle} body={emptyBody} />}
    />
  );
}
