import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getRegistrationState, hasAppAccess } from "@/server/queries/registration";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadWorkspaces } from "@/server/queries/workspace";
import { personalEntry } from "@/lib/workspace/model";
import { loadPersonalHome } from "@/server/queries/personal-home";
import { loadTradeCatalog } from "@/server/queries/trades";
import { getMessages, createTranslator } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { tradeLabel } from "@/lib/i18n/trade-label";
import { ButtonLink } from "@/components/ui/controls";
import { NoProfessionalProfile } from "@/features/profile/no-professional-profile";
import { InstallerJobsBoard } from "@/features/home/installer-jobs-board";
import { jobCountLabel, toJobCardVMs } from "@/features/home/installer-jobs-data";
import { parseJobBoardParams, toOpportunityQuery, type JobBoardParams } from "@/lib/installer/job-board-filters";
import {
  OPPORTUNITY_LIST_LIMIT,
  listJobOpportunities,
  listOpportunityGovernorates,
} from "@/server/queries/job-opportunities";

export const dynamic = "force-dynamic";

/**
 * Job Opportunities — the installer's discovery surface, in the approved
 * presentation shared with `/preview/installer-job-opportunities`.
 *
 * COMPOSITION ONLY. The read seam and every filter dimension stay the database's:
 * `open_job_opportunities` decides what exists (open, poster currently verified)
 * inside its own definer, so this page never asks about verification and filters
 * can only narrow that set, never widen it. O5 still holds — the trade filter is a
 * convenience, unset by default, and nothing here reads the caller's declared
 * trades: the default board is ALL trades.
 *
 * The URL is the board's state (`lib/installer/job-board-filters.ts`). This route
 * parses it, runs the real query, adapts rows to the shared view model, and hands
 * the result to the shared View. The shell (sidebar, topbar) is the installer
 * layout's, so nothing here draws chrome.
 *
 * STILL NO: match percentage, distance/km, a map, radius, save hearts or a saved
 * count, a "New" badge, ratings, the private site address, or a fabricated image —
 * none of those have authority in this domain.
 */
export default async function JobOpportunitiesPage({
  searchParams,
}: {
  searchParams: Promise<JobBoardParams>;
}) {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (!hasAppAccess(state)) redirect("/onboarding");

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

  const { filters, sort } = parseJobBoardParams(await searchParams);

  const [opportunities, governorates, trades] = await Promise.all([
    listJobOpportunities(supabase, toOpportunityQuery(filters, sort)),
    listOpportunityGovernorates(supabase),
    // The ACTIVE catalog, and only it: a retired trade is not something a
    // professional should be able to filter for, because nothing can be
    // published under one (§20).
    loadTradeCatalog(),
  ]);

  return (
    <div className="flex flex-1 flex-col" data-testid="job-opportunities">
      <InstallerJobsBoard
        opportunities={toJobCardVMs(opportunities, t, locale)}
        countLabel={jobCountLabel(opportunities.length, OPPORTUNITY_LIST_LIMIT, locale)}
        filters={filters}
        sort={sort}
        tradeOptions={trades.map((tr) => ({ key: tr.key, label: tradeLabel(t, tr.key) }))}
        governorates={governorates}
        subtitle={m.jobs.opportunities.subtitle}
        headerAction={
          <ButtonLink href="/home/jobs/applications" variant="outline" size="sm" className="self-start tablet:self-auto">
            {m.jobs.opportunities.myApplications}
          </ButtonLink>
        }
      />
    </div>
  );
}
