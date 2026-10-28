import { PasswordSignInForm } from "@/features/auth-password-preview/sign-in-form";
import { oauthAvailability } from "@/server/auth/entry-oauth";
import { sanitizeNext } from "@/server/auth/next";

export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  const providers = await oauthAvailability();
  return <PasswordSignInForm next={sanitizeNext(next)} providers={providers} oauthError={typeof error === "string" ? error : undefined} />;
}
