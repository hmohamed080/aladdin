import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getRegistrationState } from "@/server/queries/registration";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadWorkspaces } from "@/server/queries/workspace";
import { personalEntry } from "@/lib/workspace/model";
import { loadPersonalHome } from "@/server/queries/personal-home";
import { loadTradeCatalog } from "@/server/queries/trades";
import { getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { tradeLabel } from "@/lib/i18n/trade-label";
import { createTranslator } from "@/lib/i18n/translate";
import { HomeHeader } from "@/features/home/parts";
import { Panel, WorkPane } from "@/components/ui/workspace-layout";
import { FilterBar } from "@/components/ui/filter-bar";
import { ButtonLink } from "@/components/ui/controls";
import { BriefcaseIcon, FilterIcon } from "@/components/ui/icons";
import { formatCount } from "@/lib/ui/format";
import { NoProfessionalProfile } from "@/features/profile/no-professional-profile";
import { OpportunityList } from "@/features/jobs/opportunity-list";
import {
  listJobOpportunities,
  listOpportunityGovernorates,
} from "@/server/queries/job-opportunities";

export const dynamic = "force-dynamic";

/**
 * Job Opportunities — the professional's discovery surface (revisit,
 * Increment 14, reference 02).
 *
 * COMPOSITION ONLY. The read seam and every filter dimension are Increment
 * 8's, unchanged: `open_job_opportunities` decides what exists (open, poster
 * currently verified) inside its own definer, so this page never asks about
 * verification and filters can only narrow that set, never widen it. O5
 * still holds — the trade filter is a convenience, unset by default, and
 * nothing here reads the caller's declared trades.
 *
 * THE GEOMETRY CHANGE: filters move into their own rail beside the results,
 * matching the reference's column balance, rather than a single inline bar
 * above a full-width grid. `FilterBar variant="flush"` composes into the
 * SAME `Panel` surface as the note under it, instead of nesting FilterBar's
 * own card inside a second one (the same fix Increment 13 made for the
 * Network hero+search block).
 *
 * DENSITY CORRECTION (Increment 14): the rail took `WorkPane`'s `wide`
 * (22rem) width in the first pass, which read as an oversized empty panel
 * beside three compact filters. It now takes the default `narrow` (18rem) —
 * the same width Jobs' own filter fields already wrap onto their own line
 * at either width, so nothing about the filters themselves changes — and the
 * results column keeps the width the rail gave back, which is what lets the
 * card grid open to three columns at `wide`.
 *
 * STILL NO: match percentage, distance/km, a map, bookmark hearts, ratings,
 * the private site address, or a fabricated image — none of those have
 * authority in this domain, and none were added here.
 */
export default async function JobOpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; trade?: string; gov?: string; applied?: string }>;
}) {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (state !== "active_personal") redirect("/onboarding");

  const supabase = await getServerSupabase();
  const { entries } = await loadWorkspaces(supabase);
  if (!personalEntry(entries)) redirect("/");

  const home = await loadPersonalHome();
  if (!home) redirect("/auth/sign-in");

  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);
  const t = createTranslator(locale);

  // The same test `job_application_submit` applies. A consumer can be shown the
  // openings — discovery is open to any authenticated caller — but the one
  // action this page exists for would be refused, so the destination is stated
  // as not theirs rather than half-working.
  if (home.variant !== "professional") return <NoProfessionalProfile />;

  const sp = await searchParams;
  const applied = sp.applied === "yes" || sp.applied === "no" ? sp.applied : undefined;
  const filtered = Boolean(sp.q || sp.trade || sp.gov || applied);

  const [opportunities, governorates, trades] = await Promise.all([
    listJobOpportunities(supabase, {
      search: sp.q,
      tradeKey: sp.trade,
      governorate: sp.gov,
      applied,
    }),
    listOpportunityGovernorates(supabase),
    // The ACTIVE catalog, and only it: a retired trade is not something a
    // professional should be able to filter for, because nothing can be
    // published under one (§20).
    loadTradeCatalog(),
  ]);

  return (
    <div className="flex flex-col gap-md" data-testid="job-opportunities">
      <HomeHeader
        eyebrow={m.jobs.opportunities.title}
        title={m.jobs.opportunities.title}
        lead={m.jobs.opportunities.subtitle}
        meta={
          <ButtonLink href="/home/jobs/applications" variant="outline" size="sm">
            {m.jobs.opportunities.myApplications}
          </ButtonLink>
        }
      />

      <WorkPane
        aside={
          <Panel title={t("jobs.opportunities.filtersTitle")} Icon={FilterIcon}>
            <div className="flex flex-col gap-sm">
              <FilterBar
                variant="flush"
                basePath="/home/jobs"
                search={{
                  name: "q",
                  value: sp.q ?? "",
                  placeholder: m.jobs.opportunities.searchPlaceholder,
                }}
                selects={[
                  {
                    name: "trade",
                    label: m.jobs.field.trade,
                    value: sp.trade ?? "",
                    anyLabel: m.jobs.opportunities.allTrades,
                    options: trades.map((tr) => ({ value: tr.key, label: tradeLabel(t, tr.key) })),
                  },
                  {
                    name: "gov",
                    label: m.jobs.field.governorate,
                    value: sp.gov ?? "",
                    anyLabel: m.jobs.opportunities.allLocations,
                    // Free text the posters wrote, so the label IS the value —
                    // there is no catalog key here to translate through.
                    options: governorates.map((g) => ({ value: g, label: g })),
                  },
                  {
                    name: "applied",
                    label: m.jobs.applications.title,
                    value: applied ?? "",
                    anyLabel: m.jobs.opportunities.allApplications,
                    options: [
                      { value: "no", label: m.jobs.opportunities.notApplied },
                      { value: "yes", label: m.jobs.opportunities.appliedOnly },
                    ],
                  },
                ]}
                clearLabel={m.jobs.opportunities.clear}
              />
              <p className="border-t pt-sm text-caption text-fg-muted">
                {m.jobs.opportunities.offTradeNote}
              </p>
            </div>
          </Panel>
        }
      >
        <Panel
          title={m.jobs.opportunities.title}
          Icon={BriefcaseIcon}
          badge={
            <span className="rounded-pill bg-surface-2 px-2 py-0.5 text-label font-medium text-fg-secondary tabular-nums">
              {formatCount(opportunities.length, locale)}
            </span>
          }
        >
          <OpportunityList opportunities={opportunities} locale={locale} filtered={filtered} />
        </Panel>
      </WorkPane>
    </div>
  );
}
