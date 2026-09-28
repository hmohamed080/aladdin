"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { requestEmailOtp, verifyEmailOtp } from "@/server/actions/auth";
import { AuthCard } from "@/features/auth/auth-card";
import { EmailOtpFlow } from "@/features/auth/email-otp-flow";

/**
 * Sign In — passwordless Email-OTP for EXISTING accounts. The underlying two-step
 * flow (send → verify, sibling forms, resend cooldown, change-email) lives in the
 * shared `EmailOtpFlow`; Sign In never creates a user (`requestEmailOtp` sends with
 * `shouldCreateUser: false`). Distinct from Sign Up, with clear links to it and to
 * account-access recovery — and a secondary link for installer/technician
 * accounts that sign in with phone + password (`/installer/sign-in`), carrying
 * the caller's validated `next` when there is one.
 */
export function SignInForm({ next, installerSignInHref = "/installer/sign-in" }: { next: string; installerSignInHref?: string }) {
  const { t } = useI18n();
  return (
    <AuthCard
      title={t("auth.title")}
      subtitle={t("auth.subtitle")}
      footer={
        <div className="flex flex-col gap-1.5">
          <p>
            {t("auth.noAccount")}{" "}
            <Link href="/auth/sign-up" className="font-medium text-accent hover:underline">
              {t("auth.signUpLink")}
            </Link>
          </p>
          <p>
            <Link href="/auth/recovery" className="text-fg-muted hover:text-fg hover:underline">
              {t("auth.troubleSigningIn")}
            </Link>
          </p>
          <p>
            <Link href={installerSignInHref} className="text-fg-muted hover:text-fg hover:underline">
              {t("auth.installerPhoneSignIn")}
            </Link>
          </p>
        </div>
      }
    >
      <EmailOtpFlow
        sendAction={requestEmailOtp}
        verifyAction={verifyEmailOtp}
        sendLabel={t("auth.sendCode")}
        sendingLabel={t("auth.sending")}
        next={next}
        note={t("auth.passwordless")}
      />
    </AuthCard>
  );
}
