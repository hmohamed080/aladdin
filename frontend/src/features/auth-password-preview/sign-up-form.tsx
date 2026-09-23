"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import {
  requestPasswordSignUp,
  resendPasswordSignUpCode,
  verifyPasswordSignUp,
  type PasswordAuthState,
} from "@/server/actions/auth-password-preview";
import { AuthCard } from "@/features/auth/auth-card";
import { Input, LabeledField, SubmitButton, Checkbox, ResendButton, Button } from "@/components/ui/controls";
import { OtpInput } from "@/components/ui/otp-input";
import { PasswordInput } from "./password-input";
import { PasswordStrengthMeter } from "./password-strength-meter";
import { TurnstileWidget } from "./turnstile-widget";

const initial: PasswordAuthState = { ok: false };
const RESEND_COOLDOWN_SECONDS = 30;

/**
 * Registration — Architecture B (docs/frontend/auth-password-preview.md
 * §Registration architecture): email + password + confirm, gated by the
 * three required consents, submitted in ONE call to `signUp()`
 * (`requestPasswordSignUp`), which sets the password atomically. The OTP
 * step that follows ONLY ever collects the 6-digit confirmation code — there
 * is no password field on it, no hidden `<input type="hidden" name="password">`,
 * and resend (`resendPasswordSignUpCode`) takes just the email. The password
 * therefore never survives past this component's own Step-1 submit; it is
 * never held in React state across a step transition, never in the URL,
 * never in a cookie, never in `localStorage`/`sessionStorage`.
 *
 * The Step-2 message is deliberately NEUTRAL ("if this email can continue
 * registration…"), never an unconditional "we sent a code to {email}" — an
 * email that already belongs to a CONFIRMED account is normalized by the
 * server action into the exact same response a genuine new signup gets (see
 * `isAccountExistsError` in the server action module), so the UI must never
 * imply a code was definitely sent. The same screen always keeps the "Sign
 * in" link visible (via `AuthCard`'s footer) and adds an explicit hint +
 * "Forgot password?" link, so someone who already has a confirmed account
 * and never receives a code has an immediate, non-suspicious way out instead
 * of waiting indefinitely on a code that GoTrue never actually sent.
 */
