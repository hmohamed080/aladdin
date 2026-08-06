import { redirect } from "next/navigation";
import { getRegistrationState } from "@/server/queries/registration";
import { OnboardingPanel } from "@/features/onboarding/onboarding-panel";

export const dynamic = "force-dynamic";

/**
 * Post-registration handoff / resume entry. Resolves the derived registration
 * state and routes accordingly: no session -> sign in; an active user -> the
 * workspace; otherwise show the current setup state and the next required step.
 */
export default async function OnboardingPage() {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (state === "active_personal") redirect("/b2b");
  return <OnboardingPanel state={state} />;
}
