import { redirect } from "next/navigation";
import { getRegistrationState } from "@/server/queries/registration";
import { OnboardingPanel } from "@/features/onboarding/onboarding-panel";

export const dynamic = "force-dynamic";

/**
 * Post-registration handoff / resume entry. Resolves the derived registration
 * state and forwards to the next incomplete step (profile → contact →
 * account-type), the handoff summary, or the workspace. Consent / invitation /
 * blocked states render their notice here.
 */
export default async function OnboardingPage() {
  const state = await getRegistrationState();

  switch (state) {
    case "unverified":
      redirect("/auth/sign-in");
    case "active_personal":
      redirect("/b2b");
    case "profile_pending":
      redirect("/onboarding/profile");
    case "contact_pending":
      redirect("/onboarding/contact");
    case "account_type_pending":
      redirect("/onboarding/account-type");
    case "consumer_onboarding_pending":
    case "persona_onboarding_pending":
    case "organization_setup_pending":
      redirect("/onboarding/complete");
    default:
      // consent_pending, invitation_pending, manually_blocked
      return <OnboardingPanel state={state} />;
  }
}
