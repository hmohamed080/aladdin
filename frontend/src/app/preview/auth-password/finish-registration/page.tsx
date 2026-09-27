import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getRegistrationState } from "@/server/queries/registration";
import { activeLandingPath } from "@/server/queries/landing";
import { FinishRegistrationScreen } from "@/features/auth-password-preview/finish-registration-screen";

export const dynamic = "force-dynamic";

/**
 * The isolated preview's own minimal recovery screen — correction #2 of the
 * staging-prep plan: "A refresh or direct navigation must NOT allow a
 * verified user with no username to bypass this requirement. Do not send
 * this user into the legacy six-step onboarding wizard." Reached from
 * `verifyPasswordSignUp`'s `postSessionRedirect` whenever the caller is
 * verified + consented but the pending-registration state (Increment 6)
 * either never landed or lost a username-collision race — covers BOTH
 * possible gaps (account_type_pending, username_pending), re-derived fresh
 * from `my_registration_state()` on every load, never from client state.
 */
export default async function FinishRegistrationPage({
  searchParams,
}: {
  searchParams?: Promise<{ reason?: string | string[] }>;
}) {
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/preview/auth-password/sign-in");

  const state = await getRegistrationState();
  if (state === "active_personal" || state === "access_ready") redirect(await activeLandingPath());
  if (state !== "account_type_pending" && state !== "username_pending") redirect("/onboarding");

  // `reason` only chooses explanatory copy (allow-listed literal); it never
  // grants or skips anything — the state above is re-derived from the DB.
  const reason = (await searchParams)?.reason;
  const usernameUnavailable = state === "username_pending" && reason === "username_unavailable";

  return (
    <FinishRegistrationScreen
      needsAccountType={state === "account_type_pending"}
      usernameUnavailable={usernameUnavailable}
    />
  );
}
