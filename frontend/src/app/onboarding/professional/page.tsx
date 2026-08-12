import { redirect } from "next/navigation";
import { getRegistrationState } from "@/server/queries/registration";
import { activeLandingPath } from "@/server/queries/landing";
import { getIndividualOnboardingData } from "@/server/queries/onboarding";
import { ProfessionalFlow } from "@/features/onboarding/professional-flow";
import { PERSONA_BY_ACCOUNT_TYPE } from "@/lib/onboarding/persona-fields";

export const dynamic = "force-dynamic";

/**
 * Professional onboarding (05.2.x) — the common flow for the four individual
 * professionals. It is also the EDIT surface: submitting activates the account, so
 * an active personal caller may re-open their own wizard to keep the profile
 * current. Anyone who belongs to a workspace, or is platform staff, is corrected
 * to their real surface instead.
 */
export default async function ProfessionalOnboardingPage() {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (state === "active_personal") {
    const landing = await activeLandingPath();
    if (landing !== "/home") redirect(landing);
  } else if (state === "persona_review_pending") {
    redirect("/onboarding/professional/review");
  } else if (state !== "persona_onboarding_pending") {
    redirect("/onboarding");
  }

  const data = await getIndividualOnboardingData();
  if (!data || data.selectedTrack !== "professional") redirect("/onboarding");

  const persona = data.selectedAccountType ? PERSONA_BY_ACCOUNT_TYPE[data.selectedAccountType] : undefined;
  if (!persona) redirect("/onboarding");

  return <ProfessionalFlow persona={persona} answers={data.professional} />;
}
