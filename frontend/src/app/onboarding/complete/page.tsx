import { redirect } from "next/navigation";
import { getRegistrationState } from "@/server/queries/registration";
import { activeLandingPath } from "@/server/queries/landing";
import { getOnboardingData } from "@/server/queries/onboarding";
import { ACCOUNT_TYPE_CHOICES } from "@/lib/onboarding/account-types";
import { HandoffPanel, type Track } from "@/features/onboarding/handoff-panel";

export const dynamic = "force-dynamic";

/** The three registration states that genuinely sit at the handoff moment. */
const TRACK_BY_STATE: Record<string, Track> = {
  consumer_onboarding_pending: "consumer",
  persona_onboarding_pending: "professional",
  organization_setup_pending: "business",
};

/**
 * Step 4 — Handoff / transition. A deliberate stop between "account type chosen"
 * and "now filling in the persona wizard" — not an instant jump. Only a user
 * whose state is one of the three TRACK_BY_STATE entries lands here; anyone
 * still mid-flow (or already past this point) is sent to their real next step.
 * This is a handoff state (not activation): business personas still require
 * review later.
 */
export default async function OnboardingCompletePage() {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (state === "active_personal") redirect(await activeLandingPath());
  if (state === "profile_pending") redirect("/onboarding/profile");
  if (state === "contact_pending") redirect("/onboarding/contact");
  if (state === "account_type_pending") redirect("/onboarding/account-type");
  // Past the handoff already — resume the persona flow directly, not the handoff.
  if (state === "consumer_onboarding_complete") redirect("/onboarding/consumer");
  if (state === "persona_review_pending") redirect("/onboarding/professional/review");
  if (state === "consent_pending" || state === "invitation_pending" || state === "manually_blocked") {
    redirect("/onboarding");
  }

  const track = TRACK_BY_STATE[state];
  if (!track) redirect("/onboarding");

  const data = await getOnboardingData();
  const accountTypeKey =
    ACCOUNT_TYPE_CHOICES.find(
      (c) => c.track === data?.selectedTrack && c.accountType === (data?.selectedAccountType ?? null),
    )?.key ?? null;

  return <HandoffPanel track={track} accountTypeKey={accountTypeKey} />;
}
