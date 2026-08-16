import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import {
  listOrganizations,
  organizationTypeCounts,
  organizationProductFacets,
  sharedWorkCounts,
  SUPPLIER_ORG_TYPES,
} from "@/server/queries/directory";
import { PageHeader } from "@/features/sales/page-parts";
import { FilterBar } from "@/components/ui/filter-bar";
import { StatTiles } from "@/components/ui/stat-tiles";
import { OrganizationDirectoryTable } from "@/features/directory/directory-tables";
import { TruckIcon, BadgeCheckIcon, PackageIcon, ReceiptIcon } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

/**
 * Distributors — the businesses this showroom buys from.
 *
 * A directory of organizations already registered on Aladdin, not a private
 * address book: a showroom cannot create a distributor record here, because a
 * business is an Organization with its own identity and its own owner. Rows lead
 * into that distributor's published catalog, which is where an RFQ actually starts.
 *
 * A sourcing module, not a list of names: each row says what the business
 * publishes and how many products it has listed, so the buyer can tell who is
 * worth opening before opening anything. The tiles above answer the same question
 * for the whole directory, including how many of these businesses this showroom
 * has already bought from — the one piece of context no public column carries.
 */
export default async function DistributorsPage({
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
      types: SUPPLIER_ORG_TYPES,
      search: sp.q,
      type: sp.type,
      excludeOrgId: org.organizationId,
    }),
    organizationTypeCounts(supabase, SUPPLIER_ORG_TYPES, org.organizationId),
    sharedWorkCounts(supabase, org.organizationId),
  ]);

  // Facets are looked up for the rows actually on screen — a second request, but
  // one bounded by the page rather than by the size of the platform's catalog.
  const facets = await organizationProductFacets(
    supabase,
    rows.map((r) => r.id).filter((id): id is string => !!id),
  );

  const productTotal = [...facets.values()].reduce((s, f) => s + f.products, 0);
  const boughtFrom = rows.filter((r) => r.id && worked.has(r.id)).length;

  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0">
      <PageHeader title={m.suppliers.title} subtitle={m.suppliers.subtitle} count={rows.length} />

      <StatTiles
        tiles={[
          { label: m.suppliers.stat.total, value: counts.total, Icon: TruckIcon, tone: "accent" },
          { label: m.suppliers.stat.verified, value: counts.verified, Icon: BadgeCheckIcon, tone: "success" },
          { label: m.suppliers.stat.products, value: productTotal, Icon: PackageIcon, href: "/b2b/catalog" },
          { label: m.suppliers.stat.bought, value: boughtFrom, Icon: ReceiptIcon, tone: "info" },
        ]}
      />

      <div>
        <FilterBar
          basePath="/b2b/suppliers"
          clearLabel={m.reports.filters.clear}
          search={{ name: "q", value: sp.q ?? "", placeholder: m.suppliers.searchPlaceholder }}
          selects={[
            {
              name: "type",
              label: m.directory.column.type,
              value: sp.type ?? "",
              anyLabel: m.suppliers.allTypes,
              options: SUPPLIER_ORG_TYPES.map((v) => ({ value: v, label: m.directory.orgType[v] })),
            },
          ]}
        />
        <OrganizationDirectoryTable
          rows={rows}
          m={m}
          facets={facets}
          emptyTitle={m.suppliers.emptyTitle}
          emptyBody={m.suppliers.emptyBody}
        />
      </div>
    </div>
  );
}
