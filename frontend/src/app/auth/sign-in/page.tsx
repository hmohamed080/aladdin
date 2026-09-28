import { SignInForm } from "@/features/auth/sign-in-form";
import { sanitizeNext } from "@/server/auth/next";

export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const safeNext = sanitizeNext(next);
  // The installer phone sign-in link forwards an EXPLICIT, validated `next`
  // only — never a default, never the raw query value.
  const installerSignInHref = next ? `/installer/sign-in?next=${encodeURIComponent(safeNext)}` : "/installer/sign-in";
  return <SignInForm next={safeNext} installerSignInHref={installerSignInHref} />;
}
