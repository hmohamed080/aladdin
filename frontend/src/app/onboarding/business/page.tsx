import { redirect } from "next/navigation";
import { getRegistrationState } from "@/server/queries/registration";
import { activeLandingPath } from "@/server/queries/landing";
import { getBusinessOnboardingData } from "@/server/queries/onboarding";
import { BusinessFlow } from "@/features/onboarding/business-flow";
import { businessOrgTypeFromAccountType } from "@/lib/onboarding/account-types";

export const dynamic = "force-dynamic";

/**
 * Business / organization onboarding (Sprint 8) — the shared flow for every
 * business persona (owner/manager who creates the organization). Only a
 * business-track caller who has not yet created their org reaches the wizard; once
 * the org + active owner membership exist, `my_registration_state` resolves to
 * active_personal and the caller is forwarded to the workspace. An invited employee
 * never lands here (they join via the invitation link → active membership).
 */
export default async function BusinessOnboardingPage() {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (state === "active_personal") redirect(await activeLandingPath());
  if (state !== "organization_setup_pending") redirect("/onboarding");

  const data = await getBusinessOnboardingData();
  if (!data || data.selectedTrack !== "business") redirect("/onboarding");

  // The org intent chosen at the shared account-type step pre-selects the type
  // (null for the generic "organization owner/manager" choice).
  const presetOrgType = businessOrgTypeFromAccountType(data.selectedAccountType);

  return <BusinessFlow answers={data.business} presetOrgType={presetOrgType} />;
}
