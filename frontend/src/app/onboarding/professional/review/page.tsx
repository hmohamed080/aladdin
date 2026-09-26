import { redirect } from "next/navigation";
import { getRegistrationState, hasAppAccess } from "@/server/queries/registration";
import { getIndividualOnboardingData } from "@/server/queries/onboarding";
import { ProfessionalReview } from "@/features/onboarding/professional-review";

export const dynamic = "force-dynamic";

/**
 * Professional Review (05.2.6). Renders the submission summary with Edit links
 * back into the wizard and a Submit that files the verification request and
 * activates the account. No longer a mandatory registration gate (Increment 7
 * removed persona_review_pending as a my_registration_state() return value,
 * and app access no longer depends on this flow at all) — every caller who
 * reaches this page already has app access by definition, so it always
 * renders the same summary now; `ProfessionalReviewPending`'s distinct
 * "submitted but not yet active" case can no longer occur.
 */
export default async function ProfessionalReviewPage() {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (!hasAppAccess(state)) redirect("/onboarding");

  const data = await getIndividualOnboardingData();
  if (!data || data.selectedTrack !== "professional") redirect("/onboarding");

  return <ProfessionalReview answers={data.professional} />;
}
