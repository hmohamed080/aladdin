"use client";

import { useActionState } from "react";
import { Input, LabeledField } from "@/components/ui/controls";
import { InlineSuccess } from "@/components/ui/primitives";
import { setUsernameAction, type IdentityFieldState } from "@/server/actions/profile-identity";

const INITIAL: IdentityFieldState = { ok: false };

export type UsernameLabels = { username: string; saved: string; unavailable: string; invalid: string };

/** Username. Saved by the page-end button (see SettingsSaveBar), which submits this form by id. */
export function UsernameForm({ username, labels }: { username: string | null; labels: UsernameLabels }) {
  const [state, submit] = useActionState(setUsernameAction, INITIAL);
  const error = !state.ok && state.code ? (state.code.endsWith("unavailable") ? labels.unavailable : labels.invalid) : undefined;
  return (
    <form action={submit} id="username" className="engineer-username-form">
      <LabeledField label={labels.username} htmlFor="settings-username" error={error}>
        <Input id="settings-username" name="username" defaultValue={username ?? ""} dir="ltr" minLength={3} maxLength={24} autoComplete="username" autoCapitalize="none" spellCheck={false} />
      </LabeledField>
      {state.ok ? <InlineSuccess>{labels.saved}</InlineSuccess> : null}
      <button type="submit" hidden />
    </form>
  );
}
