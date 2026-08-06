"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { requestSignUpOtp, verifySignUpOtp } from "@/server/actions/auth";
import { AuthCard } from "@/features/auth/auth-card";
import { EmailOtpFlow } from "@/features/auth/email-otp-flow";

/**
 * Sign Up — passwordless Email-OTP registration. Requires accepting the three
 * consents before a code is sent; on verification the identity is created (DB
 * trigger bootstraps the profile), the consent receipt is persisted, and the user
 * is handed off to `/onboarding`. No passwords, no phone, no WhatsApp, no social
 * logins, no account enumeration. Distinct route from Sign In.
 */
export function SignUpForm() {
  const { t } = useI18n();
  return (
    <AuthCard
      title={t("auth.signUpTitle")}
      subtitle={t("auth.signUpSubtitle")}
      footer={
        <p>
          {t("auth.haveAccount")}{" "}
          <Link href="/auth/sign-in" className="font-medium text-accent hover:underline">
            {t("auth.signInLink")}
          </Link>
        </p>
      }
    >
      <EmailOtpFlow
        sendAction={requestSignUpOtp}
        verifyAction={verifySignUpOtp}
        sendLabel={t("auth.createAccount")}
        sendingLabel={t("auth.sending")}
        consent
      />
    </AuthCard>
  );
}
