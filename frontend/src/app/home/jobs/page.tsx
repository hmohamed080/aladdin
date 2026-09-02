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
import { FilterBar } from "@/components/ui/filter-bar";
import { ButtonLink } from "@/components/ui/controls";
import { NoProfessionalProfile } from "@/features/profile/no-professional-profile";
import { OpportunityList } from "@/features/jobs/opportunity-list";
import {
  listJobOpportunities,
  listOpportunityGovernorates,
} from "@/server/queries/job-opportunities";

export const dynamic = "force-dynamic";

/**
 * Job Opportunities — the professional's discovery surface.
 *
 * The read seam decides what exists. `open_job_opportunities` returns open jobs
 * whose poster is CURRENTLY verified, active and not deleted, and it decides
 * that inside its own definer with a live join — so this page never asks about
 * verification, never filters on it, and cannot get it wrong. Filters here can
 * only narrow that set.
 *
 * O5, ON THIS PAGE. The trade filter is a convenience and is unset by default.
 * Nothing on this route reads the caller's declared trades, and an opening in a
 * trade they have never claimed is listed, opened and applied for identically.
 * The note under the toolbar says so in the reader's own language, because the
 * trade dropdown is the one control here a professional could reasonably mistake
 * for a rule about who is allowed to apply.
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
    <div className="flex flex-col gap-xl" data-testid="job-opportunities">
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

      <div>
        <FilterBar
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
              // Free text the posters wrote, so the label IS the value — there
              // is no catalog key here to translate through.
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
        <p className="-mt-md mb-lg text-caption text-fg-muted">
          {m.jobs.opportunities.offTradeNote}
        </p>
      </div>

      <OpportunityList opportunities={opportunities} locale={locale} filtered={filtered} />
    </div>
  );
}
