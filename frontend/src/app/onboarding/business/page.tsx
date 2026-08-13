import { redirect } from "next/navigation";
import { getRegistrationState } from "@/server/queries/registration";
import { activeLandingPath } from "@/server/queries/landing";
import { getBusinessOnboardingData } from "@/server/queries/onboarding";
import { BusinessFlow } from "@/features/onboarding/business-flow";
import { businessOrgTypeFromAccountType } from "@/lib/onboarding/account-types";

export const dynamic = "force-dynamic";

/**
 * Business setup during REGISTRATION. Someone who chose a concrete business type
 * ("Showroom") arrives here to create it; the type they already picked is carried
 * in, so the wizard never asks a second time. Once the organization and the
 * creator's owner membership exist, `my_registration_state` resolves to
 * active_personal and they are forwarded to their new workspace.
 *
 * The same flow is reachable later at /business/new — the only difference is where
 * the person came from, never what gets created. An invited employee never lands
 * here (they join an existing organization via their invitation link).
 */
export default async function BusinessOnboardingPage() {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (state === "active_personal") redirect(await activeLandingPath());
  if (state !== "organization_setup_pending") redirect("/onboarding");

  const data = await getBusinessOnboardingData();
  if (!data || data.selectedTrack !== "business") redirect("/onboarding");

  const presetOrgType = businessOrgTypeFromAccountType(data.selectedAccountType);

  return (
    <BusinessFlow answers={data.business} presetOrgType={presetOrgType} draftId={data.draftId} />
  );
}
