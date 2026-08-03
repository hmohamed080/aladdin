"use client";

import { useActionState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { requestEmailOtp, verifyEmailOtp, type AuthState } from "@/server/actions/auth";
import { Card } from "@/components/ui/primitives";
import { Input, LabeledField, SubmitButton, Button } from "@/components/ui/controls";

const initial: AuthState = { ok: false };

/**
 * Two-step passwordless Email-OTP sign-in. Step 1 sends a code; on success we
 * show the code field (step 2). All messages are translation keys resolved in
 * the active locale — Arabic-first. No passwords, no service-role.
 */
export function SignInForm({ next }: { next: string }) {
  const { t } = useI18n();
  const [sendState, sendAction] = useActionState(requestEmailOtp, initial);
  const [verifyState, verifyAction] = useActionState(verifyEmailOtp, initial);

  const codeSent = sendState.ok;
  const email = sendState.email ?? "";

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
              id="email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              placeholder={t("auth.emailPlaceholder")}
              aria-invalid={sendState.code && !sendState.ok ? true : undefined}
            />
          </LabeledField>
          <SubmitButton pendingLabel={t("auth.sending")}>{t("auth.sendCode")}</SubmitButton>
          <p className="text-label text-fg-muted">{t("auth.passwordless")}</p>
        </form>
      ) : (
        <form action={verifyAction} className="flex flex-col gap-md" noValidate>
          <p role="status" className="text-body text-success">
            {t("auth.info.codeSent", { email })}
          </p>
          <input type="hidden" name="email" value={email} />
          <input type="hidden" name="next" value={next} />
          <LabeledField
            label={t("auth.codeLabel")}
            htmlFor="token"
            error={verifyState.code && !verifyState.ok ? t(verifyState.code) : undefined}
          >
            <Input
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
          <form action={sendAction}>
            <input type="hidden" name="email" value={email} />
            <Button type="submit" variant="ghost" className="w-full">
              {t("auth.changeEmail")}
            </Button>
          </form>
        </form>
      )}
    </Card>
  );
}
