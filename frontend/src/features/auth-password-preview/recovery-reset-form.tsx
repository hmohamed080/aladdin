"use client";

import { useActionState, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { resetPasswordAndSignOut, type PasswordAuthState } from "@/server/actions/auth-password-preview";
import { AuthCard } from "@/features/auth/auth-card";
import { LabeledField, SubmitButton } from "@/components/ui/controls";
import { PasswordInput } from "./password-input";
import { PasswordStrengthMeter } from "./password-strength-meter";

const initial: PasswordAuthState = { ok: false };

/**
 * Forgot Password — SCREEN 3 of 4. Only reachable with a genuine, live
 * recovery session (enforced server-side by the page, and re-checked inside
 * `resetPasswordAndSignOut` itself). No email or OTP field is shown again —
 * both are already spent. On success the server ends this session (and every
 * other one) and redirects to Screen 4; there is no path from here back into
 * the app without a fresh Email + Password sign-in.
 */
export function RecoveryResetForm({ email }: { email: string }) {
  const { t } = useI18n();
  const [state, dispatch] = useActionState(resetPasswordAndSignOut, initial);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;

  return (
    <AuthCard title={t("authPasswordPreview.recoveryReset.title")} subtitle={t("authPasswordPreview.recoveryReset.subtitle")}>
      <form action={dispatch} className="flex flex-col gap-md" noValidate>
        <LabeledField
          label={t("authPasswordPreview.newPasswordLabel")}
          htmlFor="password"
          error={
            state.code && state.code !== "authPasswordPreview.error.passwordMismatch"
              ? t(state.code)
              : undefined
          }
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
          error={mismatch ? t("authPasswordPreview.error.passwordMismatch") : undefined}
        >
          <PasswordInput
            id="confirmPassword"
            name="confirmPassword"
            autoComplete="new-password"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            aria-invalid={mismatch || undefined}
          />
        </LabeledField>

        <SubmitButton className="w-full" pendingLabel={t("authPasswordPreview.recoveryReset.submitting")} disabled={mismatch}>
          {t("authPasswordPreview.recoveryReset.submit")}
        </SubmitButton>
      </form>
    </AuthCard>
  );
}
