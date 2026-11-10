"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { AuthCard } from "@/features/auth/auth-card";
import { Input, SubmitButton } from "@/components/ui/controls";
import { OtpInput } from "@/components/ui/otp-input";
import { PasswordInput } from "@/features/auth-password-preview/password-input";
import { TurnstileWidget } from "@/features/auth-password-preview/turnstile-widget";
import { DISPLAY_NAME_MAX_LENGTH } from "@/features/auth-password-preview/password-policy";
import { isAgeNotConfirmedCode, useAgeConfirmation } from "@/features/auth-password-preview/age-confirm-checkbox";
import { requestStaffSignUp, verifyStaffSignUp, type StaffInvitationState } from "@/server/actions/staff-invitation";

const CONSENT_TYPES = ["terms", "privacy", "pilot"] as const;
const initial: StaffInvitationState = { ok: false };

function FieldError({ code }: { code?: string }) {
  const { t } = useI18n();
  return code ? (
    <p role="alert" className="text-label text-danger">
      {t(code)}
    </p>
  ) : null;
}

/**
 * Registration for an invited staff member. The same fields, rules, CAPTCHA and 6-digit e-mail code as marketplace sign-up, minus the
 * account type: a staff account never gets a marketplace persona. The invitation token is not a field here; the server
 * reads it from its httpOnly handoff cookie, so nothing sensitive lives in this form or in the URL.
 */
export function StaffRegisterForm() {
  const { t } = useI18n();
  const [sendState, dispatchSend] = useActionState(requestStaffSignUp, initial);
  const [verifyState, dispatchVerify] = useActionState(verifyStaffSignUp, initial);
  const [password, setPassword] = useState("");
  const emailForCode = sendState.ok ? sendState.email : undefined;
  const age = useAgeConfirmation(sendState.ok ? undefined : sendState.code);

  if (emailForCode) {
    return (
      <AuthCard title={t("authPasswordPreview.signUp.codeStepTitle")} subtitle={t("authPasswordPreview.signUp.codeStepSubtitle", { email: emailForCode })}>
        <form action={dispatchVerify} className="flex flex-col gap-sm" noValidate data-staff-step="code">
          <input type="hidden" name="email" value={emailForCode} />
          <label htmlFor="token" className="sr-only">
            {t("authPasswordPreview.codeLabel")}
          </label>
          <OtpInput id="token" name="token" autoFocus error={Boolean(verifyState.code) && !verifyState.ok} />
          <FieldError code={!verifyState.ok ? verifyState.code : undefined} />
          <SubmitButton className="w-full" pendingLabel={t("authPasswordPreview.signUp.verifying")}>
            {t("authPasswordPreview.signUp.verify")}
          </SubmitButton>
        </form>
        <p className="mt-md text-label text-fg-muted">{t("staffInvitation.register.existingHint")}</p>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t("staffInvitation.register.title")} subtitle={t("staffInvitation.register.intro")}>
      <form action={dispatchSend} onSubmit={age.guardSubmit} className="flex flex-col gap-sm" noValidate data-staff-step="details">
        <label htmlFor="email" className="sr-only">
          {t("authPasswordPreview.signUp.contactLabel")}
        </label>
        <Input
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          dir="ltr"
          required
          defaultValue={sendState.email ?? ""}
          placeholder={t("authPasswordPreview.signUp.contactLabel")}
        />
        <label htmlFor="password" className="sr-only">
          {t("authPasswordPreview.passwordLabel")}
        </label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t("authPasswordPreview.passwordLabel")}
        />
        <label htmlFor="displayName" className="sr-only">
          {t("authPasswordPreview.fullNameLabel")}
        </label>
        <Input
          id="displayName"
          name="displayName"
          type="text"
          autoComplete="name"
          required
          maxLength={DISPLAY_NAME_MAX_LENGTH}
          placeholder={t("authPasswordPreview.fullNameLabel")}
        />
        {/* PROPOSED INTERIM, pending legal approval: replaces the retired birth-date fields. */}
        {age.field}
        {CONSENT_TYPES.map((type) => (
          <input key={type} type="hidden" name={`consent_${type}`} value="on" />
        ))}
        <p className="mt-xs text-center text-label text-fg-muted" data-sign-up-agreement>
          {t("authPasswordPreview.signUp.agreementPrefix")}{" "}
          <Link href="/legal/terms" target="_blank" className="font-semibold text-fg-secondary hover:underline">
            {t("entryAuth.terms")}
          </Link>{" "}
          {t("entryAuth.and")}{" "}
          <Link href="/legal/privacy" target="_blank" className="font-semibold text-fg-secondary hover:underline">
            {t("entryAuth.privacy")}
          </Link>
          . {t("authPasswordPreview.signUp.agreementSuffix")}
        </p>
        <TurnstileWidget action="sign-up" resetKey={sendState} />
        <FieldError code={!sendState.ok && !isAgeNotConfirmedCode(sendState.code) ? sendState.code : undefined} />
        <SubmitButton className="w-full" pendingLabel={t("staffInvitation.register.submitting")}>
          {t("staffInvitation.register.submit")}
        </SubmitButton>
        <Link href="/auth/staff-invitation" className="text-center text-label text-fg-muted hover:underline">
          {t("staffInvitation.register.back")}
        </Link>
      </form>
    </AuthCard>
  );
}
