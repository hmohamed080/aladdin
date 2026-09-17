"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { verifyEmailOtp, requestEmailOtp, type AuthState } from "@/server/actions/auth";
import { AuthCard } from "@/features/auth/auth-card";
import { Input, LabeledField, SubmitButton, ResendButton } from "@/components/ui/controls";
import { OtpInput } from "@/components/ui/otp-input";

const initial: AuthState = { ok: false };
const RESEND_COOLDOWN_SECONDS = 30;

/**
 * Standalone verification: a single form for someone who already requested a code
 * and wants to enter their email + code together (e.g. resuming on a new tab).
 * The email is entered here, never carried in the URL (no PII in query strings).
 * Verifies via the Sign In action (`shouldCreateUser: false`).
 *
 * A resend control is included (sharing `ResendButton`'s cooldown behavior with
 * `EmailOtpFlow`) so an expired code isn't a dead end back to sign-in.
 */
export function VerifyForm({ next }: { next: string }) {
  const { t } = useI18n();
  const [state, dispatch] = useActionState(verifyEmailOtp, initial);
  const [resendState, dispatchResend] = useActionState(requestEmailOtp, initial);
  const [email, setEmail] = useState("");
  const [cooldown, setCooldown] = useState(0);

  const invalidEmail = state.code === "auth.error.invalidEmail";
  const invalidCode = state.code && !state.ok && !invalidEmail;

  useEffect(() => {
    if (resendState.ok) setCooldown(RESEND_COOLDOWN_SECONDS);
  }, [resendState]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  return (
    <AuthCard
      title={t("auth.verifyTitle")}
      subtitle={t("auth.verifySubtitle")}
      footer={
        <p>
          <Link href="/auth/sign-in" className="text-fg-muted hover:text-fg hover:underline">
            {t("support.backToSignIn")}
          </Link>
        </p>
      }
    >
      <form action={dispatch} className="flex flex-col gap-md" noValidate>
        <input type="hidden" name="next" value={next} />
        <LabeledField
          label={t("auth.emailLabel")}
          htmlFor="email"
          error={invalidEmail ? t("auth.error.invalidEmail") : undefined}
        >
          <Input
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("auth.emailPlaceholder")}
            aria-invalid={invalidEmail ? true : undefined}
          />
        </LabeledField>
        <LabeledField
          label={t("auth.codeLabel")}
          htmlFor="token"
          error={invalidCode ? t(state.code as string) : undefined}
        >
          <OtpInput id="token" name="token" error={Boolean(invalidCode)} />
        </LabeledField>
        <SubmitButton className="w-full" pendingLabel={t("auth.verifying")}>{t("auth.verify")}</SubmitButton>
      </form>

      <div className="flex items-center justify-between gap-sm border-t pt-md">
        {resendState.ok ? (
          <p role="status" className="text-label text-success">{t("auth.info.codeSent", { email })}</p>
        ) : (
          <span />
        )}
        <form action={dispatchResend}>
          <input type="hidden" name="email" value={email} />
          <ResendButton cooldown={cooldown} />
        </form>
      </div>
    </AuthCard>
  );
}
