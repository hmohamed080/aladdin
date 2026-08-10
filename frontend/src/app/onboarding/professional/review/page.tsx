import { redirect } from "next/navigation";
import { getRegistrationState } from "@/server/queries/registration";
import { activeLandingPath } from "@/server/queries/landing";
import { getIndividualOnboardingData } from "@/server/queries/onboarding";
import { ProfessionalReview, ProfessionalReviewPending } from "@/features/onboarding/professional-review";

export const dynamic = "force-dynamic";

/**
 * Professional Review (05.2.6) + submitted terminal. Before submission it renders
 * the review with Edit links back into the wizard and a Submit that hands off to the
 * trusted upgrade/review workflow. After submission it renders the "with review"
 * state — the account is NOT activated (a platform review is still required).
 */
export default async function ProfessionalReviewPage() {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (state === "active_personal") redirect(await activeLandingPath());
  if (state === "persona_review_pending") return <ProfessionalReviewPending />;
  if (state !== "persona_onboarding_pending") redirect("/onboarding");

  const data = await getIndividualOnboardingData();
  if (!data || data.selectedTrack !== "professional") redirect("/onboarding");

  return <ProfessionalReview answers={data.professional} />;
}
