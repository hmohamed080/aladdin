import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getRegistrationState } from "@/server/queries/registration";
import { resolveActiveLanding } from "@/server/queries/landing";
import { loadPersonalHome } from "@/server/queries/personal-home";
import { getServerSupabase } from "@/lib/supabase/server";
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
 * Two guards, both derived, never assumed:
 *   * an account that has not finished onboarding resumes at /onboarding;
 *   * a caller who in fact belongs to a workspace, or is platform staff, is
 *     corrected to their real destination (a consumer is never sent to /b2b).
 *
 * Reaching this page never depends on a verification decision — completing
 * onboarding activates the account, and trust state is shown, not enforced.
 */
export default async function PersonalHomePage() {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (state !== "active_personal") redirect("/onboarding");

  const supabase = await getServerSupabase();
  const landing = await resolveActiveLanding(supabase);
  if (landing !== "/home") redirect(landing);

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
