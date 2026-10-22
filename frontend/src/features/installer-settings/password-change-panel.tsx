"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";
import { Button, LabeledField } from "@/components/ui/controls";
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon, ShieldIcon } from "@/components/ui/icons";
import { PasswordInput } from "@/features/auth-password-preview/password-input";
import { PASSWORD_MIN_LENGTH } from "@/features/auth-password-preview/password-policy";
import { PasswordStrengthMeter } from "@/features/auth-password-preview/password-strength-meter";
import { SettingRow } from "@/features/installer-settings-preview/installer-settings-preview";
import { useI18n } from "@/lib/i18n/context";
import { changeInstallerPassword, type InstallerSecurityState } from "@/server/actions/installer-security";
import { retryMessage } from "./phone-change-panel";
import type { ProductionCopy } from "./production-copy";

const INITIAL: InstallerSecurityState = { ok: false };

/**
 * The approved "Change password" row. Its chevron opens the current / new / confirm form below it, wired to the
 * `changeInstallerPassword` Server Action (M2 gate, GoTrue's native current-password check, M4 audit, other sessions
 * signed out). The strength meter is the existing policy component, fed the account's own identifiers as context exactly
 * as the server does. Nothing is stored: every value is cleared when the attempt is handed to the action or succeeds.
 */
export function PasswordChangeRow({
  title,
  hint,
  c,
  context,
  disabledReason,
}: {
  title: string;
  hint: string;
  c: ProductionCopy;
  /** The account's own phone / name fragments the new password may not contain (mirrors the server rule). */
  context: string[];
  /** Why the control is unavailable for this account (e.g. not a phone sign-in account); null = available. */
  disabledReason: string | null;
}) {
  const { t, dir } = useI18n();
  const [state, dispatch, pending] = useActionState(changeInstallerPassword, INITIAL);
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [handled, setHandled] = useState<InstallerSecurityState | null>(null);
  const Chevron = dir === "rtl" ? ChevronLeftIcon : ChevronRightIcon;

  if (state !== handled && state !== INITIAL && !pending) {
    setHandled(state);
    if (state.ok) {
      setOpen(false);
      setCurrent("");
      setNext("");
      setConfirm("");
    }
  }

  const mismatch = confirm.length > 0 && next !== confirm;
  const canSubmit = current.length > 0 && next.length >= PASSWORD_MIN_LENGTH && next === confirm && !pending;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit) return;
    const data = new FormData();
    data.set("currentPassword", current);
    data.set("newPassword", next);
    data.set("confirmNewPassword", confirm);
    setCurrent(""); // always retype the current password after an attempt; the new pair is kept on a failure to correct it
    startTransition(() => dispatch(data));
  };

  const failure = state !== INITIAL && !state.ok && state.code ? `${t(state.code)} ${retryMessage(c.retryAfter, state.retryAfterSeconds)}`.trim() : null;
  const succeeded = !open && state.ok && state.code;

  return (
    <>
      <SettingRow title={title} hint={hint} icon={ShieldIcon}>
        {disabledReason ? (
          <span className="text-caption text-fg-secondary">{disabledReason}</span>
        ) : (
          <Button variant="ghost" aria-label={title} aria-expanded={open} aria-controls="settings-password-change" onClick={() => setOpen((value) => !value)}>
            <Chevron size={18} />
          </Button>
        )}
      </SettingRow>
      {succeeded ? (
        <p role="status" className="flex items-center gap-sm rounded-sm border p-md text-body" data-testid="password-change-success">
          <CheckIcon size={18} />
          {t(state.code!)}
        </p>
      ) : null}
      {open ? (
        <form id="settings-password-change" onSubmit={submit} className="grid min-w-0 gap-md rounded-sm border p-md" aria-label={title} noValidate>
          <p className="text-caption text-fg-secondary">{c.changePasswordHint}</p>
          <LabeledField htmlFor="settings-current-password" label={c.currentPassword}>
            <PasswordInput id="settings-current-password" name="currentPassword" autoComplete="current-password" value={current} onChange={(event) => setCurrent(event.target.value)} disabled={pending} />
          </LabeledField>
          <LabeledField htmlFor="settings-new-password" label={c.newPassword}>
            <PasswordInput id="settings-new-password" name="newPassword" autoComplete="new-password" value={next} onChange={(event) => setNext(event.target.value)} disabled={pending} />
          </LabeledField>
          <PasswordStrengthMeter value={next} context={context} />
          <LabeledField htmlFor="settings-confirm-password" label={c.confirmNewPassword} error={mismatch ? t("installerSecurity.error.passwordMismatch") : undefined}>
            <PasswordInput id="settings-confirm-password" name="confirmNewPassword" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} disabled={pending} aria-invalid={mismatch || undefined} />
          </LabeledField>
          {failure ? <p role="alert" className="text-label text-danger" data-testid="password-change-error">{failure}</p> : null}
          <div className="flex flex-wrap items-center gap-sm">
            <Button type="submit" disabled={!canSubmit} aria-busy={pending}>{pending ? c.changingPassword : c.submitPassword}</Button>
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setOpen(false);
                setCurrent("");
                setNext("");
                setConfirm("");
              }}
            >
              {c.cancel}
            </Button>
          </div>
        </form>
      ) : null}
    </>
  );
}
