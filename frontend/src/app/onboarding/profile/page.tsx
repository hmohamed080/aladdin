import { redirect } from "next/navigation";
import { getRegistrationState } from "@/server/queries/registration";
import { activeLandingPath } from "@/server/queries/landing";
import { getOnboardingData } from "@/server/queries/onboarding";
import { currentOnboardingLocale } from "@/server/actions/onboarding";
import { ProfileStep } from "@/features/onboarding/profile-step";

export const dynamic = "force-dynamic";

/** Step 1 route. Guarded so only an onboarding user in/at-or-before this step lands here. */
export default async function OnboardingProfilePage() {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (state === "active_personal") redirect(await activeLandingPath());
  if (state === "consent_pending" || state === "invitation_pending" || state === "manually_blocked") {
    redirect("/onboarding");
  }
  const data = await getOnboardingData();
  // Default the language choice to the locale the visitor is actually browsing in
  // (cookie), not just the bootstrapped identity locale — a fresh account starts at
  // 'en' but a visitor browsing Arabic should see Arabic pre-selected.
  const locale = await currentOnboardingLocale();
  return <ProfileStep displayName={data?.displayName ?? ""} locale={locale} />;
}
