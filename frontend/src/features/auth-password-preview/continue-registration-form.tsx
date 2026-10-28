"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import {
  forgetPendingRegistration,
  resendPasswordSignUpCode,
  verifyPasswordSignUp,
  type PasswordAuthState,
} from "@/server/actions/auth-password-preview";
import { RESEND_COOLDOWN_SECONDS } from "./constants";
import { AuthCard } from "@/features/auth/auth-card";
import { Button, Input, LabeledField, ResendButton, SubmitButton } from "@/components/ui/controls";
import { OtpInput } from "@/components/ui/otp-input";
import { TurnstileWidget } from "./turnstile-widget";
import { maskEmail } from "@/lib/ui/mask-email";

const initial: PasswordAuthState = { ok: false };

/**
 * Continue an interrupted email registration (lost connection, closed tab,
 * refresh). Two steps on one route:
 *   1. Email + CAPTCHA → `resendPasswordSignUpCode` (GoTrue `resend`, never a
 *      second `signUp`: no password is asked for again or re-sent).
 *   2. The 6-digit code → the same `verifyPasswordSignUp` sign-up uses, which
 *      restores the staged username/account type or falls through to
 *      finish-registration for whatever is missing.
 * `pendingEmail` comes from the server-side httpOnly routing cookie, never the
 * URL; when it is present the page opens directly on step 2. Every answer is
 * neutral ("if this email has an unfinished registration…"), so the screen
 * never reveals whether an email is registered or already confirmed.
 */
export function ContinueRegistrationForm({ pendingEmail }: { pendingEmail: string | null }) {
  const { t } = useI18n();
  const [sendState, dispatchSend] = useActionState(resendPasswordSignUpCode, initial);
  const [resendState, dispatchResend] = useActionState(resendPasswordSignUpCode, initial);
  const [verifyState, dispatchVerify] = useActionState(verifyPasswordSignUp, initial);
  const [cooldown, setCooldown] = useState(0);

  const email = sendState.ok ? (sendState.email ?? null) : pendingEmail;

  useEffect(() => {
    if (sendState.ok || resendState.ok) setCooldown(RESEND_COOLDOWN_SECONDS);
  }, [sendState, resendState]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const footer = (
    <Link href="/auth/sign-in" className="text-fg-muted hover:text-fg hover:underline">
      {t("authPasswordPreview.continueRegistration.backToSignIn")}
    </Link>
  );

  if (!email) {
    return (
      <AuthCard
        title={t("authPasswordPreview.continueRegistration.title")}
        subtitle={t("authPasswordPreview.continueRegistration.subtitle")}
        footer={footer}
      >
        <form action={dispatchSend} className="flex flex-col gap-md" noValidate data-continue-step="email">
          <LabeledField
            label={t("authPasswordPreview.continueRegistration.emailLabel")}
            htmlFor="email"
            error={sendState.code && !sendState.ok ? t(sendState.code) : undefined}
          >
            <Input
              id="email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              defaultValue={sendState.email ?? ""}
              placeholder={t("authPasswordPreview.emailPlaceholder")}
              aria-invalid={Boolean(sendState.code && !sendState.ok) || undefined}
            />
          </LabeledField>
          <TurnstileWidget action="sign-up-resend" resetKey={sendState} />
          <SubmitButton className="w-full" pendingLabel={t("authPasswordPreview.continueRegistration.submitting")}>
            {t("authPasswordPreview.continueRegistration.submit")}
          </SubmitButton>
        </form>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={t("authPasswordPreview.continueRegistration.codeTitle")}
      subtitle={t("authPasswordPreview.continueRegistration.codeSubtitle", { email: maskEmail(email) })}
      footer={footer}
    >
      <div className="flex flex-col gap-md" data-continue-step="code">
        {/* The email rides the server-side cookie; there is no password field on this step at all. */}
        <form action={dispatchVerify} className="flex flex-col gap-sm" noValidate>
          <label htmlFor="token" className="sr-only">{t("authPasswordPreview.codeLabel")}</label>
          <OtpInput id="token" name="token" autoFocus error={Boolean(verifyState.code) && !verifyState.ok} />
          {verifyState.code && !verifyState.ok ? (
            <p role="alert" className="text-label text-danger">{t(verifyState.code)}</p>
          ) : null}
          <SubmitButton className="w-full" pendingLabel={t("authPasswordPreview.signUp.verifying")}>
            {t("authPasswordPreview.signUp.verify")}
          </SubmitButton>
        </form>
        <p className="text-label text-fg-muted">
          {t("authPasswordPreview.continueRegistration.passwordNote")}{" "}
          <Link href="/auth/forgot-password" className="font-medium text-accent hover:underline">
            {t("authPasswordPreview.signIn.forgotPassword")}
          </Link>
        </p>
        <div className="flex items-center justify-between gap-sm border-t pt-md">
          <form action={dispatchResend} className="flex items-center gap-sm">
            <TurnstileWidget action="sign-up-resend" appearance="interaction-only" resetKey={resendState} />
            <ResendButton cooldown={cooldown} />
          </form>
          <form action={forgetPendingRegistration}>
            <Button type="submit" variant="ghost" size="sm">
              {t("authPasswordPreview.continueRegistration.useAnotherEmail")}
            </Button>
          </form>
        </div>
        {resendState.code && !resendState.ok ? (
          <p role="alert" className="text-label text-danger">{t(resendState.code)}</p>
        ) : null}
      </div>
    </AuthCard>
  );
}
