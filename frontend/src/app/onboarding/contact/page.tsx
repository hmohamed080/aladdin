import { redirect } from "next/navigation";
import { getRegistrationState } from "@/server/queries/registration";
import { activeLandingPath } from "@/server/queries/landing";
import { getOnboardingData } from "@/server/queries/onboarding";
import { ContactStep } from "@/features/onboarding/contact-step";

export const dynamic = "force-dynamic";

/** Step 2 route. Sends the user back to the profile step if it isn't done yet. */
export default async function OnboardingContactPage() {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (state === "active_personal") redirect(await activeLandingPath());
  if (state === "consent_pending" || state === "invitation_pending" || state === "manually_blocked") {
    redirect("/onboarding");
  }
  if (state === "profile_pending") redirect("/onboarding/profile");
  const data = await getOnboardingData();
  return <ContactStep email={data?.email ?? ""} phone={data?.phone ?? null} />;
}
