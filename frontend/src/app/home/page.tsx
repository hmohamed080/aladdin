import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getRegistrationState } from "@/server/queries/registration";
import { loadPlatformRole } from "@/server/queries/platform";
import { loadWorkspaces } from "@/server/queries/workspace";
import { personalEntry, businessEntries } from "@/lib/workspace/model";
import { loadPersonalHome } from "@/server/queries/personal-home";
import { getServerSupabase } from "@/lib/supabase/server";
import { NoPersonalWorkspace } from "@/features/home/no-personal-workspace";
import { createTranslator } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { ConsumerHome } from "@/features/home/consumer-home";
import { ProfessionalHome } from "@/features/home/professional-home";

export const dynamic = "force-dynamic";

/**
 * The ONE personal-account surface. A signed-in caller with no organization —
 * an End Consumer, or an individual professional (Engineer, Interior Designer,
 * Installer/Technician, Contractor, org-less Salesperson) — lands here, and the
 * page is persona-aware rather than consumer-specific.
 *
 * Three guards, all derived, never assumed:
 *   * an account that has not finished onboarding resumes at /onboarding;
 *   * platform staff belong in /admin;
 *   * a caller with NO personal persona has no personal home to show. A
 *     business-only identity is sent to its business workspace rather than a
 *     fabricated, empty Personal one; a caller with neither gets an account-safe
 *     terminal here (never a redirect, which would loop).
 *
 * Crucially, merely BELONGING to an organization no longer evicts the caller: an
 * Engineer who also owns a business keeps a real personal home, and the workspace
 * switcher — not a forced redirect — decides where they work.
 *
 * Reaching this page never depends on a verification decision — completing
 * onboarding activates the account, and trust state is shown, not enforced.
 */
export default async function PersonalHomePage() {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (state !== "active_personal") redirect("/onboarding");

  const supabase = await getServerSupabase();
  if (await loadPlatformRole(supabase)) redirect("/admin");

  const { entries } = await loadWorkspaces(supabase);
  if (!personalEntry(entries)) {
    if (businessEntries(entries).length > 0) redirect("/b2b");
    return <NoPersonalWorkspace />;
  }

  const data = await loadPersonalHome();
  if (!data) redirect("/auth/sign-in");

  const store = await cookies();
  const t = createTranslator(resolveLocale(store.get(LOCALE_COOKIE)?.value));

  return data.variant === "professional" ? (
    <ProfessionalHome data={data} t={t} />
  ) : (
    <ConsumerHome data={data} t={t} />
  );
}
