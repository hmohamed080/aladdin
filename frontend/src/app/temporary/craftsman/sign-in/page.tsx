import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { createTranslator } from "@/lib/i18n/translate";
import { CraftsmanAuthShell } from "@/features/temporary-craftsman-auth/auth-shell";
import { CraftsmanSignInForm } from "@/features/temporary-craftsman-auth/sign-in-form";
import { CRAFTSMAN_SIGN_UP_PATH } from "@/features/temporary-craftsman-auth/routes";

export const dynamic = "force-dynamic";

const t = createTranslator("ar");

export const metadata: Metadata = { title: t("temporaryCraftsman.meta.signInTitle") };

export default async function TemporaryCraftsmanSignInPage() {
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
      subtitle={t("temporaryCraftsman.signIn.subtitle")}
      footer={{
        prompt: t("temporaryCraftsman.signIn.noAccount"),
        linkLabel: t("temporaryCraftsman.signIn.signUpLink"),
        href: CRAFTSMAN_SIGN_UP_PATH,
      }}
    >
      <CraftsmanSignInForm />
    </CraftsmanAuthShell>
  );
}
