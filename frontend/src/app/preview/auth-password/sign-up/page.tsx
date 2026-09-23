import { PasswordSignUpForm } from "@/features/auth-password-preview/sign-up-form";

export const dynamic = "force-dynamic";

/**
 * Registration entry point — Architecture B
 * (docs/frontend/auth-password-preview.md §Registration architecture):
 * `signUp()` sets the password atomically, so there is no interrupted
 * "confirmed but no password" state to resume here (unlike revisions 1-3's
 * Architecture A) — this page renders the form directly.
 */
export default function AuthPasswordPreviewSignUpPage() {
  return <PasswordSignUpForm />;
}
