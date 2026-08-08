import { redirect } from "next/navigation";
import { getRegistrationState } from "@/server/queries/registration";
import { getIndividualOnboardingData } from "@/server/queries/onboarding";
import { ConsumerFlow, ConsumerComplete } from "@/features/onboarding/consumer-flow";

export const dynamic = "force-dynamic";

/**
 * End Consumer onboarding (05.1.x). Only a consumer-track caller reaches this route;
 * everyone else is bounced to the resolver, which forwards them to their own flow.
 * The completed state renders a read-only recap terminal (no activation).
 */
export default async function ConsumerOnboardingPage() {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (state === "active_personal") redirect("/b2b");
  // Anyone not on the consumer branch resolves elsewhere.
  if (state !== "consumer_onboarding_pending" && state !== "consumer_onboarding_complete") {
    redirect("/onboarding");
  }

  const data = await getIndividualOnboardingData();
  if (!data || data.selectedTrack !== "consumer") redirect("/onboarding");

  if (state === "consumer_onboarding_complete") {
    return <ConsumerComplete answers={data.consumer} />;
  }
  return <ConsumerFlow answers={data.consumer} />;
}
