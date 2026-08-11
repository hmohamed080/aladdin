import { redirect } from "next/navigation";
import { getRegistrationState } from "@/server/queries/registration";
import { activeLandingPath } from "@/server/queries/landing";
import { getIndividualOnboardingData } from "@/server/queries/onboarding";
import { ProfessionalReview, ProfessionalReviewPending } from "@/features/onboarding/professional-review";

export const dynamic = "force-dynamic";

/**
 * Professional Review (05.2.6). Renders the submission summary with Edit links
 * back into the wizard and a Submit that files the verification request and
 * activates the account. An already-active professional sees the same summary —
 * re-submitting is idempotent, so this doubles as "see what you sent".
 * `ProfessionalReviewPending` remains for a legacy row that was submitted before
 * activation existed.
 */
export default async function ProfessionalReviewPage() {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (state === "active_personal") {
    const landing = await activeLandingPath();
    if (landing !== "/home") redirect(landing);
  } else if (state === "persona_review_pending") {
    return <ProfessionalReviewPending />;
  } else if (state !== "persona_onboarding_pending") {
    redirect("/onboarding");
  }

  const data = await getIndividualOnboardingData();
  if (!data || data.selectedTrack !== "professional") redirect("/onboarding");

  return <ProfessionalReview answers={data.professional} />;
}
