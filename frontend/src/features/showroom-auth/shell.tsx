import type { ReactNode } from "react";
import { createTranslator } from "@/lib/i18n/translate";
import { AuthStage, AuthStageFooter, AuthStageHeader } from "@/features/entry-auth/auth-stage";
const t = createTranslator("ar");
export function ShowroomAuthShell({ variant, children }: {
    variant: "signIn" | "signUp";
    children: ReactNode;
}) {
    const signUp = variant === "signUp";
    return <AuthStage labelledBy="showroom-auth-title">
      <AuthStageHeader id="showroom-auth-title" appName={t("common.appName")} badge={<>
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 10 5 3h14l2 7M4 10v11h16V10M9 21v-7h6v7M3 10c0 3 4 3 4 0 0 3 5 3 5 0 0 3 5 3 5 0 0 3 4 3 4 0"/></svg>
          {t("showroomAuth.account")}
        </>} title={t(signUp ? "showroomAuth.signUp" : "showroomAuth.signIn")} subtitle={!signUp ? t("showroomAuth.signInSubtitle") : undefined} description={t(signUp ? "showroomAuth.signUpDescription" : "showroomAuth.signInDescription")}/>
      {children}
      <AuthStageFooter prompt={t(signUp ? "showroomAuth.haveAccount" : "showroomAuth.noAccount")} linkLabel={t(signUp ? "showroomAuth.signIn" : "showroomAuth.signUp")} href={signUp ? "/showroom/sign-in" : "/showroom/sign-up"}/>
    </AuthStage>;
}
