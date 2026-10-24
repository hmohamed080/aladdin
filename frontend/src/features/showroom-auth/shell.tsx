import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { createTranslator } from "@/lib/i18n/translate";
import styles from "./showroom-auth.module.css";
const t = createTranslator("ar");
export function ShowroomAuthShell({ variant, children }: {
    variant: "signIn" | "signUp";
    children: ReactNode;
}) {
    const signUp = variant === "signUp";
    return <main className={styles.stage + " installer-surface"} lang="ar" dir="rtl">
    <section className={styles.sheet} aria-labelledby="showroom-auth-title">
      <div className={styles.inner}>
        <header className={styles.header}>
          <div className={styles.brand}><Image src="/assets/showroom-auth/aladdin-logo-2026.png" alt={t("common.appName")} width={1536} height={1024} priority className={styles.logo}/></div>
          {signUp ? <p className={styles.badge}>
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 10 5 3h14l2 7M4 10v11h16V10M9 21v-7h6v7M3 10c0 3 4 3 4 0 0 3 5 3 5 0 0 3 5 3 5 0 0 3 4 3 4 0"/></svg>
            {t("showroomAuth.account")}
          </p> : null}
          <h1 id="showroom-auth-title">{t(signUp ? "showroomAuth.signUp" : "showroomAuth.signIn")}</h1>
          <p className={styles.description}>{t(signUp ? "showroomAuth.signUpDescription" : "showroomAuth.signInDescription")}</p>
        </header>
        {children}
        <p className={styles.footer}>{t(signUp ? "showroomAuth.haveAccount" : "showroomAuth.noAccount")} <Link href={signUp ? "/sign-in" : "/auth/sign-up"}>{t(signUp ? "showroomAuth.signIn" : "showroomAuth.signUp")}</Link></p>
      </div>
    </section>
    <div className={styles.photo} aria-hidden="true"><picture><source media="(max-width: 767px)" srcSet="/assets/showroom-auth/showroom-interior-mobile-2026.png"/><Image src="/assets/showroom-auth/showroom-interior-2026.png" alt="" fill loading="eager" fetchPriority="high" sizes="62vw"/></picture></div>
  </main>;
}
