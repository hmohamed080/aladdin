import { PasswordSignUpForm } from "@/features/auth-password-preview/sign-up-form";
import { resumePasswordSignUpEmail } from "@/server/actions/auth-password-preview";

export const dynamic = "force-dynamic";

/**
 * Interrupted-state resume (docs/frontend/auth-password-preview.md
 * §Registration architecture): a signed-in, email-confirmed session with no
 * password yet means a prior visit's `updateUser` never completed. Skip
 * straight to the password-only completion step instead of restarting.
 */
export default async function AuthPasswordPreviewSignUpPage() {
  const resumeEmail = await resumePasswordSignUpEmail();
  return <PasswordSignUpForm resumeEmail={resumeEmail ?? undefined} />;
}
