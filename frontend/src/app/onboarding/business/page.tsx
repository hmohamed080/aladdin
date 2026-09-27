import { redirect } from "next/navigation";
import { getRegistrationState, hasAppAccess } from "@/server/queries/registration";
import { getBusinessOnboardingData } from "@/server/queries/onboarding";
import { BusinessFlow } from "@/features/onboarding/business-flow";
import { businessOrgTypeFromAccountType } from "@/lib/onboarding/account-types";

export const dynamic = "force-dynamic";

/**
 * Business setup. Someone who chose a concrete business type ("Showroom")
 * arrives here to create it; the type they already picked is carried in, so
 * the wizard never asks a second time. No longer a mandatory registration
 * gate (Increment 7 removed organization_setup_pending as a
 * my_registration_state() return value — a business-track caller reaches
 * access_ready immediately, with zero organizations, exactly like every
 * other audience) — creating the business is now an optional in-app action,
 * identical to /business/new (same flow; only the entry point differs). An
 * invited employee never lands here (they join an existing organization via
 * their invitation link).
 */
export default async function BusinessOnboardingPage() {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (!hasAppAccess(state)) redirect("/onboarding");

  const data = await getBusinessOnboardingData();
  if (!data || data.selectedTrack !== "business") redirect("/onboarding");

  const presetOrgType = businessOrgTypeFromAccountType(data.selectedAccountType);

  return (
    <BusinessFlow answers={data.business} presetOrgType={presetOrgType} draftId={data.draftId} />
  );
}
