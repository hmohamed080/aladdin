import { redirect } from "next/navigation";
import { getRegistrationState, hasAppAccess } from "@/server/queries/registration";
import { activeLandingPath } from "@/server/queries/landing";
import { getOnboardingData } from "@/server/queries/onboarding";
import { currentOnboardingLocale } from "@/server/actions/onboarding";
import { ProfileStep } from "@/features/onboarding/profile-step";

export const dynamic = "force-dynamic";

/**
 * Legacy wizard step. No longer part of the mandatory registration path
 * (Increment 7 dropped profile_pending as a gating state — display name now
 * lives in the persistent profile-completion UI) but left reachable by
 * direct navigation rather than deleted, since nothing currently forces a
 * user here.
 */
export default async function OnboardingProfilePage() {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (hasAppAccess(state)) redirect(await activeLandingPath());
  if (state === "consent_pending" || state === "manually_blocked") {
    redirect("/onboarding");
  }
  const data = await getOnboardingData();
  // Default the language choice to the locale the visitor is actually browsing in
  // (cookie), not just the bootstrapped identity locale — a fresh account starts at
  // 'en' but a visitor browsing Arabic should see Arabic pre-selected.
  const locale = await currentOnboardingLocale();
  return <ProfileStep displayName={data?.displayName ?? ""} locale={locale} />;
}
