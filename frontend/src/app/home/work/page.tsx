import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getRegistrationState, hasAppAccess } from "@/server/queries/registration";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadWorkspaces } from "@/server/queries/workspace";
import { personalEntry } from "@/lib/workspace/model";
import { loadPersonalHome } from "@/server/queries/personal-home";
import { getMessages, createTranslator } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { ButtonLink } from "@/components/ui/controls";
import { NoProfessionalProfile } from "@/features/profile/no-professional-profile";
import { InstallerWorkBoard } from "@/features/home/installer-work-board";
import { InstallerWorkRail } from "@/features/home/installer-work-rail";
import { filtersToState, toActiveWorkVM, toWorkTabs } from "@/features/home/installer-work-data";
import { WORK_PAGE_STEP, parseWorkBoardParams, toWorkBoardSearch, type WorkBoardParams } from "@/lib/installer/work-board-params";
import { listSavedSearches } from "@/server/queries/saved-searches";
import { loadWorkBoardPage } from "@/server/queries/work-board-page";
import {
  countMyAssignments,
  getFeaturedAssignment,
  listProgressUpdates,
  listWorkCompanies,
} from "@/server/queries/job-assignments";

export const dynamic = "force-dynamic";

/**
 * MY WORK — "what have I been assigned, and what is its state?", in the approved
 * presentation shared with `/preview/installer-my-work`.
 *
 * EVERY FIGURE ON THIS PAGE IS THE DATABASE'S, and none is derived from a fetched
 * list. The URL is the board's state (`lib/installer/work-board-params.ts`):
 *
 *   - `my_work_page` returns one PAGE of the filtered, ordered assignments — status,
 *     search, company, planned period, contact and sort all applied in SQL — together
 *     with the EXACT filtered total. This route renders the first page; "Show more"
 *     asks for the next page (`loadMoreWorkAction`) and appends it, with no ceiling, so
 *     an installer with a thousand assignments pages through all of them and sees the
 *     same exact counts as one with six.
 *   - `my_work_counts` is an exact COUNT per status, for the tabs and the summary
 *     rail, so they cannot disagree with the list beside them and never depend on
 *     how many rows were fetched.
 *   - the featured assignment, the Company filter's options and the reviews of the
 *     rows on screen are three small reads of their own.
 *
 * The default "All your work" means in progress + completed. Scheduled and
 * cancelled work is reachable through its own `?state=` (the summary rail links to
 * them), so no record is hidden. `state=current` is the composite of `scheduled` +
 * `in_progress`, computed from `status` and stored nowhere.
 *
 * The shell (sidebar, topbar) is the installer layout's; nothing here draws chrome.
 * The real actions — start, report progress, cancel — stay on the assignment's own
 * page, which this page only links to.
 */
export default async function MyWorkPage({ searchParams }: { searchParams: Promise<WorkBoardParams> }) {
  const registration = await getRegistrationState();
  if (registration === "unverified") redirect("/auth/sign-in");
  if (!hasAppAccess(registration)) redirect("/onboarding");

  const supabase = await getServerSupabase();
  const { entries } = await loadWorkspaces(supabase);
  if (!personalEntry(entries)) redirect("/");

  const home = await loadPersonalHome();
  if (!home) redirect("/auth/sign-in");

  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);
  const t = createTranslator(locale);

  if (home.variant !== "professional") return <NoProfessionalProfile />;

  const { state } = parseWorkBoardParams(await searchParams);
  const now = new Date();

  const [page, counts, companies, featured, saved] = await Promise.all([
    loadWorkBoardPage(supabase, state, null, WORK_PAGE_STEP, t, locale, now),
    countMyAssignments(supabase),
    listWorkCompanies(supabase),
    getFeaturedAssignment(supabase),
    listSavedSearches(supabase, "work"),
  ]);

  const latestStage =
    featured?.id && featured.status === "in_progress"
      ? ((await listProgressUpdates(supabase, featured.id))[0]?.stage ?? null)
      : null;

  return (
    <div className="flex flex-1 flex-col" data-testid="my-work">
      <InstallerWorkBoard
        activeWork={featured ? toActiveWorkVM(featured, latestStage, t, locale, now) : null}
        rows={page.rows}
        tabs={toWorkTabs(counts, t)}
        state={state}
        search={toWorkBoardSearch(state)}
        total={page.total ?? 0}
        nextCursor={page.nextCursor}
        companies={companies}
        rail={<InstallerWorkRail counts={counts} locale={locale} t={t} />}
        savedSearches={saved.map((row) => ({ id: row.id, name: row.name, state: filtersToState(row.filters) }))}
        subtitle={m.work.subtitle}
        headerAction={
          <ButtonLink href="/home/jobs" variant="outline" size="sm" className="self-start tablet:self-auto">
            {m.work.browse}
          </ButtonLink>
        }
      />
    </div>
  );
}
