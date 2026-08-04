"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { requestEmailOtp, verifyEmailOtp, type AuthState } from "@/server/actions/auth";
import { Card } from "@/components/ui/primitives";
import { Input, LabeledField, SubmitButton, Button } from "@/components/ui/controls";

const initial: AuthState = { ok: false };
const RESEND_COOLDOWN_SECONDS = 30;

/**
 * Two-step passwordless Email-OTP sign-in. Step 1 sends a code; on success we
 * show the code field (step 2). All messages are translation keys resolved in
 * the active locale — Arabic-first. No passwords, no service-role.
 *
 * The two steps are SIBLING forms (never nested — nested <form> is invalid HTML
 * and makes submission browser-dependent). "Use a different email" is a plain
 * button that resets the UI to step 1; "Resend" re-triggers the send form with a
 * cooldown so the public endpoint can't be hammered.
 */
export function SignInForm({ next }: { next: string }) {
  const { t } = useI18n();
  const [sendState, sendAction] = useActionState(requestEmailOtp, initial);
  const [verifyState, verifyAction] = useActionState(verifyEmailOtp, initial);

  // When true, we force step 1 even though a code was already sent, so the user
  // can correct the address. Cleared automatically once a new code is sent.
  const [editingEmail, setEditingEmail] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const emailRef = useRef<HTMLInputElement>(null);
  const tokenRef = useRef<HTMLInputElement>(null);

  const codeSent = sendState.ok && !editingEmail;
  const email = sendState.email ?? "";

  // A fresh successful send clears the "editing" override and starts the resend
  // cooldown. `sendState` is a new object per dispatch, so this fires each send.
  useEffect(() => {
    if (sendState.ok) {
      setEditingEmail(false);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    }
  }, [sendState]);

  // Count the resend cooldown down to zero.
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  // Move focus to the field that matters for the current step (screen-reader +
  // keyboard users land where they can act).
  useEffect(() => {
    if (codeSent) tokenRef.current?.focus();
    else if (editingEmail) emailRef.current?.focus();
  }, [codeSent, editingEmail]);

  function handleChangeEmail() {
    setEditingEmail(true);
    // focus is moved by the effect above once step 1 re-renders.
  }

  return (
    <Card className="flex flex-col gap-md">
      <div className="flex flex-col gap-1">
        <h1 className="font-display-ar text-title text-fg">{t("auth.title")}</h1>
        <p className="text-body text-fg-secondary">{t("auth.subtitle")}</p>
      </div>

      {!codeSent ? (
        <form action={sendAction} className="flex flex-col gap-md" noValidate>
          <LabeledField
            label={t("auth.emailLabel")}
            htmlFor="email"
            error={sendState.code && !sendState.ok ? t(sendState.code) : undefined}
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
              aria-invalid={sendState.code && !sendState.ok ? true : undefined}
            />
          </LabeledField>
          <SubmitButton pendingLabel={t("auth.sending")}>{t("auth.sendCode")}</SubmitButton>
          <p className="text-label text-fg-muted">{t("auth.passwordless")}</p>
        </form>
      ) : (
        // Sibling forms + a plain button — NOT nested. The verify form submits the
        // OTP only; the resend form re-sends; the change-email button resets.
        <div className="flex flex-col gap-md">
          <p role="status" className="text-body text-success">
            {t("auth.info.codeSent", { email })}
          </p>

          <form action={verifyAction} className="flex flex-col gap-md" noValidate>
            <input type="hidden" name="email" value={email} />
            <input type="hidden" name="next" value={next} />
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
              />
            </LabeledField>
            <SubmitButton pendingLabel={t("auth.verifying")}>{t("auth.verify")}</SubmitButton>
          </form>

          <div className="flex items-center justify-between gap-sm">
            <form action={sendAction}>
              <input type="hidden" name="email" value={email} />
              <ResendButton cooldown={cooldown} />
            </form>
            <Button type="button" variant="ghost" onClick={handleChangeEmail}>
              {t("auth.changeEmail")}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

/** Resend control: disabled during the cooldown, showing the remaining seconds. */
function ResendButton({ cooldown }: { cooldown: number }) {
  const { t } = useI18n();
  const waiting = cooldown > 0;
  return (
    <Button type="submit" variant="ghost" disabled={waiting}>
      {waiting ? t("auth.resendIn", { seconds: String(cooldown) }) : t("auth.resend")}
    </Button>
  );
}
