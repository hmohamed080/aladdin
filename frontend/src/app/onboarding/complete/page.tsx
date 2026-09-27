import { redirect } from "next/navigation";
import { getRegistrationState, hasAppAccess } from "@/server/queries/registration";
import { activeLandingPath } from "@/server/queries/landing";

export const dynamic = "force-dynamic";

/**
 * Step 4 — Handoff / transition. UNREACHABLE via the normal flow as of
 * Increment 7 (20260924090007_registration_state_access_ready.sql): the
 * three states this page used to stop at (consumer_onboarding_pending /
 * persona_onboarding_pending / organization_setup_pending) are no longer
 * returned by my_registration_state() at all — account_type_completed_at now
 * goes straight to username_pending/access_ready, and the persona/business
 * wizards are optional post-access surfaces (see /onboarding/consumer,
 * /onboarding/professional, /onboarding/business), not a gated handoff. Kept
 * as a route (not deleted) purely to route anyone who still has this URL
 * bookmarked back to the right place; `HandoffPanel`
 * (features/onboarding/handoff-panel.tsx) is no longer rendered from here.
 */
export default async function OnboardingCompletePage() {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (hasAppAccess(state)) redirect(await activeLandingPath());
  redirect("/onboarding");
}
