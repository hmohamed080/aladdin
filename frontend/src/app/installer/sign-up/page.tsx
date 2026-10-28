import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { createTranslator } from "@/lib/i18n/translate";
import { AuthStage, AuthStageFooter, AuthStageHeader } from "@/features/entry-auth/auth-stage";
import { CraftsmanSignUpForm } from "@/features/installer-phone-auth/sign-up-form";
import { INSTALLER_SIGN_IN_PATH } from "@/features/installer-phone-auth/routes";
import { oauthAvailability } from "@/server/auth/entry-oauth";
import { EntryAuthPanel } from "@/features/entry-auth/entry-auth-panel";
import { EntryEmailSignUpForm } from "@/features/entry-auth/email-forms";

export const dynamic = "force-dynamic";

const t = createTranslator("ar");

export const metadata: Metadata = { title: t("temporaryCraftsman.meta.signUpTitle") };

export default async function InstallerSignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ method?: string; error?: string }>;
}) {
  const { method, error } = await searchParams;
  // A signed-in caller never needs to register — same rule the middleware
  // applies to /auth/sign-up: resume through /onboarding.
  const supabase = await getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/onboarding");

  return (
    <AuthStage labelledBy="installer-auth-title">
      <AuthStageHeader
        id="installer-auth-title"
        appName={t("common.appName")}
        badge={t("onboarding.accountType.types.installer_technician")}
        title={t("temporaryCraftsman.signUp.title")}
        description={t("temporaryCraftsman.signUp.subtitle")}
      />
      <EntryAuthPanel
        kind="installer"
        providers={await oauthAvailability()}
        initialMethod={method === "email" ? "email" : "phone"}
        error={error}
        phone={<CraftsmanSignUpForm />}
        email={<EntryEmailSignUpForm kind="installer" />}
      />
      <AuthStageFooter prompt={t("temporaryCraftsman.signUp.haveAccount")} linkLabel={t("temporaryCraftsman.signUp.signInLink")} href={INSTALLER_SIGN_IN_PATH} />
    </AuthStage>
  );
}
