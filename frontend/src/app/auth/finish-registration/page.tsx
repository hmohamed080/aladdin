import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getRegistrationState } from "@/server/queries/registration";
import { activeLandingPath } from "@/server/queries/landing";
import { FinishRegistrationScreen } from "@/features/auth-password-preview/finish-registration-screen";

export const dynamic = "force-dynamic";

/**
 * Canonical password auth's own minimal finish-registration screen. Reached from
 * `verifyPasswordSignUp`'s `postSessionRedirect` whenever the caller is verified
 * + consented but the pending-registration state either never landed or the
 * account type is still missing. The state is re-derived fresh from
 * `my_registration_state()` on every load, never from client state. (The username
 * gap no longer exists: Phase 1 of the account-identity plan removed the username.)
 */
export default async function FinishRegistrationPage() {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/sign-in");

  const state = await getRegistrationState();
  if (state === "active_personal" || state === "access_ready") redirect(await activeLandingPath());
  // Anything but the missing account type (including a legacy "username_pending" from a pre-M1 database) goes to /onboarding.
  if (state !== "account_type_pending") redirect("/onboarding");

  return <FinishRegistrationScreen />;
}
