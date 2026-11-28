import { PasswordSignInForm } from "@/features/auth-password-preview/sign-in-form";
import { sanitizeNext } from "@/server/auth/next";
import { oauthAvailability } from "@/server/auth/entry-oauth";
import { installerSignInHref } from "./installer-sign-in-href";

export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  return (
    <PasswordSignInForm
      next={sanitizeNext(next)}
      installerSignInHref={installerSignInHref(next)}
      providers={await oauthAvailability()}
      oauthError={error}
    />
  );
}
