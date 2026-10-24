import { PasswordSignUpForm } from "@/features/auth-password-preview/sign-up-form";
import { CHOICES_BY_KEY, REGISTRATION_CHOICE_ORDER } from "@/lib/onboarding/account-types";
import { sanitizeNext } from "@/server/auth/next";

export const dynamic = "force-dynamic";

/**
 * Registration entry point — Architecture B
 * (docs/frontend/auth-password-preview.md §Registration architecture):
 * `signUp()` sets the password atomically, so there is no interrupted
 * "confirmed but no password" state to resume here (unlike revisions 1-3's
 * Architecture A) — this page renders the form directly.
 *
 * `?type=<key>` (from the landing page's account-type menu) only PRE-SELECTS the
 * account type. It must name one of the open registration choices; anything else
 * (unknown key, a Coming Soon type) is ignored and the form behaves as before. The
 * server action still validates the submitted type, so this carries no authority.
 */
export default async function SignUpPage({ searchParams }: { searchParams?: Promise<{ type?: string; next?: string }> }) {
  const { type, next } = (await searchParams) ?? {};
  const initialAccountType =
    typeof type === "string" && REGISTRATION_CHOICE_ORDER.includes(type) && CHOICES_BY_KEY[type]?.comingSoon !== true
      ? type
      : undefined;
  // Only an employee-invitation return path is honored; everything else is dropped.
  const safe = sanitizeNext(next);
  return <PasswordSignUpForm initialAccountType={initialAccountType} next={safe.startsWith("/auth/invite/") ? safe : undefined} />;
}
