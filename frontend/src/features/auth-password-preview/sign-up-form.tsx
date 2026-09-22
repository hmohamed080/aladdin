"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import {
  requestPasswordSignUp,
  verifyPasswordSignUp,
  finishPasswordSignUp,
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
 * Registration preview — email + password + confirm, gated by the three
 * required consents (mirrors the live Sign Up's consent gate), then email
 * verification via the SAME 6-digit OTP mechanism the passwordless flow
 * already uses. The OTP step is what confirms the email; the password is
 * attached only after that succeeds (`verifyPasswordSignUp`), stamping a
 * resume flag in the same call.
 *
 * `resumeEmail`: set by the sign-up PAGE (`resumePasswordSignUpEmail()`) when
 * a signed-in session's email is confirmed but never got that flag — the
 * interrupted-state case (network/browser failure between OTP verify and
 * `updateUser`). When present, this form skips straight to the password-only
 * completion step; no code, no email field, nothing already proven is asked
 * for twice.
 */
export function PasswordSignUpForm({ resumeEmail }: { resumeEmail?: string }) {
  const { t } = useI18n();
  const [sendState, dispatchSend] = useActionState(requestPasswordSignUp, initial);
  const [verifyState, dispatchVerify] = useActionState(verifyPasswordSignUp, initial);
  const [finishState, dispatchFinish] = useActionState(finishPasswordSignUp, initial);

  const [editingEmail, setEditingEmail] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [retryPassword, setRetryPassword] = useState("");
  const [retryConfirm, setRetryConfirm] = useState("");
  const [consents, setConsents] = useState({ terms: false, privacy: false, pilot: false });

  const emailRef = useRef<HTMLInputElement>(null);

  const codeSent = sendState.ok && !editingEmail;
  const email = sendState.email ?? "";
  const allConsented = consents.terms && consents.privacy && consents.pilot;
  const passwordStage = Boolean(resumeEmail) || verifyState.code === "authPasswordPreview.error.passwordRejected";
  const contextEmail = resumeEmail ?? email;

  useEffect(() => {
    if (sendState.ok) {
      setEditingEmail(false);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    }
  }, [sendState]);

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
      {passwordStage ? (
        <form action={dispatchFinish} className="flex flex-col gap-md" noValidate>
          <p role="status" className="rounded-md border border-success/40 bg-success/10 px-md py-2.5 text-body text-success">
            {t("authPasswordPreview.signUp.passwordStepSubtitle")}
          </p>
          <LabeledField
            label={t("authPasswordPreview.passwordLabel")}
            htmlFor="retryPassword"
            error={finishState.code && finishState.code !== "authPasswordPreview.error.passwordMismatch" ? t(finishState.code) : undefined}
          >
            <PasswordInput
              id="retryPassword"
              name="password"
              autoComplete="new-password"
              required
              value={retryPassword}
              onChange={(e) => setRetryPassword(e.target.value)}
            />
          </LabeledField>
          <PasswordStrengthMeter value={retryPassword} context={[contextEmail]} />
          <LabeledField
            label={t("authPasswordPreview.confirmPasswordLabel")}
            htmlFor="retryConfirmPassword"
            error={retryConfirm.length > 0 && retryConfirm !== retryPassword ? t("authPasswordPreview.error.passwordMismatch") : undefined}
          >
            <PasswordInput
              id="retryConfirmPassword"
              name="confirmPassword"
              autoComplete="new-password"
              required
              value={retryConfirm}
              onChange={(e) => setRetryConfirm(e.target.value)}
            />
          </LabeledField>
          <SubmitButton className="w-full" pendingLabel={t("authPasswordPreview.resetPassword.submitting")} disabled={retryPassword.length === 0 || retryPassword !== retryConfirm}>
            {t("authPasswordPreview.resetPassword.submit")}
          </SubmitButton>
        </form>
      ) : !codeSent ? (
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
          <PasswordStrengthMeter value={password} context={[contextEmail]} />

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

          <form action={dispatchVerify} className="flex flex-col gap-md" noValidate>
            <input type="hidden" name="email" value={email} />
            <input type="hidden" name="password" value={password} />
            <LabeledField
              label={t("authPasswordPreview.codeLabel")}
              htmlFor="token"
              error={verifyState.code && !verifyState.ok && !passwordStage ? t(verifyState.code) : undefined}
            >
              <OtpInput id="token" name="token" autoFocus error={Boolean(verifyState.code) && !verifyState.ok} />
            </LabeledField>
            <SubmitButton className="w-full" pendingLabel={t("authPasswordPreview.signUp.verifying")}>
              {t("authPasswordPreview.signUp.verify")}
            </SubmitButton>
          </form>

          <div className="flex items-center justify-between gap-sm border-t pt-md">
            <form action={dispatchSend} className="flex items-center gap-sm">
              <input type="hidden" name="email" value={email} />
              <input type="hidden" name="password" value={password} />
              <input type="hidden" name="confirmPassword" value={confirmPassword} />
              <input type="hidden" name="consent_terms" value="on" />
              <input type="hidden" name="consent_privacy" value="on" />
              <input type="hidden" name="consent_pilot" value="on" />
              <TurnstileWidget resetKey={sendState} />
              <ResendButton cooldown={cooldown} />
            </form>
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditingEmail(true)}>
              {t("authPasswordPreview.changeEmail")}
            </Button>
          </div>
        </div>
      )}
    </AuthCard>
  );
}