export function PasswordSignUpForm() {
  const { t } = useI18n();
  const [sendState, dispatchSend] = useActionState(requestPasswordSignUp, initial);
  const [resendState, dispatchResend] = useActionState(resendPasswordSignUpCode, initial);
  const [verifyState, dispatchVerify] = useActionState(verifyPasswordSignUp, initial);

  const [editingEmail, setEditingEmail] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [consents, setConsents] = useState({ terms: false, privacy: false, pilot: false });

  const emailRef = useRef<HTMLInputElement>(null);

  const codeSent = sendState.ok && !editingEmail;
  const email = sendState.email ?? "";
  const allConsented = consents.terms && consents.privacy && consents.pilot;

  useEffect(() => {
    if (sendState.ok) {
      setEditingEmail(false);
      setCooldown(RESEND_COOLDOWN_SECONDS);
      // The password only ever needs to exist for the ONE signUp() submit
      // above — clear it from React state immediately once that step is
      // behind us, rather than merely leaving it unused.
      setPassword("");
      setConfirmPassword("");
    }
  }, [sendState]);

  useEffect(() => {
    if (resendState.ok) setCooldown(RESEND_COOLDOWN_SECONDS);
  }, [resendState]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  useEffect(() => {
    if (editingEmail) emailRef.current?.focus();
  }, [editingEmail]);

  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;

  return (
    <AuthCard
      title={t("authPasswordPreview.signUp.title")}
      subtitle={t("authPasswordPreview.signUp.subtitle")}
      footer={
        <p>
          {t("authPasswordPreview.signUp.haveAccount")}{" "}
          <Link href="/preview/auth-password/sign-in" className="font-medium text-accent hover:underline">
            {t("authPasswordPreview.signUp.signInLink")}
          </Link>
        </p>
      }
    >
      {!codeSent ? (
        <form action={dispatchSend} className="flex flex-col gap-md" noValidate>
          <LabeledField
            label={t("authPasswordPreview.emailLabel")}
            htmlFor="email"
            error={
              sendState.code === "authPasswordPreview.error.invalidEmail" ||
              sendState.code === "authPasswordPreview.error.sendFailed" ||
              sendState.code === "authPasswordPreview.error.rateLimited"
                ? t(sendState.code)
                : undefined
            }
          >
            <Input
              ref={emailRef}
              id="email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              defaultValue={email}
              placeholder={t("authPasswordPreview.emailPlaceholder")}
              aria-invalid={sendState.code === "authPasswordPreview.error.invalidEmail" ? true : undefined}
            />
          </LabeledField>

          <LabeledField
            label={t("authPasswordPreview.passwordLabel")}
            htmlFor="password"
            error={sendState.code && sendState.code.startsWith("authPasswordPreview.error.password") ? t(sendState.code) : undefined}
          >
            <PasswordInput
              id="password"
              name="password"
              autoComplete="new-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </LabeledField>
          <PasswordStrengthMeter value={password} context={[email]} />

          <LabeledField
            label={t("authPasswordPreview.confirmPasswordLabel")}
            htmlFor="confirmPassword"
            error={mismatch || sendState.code === "authPasswordPreview.error.passwordMismatch" ? t("authPasswordPreview.error.passwordMismatch") : undefined}
          >
            <PasswordInput
              id="confirmPassword"
              name="confirmPassword"
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              aria-invalid={mismatch ? true : undefined}
            />
          </LabeledField>

          <fieldset className="flex flex-col gap-2.5 rounded-md border border-strong/70 bg-surface-2/40 p-md">
            <legend className="px-1 text-label font-medium text-fg-secondary">{t("authPasswordPreview.consent.heading")}</legend>
            <Checkbox id="consent_terms" name="consent_terms" checked={consents.terms} onChange={(v) => setConsents((c) => ({ ...c, terms: v }))}>
              {t("authPasswordPreview.consent.terms")}
            </Checkbox>
            <Checkbox id="consent_privacy" name="consent_privacy" checked={consents.privacy} onChange={(v) => setConsents((c) => ({ ...c, privacy: v }))}>
              {t("authPasswordPreview.consent.privacy")}
            </Checkbox>
            <Checkbox id="consent_pilot" name="consent_pilot" checked={consents.pilot} onChange={(v) => setConsents((c) => ({ ...c, pilot: v }))}>
              {t("authPasswordPreview.consent.pilot")}
            </Checkbox>
            {sendState.code === "authPasswordPreview.error.consentRequired" ? (
              <p role="alert" className="text-label text-danger">{t("authPasswordPreview.error.consentRequired")}</p>
            ) : (
              <p className="text-label text-fg-muted">{t("authPasswordPreview.consent.note")}</p>
            )}
          </fieldset>

          <TurnstileWidget resetKey={sendState} />
          {sendState.code === "authPasswordPreview.error.captchaRequired" ||
          sendState.code === "authPasswordPreview.error.captchaRejected" ? (
            <p role="alert" className="text-label text-danger">
              {t(sendState.code)}
            </p>
          ) : null}

          <SubmitButton className="w-full" pendingLabel={t("authPasswordPreview.signUp.submitting")} disabled={!allConsented || mismatch}>
            {t("authPasswordPreview.signUp.submit")}
          </SubmitButton>
        </form>
      ) : (
        <div className="flex flex-col gap-md">
          <p role="status" className="rounded-md border border-success/40 bg-success/10 px-md py-2.5 text-body text-success">
            {t("authPasswordPreview.signUp.codeStepSubtitle", { email })}
          </p>

          {/* No password field exists anywhere on this step — verifyPasswordSignUp
              only ever takes the email + the 6-digit code (see the module doc
              comment). */}
          <form action={dispatchVerify} className="flex flex-col gap-md" noValidate>
            <input type="hidden" name="email" value={email} />
            <LabeledField
              label={t("authPasswordPreview.codeLabel")}
              htmlFor="token"
              error={verifyState.code && !verifyState.ok ? t(verifyState.code) : undefined}
            >
              <OtpInput id="token" name="token" autoFocus error={Boolean(verifyState.code) && !verifyState.ok} />
            </LabeledField>
            <SubmitButton className="w-full" pendingLabel={t("authPasswordPreview.signUp.verifying")}>
              {t("authPasswordPreview.signUp.verify")}
            </SubmitButton>
          </form>

          <div className="flex items-center justify-between gap-sm border-t pt-md">
            <form action={dispatchResend} className="flex items-center gap-sm">
              <input type="hidden" name="email" value={email} />
              <TurnstileWidget resetKey={resendState} />
              <ResendButton cooldown={cooldown} />
            </form>
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditingEmail(true)}>
              {t("authPasswordPreview.changeEmail")}
            </Button>
          </div>

          {/* §5 — never leave the caller waiting indefinitely on a code that,
              for an email that already belongs to a confirmed account, GoTrue
              never actually sent. A visible, neutral way out — never phrased
              as "you already have an account." */}
          <p className="text-label text-fg-muted">
            {t("authPasswordPreview.signUp.noCodeHint")}{" "}
            <Link href="/preview/auth-password/forgot-password" className="font-medium text-accent hover:underline">
              {t("authPasswordPreview.signIn.forgotPassword")}
            </Link>
          </p>
        </div>
      )}
    </AuthCard>
  );
}
