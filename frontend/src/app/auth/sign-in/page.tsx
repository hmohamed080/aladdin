import { PasswordSignInForm } from "@/features/auth-password-preview/sign-in-form";
import { ForgetAccountCart } from "@/features/marketplace/live/cart-viewer";
import { oauthAvailability } from "@/server/auth/entry-oauth";
import { sanitizeNext } from "@/server/auth/next";
import { signInPrefillIdentifier } from "@/server/actions/auth-password-preview";

export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const providers = await oauthAvailability();
  // Carried from the sign-up "account already exists" warning (httpOnly cookie, never the URL).
  const prefill = await signInPrefillIdentifier();
  return (
    <>
      <ForgetAccountCart />
      <PasswordSignInForm
        next={sanitizeNext(next)}
        providers={providers}
        oauthError={typeof error === "string" ? error : undefined}
        defaultIdentifier={prefill ?? undefined}
      />
    </>
  );
}
