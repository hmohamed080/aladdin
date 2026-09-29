"use client";

import { useState, type FormEvent } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Button, LabeledField } from "@/components/ui/controls";
import { PasswordInput } from "@/features/auth-password-preview/password-input";
import { PasswordStrengthMeter } from "@/features/auth-password-preview/password-strength-meter";

/**
 * Admin Settings → Security → Change password (PD-014) — PREVIEW ONLY.
 *
 * The fields, the show/hide toggle and the live strength meter are the REAL
 * ones (`PasswordInput`, `PasswordStrengthMeter`, and through it the single
 * password policy in `password-policy.ts` — not a second copy). What is NOT
 * real: Save never calls Supabase Auth, never touches a password, and never
 * renders a success state. It only reveals a permanent "Preview only" note.
 *
 * Future wiring (recorded in PD-014): require the current password (or a fresh
 * OTP), rate-limit attempts, send the existing password-changed notification,
 * and never store or log a password outside Supabase Auth.
 */
export function ChangePasswordPreview({ email }: { email: string }) {
  const { t } = useI18n();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [clicked, setClicked] = useState(false);
  const mismatch = confirm.length > 0 && next !== confirm;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setClicked(true);
  }

  return (
    <form onSubmit={onSubmit} className="flex max-w-xl flex-col gap-md" noValidate>
      <LabeledField label={t("admin.preview.settings.currentPassword")} htmlFor="admin-current-password">
        <PasswordInput id="admin-current-password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
      </LabeledField>
      <LabeledField label={t("admin.preview.settings.newPassword")} htmlFor="admin-new-password" hint={t("admin.preview.settings.passwordPolicy")}>
        <PasswordInput id="admin-new-password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
      </LabeledField>
      <PasswordStrengthMeter value={next} context={email ? [email] : []} />
      <LabeledField
        label={t("admin.preview.settings.confirmPassword")}
        htmlFor="admin-confirm-password"
        error={mismatch ? t("authPasswordPreview.error.passwordMismatch") : undefined}
      >
        <PasswordInput
          id="admin-confirm-password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          aria-invalid={mismatch || undefined}
        />
      </LabeledField>
      <div className="flex flex-wrap items-center gap-md">
        <Button type="submit" variant="accent" disabled={mismatch}>
          {t("admin.preview.settings.savePassword")}
        </Button>
        {clicked ? (
          <p role="status" className="rounded-sm border border-warning/40 bg-warning/10 px-md py-2 text-label text-fg-secondary">
            {t("admin.preview.settings.passwordPreviewNote")}
          </p>
        ) : (
          <p className="text-label text-fg-muted">{t("admin.preview.settings.passwordPreviewNote")}</p>
        )}
      </div>
    </form>
  );
}
