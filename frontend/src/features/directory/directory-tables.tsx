import Link from "next/link";
import type { Messages } from "@/lib/i18n/messages/en";
import { DataTable, RecordCell, Monogram, type Column } from "@/components/ui/data-table";
import { Badge, StatePanel } from "@/components/ui/primitives";
import { BadgeCheckIcon, BuildingIcon, UserIcon } from "@/components/ui/icons";
import type { OrgDirectoryRow, ProfileDirectoryRow } from "@/server/queries/directory";

/**
 * Directory tables shared by Suppliers, Institutions and Technicians.
 *
 * One component per record shape, not one per module: Suppliers and Institutions
 * differ only in which organization types they list and where their rows lead, so
 * they render the same table with different labels. Server components — they take
 * the resolved message catalog rather than a client i18n hook.
 *
 * Only columns backed by real data appear. The references show star ratings, deal
 * history and contact buttons; none of those exist in Aladdin, and inventing them
 * would put fabricated numbers in front of a client.
 */

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

export function OrganizationDirectoryTable({
  rows,
  m,
  emptyTitle,
  emptyBody,
}: {
  rows: OrgDirectoryRow[];
  m: Messages;
  emptyTitle: string;
  emptyBody: string;
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
    {
      key: "verified",
      header: m.directory.column.status,
      cell: (r) => <VerifiedBadge verified={r.is_verified} m={m} />,
    },
    {
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
    },
  ];

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
      key: "headline",
      header: m.directory.column.headline,
      cell: (r) => <span className="line-clamp-2">{r.headline ?? "—"}</span>,
    },
    {
      key: "trade",
      header: m.directory.column.trade,
      secondary: true,
      desktopOnly: true,
      cell: (r) => (r.persona ? m.directory.persona[r.persona] : "—"),
    },
    {
      key: "languages",
      header: m.directory.column.languages,
      secondary: true,
      desktopOnly: true,
      cell: (r) => (r.languages?.length ? r.languages.join(", ") : "—"),
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
