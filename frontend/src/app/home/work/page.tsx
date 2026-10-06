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
import { tabFromState, toActiveWorkVM, toWorkRowVMs, toWorkTabs } from "@/features/home/installer-work-data";
import {
  listMyAssignments,
  listProgressUpdates,
  countAssignmentsByStatus,
  featuredAssignment,
} from "@/server/queries/job-assignments";

export const dynamic = "force-dynamic";

/**
 * MY WORK — "what have I been assigned, and what is its state?", in the approved
 * presentation shared with `/preview/installer-my-work`.
 *
 * ONE READ for the whole page. `my_job_assignments` is scoped to `auth.uid()`
 * inside its definer, and every count on the page — the tabs, the summary rail —
 * is derived from those same rows rather than from a second query per state, so
 * the figures cannot disagree with the list they sit beside, because they are the
 * list. The one extra read is the featured assignment's latest progress update,
 * the only source of a "current stage".
 *
 * The status tab is the URL (`?state=`), unchanged, so links from the dashboard and
 * the summary rail keep working. `state=current` is the composite of `scheduled` +
 * `in_progress`, computed from `status` and stored nowhere.
 *
 * The shell (sidebar, topbar) is the installer layout's; nothing here draws chrome.
 * The real actions — start, report progress, cancel — stay on the assignment's own
 * page, which this page only links to.
 */
export default async function MyWorkPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
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

  const { state } = await searchParams;
  const all = await listMyAssignments(supabase);
  const counts = countAssignmentsByStatus(all);

  const featured = featuredAssignment(all);
  const latestStage =
    featured?.id && featured.status === "in_progress"
      ? ((await listProgressUpdates(supabase, featured.id))[0]?.stage ?? null)
      : null;
  const now = new Date();

  return (
    <div className="flex flex-1 flex-col" data-testid="my-work">
      <InstallerWorkBoard
        activeWork={featured ? toActiveWorkVM(featured, latestStage, t, locale, now) : null}
        rows={toWorkRowVMs(all, t, locale, now)}
        tabs={toWorkTabs(counts, t)}
        activeTab={tabFromState(state)}
        rail={<InstallerWorkRail counts={counts} locale={locale} t={t} />}
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
