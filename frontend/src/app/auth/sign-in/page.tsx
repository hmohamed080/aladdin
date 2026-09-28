import { PasswordSignInForm } from "@/features/auth-password-preview/sign-in-form";
import { sanitizeNext } from "@/server/auth/next";
import { installerSignInHref } from "./installer-sign-in-href";

export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <PasswordSignInForm next={sanitizeNext(next)} installerSignInHref={installerSignInHref(next)} />;
}
