import { redirect } from "next/navigation";
import { getRegistrationState, hasAppAccess } from "@/server/queries/registration";
import { activeLandingPath } from "@/server/queries/landing";
import { getOnboardingData } from "@/server/queries/onboarding";
import { ContactStep } from "@/features/onboarding/contact-step";

export const dynamic = "force-dynamic";

/**
 * Legacy wizard step. Phone is no longer collected during registration
 * (Increment 7/8 — it moved to the persistent profile-completion UI's
 * canonical E.164 phone field, `public.profile_set_phone`). Left reachable by
 * direct navigation rather than deleted.
 */
export default async function OnboardingContactPage() {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (hasAppAccess(state)) redirect(await activeLandingPath());
  if (state === "consent_pending" || state === "manually_blocked") {
    redirect("/onboarding");
  }
  const data = await getOnboardingData();
  return <ContactStep email={data?.email ?? ""} phone={data?.phone ?? null} />;
}
