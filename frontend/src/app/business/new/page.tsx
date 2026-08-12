import { redirect } from "next/navigation";
import { getRegistrationState } from "@/server/queries/registration";
import { getBusinessOnboardingData } from "@/server/queries/onboarding";
import { businessOrgTypeFromAccountType } from "@/lib/onboarding/account-types";
import { BusinessFlow } from "@/features/onboarding/business-flow";

export const dynamic = "force-dynamic";

/**
 * ADD A BUSINESS — the authenticated entry point for someone who already has an
 * account. This is the whole point of "one person = one user id": an Engineer who
 * wants a showroom does not sign up again. There is no Sign Up, no new OTP, no
 * second auth identity, no second personal profile — just a new organization,
 * owned by the SAME user, reached from the workspace menu.
 *
 * A person may do this repeatedly: each visit resumes their open business draft or
 * starts a fresh one, and each completed draft yields its own organization.
 */
export default async function AddBusinessPage() {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  // Someone still mid-registration finishes that first; the shared steps (consent,
  // profile, contact) are prerequisites for creating anything.
  if (state !== "active_personal" && state !== "organization_setup_pending") redirect("/onboarding");

  const data = await getBusinessOnboardingData();
  if (!data) redirect("/auth/sign-in");

  // A type chosen at registration carries through, so it is never asked twice.
  const presetOrgType = businessOrgTypeFromAccountType(data.selectedAccountType);

  return (
    <BusinessFlow answers={data.business} presetOrgType={presetOrgType} draftId={data.draftId} />
  );
}
