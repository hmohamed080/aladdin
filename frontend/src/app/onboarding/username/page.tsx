import { redirect } from "next/navigation";
import { getRegistrationState } from "@/server/queries/registration";
import { activeLandingPath } from "@/server/queries/landing";
import { UsernameStep } from "@/features/onboarding/username-step";

export const dynamic = "force-dynamic";

/**
 * The mandatory username step (Increment 7's `username_pending` state).
 * DELIBERATELY MINIMAL — a single field, not the legacy six-step wizard.
 * Reached whenever consent and an account type are already recorded but no
 * valid username is stored yet, whether because the caller never had one
 * (a direct RPC path) or their pending-registration username claim collided
 * with someone else's during the verification window (see
 * `frontend/src/app/preview/auth-password/finish-registration/page.tsx` for
 * the isolated preview's equivalent recovery screen — same underlying RPCs,
 * same error-code shape). A refresh or direct navigation cannot bypass this:
 * `my_registration_state()` is re-derived from the database on every call,
 * never from client state.
 */
export default async function OnboardingUsernamePage() {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (state === "active_personal" || state === "access_ready") redirect(await activeLandingPath());
  if (state !== "username_pending") redirect("/onboarding");

  return <UsernameStep />;
}
