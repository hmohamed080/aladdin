import { redirect } from "next/navigation";
import { getRegistrationState, hasAppAccess } from "@/server/queries/registration";
import { getIndividualOnboardingData } from "@/server/queries/onboarding";
import { ConsumerFlow, ConsumerComplete } from "@/features/onboarding/consumer-flow";

export const dynamic = "force-dynamic";

/**
 * End Consumer questionnaire (05.1.x). No longer a mandatory registration
 * gate (Increment 7 removed consumer_onboarding_pending/complete as
 * my_registration_state() return values) — this is now an OPTIONAL surface a
 * consumer-track caller with app access may open or re-open at any time to
 * fill in or change their answers. `data.consumer.completedAt` (not
 * registration state) decides whether to show the flow or the completed
 * summary.
 */
export default async function ConsumerOnboardingPage() {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (!hasAppAccess(state)) redirect("/onboarding");

  const data = await getIndividualOnboardingData();
  if (!data || data.selectedTrack !== "consumer") redirect("/onboarding");

  if (data.consumer.completedAt) {
    return <ConsumerComplete answers={data.consumer} />;
  }
  return <ConsumerFlow answers={data.consumer} />;
}
