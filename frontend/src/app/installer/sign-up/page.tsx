import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { createTranslator } from "@/lib/i18n/translate";
import { CraftsmanAuthShell } from "@/features/installer-phone-auth/auth-shell";
import { CraftsmanSignUpForm } from "@/features/installer-phone-auth/sign-up-form";
import { INSTALLER_SIGN_IN_PATH } from "@/features/installer-phone-auth/routes";

export const dynamic = "force-dynamic";

const t = createTranslator("ar");

export const metadata: Metadata = { title: t("temporaryCraftsman.meta.signUpTitle") };

export default async function InstallerSignUpPage() {
  // A signed-in caller never needs to register — same rule the middleware
  // applies to /auth/sign-up: resume through /onboarding.
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/onboarding");

  return (
    <CraftsmanAuthShell
      variant="signUp"
      t={t}
      title={t("temporaryCraftsman.signUp.title")}
      subtitle={t("temporaryCraftsman.signUp.subtitle")}
      footer={{
        prompt: t("temporaryCraftsman.signUp.haveAccount"),
        linkLabel: t("temporaryCraftsman.signUp.signInLink"),
        href: INSTALLER_SIGN_IN_PATH,
      }}
    >
      <CraftsmanSignUpForm />
    </CraftsmanAuthShell>
  );
}
