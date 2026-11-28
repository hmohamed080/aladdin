import { PasswordSignUpForm } from "@/features/auth-password-preview/sign-up-form";
import { sanitizeNext } from "@/server/auth/next";
import { oauthAvailability } from "@/server/auth/entry-oauth";

export const dynamic = "force-dynamic";

/**
 * Registration entry point — Architecture B
 * (docs/frontend/auth-password-preview.md §Registration architecture):
 * `signUp()` sets the password atomically, so there is no interrupted
 * "confirmed but no password" state to resume here (unlike revisions 1-3's
 * Architecture A) — this page renders the form directly.
 */
export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  // Only an employee-invitation return path is honored; everything else is dropped.
  const safe = sanitizeNext(next);
  return <PasswordSignUpForm next={safe.startsWith("/auth/invite/") ? safe : undefined} providers={await oauthAvailability()} />;
}
