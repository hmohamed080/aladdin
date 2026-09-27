import { redirect } from "next/navigation";
import { getRegistrationState, hasAppAccess } from "@/server/queries/registration";
import { getIndividualOnboardingData } from "@/server/queries/onboarding";
import { ProfessionalFlow } from "@/features/onboarding/professional-flow";
import { PERSONA_BY_ACCOUNT_TYPE } from "@/lib/onboarding/persona-fields";

export const dynamic = "force-dynamic";

/**
 * Professional onboarding (05.2.x) — the common flow for the four individual
 * professionals. No longer a mandatory registration gate (Increment 7
 * removed persona_onboarding_pending/persona_review_pending as
 * my_registration_state() return values, and access to the app no longer
 * depends on this flow's completion at all) — this is now purely an EDIT
 * surface a professional-track caller with app access may open at any time,
 * whether or not they have already submitted it. `/onboarding/professional/
 * review` remains a separate page for explicitly viewing review status.
 */
export default async function ProfessionalOnboardingPage() {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (!hasAppAccess(state)) redirect("/onboarding");

  const data = await getIndividualOnboardingData();
  if (!data || data.selectedTrack !== "professional") redirect("/onboarding");

  const persona = data.selectedPersona ? PERSONA_BY_ACCOUNT_TYPE[data.selectedPersona] : undefined;
  if (!persona) redirect("/onboarding");

  return <ProfessionalFlow persona={persona} answers={data.professional} />;
}
