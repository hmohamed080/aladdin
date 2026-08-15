import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import {
  listOrganizations,
  organizationTypeCounts,
  INSTITUTION_ORG_TYPES,
} from "@/server/queries/directory";
import { PageHeader } from "@/features/sales/page-parts";
import { FilterBar } from "@/components/ui/filter-bar";
import { StatTiles } from "@/components/ui/stat-tiles";
import { OrganizationDirectoryTable } from "@/features/directory/directory-tables";
import { LandmarkIcon, BadgeCheckIcon, LayersIcon, BuildingIcon } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

/**
 * Institutions — the contracting companies, design/engineering offices and peer
 * showrooms a business works ALONGSIDE, as distinct from the suppliers it buys
 * from. Same hardened public directory, a different slice of organization types.
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

  const [rows, counts] = await Promise.all([
    listOrganizations(supabase, { types: INSTITUTION_ORG_TYPES, search: sp.q, type: sp.type, excludeOrgId: org.organizationId }),
    organizationTypeCounts(supabase, INSTITUTION_ORG_TYPES, org.organizationId),
  ]);

  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0">
      <PageHeader title={m.institutions.title} subtitle={m.institutions.subtitle} count={rows.length} />

      <StatTiles
        tiles={[
          { label: m.institutions.stat.total, value: counts.total, Icon: LandmarkIcon, tone: "accent" },
          { label: m.institutions.stat.verified, value: counts.verified, Icon: BadgeCheckIcon, tone: "success" },
          {
            label: m.directory.orgType.contractor_company,
            value: counts.byType.contractor_company ?? 0,
            Icon: LayersIcon,
          },
          {
            label: m.directory.orgType.design_office,
            value: counts.byType.design_office ?? 0,
            Icon: BuildingIcon,
          },
        ]}
      />

      <div>
        <FilterBar
          basePath="/b2b/institutions"
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
          emptyTitle={m.institutions.emptyTitle}
          emptyBody={m.institutions.emptyBody}
        />
      </div>
    </div>
  );
}
