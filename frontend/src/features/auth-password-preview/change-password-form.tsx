"use client";

import { useActionState, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { changePassword, type PasswordAuthState } from "@/server/actions/auth-password-preview";
import { AuthCard } from "@/features/auth/auth-card";
import { LabeledField, SubmitButton } from "@/components/ui/controls";
import { PasswordInput } from "./password-input";
import { PasswordStrengthMeter } from "./password-strength-meter";

const initial: PasswordAuthState = { ok: false };

/**
 * Authenticated Change Password (docs/frontend/auth-password-preview.md
 * §Authenticated Change Password) — distinct from Forgot Password. Requires
 * the CURRENT password, re-verified server-side via `signInWithPassword`
 * (see `changePassword`), never the existing session alone: a long-lived
 * session is not proof of intent for a sensitive account-security change.
 */
export function ChangePasswordForm({ email }: { email: string }) {
  const { t } = useI18n();
  const [state, dispatch] = useActionState(changePassword, initial);
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const mismatch = confirmNewPassword.length > 0 && newPassword !== confirmNewPassword;

  if (state.ok) {
    return (
      <AuthCard title={t("authPasswordPreview.changePassword.title")} subtitle={t("authPasswordPreview.changePassword.done")}>
        <></>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t("authPasswordPreview.changePassword.title")} subtitle={t("authPasswordPreview.changePassword.subtitle")}>
      <form action={dispatch} className="flex flex-col gap-md" noValidate>
        <LabeledField
          label={t("authPasswordPreview.changePassword.currentPasswordLabel")}
          htmlFor="currentPassword"
          error={
            state.code === "authPasswordPreview.error.currentPasswordRequired" ||
            state.code === "authPasswordPreview.error.currentPasswordWrong" ||
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

        <SubmitButton className="w-full" pendingLabel={t("authPasswordPreview.changePassword.submitting")} disabled={mismatch}>
          {t("authPasswordPreview.changePassword.submit")}
        </SubmitButton>
      </form>
    </AuthCard>
  );
}
