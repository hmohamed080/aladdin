"use client";

import { startTransition, useActionState, useState, type FormEvent } from "react";
import dynamic from "next/dynamic";
import { Button, LabeledField } from "@/components/ui/controls";
import { CheckIcon } from "@/components/ui/icons";
import { PasswordInput } from "@/features/auth-password-preview/password-input";
import { useI18n } from "@/lib/i18n/context";
import type { CanonicalPhone } from "@/lib/contact/phone";
import { changeInstallerPhone, type InstallerSecurityState } from "@/server/actions/installer-security";
import type { ProductionCopy } from "./production-copy";

// Intl country names differ between Node and browser ICU versions, so the shared control is client-rendered (same as the preview).
const PhoneField = dynamic(() => import("@/features/installer-dashboard-preview/installer-phone-field").then((module) => module.InstallerPhoneField), {
  ssr: false,
  loading: () => <div className="h-11 rounded-md border bg-canvas" aria-busy="true" />,
});

const INITIAL: InstallerSecurityState = { ok: false };

/** "Try again in about N min." from the lockout's retry-after seconds. */
export function retryMessage(template: string, seconds: number | undefined): string {
  if (!seconds || seconds <= 0) return "";
  return template.replace("{minutes}", String(Math.max(1, Math.ceil(seconds / 60))));
}

/**
 * Change the sign-in phone: country + number + the CURRENT password, through the `changeInstallerPhone` Server Action
 * (M2 gate -> M3 journal -> M4 audit). Nothing here decides anything: success is shown only when the action answers `ok`,
 * and the new number stays UNVERIFIED (said out loud). The password is held in memory for the length of one keystroke
 * sequence, handed to the action inside a FormData and cleared immediately - never stored anywhere.
 */
export function PhoneChangePanel({ c }: { c: ProductionCopy }) {
  const { t } = useI18n();
  const [state, dispatch, pending] = useActionState(changeInstallerPhone, INITIAL);
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState<CanonicalPhone | null>(null);
  const [password, setPassword] = useState("");
  // Bumped after a success so the (stateful) phone field unmounts and starts empty next time.
  const [formKey, setFormKey] = useState(0);
  const [handled, setHandled] = useState<InstallerSecurityState | null>(null);

  // A finished attempt: on success close the form and forget the typed number; on failure keep it open for a retry.
  if (state !== handled && state !== INITIAL && !pending) {
    setHandled(state);
    if (state.ok) {
      setOpen(false);
      setPhone(null);
      setFormKey((key) => key + 1);
    }
  }

  const canSubmit = phone !== null && password.length > 0 && !pending;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!phone || password.length === 0 || pending) return;
    const data = new FormData();
    data.set("countryIso2", phone.countryIso2);
    data.set("national", phone.national);
    data.set("currentPassword", password);
    data.set("requestId", globalThis.crypto.randomUUID());
    setPassword(""); // the value now lives only in `data`, which the action consumes
    startTransition(() => dispatch(data));
  };

  const failure = state !== INITIAL && !state.ok && state.code ? `${t(state.code)} ${retryMessage(c.retryAfter, state.retryAfterSeconds)}`.trim() : null;
  const succeeded = !open && state.ok && state.code;

  return (
    <div className="flex min-w-0 flex-col gap-sm tablet:col-span-2">
      {!open ? (
        <Button
          variant="outline"
          className="self-start"
          aria-expanded={false}
          aria-controls="settings-phone-change"
          onClick={() => setOpen(true)}
        >
          {c.changePhone}
        </Button>
      ) : null}
      {succeeded ? (
        <div role="status" className="flex flex-col gap-1 rounded-sm border p-md" data-testid="phone-change-success">
          <p className="flex items-center gap-sm text-body font-medium"><CheckIcon size={18} />{t(state.code!)}</p>
          <p className="text-caption text-fg-secondary">{c.phoneChangedUnverified}</p>
        </div>
      ) : null}
      {open ? (
        <form id="settings-phone-change" key={formKey} onSubmit={submit} className="grid min-w-0 gap-md rounded-sm border p-md" aria-labelledby="settings-phone-change-title" noValidate>
          <div>
            <h3 id="settings-phone-change-title" className="text-body font-semibold text-fg">{c.changePhoneTitle}</h3>
            <p className="mt-1 text-caption text-fg-secondary">{c.changePhoneHint}</p>
          </div>
          <LabeledField htmlFor="settings-new-phone" label={c.newPhone}>
            <PhoneField id="settings-new-phone" defaultCountryIso2="EG" onChange={setPhone} />
          </LabeledField>
          <LabeledField htmlFor="settings-phone-password" label={c.currentPassword}>
            <PasswordInput
              id="settings-phone-password"
              name="currentPassword"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={pending}
            />
          </LabeledField>
          {failure ? <p role="alert" className="text-label text-danger" data-testid="phone-change-error">{failure}</p> : null}
          <div className="flex flex-wrap items-center gap-sm">
            <Button type="submit" disabled={!canSubmit} aria-busy={pending}>{pending ? c.changingPhone : c.confirmPhone}</Button>
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() => {
                setOpen(false);
                setPassword("");
              }}
            >
              {c.cancel}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
