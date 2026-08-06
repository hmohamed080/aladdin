"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { requestEmailOtp, verifyEmailOtp } from "@/server/actions/auth";
import { AuthCard } from "@/features/auth/auth-card";
import { EmailOtpFlow } from "@/features/auth/email-otp-flow";

/**
 * Account access recovery. The pilot verifies accounts by a SINGLE channel
 * (email), so recovery is simply "send me a fresh code" for an account whose email
 * the user can still reach — it reuses the Sign In actions (`shouldCreateUser:
 * false`, never creates a user). When the user no longer controls the email, the
 * only safe path is the manual support review at `/auth/support`.
 */
export function RecoveryForm() {
  const { t } = useI18n();
  return (
    <AuthCard
      title={t("auth.recoveryTitle")}
      subtitle={t("auth.recoverySubtitle")}
      footer={
        <div className="flex flex-col gap-1.5">
          <p>
            <Link href="/auth/support" className="font-medium text-accent hover:underline">
              {t("auth.lostEmailAccess")}
            </Link>
          </p>
          <p>
            <Link href="/auth/sign-in" className="text-fg-muted hover:text-fg hover:underline">
              {t("support.backToSignIn")}
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
        next="/b2b"
        note={t("auth.recoveryChannelNote")}
      />
    </AuthCard>
  );
}
