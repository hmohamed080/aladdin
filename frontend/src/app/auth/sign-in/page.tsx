import { SignInForm } from "@/features/auth/sign-in-form";
import { LanguageSwitch } from "@/components/layout/switchers";

export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const safeNext = typeof next === "string" && next.startsWith("/b2b") ? next : "/b2b";
  return (
    <div className="w-full max-w-md">
      <div className="mb-md flex justify-end">
        <LanguageSwitch />
      </div>
      <SignInForm next={safeNext} />
    </div>
  );
}
