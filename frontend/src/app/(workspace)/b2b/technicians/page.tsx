import { getPageContext } from "@/server/queries/page-context";
import { getMessages } from "@/lib/i18n/translate";
import {
  listProfessionals,
  professionalCount,
  TECHNICIAN_PERSONAS,
  CONSULTANT_PERSONAS,
  type PersonaType,
} from "@/server/queries/directory";
import { PageHeader } from "@/components/ui/workspace-layout";
import { FilterBar } from "@/components/ui/filter-bar";
import { StatTiles, TabLinks } from "@/components/ui/stat-tiles";
import { ProfessionalDirectoryTable } from "@/features/directory/directory-tables";
import { WrenchIcon, UsersIcon, BadgeCheckIcon } from "@/components/ui/icons";

export const dynamic = "force-dynamic";

/** Trades tab lists the on-site trades; the consultants tab lists engineers/designers. */
function personasFor(group: string): PersonaType[] {
  return group === "consultants" ? CONSULTANT_PERSONAS : TECHNICIAN_PERSONAS;
}

/**
 * Technicians (الصنايعية) — the on-site trades a showroom recommends to a client
 * or brings onto a project.
 *
 * TRADES ARE THE MODULE; consultants are a secondary view. The default tab, the
 * page subtitle, the search placeholder and the trade filter all describe
 * installers, and the consultants tab is one click away for the case where a
 * showroom needs an engineer or a designer instead. Making the default a mixed
 * "professionals" list would have meant a buyer looking for a tiler scrolling past
 * interior designers.
 *
 * These are real Aladdin professionals who chose to be listed; the page reads the
 * hardened public profile directory and shows only its approved display columns —
 * the trade they wrote for themselves, their own summary, and the languages they
 * work in. There is no rating, no availability and no phone number, because the
 * model holds none of those and a directory that invents them is worse than one
 * that admits what it knows. A showroom cannot add a technician here either — a
 * person is their own account, never a row in somebody else's address book.
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
  const consultants = group === "consultants";
  const personas = personasFor(group);

  // The tabs and tiles need two NUMBERS, not two more directories. Listing each
  // group in full to read `.length` also meant that on the default tab one of those
  // lists was the same query the table below already ran.
  const [rows, tradeCount, consultantCount] = await Promise.all([
    listProfessionals(supabase, { personas, search: sp.q, persona: sp.persona }),
    professionalCount(supabase, TECHNICIAN_PERSONAS),
    professionalCount(supabase, CONSULTANT_PERSONAS),
  ]);

  // A trade who lists both languages can work a site in either — worth surfacing
  // for a showroom whose client speaks one and whose crew speaks the other.
  const bilingual = rows.filter((r) => (r.languages?.length ?? 0) > 1).length;

  return (
    <div className="flex flex-col gap-lg pb-16 tablet:pb-0">
      <PageHeader
        locale={locale}
        Icon={WrenchIcon}
        title={m.technicians.title}
        subtitle={consultants ? m.technicians.consultantsSubtitle : m.technicians.subtitle}
        count={rows.length}
      />

      <StatTiles
        locale={locale}
        layout="strip"
        tiles={[
          { label: m.technicians.stat.trades, value: tradeCount, Icon: WrenchIcon, tone: "accent" },
          { label: m.technicians.stat.consultants, value: consultantCount, Icon: UsersIcon, tone: "info" },
          { label: m.technicians.stat.languages, value: bilingual, Icon: BadgeCheckIcon },
        ]}
        className="tablet:grid-cols-3 desktop:grid-cols-3"
      />

      <div>
        <TabLinks
          locale={locale}
          basePath="/b2b/technicians"
          param="group"
          current={group}
          label={m.technicians.title}
          tabs={[
            { value: "", label: m.technicians.tab.trades, count: tradeCount },
            { value: "consultants", label: m.technicians.tab.consultants, count: consultantCount },
          ]}
        />
        <FilterBar
          basePath="/b2b/technicians"
          clearLabel={m.reports.filters.clear}
          search={{ name: "q", value: sp.q ?? "", placeholder: m.technicians.searchPlaceholder }}
          selects={[
            // A single-persona group (trades) has nothing to narrow to, so the
            // filter appears only where it can actually change the result.
            ...(personas.length > 1
              ? [
                  {
                    name: "persona",
                    label: m.directory.column.trade,
                    value: sp.persona ?? "",
                    anyLabel: m.technicians.allTrades,
                    options: personas.map((v) => ({ value: v, label: m.directory.persona[v] })),
                  },
                ]
              : []),
          ]}
        />
        <ProfessionalDirectoryTable
          rows={rows}
          m={m}
          emptyTitle={consultants ? m.technicians.emptyConsultantsTitle : m.technicians.emptyTitle}
          emptyBody={consultants ? m.technicians.emptyConsultantsBody : m.technicians.emptyBody}
        />
        <p className="mt-sm text-label text-fg-muted">{m.technicians.contactNote}</p>
      </div>
    </div>
  );
}
