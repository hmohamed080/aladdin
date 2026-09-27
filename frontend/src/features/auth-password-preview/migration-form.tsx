"use client";

import { useActionState, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { requestMigrationCode, completeMigration, type PasswordAuthState } from "@/server/actions/auth-password-preview";
import { AuthCard } from "@/features/auth/auth-card";
import { LabeledField, SubmitButton } from "@/components/ui/controls";
import { OtpInput } from "@/components/ui/otp-input";
import { PasswordInput } from "./password-input";
import { PasswordStrengthMeter } from "./password-strength-meter";

const sendInitial: PasswordAuthState = { ok: false };
const completeInitial: PasswordAuthState = { ok: false };

/**
 * Existing-passwordless-user migration (docs/frontend/auth-password-preview.md
 * §Existing passwordless users): an already-signed-in caller with no
 * password. Step-up verification via Supabase's `reauthenticate()` — a fresh
 * nonce emailed to the caller's OWN confirmed address, matching the proposed
 * journey ("verify identity through the existing OTP mechanism") — rather
 * than trusting the existing session alone for a credential-adding change.
 */
export function MigrationForm({ email }: { email: string }) {
  const { t } = useI18n();
  const [sendState, dispatchSend] = useActionState(requestMigrationCode, sendInitial);
  const [completeState, dispatchComplete] = useActionState(completeMigration, completeInitial);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const mismatch = confirmPassword.length > 0 && password !== confirmPassword;

  if (completeState.ok) {
    return (
      <AuthCard title={t("authPasswordPreview.migration.title")} subtitle={t("authPasswordPreview.migration.done")}>
        <></>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t("authPasswordPreview.migration.title")} subtitle={t("authPasswordPreview.migration.subtitle")}>
      {!sendState.ok ? (
        <form action={dispatchSend} className="flex flex-col gap-md">
          {sendState.code ? (
            <p role="alert" className="text-label text-danger">{t(sendState.code)}</p>
          ) : null}
          <SubmitButton className="w-full" pendingLabel={t("authPasswordPreview.migration.sending")}>
            {t("authPasswordPreview.migration.sendCode")}
          </SubmitButton>
        </form>
      ) : (
        <form action={dispatchComplete} className="flex flex-col gap-md" noValidate>
          <p role="status" className="rounded-md border border-success/40 bg-success/10 px-md py-2.5 text-body text-success">
            {t("authPasswordPreview.migration.codeStepSubtitle", { email })}
          </p>
          <LabeledField
            label={t("authPasswordPreview.codeLabel")}
            htmlFor="token"
            error={
              completeState.code &&
              (completeState.code === "authPasswordPreview.error.invalidCode" ||
                completeState.code === "authPasswordPreview.error.otpExpired" ||
                completeState.code === "authPasswordPreview.error.rateLimited")
                ? t(completeState.code)
                : undefined
            }
          >
            <OtpInput id="token" name="token" autoFocus />
          </LabeledField>

          <LabeledField
            label={t("authPasswordPreview.passwordLabel")}
            htmlFor="password"
            error={completeState.code?.startsWith("authPasswordPreview.error.password") ? t(completeState.code) : undefined}
          >
            <PasswordInput id="password" name="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </LabeledField>
          <PasswordStrengthMeter value={password} context={[email]} />

          <LabeledField
            label={t("authPasswordPreview.confirmPasswordLabel")}
            htmlFor="confirmPassword"
            error={mismatch ? t("authPasswordPreview.error.passwordMismatch") : undefined}
          >
            <PasswordInput id="confirmPassword" name="confirmPassword" autoComplete="new-password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} aria-invalid={mismatch || undefined} />
          </LabeledField>

          <SubmitButton className="w-full" pendingLabel={t("authPasswordPreview.migration.verifying")} disabled={mismatch}>
            {t("authPasswordPreview.migration.verify")}
          </SubmitButton>
        </form>
      )}
    </AuthCard>
  );
}
