"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { AuthCard } from "@/features/auth/auth-card";

/**
 * Forgot Password — SCREEN 4 of 4. A clean terminal state, nothing else: no
 * auto-redirect into the app (the session was already ended by Screen 3), a
 * single primary action back to Sign In.
 *
 * A Client Component, matching every other screen in this preview: `AuthCard`
 * calls the `useI18n()` hook internally without its own `"use client"`
 * marker, so it only works when rendered from within an already-client
 * module graph (every other screen gets this for free because their forms
 * are client components). An earlier version of this file was a plain
 * Server Component passing `locale` as a prop, which broke at runtime
 * ("Attempted to call useI18n() from the server") the first time it ran.
 */
export function RecoverySuccess() {
  const { t } = useI18n();
  return (
    <AuthCard title={t("authPasswordPreview.recoverySuccess.title")} subtitle={t("authPasswordPreview.recoverySuccess.body")}>
      <Link
        href="/preview/auth-password/sign-in"
        className="block w-full rounded-sm bg-primary px-md py-2 text-center text-label font-medium text-primary-foreground shadow-sm hover:opacity-90"
      >
        {t("authPasswordPreview.recoverySuccess.signIn")}
      </Link>
    </AuthCard>
  );
}
