import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getRegistrationState } from "@/server/queries/registration";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadWorkspaces } from "@/server/queries/workspace";
import { personalEntry } from "@/lib/workspace/model";
import { loadPersonalHome } from "@/server/queries/personal-home";
import { getMessages } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { HomeHeader } from "@/features/home/parts";
import { TabLinks } from "@/components/ui/stat-tiles";
import { ButtonLink } from "@/components/ui/controls";
import { NoProfessionalProfile } from "@/features/profile/no-professional-profile";
import { MyWork } from "@/features/work/my-work";
import {
  listMyAssignments,
  countAssignmentsByStatus,
  currentAssignments,
  ASSIGNMENT_STATUSES,
  type JobAssignmentStatus,
} from "@/server/queries/job-assignments";

export const dynamic = "force-dynamic";

/**
 * MY WORK — "what have I been assigned, and what is its state?"
 *
 * ONE READ for the whole page. `my_job_assignments` is scoped to `auth.uid()`
 * inside its definer, and every count on the page — the tabs, the summary
 * breakdown — is derived from those same rows rather than from a second query
 * per state. That is what makes the figures honest by construction: they cannot
 * disagree with the list they sit beside, because they are the list.
 *
 * IT IS DELIBERATELY NOT FILTERED SERVER-SIDE. A `.eq("status", …)` would give
 * the selected tab the right rows and the other five tabs the wrong counts, and
 * fixing that would take a second round trip. At a professional's realistic
 * assignment volume the filter belongs here.
 *
 * `state=current` is the one tab value that is not a database status — it is the
 * composite the reference leads with (`scheduled` + `in_progress`), computed
 * from `status` and stored nowhere.
 */
export default async function MyWorkPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const registration = await getRegistrationState();
  if (registration === "unverified") redirect("/auth/sign-in");
  if (registration !== "active_personal") redirect("/onboarding");

  const supabase = await getServerSupabase();
  const { entries } = await loadWorkspaces(supabase);
  if (!personalEntry(entries)) redirect("/");

  const home = await loadPersonalHome();
  if (!home) redirect("/auth/sign-in");

  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  const m = getMessages(locale);

  if (home.variant !== "professional") return <NoProfessionalProfile />;

  const sp = await searchParams;
  const raw = sp.state ?? "";
  const isStatus = (ASSIGNMENT_STATUSES as readonly string[]).includes(raw);
  const state = raw === "current" || isStatus ? raw : "";

  const all = await listMyAssignments(supabase);
  const counts = countAssignmentsByStatus(all);

  const rows =
    state === "current"
      ? currentAssignments(all)
      : state
        ? all.filter((a) => a.status === (state as JobAssignmentStatus))
        : all;

  return (
    <div className="flex flex-col gap-xl" data-testid="my-work">
      <HomeHeader
        eyebrow={m.personalNav.myWork}
        title={m.work.title}
        lead={m.work.subtitle}
        meta={
          <ButtonLink href="/home/jobs" variant="outline" size="sm">
            {m.work.browse}
          </ButtonLink>
        }
      />

      {/*
        STATUS NAVIGATION, from the real lifecycle and nothing else. The
        reference's "on hold", "in review", "rejected" and "archive" tabs have no
        `job_assignment_status` behind them and are absent rather than faked.
        Every count is the caller's own.

        Application state does NOT appear here (§5): that belongs to My
        Applications, and a "submitted" tab on this page would mean an assignment
        that does not exist.
      */}
      <TabLinks
        basePath="/home/work"
        param="state"
        current={state}
        label={m.work.title}
        locale={locale}
        tabs={[
          { value: "", label: m.work.tab.all, count: all.length },
          {
            value: "current",
            label: m.work.tab.current,
            count: counts.scheduled + counts.in_progress,
          },
          ...ASSIGNMENT_STATUSES.map((s) => ({
            value: s,
            /* The SAME four labels every badge on the page uses (§22). A tab
               that named these states differently would be a second status
               vocabulary. */
            label: m.jobs.assignmentStatus[s],
            count: counts[s],
          })),
        ]}
      />

      <MyWork
        assignments={rows}
        counts={counts}
        locale={locale}
        filtered={Boolean(state)}
      />
    </div>
  );
}
