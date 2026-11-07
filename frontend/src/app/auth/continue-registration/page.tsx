import { pendingRegistrationEmail } from "@/server/actions/auth-password-preview";
import { ContinueRegistrationForm } from "@/features/auth-password-preview/continue-registration-form";

export const dynamic = "force-dynamic";

/**
 * Continue an interrupted email registration. Reachable by anyone (the entry
 * links on sign-in and sign-up); the httpOnly routing cookie, when this
 * browser has one, only skips straight to the code step. Keyed by that email so
 * "Use a different email" (which clears the cookie) remounts a clean form.
 */
export default async function ContinueRegistrationPage() {
  const email = await pendingRegistrationEmail();
  return <ContinueRegistrationForm key={email ?? "none"} pendingEmail={email} />;
}
