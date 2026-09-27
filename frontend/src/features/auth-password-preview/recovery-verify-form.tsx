"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import {
  verifyRecoveryCode,
  resendRecoveryCode,
  type PasswordAuthState,
} from "@/server/actions/auth-password-preview";
import { RESEND_COOLDOWN_SECONDS } from "./constants";
import { AuthCard } from "@/features/auth/auth-card";
import { LabeledField, SubmitButton, ResendButton } from "@/components/ui/controls";
import { OtpInput } from "@/components/ui/otp-input";
import { maskEmail } from "@/lib/ui/mask-email";

const initial: PasswordAuthState = { ok: false };

/**
 * Forgot Password — SCREEN 2 of 4. No password fields here at all. The
 * destination email is read server-side from the httpOnly routing cookie
 * (never a query param, never a hidden field the client could edit) and
 * shown masked. On success `verifyRecoveryCode` redirects straight to
 * Screen 3 — reaching it any other way is refused there (see
 * `requireRecoverySession`/`isRecoverySession`).
 */
export function RecoveryVerifyForm({ email }: { email: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [verifyState, dispatchVerify] = useActionState(verifyRecoveryCode, initial);
  const [resendState, dispatchResend] = useActionState(resendRecoveryCode, initial);
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  useEffect(() => {
    if (resendState.ok) setCooldown(RESEND_COOLDOWN_SECONDS);
  }, [resendState]);

  useEffect(() => {
    // Client-side navigation, not a server redirect — see the doc comment on
    // `verifyRecoveryCode` for why (cookie-propagation race on Screen 3).
    if (verifyState.ok) router.push("/preview/auth-password/forgot-password/reset");
  }, [verifyState, router]);

  return (
    <AuthCard
      title={t("authPasswordPreview.recoveryVerify.title")}
      subtitle={t("authPasswordPreview.recoveryVerify.subtitle")}
      footer={
        <Link href="/preview/auth-password/forgot-password" className="text-fg-muted hover:text-fg hover:underline">
          {t("authPasswordPreview.recoveryVerify.changeEmail")}
        </Link>
      }
    >
      <div className="flex flex-col gap-md">
        <p role="status" className="rounded-md border border-strong/70 bg-surface-2/40 px-md py-2.5 text-body text-fg-secondary">
          {t("authPasswordPreview.recoveryVerify.destinationLabel", { email: maskEmail(email) })}
        </p>

        <form action={dispatchVerify} className="flex flex-col gap-md" noValidate>
          <LabeledField
            label={t("authPasswordPreview.codeLabel")}
            htmlFor="token"
            error={verifyState.code ? t(verifyState.code) : undefined}
          >
            <OtpInput id="token" name="token" autoFocus error={Boolean(verifyState.code)} />
          </LabeledField>
          <SubmitButton className="w-full" pendingLabel={t("authPasswordPreview.recoveryVerify.verifying")}>
            {t("authPasswordPreview.recoveryVerify.verify")}
          </SubmitButton>
        </form>

        <form action={dispatchResend} className="border-t pt-md">
          <ResendButton cooldown={cooldown} />
        </form>
      </div>
    </AuthCard>
  );
}
