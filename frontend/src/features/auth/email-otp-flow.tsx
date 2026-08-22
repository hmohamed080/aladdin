"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n/context";
import type { AuthState } from "@/server/actions/auth";
import { Input, LabeledField, SubmitButton, Button, Checkbox } from "@/components/ui/controls";

const initial: AuthState = { ok: false };
const RESEND_COOLDOWN_SECONDS = 30;

type SendAction = (prev: AuthState, formData: FormData) => Promise<AuthState>;

/**
 * The one shared passwordless Email-OTP flow used by Sign In, Sign Up, and
 * Recovery. Two SIBLING forms (never nested — nested <form> is invalid HTML): a
 * send form and a verify form, with a plain "use a different email" button and a
 * cooldown-gated resend. Sign Up additionally renders the required consent block
 * inside the send form and gates sending on all three boxes being checked; that
 * checkbox state is controlled, so it survives a failed send. Behavior parity with
 * the original sign-in form is preserved — only the surrounding chrome differs.
 */
export function EmailOtpFlow({
  sendAction,
  verifyAction,
  sendLabel,
  sendingLabel,
  next,
  consent = false,
  note,
  footer,
}: {
  sendAction: SendAction;
  verifyAction: SendAction;
  sendLabel: string;
  sendingLabel: string;
  next?: string;
  consent?: boolean;
  note?: string;
  footer?: ReactNode;
}) {
  const { t } = useI18n();
  const [sendState, dispatchSend] = useActionState(sendAction, initial);
  const [verifyState, dispatchVerify] = useActionState(verifyAction, initial);

  const [editingEmail, setEditingEmail] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  // Controlled consent so entries survive an expected validation error (sign-up).
  const [consents, setConsents] = useState({ terms: false, privacy: false, pilot: false });

  const emailRef = useRef<HTMLInputElement>(null);
  const tokenRef = useRef<HTMLInputElement>(null);

  const codeSent = sendState.ok && !editingEmail;
  const email = sendState.email ?? "";
  const allConsented = !consent || (consents.terms && consents.privacy && consents.pilot);

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
    if (codeSent) tokenRef.current?.focus();
    else if (editingEmail) emailRef.current?.focus();
  }, [codeSent, editingEmail]);

  return !codeSent ? (
    <form action={dispatchSend} className="flex flex-col gap-md" noValidate>
      <LabeledField
        label={t("auth.emailLabel")}
        htmlFor="email"
        error={sendState.code === "auth.error.invalidEmail" || sendState.code === "auth.error.sendFailed" ? t(sendState.code) : undefined}
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
          placeholder={t("auth.emailPlaceholder")}
          aria-invalid={sendState.code === "auth.error.invalidEmail" ? true : undefined}
        />
      </LabeledField>

      {consent ? (
        <fieldset className="flex flex-col gap-2.5 rounded-md border border-strong/70 bg-surface-2/40 p-md">
          <legend className="px-1 text-label font-medium text-fg-secondary">{t("auth.consent.heading")}</legend>
          <Checkbox id="consent_terms" name="consent_terms" checked={consents.terms} onChange={(v) => setConsents((c) => ({ ...c, terms: v }))}>
            {t("auth.consent.terms")}
          </Checkbox>
          <Checkbox id="consent_privacy" name="consent_privacy" checked={consents.privacy} onChange={(v) => setConsents((c) => ({ ...c, privacy: v }))}>
            {t("auth.consent.privacy")}
          </Checkbox>
          <Checkbox id="consent_pilot" name="consent_pilot" checked={consents.pilot} onChange={(v) => setConsents((c) => ({ ...c, pilot: v }))}>
            {t("auth.consent.pilot")}
          </Checkbox>
          {sendState.code === "auth.error.consentRequired" ? (
            <p role="alert" className="text-label text-danger">{t("auth.error.consentRequired")}</p>
          ) : (
            <p className="text-label text-fg-muted">{t("auth.consent.note")}</p>
          )}
        </fieldset>
      ) : null}

      <SubmitButton className="w-full" pendingLabel={sendingLabel} disabled={!allConsented}>
        {sendLabel}
      </SubmitButton>
      {note ? <p className="text-center text-label text-fg-muted">{note}</p> : null}
      {footer}
    </form>
  ) : (
    <div className="flex flex-col gap-md">
      <p role="status" className="rounded-md border border-success/40 bg-success/10 px-md py-2.5 text-body text-success">
        {t("auth.info.codeSent", { email })}
      </p>

      <form action={dispatchVerify} className="flex flex-col gap-md" noValidate>
        <input type="hidden" name="email" value={email} />
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <LabeledField
          label={t("auth.codeLabel")}
          htmlFor="token"
          error={verifyState.code && !verifyState.ok ? t(verifyState.code) : undefined}
        >
          <Input
            ref={tokenRef}
            id="token"
            name="token"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            placeholder={t("auth.codePlaceholder")}
            aria-invalid={verifyState.code && !verifyState.ok ? true : undefined}
            className="text-center font-mono text-title tracking-[0.4em]"
          />
        </LabeledField>
        <SubmitButton className="w-full" pendingLabel={t("auth.verifying")}>{t("auth.verify")}</SubmitButton>
      </form>

      <div className="flex items-center justify-between gap-sm border-t pt-md">
        <form action={dispatchSend}>
          <input type="hidden" name="email" value={email} />
          {/* Preserve accepted consent on resend so sign-up's server re-check passes. */}
          {consent ? (
            <>
              <input type="hidden" name="consent_terms" value="on" />
              <input type="hidden" name="consent_privacy" value="on" />
              <input type="hidden" name="consent_pilot" value="on" />
            </>
          ) : null}
          <ResendButton cooldown={cooldown} />
        </form>
        <Button type="button" variant="ghost" size="sm" onClick={() => setEditingEmail(true)}>
          {t("auth.changeEmail")}
        </Button>
      </div>
    </div>
  );
}

/** Resend control: disabled during the cooldown, showing the remaining seconds. */
function ResendButton({ cooldown }: { cooldown: number }) {
  const { t } = useI18n();
  const waiting = cooldown > 0;
  return (
    <Button type="submit" variant="ghost" size="sm" disabled={waiting}>
      {waiting ? t("auth.resendIn", { seconds: cooldown }) : t("auth.resend")}
    </Button>
  );
}
