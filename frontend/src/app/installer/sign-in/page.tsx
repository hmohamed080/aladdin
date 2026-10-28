import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { sanitizeNext } from "@/server/auth/next";
import { createTranslator } from "@/lib/i18n/translate";
import { AuthStage, AuthStageFooter, AuthStageHeader } from "@/features/entry-auth/auth-stage";
import { CraftsmanSignInForm } from "@/features/installer-phone-auth/sign-in-form";
import { INSTALLER_SIGN_UP_PATH } from "@/features/installer-phone-auth/routes";
import { oauthAvailability } from "@/server/auth/entry-oauth";
import { EntryAuthPanel } from "@/features/entry-auth/entry-auth-panel";
import { EntryEmailSignInForm } from "@/features/entry-auth/email-forms";

export const dynamic = "force-dynamic";

const t = createTranslator("ar");

export const metadata: Metadata = { title: t("temporaryCraftsman.meta.signInTitle") };

export default async function InstallerSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; method?: string; error?: string }>;
}) {
  const { next, method, error } = await searchParams;
  const safeNext = sanitizeNext(next);
  // Same rule the middleware applies to /auth/sign-in.
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
        title={t("temporaryCraftsman.signIn.title")}
        description={t("temporaryCraftsman.signIn.subtitle")}
      />
      <EntryAuthPanel
        kind="installer"
        next={safeNext}
        providers={await oauthAvailability()}
        initialMethod={method === "email" ? "email" : "phone"}
        error={error}
        phone={<CraftsmanSignInForm next={safeNext} />}
        email={<EntryEmailSignInForm kind="installer" next={safeNext} />}
      />
      <AuthStageFooter prompt={t("temporaryCraftsman.signIn.noAccount")} linkLabel={t("temporaryCraftsman.signIn.signUpLink")} href={INSTALLER_SIGN_UP_PATH} />
    </AuthStage>
  );
}
