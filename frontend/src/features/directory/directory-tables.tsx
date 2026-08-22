import Link from "next/link";
import type { Messages } from "@/lib/i18n/messages/en";
import type { Locale } from "@/lib/i18n/locales";
import { formatCount } from "@/lib/ui/format";
import { DataTable, RecordCell, Monogram, type Column } from "@/components/ui/data-table";
import { Badge, StatePanel } from "@/components/ui/primitives";
import { BadgeCheckIcon, BuildingIcon, UserIcon } from "@/components/ui/icons";
import type { OrgDirectoryRow, ProfileDirectoryRow, OrgFacet, SharedWork } from "@/server/queries/directory";

/**
 * Directory tables shared by Distributors, Institutions and Technicians.
 *
 * One component per record shape, not one per module: Distributors and
 * Institutions differ only in which organization types they list and which
 * context column they carry, so they render the same table with different
 * columns. Server components — they take the resolved message catalog rather than
 * a client i18n hook.
 *
 * Only columns backed by real data appear. The reference screens show star
 * ratings, deal history, countries and phone buttons. Aladdin has no rating
 * model, no locality table, and does not publish a professional's phone number —
 * so none of those render here. What DOES exist is more useful anyway: what a
 * distributor actually publishes, and whether you have already worked together.
 */

/**
 * "1 order" / "4 orders" — shared so the two surfaces that show it agree.
 *
 * The count goes through the shared formatter rather than `String()`: this label
 * sits in a badge beside money and dates that are already localised, and a Latin
 * "4" next to an Arabic "٤" on the same row is the exact defect this pass exists
 * to remove.
 */
export function orderCountLabel(count: number, m: Messages, locale: Locale): string {
  return count === 1
    ? m.directory.workedOrderOne
    : m.directory.workedOrders.replace("{count}", formatCount(count, locale));
}

function VerifiedBadge({ verified, m }: { verified: boolean | null; m: Messages }) {
  return verified ? (
    <Badge tone="success">
      <BadgeCheckIcon size={13} />
      {m.directory.verified}
    </Badge>
  ) : (
    <Badge tone="neutral">{m.directory.unverified}</Badge>
  );
}

/** The categories a business publishes in, as chips — capped so one broad
 *  catalog cannot push the row's other columns off the table. */
function CategoryChips({ facet, m }: { facet: OrgFacet | undefined; m: Messages }) {
  if (!facet || facet.categories.length === 0) {
    return <span className="text-fg-muted">{m.directory.noProducts}</span>;
  }
  const shown = facet.categories.slice(0, 3);
  const rest = facet.categories.length - shown.length;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {shown.map((c) => (
        <Badge key={c} tone="neutral">
          {m.commerce.categories[c]}
        </Badge>
      ))}
      {rest > 0 ? <span className="text-label text-fg-muted">+{rest}</span> : null}
    </span>
  );
}

export function OrganizationDirectoryTable({
  rows,
  m,
  locale,
  emptyTitle,
  emptyBody,
  facets,
  sharedWork,
}: {
  rows: OrgDirectoryRow[];
  m: Messages;
  locale: Locale;
  emptyTitle: string;
  emptyBody: string;
  /** What each business publishes. Passed by the Distributors module. */
  facets?: Map<string, OrgFacet>;
  /** Orders exchanged with the caller. Passed by the Institutions module. */
  sharedWork?: Map<string, SharedWork>;
}) {
  const columns: Column<OrgDirectoryRow>[] = [
    {
      key: "name",
      header: m.directory.column.business,
      cell: (r) => (
        <RecordCell
          title={r.name ?? "—"}
          meta={r.org_type ? m.directory.orgType[r.org_type] : undefined}
          avatar={<Monogram name={r.name ?? "?"} />}
        />
      ),
    },
    {
      key: "type",
      header: m.directory.column.type,
      secondary: true,
      cell: (r) => (r.org_type ? m.directory.orgType[r.org_type] : "—"),
    },
  ];

  if (facets) {
    columns.push({
      key: "coverage",
      header: m.directory.column.coverage,
      cell: (r) => <CategoryChips facet={r.id ? facets.get(r.id) : undefined} m={m} />,
    });
    columns.push({
      key: "products",
      header: m.suppliers.stat.products,
      numeric: true,
      desktopOnly: true,
      cell: (r) => {
        const n = (r.id && facets.get(r.id)?.products) || 0;
        return n > 0 ? m.directory.productCount.replace("{count}", formatCount(n, locale)) : "—";
      },
    });
  }

  if (sharedWork) {
    columns.push({
      key: "worked",
      header: m.directory.column.worked,
      cell: (r) => {
        const w = r.id ? sharedWork.get(r.id) : undefined;
        return w ? (
          <Badge tone="info">{orderCountLabel(w.orders, m, locale)}</Badge>
        ) : (
          <span className="text-fg-muted">{m.directory.noSharedWork}</span>
        );
      },
    });
  }

  columns.push({
    key: "verified",
    header: m.directory.column.status,
    cell: (r) => <VerifiedBadge verified={r.is_verified} m={m} />,
  });
  columns.push({
    key: "actions",
    header: m.directory.column.actions,
    numeric: true,
    cell: (r) =>
      r.id ? (
        <Link
          href={`/b2b/catalog?supplier=${r.id}`}
          className="text-label font-medium text-accent hover:underline"
        >
          {m.directory.viewProducts}
        </Link>
      ) : null,
  });

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id ?? r.slug ?? ""}
      caption={m.directory.column.business}
      empty={<StatePanel icon={<BuildingIcon size={22} />} title={emptyTitle} body={emptyBody} />}
    />
  );
}

/**
 * No `locale` prop here on purpose: this table renders names, trades, bios and
 * language badges and not one number, so taking a locale it never uses would be
 * a prop that lies about what the component does.
 */
export function ProfessionalDirectoryTable({
  rows,
  m,
  emptyTitle,
  emptyBody,
}: {
  rows: ProfileDirectoryRow[];
  m: Messages;
  emptyTitle: string;
  emptyBody: string;
}) {
  const columns: Column<ProfileDirectoryRow>[] = [
    {
      key: "name",
      header: m.directory.column.person,
      cell: (r) => (
        <RecordCell
          title={r.display_name ?? "—"}
          meta={r.persona ? m.directory.persona[r.persona] : undefined}
          avatar={<Monogram name={r.display_name ?? "?"} />}
        />
      ),
    },
    {
      // The professional's own one-line description of their trade — the single
      // most useful thing on the row when picking who to bring to a site.
      key: "headline",
      header: m.directory.column.trade,
      cell: (r) => <span className="font-medium text-fg">{r.headline ?? "—"}</span>,
    },
    {
      key: "summary",
      header: m.directory.column.summary,
      secondary: true,
      desktopOnly: true,
      cell: (r) => <span className="line-clamp-2 text-fg-secondary">{r.bio ?? "—"}</span>,
    },
    {
      key: "languages",
      header: m.directory.column.languages,
      secondary: true,
      desktopOnly: true,
      cell: (r) =>
        r.languages?.length ? (
          <span className="flex flex-wrap gap-1">
            {r.languages.map((l) => (
              <Badge key={l} tone="neutral">
                {m.common.languageName[l as "ar" | "en"] ?? l}
              </Badge>
            ))}
          </span>
        ) : (
          "—"
        ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={rows}
      rowKey={(r) => r.id ?? ""}
      caption={m.directory.column.person}
      empty={<StatePanel icon={<UserIcon size={22} />} title={emptyTitle} body={emptyBody} />}
    />
  );
}
