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
import { FilterBar } from "@/components/ui/filter-bar";
import { ButtonLink } from "@/components/ui/controls";
import { BackLink } from "@/features/sales/page-parts";
import { NoProfessionalProfile } from "@/features/profile/no-professional-profile";
import { MyApplications } from "@/features/jobs/my-applications";
import {
  listMyApplications,
  discoverableJobIds,
  APPLICATION_STATUSES,
  type JobApplicationStatus,
} from "@/server/queries/job-opportunities";

export const dynamic = "force-dynamic";

/**
 * My Applications — "what have I applied to, and what happened?"
 *
 * Reads `my_job_applications`, which is scoped to `auth.uid()` inside its
 * definer and — unlike discovery — does NOT filter on the job still being open
 * or its poster still being verified. That is the whole reason it exists
 * separately: an application is a record of something this person did, and it
 * has to stay legible after the opening disappears from the board.
 *
 * A second, small read asks discovery which of these jobs are still live, which
 * is what decides whether "Apply again" is offered on a withdrawn candidacy. The
 * application row alone cannot answer it — it can see `job_status = 'open'` but
 * not the poster's current verification, and `job_application_submit` checks
 * both.
 */
export default async function MyApplicationsPage({
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
  const status = (APPLICATION_STATUSES as readonly string[]).includes(sp.state ?? "")
    ? (sp.state as JobApplicationStatus)
    : undefined;

  const applications = await listMyApplications(supabase, status);
  const live = await discoverableJobIds(
    supabase,
    applications.map((a) => a.job_id).filter((id): id is string => Boolean(id)),
  );

  return (
    <div className="flex flex-col gap-xl" data-testid="my-applications">
      <BackLink href="/home/jobs">{m.jobs.opportunities.title}</BackLink>
      <HomeHeader
        eyebrow={m.jobs.opportunities.title}
        title={m.jobs.applications.title}
        lead={m.jobs.applications.subtitle}
        meta={
          <ButtonLink href="/home/jobs" variant="outline" size="sm">
            {m.jobs.applications.browse}
          </ButtonLink>
        }
      />

      <FilterBar
        basePath="/home/jobs/applications"
        selects={[
          {
            name: "state",
            label: m.jobs.applications.title,
            value: status ?? "",
            anyLabel: m.jobs.applications.allStates,
            /* The SAME four labels the badges use. §22 asks for one status layer,
               and a filter that named these states differently from the badge
               beside them would be a second one. */
            options: APPLICATION_STATUSES.map((s) => ({
              value: s,
              label: m.jobs.applicationStatus[s],
            })),
          },
        ]}
        clearLabel={m.jobs.opportunities.clear}
      />

      <MyApplications
        applications={applications}
        discoverableJobIds={live}
        locale={locale}
        filtered={Boolean(status)}
      />
    </div>
  );
}
