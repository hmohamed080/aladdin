"use client";

import { useActionState, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { changePassword, type PasswordAuthState } from "@/server/actions/auth-password-preview";
import { AuthCard } from "@/features/auth/auth-card";
import { LabeledField, SubmitButton } from "@/components/ui/controls";
import { PasswordInput } from "./password-input";
import { TurnstileWidget } from "./turnstile-widget";
import { PasswordStrengthMeter } from "./password-strength-meter";

const initial: PasswordAuthState = { ok: false };

/**
 * Authenticated Change Password (docs/frontend/auth-password-preview.md
 * §Authenticated Change Password) — distinct from Forgot Password. Requires
 * the CURRENT password, re-verified server-side via `signInWithPassword`
 * (see `changePassword`), never the existing session alone: a long-lived
 * session is not proof of intent for a sensitive account-security change.
 */
export function ChangePasswordForm({ email, embedded = false }: { email: string; /** Inside the settings frame: no card of its own, the page supplies the title. */ embedded?: boolean }) {
  const { t } = useI18n();
  const [state, dispatch] = useActionState(changePassword, initial);
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const mismatch = confirmNewPassword.length > 0 && newPassword !== confirmNewPassword;

  if (state.ok) {
    if (embedded) return <p role="status" className="engineer-link-notice">{t("authPasswordPreview.changePassword.done")}</p>;
    return (
      <AuthCard title={t("authPasswordPreview.changePassword.title")} subtitle={t("authPasswordPreview.changePassword.done")}>
        <></>
      </AuthCard>
    );
  }

  const Frame = embedded
    ? ({ children }: { children: React.ReactNode }) => <div className="engineer-password-embed">{children}</div>
    : ({ children }: { children: React.ReactNode }) => (
        <AuthCard title={t("authPasswordPreview.changePassword.title")} subtitle={t("authPasswordPreview.changePassword.subtitle")}>{children}</AuthCard>
      );
  return (
    <Frame>
      <form action={dispatch} className="flex flex-col gap-md" noValidate>
        <LabeledField
          label={t("authPasswordPreview.changePassword.currentPasswordLabel")}
          htmlFor="currentPassword"
          error={
            state.code === "authPasswordPreview.error.currentPasswordRequired" ||
            state.code === "authPasswordPreview.error.currentPasswordWrong" ||
            state.code === "authPasswordPreview.error.captchaRequired" ||
            state.code === "authPasswordPreview.error.captchaRejected" ||
            state.code === "authPasswordPreview.error.rateLimited"
              ? t(state.code)
              : undefined
          }
        >
          <PasswordInput id="currentPassword" name="currentPassword" autoComplete="current-password" required />
        </LabeledField>

        <LabeledField
          label={t("authPasswordPreview.passwordLabel")}
          htmlFor="newPassword"
          error={
            state.code &&
            (state.code.startsWith("authPasswordPreview.error.password") || state.code === "authPasswordPreview.error.samePassword")
              ? t(state.code)
              : undefined
          }
        >
          <PasswordInput id="newPassword" name="newPassword" autoComplete="new-password" required value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        </LabeledField>
        <PasswordStrengthMeter value={newPassword} context={[email]} />

        <LabeledField
          label={t("authPasswordPreview.changePassword.confirmNewPasswordLabel")}
          htmlFor="confirmNewPassword"
          error={mismatch ? t("authPasswordPreview.error.passwordMismatch") : undefined}
        >
          <PasswordInput id="confirmNewPassword" name="confirmNewPassword" autoComplete="new-password" required value={confirmNewPassword} onChange={(e) => setConfirmNewPassword(e.target.value)} aria-invalid={mismatch || undefined} />
        </LabeledField>

        {/* The current-password check is a CAPTCHA-protected password grant. */}
        <TurnstileWidget name="captchaToken" action="change-password" appearance="interaction-only" resetKey={state} />
        <SubmitButton className="w-full" pendingLabel={t("authPasswordPreview.changePassword.submitting")} disabled={mismatch}>
          {t("authPasswordPreview.changePassword.submit")}
        </SubmitButton>
      </form>
    </Frame>
  );
}
