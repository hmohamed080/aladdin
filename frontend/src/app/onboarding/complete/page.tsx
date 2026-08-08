import { redirect } from "next/navigation";
import { getRegistrationState } from "@/server/queries/registration";
import { getOnboardingData } from "@/server/queries/onboarding";
import { ACCOUNT_TYPE_CHOICES } from "@/lib/onboarding/account-types";
import { HandoffPanel } from "@/features/onboarding/handoff-panel";

export const dynamic = "force-dynamic";

/**
 * Step 4 — Handoff / summary. Only a user who reached a terminal onboarding state
 * lands here; anyone still mid-flow is sent back to their next step. This is a
 * handoff state (not activation): business personas still require review later.
 */
export default async function OnboardingCompletePage() {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (state === "active_personal") redirect("/b2b");
  if (state === "profile_pending") redirect("/onboarding/profile");
  if (state === "contact_pending") redirect("/onboarding/contact");
  if (state === "account_type_pending") redirect("/onboarding/account-type");
  if (state === "consent_pending" || state === "invitation_pending" || state === "manually_blocked") {
    redirect("/onboarding");
  }

  const track =
    state === "consumer_onboarding_pending"
      ? "consumer"
      : state === "persona_onboarding_pending"
        ? "professional"
        : "business";

  const data = await getOnboardingData();
  const accountTypeKey =
    ACCOUNT_TYPE_CHOICES.find(
      (c) => c.track === data?.selectedTrack && c.accountType === (data?.selectedAccountType ?? null),
    )?.key ?? null;

  return <HandoffPanel track={track} accountTypeKey={accountTypeKey} />;
}
