"use client";

import { useActionState, useState } from "react";
import { Button, Input, LabeledField, SubmitButton } from "@/components/ui/controls";
import { CheckIcon, MailIcon } from "@/components/ui/icons";
import { InlineError, InlineSuccess } from "@/components/ui/primitives";
import { PasswordInput } from "@/features/auth-password-preview/password-input";
import { useI18n } from "@/lib/i18n/context";
import { removeContactEmailAction, startContactEmailAction, type ContactEmailState } from "@/server/actions/contact-email";
import type { ContactEmailStatus } from "@/server/identity/contact-email";

const INITIAL: ContactEmailState = { ok: false };

/**
 * The optional contact email (never a sign-in identity). Adding or changing it needs the current password and sends a
 * single-use link; the address is verified only when the owner presses Confirm on the link's page. Removing a verified
 * address needs the current password again; cancelling a pending link does not. All state shown is what the database
 * holds (`contact_email_status`) - nothing is displayed as verified that the database did not verify.
 */
export function ContactEmailField({ status, hasPassword }: { status: ContactEmailStatus; hasPassword: boolean }) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [startState, start] = useActionState(startContactEmailAction, INITIAL);
  const [removeState, remove] = useActionState(removeContactEmailAction, INITIAL);
  const [removing, setRemoving] = useState(false);
  // Close a form once ITS action answered with success (the server state is re-read through revalidation).
  const [handled, setHandled] = useState<ContactEmailState[]>([]);
  for (const result of [startState, removeState]) {
    if (result !== INITIAL && result.ok && !handled.includes(result)) {
      setHandled([...handled, result]);
      setEditing(false);
      setRemoving(false);
    }
  }

  const verified = status.status === "verified";
  const pending = status.status === "pending";
  const badge = verified ? t("contactEmail.statusVerified") : pending ? t("contactEmail.statusPending") : t("contactEmail.statusNone");

  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-testid="contact-email-field">
      <span className="text-label font-medium text-fg-secondary">{t("contactEmail.label")}</span>
      <div className="flex min-h-11 flex-wrap items-center gap-sm rounded-md border bg-canvas px-3.5 py-2.5">
        <MailIcon size={18} className="shrink-0" />
        <bdi dir="ltr" className="min-w-0 break-all text-body-lg">{status.email ?? "—"}</bdi>
        <span className="ms-auto flex items-center gap-1 rounded-sm bg-surface-2 px-3 py-1 text-caption" data-testid="contact-email-status">
          {verified ? <CheckIcon size={13} /> : null}
          {badge}
        </span>
      </div>
      <p className="text-label text-fg-secondary">
        {pending && status.email ? t("contactEmail.pendingHint", { email: status.email }) : status.verifiedVia === "auth_email" ? t("contactEmail.viaSignIn") : t("contactEmail.hint")}
      </p>

      <div className="flex flex-wrap gap-sm">
        {!editing ? (
          <Button type="button" variant="outline" size="sm" onClick={() => { setEditing(true); setRemoving(false); }} disabled={!hasPassword} data-testid="contact-email-edit">
            {verified || pending ? t("contactEmail.change") : t("contactEmail.add")}
          </Button>
        ) : null}
        {verified || pending ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => { setRemoving(true); setEditing(false); }} data-testid="contact-email-remove">
            {pending ? t("contactEmail.cancel") : t("contactEmail.remove")}
          </Button>
        ) : null}
      </div>

      {editing ? (
        <form action={start} className="flex flex-col gap-sm rounded-md border p-md" data-testid="contact-email-form">
          <LabeledField htmlFor="contact-email-input" label={t("contactEmail.emailLabel")}>
            <Input id="contact-email-input" name="email" type="email" dir="ltr" autoComplete="email" required maxLength={254} />
          </LabeledField>
          <LabeledField htmlFor="contact-email-password" label={t("contactEmail.passwordLabel")}>
            <PasswordInput id="contact-email-password" name="currentPassword" autoComplete="current-password" required />
          </LabeledField>
          <div className="flex flex-wrap gap-sm">
            <SubmitButton pendingLabel={t("contactEmail.sending")} data-testid="contact-email-send">{t("contactEmail.send")}</SubmitButton>
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>{t("common.cancel")}</Button>
          </div>
        </form>
      ) : null}

      {removing ? (
        <form action={remove} className="flex flex-col gap-sm rounded-md border p-md" data-testid="contact-email-remove-form">
          <input type="hidden" name="verified" value={verified ? "true" : "false"} />
          {verified ? (
            <LabeledField htmlFor="contact-email-remove-password" label={t("contactEmail.passwordLabel")}>
              <PasswordInput id="contact-email-remove-password" name="currentPassword" autoComplete="current-password" required />
            </LabeledField>
          ) : null}
          <div className="flex flex-wrap gap-sm">
            <SubmitButton variant="danger" data-testid="contact-email-remove-submit">{pending ? t("contactEmail.cancel") : t("contactEmail.remove")}</SubmitButton>
            <Button type="button" variant="ghost" onClick={() => setRemoving(false)}>{t("common.cancel")}</Button>
          </div>
        </form>
      ) : null}

      {startState.code ? (startState.ok ? <InlineSuccess>{t(startState.code)}</InlineSuccess> : <InlineError>{t(startState.code)}</InlineError>) : null}
      {removeState.code ? (removeState.ok ? <InlineSuccess>{t(removeState.code)}</InlineSuccess> : <InlineError>{t(removeState.code)}</InlineError>) : null}
    </div>
  );
}
