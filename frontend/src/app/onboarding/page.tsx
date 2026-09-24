import { redirect } from "next/navigation";
import { getRegistrationState } from "@/server/queries/registration";
import { activeLandingPath } from "@/server/queries/landing";
import { OnboardingPanel } from "@/features/onboarding/onboarding-panel";

export const dynamic = "force-dynamic";

/**
 * Post-registration handoff / resume entry. Increment 7
 * (20260924090007_registration_state_access_ready.sql) removed the
 * profile/contact/track-substate gates this switch used to route through —
 * my_registration_state() now only ever asks for consent, an account type,
 * and (Increment 7's later correction) a username, in that order, before
 * reaching access_ready/active_personal. There is no longer a mandatory
 * multi-step wizard to resume into; the old profile/contact/consumer/
 * professional/business sub-pages remain reachable by direct navigation
 * (their own guards were updated to use hasAppAccess) but nothing routes a
 * new registrant through them anymore.
 */
export default async function OnboardingPage() {
  const state = await getRegistrationState();

  switch (state) {
    case "unverified":
      redirect("/auth/sign-in");
    case "active_personal":
    case "access_ready":
      redirect(await activeLandingPath());
    case "account_type_pending":
      redirect("/onboarding/account-type");
    case "username_pending":
      // A minimal "choose a username" screen — NEVER the legacy wizard. See
      // that page's own doc comment and correction #2 of the staging-prep
      // plan: a verified user with no username may not bypass this via
      // refresh or direct navigation, since the state is re-derived from the
      // database on every call.
      redirect("/onboarding/username");
    default:
      // consent_pending, manually_blocked
      return <OnboardingPanel state={state} />;
  }
}
