import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { sanitizeNext } from "@/server/auth/next";
import { createTranslator } from "@/lib/i18n/translate";
import { CraftsmanAuthShell } from "@/features/installer-phone-auth/auth-shell";
import { CraftsmanSignInForm } from "@/features/installer-phone-auth/sign-in-form";
import { INSTALLER_SIGN_UP_PATH } from "@/features/installer-phone-auth/routes";

export const dynamic = "force-dynamic";

const t = createTranslator("ar");

export const metadata: Metadata = { title: t("temporaryCraftsman.meta.signInTitle") };

export default async function InstallerSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  // Same rule the middleware applies to /auth/sign-in.
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/onboarding");

  return (
    <CraftsmanAuthShell
      variant="signIn"
      t={t}
      title={t("temporaryCraftsman.signIn.title")}
      mobileTitle={t("temporaryCraftsman.signIn.mobileTitle")}
      subtitle={t("temporaryCraftsman.signIn.subtitle")}
      footer={{
        prompt: t("temporaryCraftsman.signIn.noAccount"),
        linkLabel: t("temporaryCraftsman.signIn.signUpLink"),
        href: INSTALLER_SIGN_UP_PATH,
      }}
    >
      <CraftsmanSignInForm next={sanitizeNext(next)} />
    </CraftsmanAuthShell>
  );
}
