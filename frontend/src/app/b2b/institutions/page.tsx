import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import {
  listOrganizations,
  organizationTypeCounts,
  sharedWorkCounts,
  INSTITUTION_ORG_TYPES,
} from "@/server/queries/directory";
import { PageHeader } from "@/features/sales/page-parts";
import { FilterBar } from "@/components/ui/filter-bar";
import { StatTiles } from "@/components/ui/stat-tiles";
import { OrganizationDirectoryTable } from "@/features/directory/directory-tables";
import { formatCompactMoney } from "@/lib/ui/format";
import { LandmarkIcon, BadgeCheckIcon, ReceiptIcon, WalletIcon } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

/**
 * Institutions — the contracting companies, design/engineering offices and peer
 * showrooms a business works ALONGSIDE, as distinct from the distributors it buys
 * from. Same hardened public directory, a different slice of organization types.
 *
 * What makes this the showroom's NETWORK rather than a phone book is the
 * relationship column: for each business it says how many orders the two of you
 * have actually exchanged, in either direction. That is derived from the caller's
 * own orders — they are a party to every one counted — so it is context they
 * already hold, surfaced where the decision is made. Read-only: there is no
 * trusted action a buyer can take against another business from a directory row
 * beyond looking at what it sells.
 */
export default async function InstitutionsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string }>;
}) {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);
  const sp = await searchParams;

  const [rows, counts, worked] = await Promise.all([
    listOrganizations(supabase, {
      types: INSTITUTION_ORG_TYPES,
      search: sp.q,
      type: sp.type,
      excludeOrgId: org.organizationId,
    }),
    organizationTypeCounts(supabase, INSTITUTION_ORG_TYPES, org.organizationId),
    sharedWorkCounts(supabase, org.organizationId),
  ]);

  // Only the counterparties visible in THIS directory count toward its tiles —
  // orders with a distributor belong to the Distributors module, not here.
  const connected = rows.filter((r) => r.id && worked.has(r.id));
  const exchanged = connected.reduce((s, r) => s + (worked.get(r.id!)?.value ?? 0), 0);

  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0">
      <PageHeader title={m.institutions.title} subtitle={m.institutions.subtitle} count={rows.length} />

      <StatTiles
        tiles={[
          { label: m.institutions.stat.total, value: counts.total, Icon: LandmarkIcon, tone: "accent" },
          { label: m.institutions.stat.verified, value: counts.verified, Icon: BadgeCheckIcon, tone: "success" },
          { label: m.institutions.stat.connected, value: connected.length, Icon: ReceiptIcon, tone: "info" },
          { label: m.institutions.stat.value, value: formatCompactMoney(exchanged, locale), Icon: WalletIcon },
        ]}
      />

      <div>
        <FilterBar
          basePath="/b2b/institutions"
          clearLabel={m.reports.filters.clear}
          search={{ name: "q", value: sp.q ?? "", placeholder: m.institutions.searchPlaceholder }}
          selects={[
            {
              name: "type",
              label: m.directory.column.type,
              value: sp.type ?? "",
              anyLabel: m.institutions.allTypes,
              options: INSTITUTION_ORG_TYPES.map((v) => ({ value: v, label: m.directory.orgType[v] })),
            },
          ]}
        />
        <OrganizationDirectoryTable
          rows={rows}
          m={m}
          sharedWork={worked}
          emptyTitle={m.institutions.emptyTitle}
          emptyBody={m.institutions.emptyBody}
        />
        <p className="mt-sm text-label text-fg-muted">{m.institutions.networkNote}</p>
      </div>
    </div>
  );
}
