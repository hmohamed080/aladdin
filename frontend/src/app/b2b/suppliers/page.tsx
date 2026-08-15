import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import {
  listOrganizations,
  organizationTypeCounts,
  SUPPLIER_ORG_TYPES,
} from "@/server/queries/directory";
import { PageHeader } from "@/features/sales/page-parts";
import { FilterBar } from "@/components/ui/filter-bar";
import { StatTiles } from "@/components/ui/stat-tiles";
import { OrganizationDirectoryTable } from "@/features/directory/directory-tables";
import { TruckIcon, BadgeCheckIcon, PackageIcon, BuildingIcon } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

/**
 * Suppliers — the businesses this showroom buys from.
 *
 * A directory of organizations already registered on Aladdin, not a private
 * address book: a showroom cannot create a supplier record here, because a
 * business is an Organization with its own identity and its own owner. Rows lead
 * into that supplier's published catalog, which is where an RFQ actually starts.
 */
export default async function SuppliersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string }>;
}) {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, org, locale } = ctx;
  const m = getMessages(locale);
  const sp = await searchParams;

  const [rows, counts] = await Promise.all([
    listOrganizations(supabase, { types: SUPPLIER_ORG_TYPES, search: sp.q, type: sp.type, excludeOrgId: org.organizationId }),
    organizationTypeCounts(supabase, SUPPLIER_ORG_TYPES, org.organizationId),
  ]);

  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0">
      <PageHeader title={m.suppliers.title} subtitle={m.suppliers.subtitle} count={rows.length} />

      <StatTiles
        tiles={[
          { label: m.suppliers.stat.total, value: counts.total, Icon: TruckIcon, tone: "accent" },
          { label: m.suppliers.stat.verified, value: counts.verified, Icon: BadgeCheckIcon, tone: "success" },
          {
            label: m.directory.orgType.manufacturer,
            value: counts.byType.manufacturer ?? 0,
            Icon: BuildingIcon,
          },
          { label: m.directory.orgType.supplier, value: counts.byType.supplier ?? 0, Icon: PackageIcon },
        ]}
      />

      <div>
        <FilterBar
          basePath="/b2b/suppliers"
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
          emptyTitle={m.suppliers.emptyTitle}
          emptyBody={m.suppliers.emptyBody}
        />
      </div>
    </div>
  );
}
