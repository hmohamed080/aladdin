"use client";

import { useActionState, useEffect, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { Button, Checkbox, Input, LabeledField, ResendButton, SubmitButton } from "@/components/ui/controls";
import { OtpInput } from "@/components/ui/otp-input";
import { PasswordInput } from "@/features/auth-password-preview/password-input";
import { TurnstileWidget } from "@/features/auth-password-preview/turnstile-widget";
import { emailSchema, loginPasswordSchema } from "@/features/auth-password-preview/password-policy";
import { IconField, PasswordField } from "@/features/installer-phone-auth/fields";
import { LockIcon, UserIcon } from "@/features/installer-phone-auth/icons";
import { parseFullName } from "@/features/installer-phone-auth/validation";
import { resendPasswordSignUpCode, verifyPasswordSignUp, type PasswordAuthState } from "@/server/actions/auth-password-preview";
import { craftsmanEmailSignIn, craftsmanEmailSignUp } from "@/server/actions/installer-phone-auth";
import { showroomEmailSignIn, showroomEmailSignUp } from "@/server/actions/showroom-phone-auth";
import type { CraftsmanAuthState, CraftsmanField } from "@/server/auth/phone-password";
import type { EntryKind } from "@/server/auth/entry-email";
import showroomStyles from "@/features/showroom-auth/showroom-auth.module.css";

const RESEND_COOLDOWN_SECONDS = 30;
const INSTALLER_SUBMIT =
  "mt-sm min-h-14 w-full rounded-lg bg-shell text-body-lg font-semibold text-shell-fg shadow-card hover:opacity-90 tablet:min-h-16 tablet:text-title dark:bg-primary dark:text-primary-foreground";

const MailIcon = () => (
  <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="m3 7 9 6 9-6" />
  </svg>
);

type Errors = Partial<Record<CraftsmanField, string>>;

/**
 * One text field in the page's own look: the Showroom pages use the canonical
 * labelled control, the Installer pages their approved boxed field.
 */
function Field({
  kind,
  id,
  name,
  label,
  icon,
  error,
  hint,
  password,
  ...input
}: {
  kind: EntryKind;
  id: string;
  name: string;
  label: string;
  icon: ReactNode;
  error?: string;
  hint?: string;
  password?: boolean;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "id" | "name">) {
  if (kind === "installer") {
    return password ? (
      <PasswordField id={id} name={name} label={label} error={error} hint={hint} {...input} />
    ) : (
      <IconField id={id} name={name} label={label} icon={icon} error={error} hint={hint} {...input} />
    );
  }
  return (
    <LabeledField label={label} htmlFor={id} hint={error ? undefined : hint} error={error}>
      {password ? (
        <PasswordInput id={id} name={name} leadingIcon={<LockIcon />} aria-invalid={error ? true : undefined} {...input} />
      ) : (
        <Input id={id} name={name} aria-invalid={error ? true : undefined} {...input} />
      )}
    </LabeledField>
  );
}

function FormError({ kind, message }: { kind: EntryKind; message?: string }) {
  if (!message) return null;
  return kind === "showroom" ? (
    <p role="alert" className={showroomStyles.error}>
      {message}
    </p>
  ) : (
    <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-md py-2.5 text-body text-danger">
      {message}
    </p>
  );
}

function submitLabels(kind: EntryKind, signUp: boolean) {
  if (kind === "showroom") return { label: signUp ? "showroomAuth.signUp" : "showroomAuth.signIn", pending: "showroomAuth.pending" };
  return signUp
    ? { label: "temporaryCraftsman.signUp.submit", pending: "temporaryCraftsman.signUp.submitting" }
    : { label: "temporaryCraftsman.signIn.submit", pending: "temporaryCraftsman.signIn.submitting" };
}

// ---------------------------------------------------------------------------
// Sign in — email + password
// ---------------------------------------------------------------------------
const signInInitial: CraftsmanAuthState = { ok: false };

export function EntryEmailSignInForm({ kind, next }: { kind: EntryKind; next: string }) {
  const { t } = useI18n();
  const [state, dispatch] = useActionState(kind === "showroom" ? showroomEmailSignIn : craftsmanEmailSignIn, signInInitial);
  const [clientErrors, setClientErrors] = useState<Errors>({});
  const [lastState, setLastState] = useState(state);
  if (state !== lastState) {
    setLastState(state);
    setClientErrors({});
  }
  const errors: Errors = Object.keys(clientErrors).length ? clientErrors : state.code && state.field ? { [state.field]: state.code } : {};
  const message = (field: CraftsmanField) => (errors[field] ? t(errors[field]!) : undefined);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const data = new FormData(event.currentTarget);
    const failures: Errors = {};
    if (!emailSchema.safeParse(data.get("email")).success) failures.email = "entryAuth.error.emailInvalid";
    const password = data.get("password");
    if (typeof password !== "string" || password.length === 0) failures.password = "temporaryCraftsman.error.passwordRequired";
    else if (!loginPasswordSchema.safeParse(password).success) failures.password = "temporaryCraftsman.error.passwordTooLong";
    setClientErrors(failures);
    if (Object.keys(failures).length) event.preventDefault();
  }

  const labels = submitLabels(kind, false);
  return (
    <form action={dispatch} onSubmit={onSubmit} noValidate className={kind === "showroom" ? showroomStyles.form : "flex flex-col gap-md"} data-entry-email-form="signIn">
      <input type="hidden" name="next" value={next} />
      <FormError kind={kind} message={message("form")} />
      <Field kind={kind} id={`${kind}-email`} name="email" type="email" inputMode="email" autoComplete="email" dir="ltr" required label={t("entryAuth.emailLabel")} placeholder={t("entryAuth.emailPlaceholder")} icon={<MailIcon />} defaultValue={state.values?.email ?? ""} error={message("email")} />
      <Field kind={kind} id={`${kind}-email-password`} name="password" password autoComplete="current-password" required label={t("showroomAuth.password")} placeholder={t("showroomAuth.passwordPlaceholder")} icon={<LockIcon />} error={message("password")} />
      <TurnstileWidget name="captchaToken" action="sign-in" appearance="interaction-only" resetKey={state} />
      <FormError kind={kind} message={message("captcha")} />
      <SubmitButton className={kind === "showroom" ? showroomStyles.submit : INSTALLER_SUBMIT} pendingLabel={t(labels.pending)}>
        {t(labels.label)}
      </SubmitButton>
      <p className="text-center text-label text-fg-muted">
        <Link href="/auth/forgot-password" className="underline underline-offset-4">
          {t("authPasswordPreview.signIn.forgotPassword")}
        </Link>
      </p>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Sign up — name + email + password + consent, then the 6-digit email code
// ---------------------------------------------------------------------------
const signUpInitial: PasswordAuthState = { ok: false };

/** Which field a canonical registration error belongs to. */
export function signUpErrorField(code: string | undefined): CraftsmanField | null {
  if (!code) return null;
  if (code.includes("fullName") || code.includes("nameRequired") || code.includes("nameTooLong")) return "name";
  if (code.includes("Email") || code.includes("emailInvalid")) return "email";
  if (code.includes("passwordMismatch")) return "confirmPassword";
  if (code.includes(".password") || code.includes("error.password")) return "password";
  if (code.includes("consent")) return "consent";
  if (code.includes("captcha")) return "captcha";
  return "form";
}

export function EntryEmailSignUpForm({ kind }: { kind: EntryKind }) {
  const { t } = useI18n();
  const [sendState, dispatchSend] = useActionState(kind === "showroom" ? showroomEmailSignUp : craftsmanEmailSignUp, signUpInitial);
  const [resendState, dispatchResend] = useActionState(resendPasswordSignUpCode, signUpInitial);
  const [verifyState, dispatchVerify] = useActionState(verifyPasswordSignUp, signUpInitial);
  const [editing, setEditing] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [consented, setConsented] = useState(false);
  const [clientErrors, setClientErrors] = useState<Errors>({});
  const [lastState, setLastState] = useState(sendState);
  if (sendState !== lastState) {
    setLastState(sendState);
    setClientErrors({});
  }

  useEffect(() => {
    if (sendState.ok) {
      setEditing(false);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    }
  }, [sendState]);
  useEffect(() => {
    if (resendState.ok) setCooldown(RESEND_COOLDOWN_SECONDS);
  }, [resendState]);
  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const serverField = !sendState.ok ? signUpErrorField(sendState.code) : null;
  const errors: Errors = Object.keys(clientErrors).length ? clientErrors : serverField && sendState.code ? { [serverField]: sendState.code } : {};
  const message = (field: CraftsmanField) => (errors[field] ? t(errors[field]!) : undefined);
  const email = sendState.email ?? "";
  const labels = submitLabels(kind, true);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const data = new FormData(event.currentTarget);
    const failures: Errors = {};
    const name = parseFullName(data.get("name"));
    if (!name.ok) failures.name = name.code;
    if (!emailSchema.safeParse(data.get("email")).success) failures.email = "entryAuth.error.emailInvalid";
    const password = data.get("password");
    if (typeof password !== "string" || password.length === 0) failures.password = "temporaryCraftsman.error.passwordRequired";
    if (data.get("confirmPassword") !== password) failures.confirmPassword = "temporaryCraftsman.error.passwordMismatch";
    if (!consented) failures.consent = "temporaryCraftsman.error.consentRequired";
    setClientErrors(failures);
    if (Object.keys(failures).length) event.preventDefault();
  }

  if (sendState.ok && !editing) {
    return (
      <div className="flex flex-col gap-md" data-entry-email-form="verify">
        <p role="status" className="rounded-md border border-success/40 bg-success/10 px-md py-2.5 text-body text-success">
          {t("entryAuth.codeSent", { email })}
        </p>
        <form action={dispatchVerify} className="flex flex-col gap-md" noValidate>
          <input type="hidden" name="email" value={email} />
          <LabeledField label={t("entryAuth.codeLabel")} htmlFor={`${kind}-email-code`} error={verifyState.code && !verifyState.ok ? t(verifyState.code) : undefined}>
            <div dir="ltr">
              <OtpInput id={`${kind}-email-code`} name="token" autoFocus error={Boolean(verifyState.code) && !verifyState.ok} />
            </div>
          </LabeledField>
          <SubmitButton className={kind === "showroom" ? showroomStyles.submit : INSTALLER_SUBMIT} pendingLabel={t("entryAuth.verifying")}>
            {t("entryAuth.verify")}
          </SubmitButton>
        </form>
        <div className="flex items-center justify-between gap-sm border-t pt-md">
          <form action={dispatchResend} className="flex items-center gap-sm">
            <input type="hidden" name="email" value={email} />
            <TurnstileWidget action="sign-up-resend" resetKey={resendState} />
            <ResendButton cooldown={cooldown} />
          </form>
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>
            {t("entryAuth.changeEmail")}
          </Button>
        </div>
        {resendState.code && !resendState.ok ? <FormError kind={kind} message={t(resendState.code)} /> : null}
        <p className="text-label text-fg-muted">{t("entryAuth.noCodeHint")}</p>
      </div>
    );
  }

  return (
    <form action={dispatchSend} onSubmit={onSubmit} noValidate className={kind === "showroom" ? showroomStyles.form : "flex flex-col gap-md"} data-entry-email-form="signUp">
      <input type="hidden" name="consent" value={consented ? "on" : ""} />
      <FormError kind={kind} message={message("form")} />
      <Field kind={kind} id={`${kind}-email-name`} name="name" autoComplete="name" required maxLength={80} label={t("temporaryCraftsman.fields.nameLabel")} placeholder={t("showroomAuth.namePlaceholder")} icon={<UserIcon />} error={message("name")} />
      <Field kind={kind} id={`${kind}-email`} name="email" type="email" inputMode="email" autoComplete="email" dir="ltr" required label={t("entryAuth.emailLabel")} placeholder={t("entryAuth.emailPlaceholder")} icon={<MailIcon />} defaultValue={email} error={message("email")} />
      <Field kind={kind} id={`${kind}-email-password`} name="password" password autoComplete="new-password" required label={t("showroomAuth.password")} placeholder={t("showroomAuth.passwordPlaceholder")} icon={<LockIcon />} hint={t("showroomAuth.passwordPolicy")} error={message("password")} />
      <Field kind={kind} id={`${kind}-email-confirm`} name="confirmPassword" password autoComplete="new-password" required label={t("showroomAuth.confirmPassword")} placeholder={t("showroomAuth.confirmPlaceholder")} icon={<LockIcon />} error={message("confirmPassword")} />
      <div>
        <Checkbox id={`${kind}-email-consent`} name="consent-choice" checked={consented} onChange={setConsented}>
          {t("showroomAuth.agree")}{" "}
          <Link href="/legal/terms" target="_blank" className="underline underline-offset-4">
            {t("showroomAuth.terms")}
          </Link>{" "}
          {t("showroomAuth.and")}{" "}
          <Link href="/legal/privacy" target="_blank" className="underline underline-offset-4">
            {t("showroomAuth.privacy")}
          </Link>
        </Checkbox>
        {message("consent") ? (
          <p role="alert" className="text-label text-danger">
            {message("consent")}
          </p>
        ) : null}
      </div>
      <TurnstileWidget action="sign-up" resetKey={sendState} />
      <FormError kind={kind} message={message("captcha")} />
      <SubmitButton className={kind === "showroom" ? showroomStyles.submit : INSTALLER_SUBMIT} pendingLabel={t(labels.pending)}>
        {t(labels.label)}
      </SubmitButton>
    </form>
  );
}
