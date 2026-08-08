import { redirect } from "next/navigation";
import { getRegistrationState } from "@/server/queries/registration";
import { getIndividualOnboardingData } from "@/server/queries/onboarding";
import { ProfessionalFlow } from "@/features/onboarding/professional-flow";
import { PERSONA_BY_ACCOUNT_TYPE } from "@/lib/onboarding/persona-fields";

export const dynamic = "force-dynamic";

/**
 * Professional onboarding (05.2.x) — the common flow for the four individual
 * professionals. Only a professional-track caller who has not yet submitted reaches
 * the wizard; a submitted caller is forwarded to the review/pending terminal.
 */
export default async function ProfessionalOnboardingPage() {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (state === "active_personal") redirect("/b2b");
  if (state === "persona_review_pending") redirect("/onboarding/professional/review");
  if (state !== "persona_onboarding_pending") redirect("/onboarding");

  const data = await getIndividualOnboardingData();
  if (!data || data.selectedTrack !== "professional") redirect("/onboarding");

  const persona = data.selectedAccountType ? PERSONA_BY_ACCOUNT_TYPE[data.selectedAccountType] : undefined;
  if (!persona) redirect("/onboarding");

  return <ProfessionalFlow persona={persona} answers={data.professional} />;
}
