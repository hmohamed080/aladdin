import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import {
  listProfessionals,
  professionalCount,
  TECHNICIAN_PERSONAS,
  CONSULTANT_PERSONAS,
  type PersonaType,
} from "@/server/queries/directory";
import { PageHeader } from "@/features/sales/page-parts";
import { FilterBar } from "@/components/ui/filter-bar";
import { StatTiles, TabLinks } from "@/components/ui/stat-tiles";
import { ProfessionalDirectoryTable } from "@/features/directory/directory-tables";
import { WrenchIcon, UsersIcon } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

/** Trades tab lists the on-site trades; the consultants tab lists engineers/designers. */
function personasFor(group: string): PersonaType[] {
  return group === "consultants" ? CONSULTANT_PERSONAS : TECHNICIAN_PERSONAS;
}

/**
 * Technicians (الصنايعية) — the on-site trades a showroom recommends to a client
 * or brings onto a project.
 *
 * These are real Aladdin professionals who chose to be listed; the page reads the
 * hardened public profile directory and shows only its approved display columns.
 * A showroom cannot add a technician here — a person is their own account, never a
 * row in somebody else's address book.
 */
export default async function TechniciansPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; group?: string; persona?: string }>;
}) {
  const ctx = await getPageContext();
  if (!ctx) return null;
  const { supabase, locale } = ctx;
  const m = getMessages(locale);
  const sp = await searchParams;

  const group = sp.group === "consultants" ? "consultants" : "";
  const personas = personasFor(group);

  // The tabs and tiles need two NUMBERS, not two more directories. Listing each
  // group in full to read `.length` also meant that on the default tab one of those
  // lists was the same query the table below already ran.
  const [rows, trades, consultants] = await Promise.all([
    listProfessionals(supabase, { personas, search: sp.q, persona: sp.persona }),
    professionalCount(supabase, TECHNICIAN_PERSONAS),
    professionalCount(supabase, CONSULTANT_PERSONAS),
  ]);

  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0">
      <PageHeader title={m.technicians.title} subtitle={m.technicians.subtitle} count={rows.length} />

      <StatTiles
        tiles={[
          { label: m.technicians.stat.trades, value: trades, Icon: WrenchIcon, tone: "accent" },
          { label: m.technicians.stat.consultants, value: consultants, Icon: UsersIcon, tone: "info" },
        ]}
        className="tablet:grid-cols-2 desktop:grid-cols-2"
      />

      <div>
        <TabLinks
          basePath="/b2b/technicians"
          param="group"
          current={group}
          label={m.technicians.title}
          tabs={[
            { value: "", label: m.technicians.tab.trades, count: trades },
            { value: "consultants", label: m.technicians.tab.consultants, count: consultants },
          ]}
        />
        <FilterBar
          basePath="/b2b/technicians"
          search={{ name: "q", value: sp.q ?? "", placeholder: m.technicians.searchPlaceholder }}
          selects={[
            {
              name: "persona",
              label: m.directory.column.trade,
              value: sp.persona ?? "",
              anyLabel: m.technicians.allTrades,
              options: personas.map((v) => ({ value: v, label: m.directory.persona[v] })),
            },
          ]}
        />
        <ProfessionalDirectoryTable
          rows={rows}
          m={m}
          emptyTitle={m.technicians.emptyTitle}
          emptyBody={m.technicians.emptyBody}
        />
      </div>
    </div>
  );
}
