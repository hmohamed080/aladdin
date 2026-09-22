import { PasswordSignInForm } from "@/features/auth-password-preview/sign-in-form";
import { sanitizeNext } from "@/server/auth/next";

export const dynamic = "force-dynamic";

export default async function AuthPasswordPreviewSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <PasswordSignInForm next={sanitizeNext(next)} />;
}
