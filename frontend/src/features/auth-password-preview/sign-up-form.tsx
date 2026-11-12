"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { continueToSignIn, forgetPendingRegistration, resendPasswordSignUpCode, verifyPasswordSignUp, type PasswordAuthState } from "@/server/actions/auth-password-preview";
import { requestSignUp, resendPhoneSignUpCode, verifyPhoneSignUp } from "@/server/actions/sign-up";
import type { PhoneSignUpState } from "@/server/auth/phone-sign-up";
import type { OAuthAvailability } from "@/server/auth/entry-oauth";
import { AuthCard } from "@/features/auth/auth-card";
import { EntryOAuthButtons, OrDivider, hasOAuthProvider } from "@/features/entry-auth/oauth-buttons";
import { Input, SubmitButton, ResendButton, Button, Select } from "@/components/ui/controls";
import { OtpInput } from "@/components/ui/otp-input";
import { PasswordInput } from "./password-input";
import { TurnstileWidget } from "./turnstile-widget";
import { DISPLAY_NAME_MAX_LENGTH } from "./password-policy";
import { CHOICES_BY_KEY, REGISTRATION_CHOICE_ORDER } from "@/lib/onboarding/account-types";

const initial: PhoneSignUpState = { ok: false };
const initialEmail: PasswordAuthState = { ok: false };
const RESEND_COOLDOWN_SECONDS = 30;
// The phone verification authority enforces its own resend cooldown (app.phone_verification_config.resend_cooldown, 60 s by default) and
// answers "too many attempts" before that. The button must not re-enable earlier than the authority will accept, so the phone path counts 60 s.
const PHONE_RESEND_COOLDOWN_SECONDS = 60;
const NO_PROVIDERS: OAuthAvailability = { google: false, facebook: false };
const CONSENT_TYPES = ["terms", "privacy", "pilot"] as const;

type Field = "contact" | "password" | "displayName" | "accountType" | "form";

/** Which field a server code belongs to, so the message renders under it. */
function fieldFor(code: string | undefined): Field | null {
  if (!code) return null;
  if (/error\.(contactInvalid|invalidEmail|phoneExists|accountExists|whatsappNumberInvalid|whatsappUnavailable)$/.test(code)) return "contact";
  if (/error\.password/.test(code)) return "password";
  if (/error\.fullName/.test(code)) return "displayName";
  if (/error\.accountTypeRequired$/.test(code)) return "accountType";
  return "form";
}

/** Codes after which the pending phone sign-up is gone and the form must be filled again. */
const PHONE_RESTART_CODES = new Set([
  "authPasswordPreview.error.phoneCodeExpired",
  "authPasswordPreview.error.phoneExists",
]);

/** The two answers that mean "this email / number already has an account" — they carry a way to log in instead. */
const EXISTING_ACCOUNT_CODES = new Set([
  "authPasswordPreview.error.accountExists",
  "authPasswordPreview.error.phoneExists",
]);

function FieldError({ code, contact }: { code?: string; contact?: string }) {
  const { t } = useI18n();
  if (!code) return null;
  if (EXISTING_ACCOUNT_CODES.has(code)) {
    // A warning, not a dead end: one tap takes the person to sign-in with the SAME email / number already filled in (the value rides a
    // short-lived httpOnly cookie through the server action, never the URL).
    return (
      <form action={continueToSignIn} role="alert" data-existing-account className="rounded-md border border-warning/40 bg-warning/10 px-md py-2.5 text-body text-fg">
        <input type="hidden" name="contact" value={contact ?? ""} />
        {t(code)}{" "}
        <button type="submit" className="font-semibold text-accent hover:underline">
          {t("authPasswordPreview.error.existingAccountSignIn")}
        </button>
      </form>
    );
  }
  return <p role="alert" className="text-label text-danger">{t(code)}</p>;
}

/**
 * Registration, Instagram style: Google / Facebook first, then ONE "Mobile
 * number or email" field, password, full name and (unless the landing
 * page already chose it) the account type,
 * and a single agreement line for the three consents. Every account type may use either:
 *
 *   * email → the canonical signUp() + 6-digit EMAIL code (Architecture B,
 *     docs/frontend/auth-password-preview.md); the password goes to signUp()
 *     exactly once and is never re-collected on the code step;
 *   * mobile number → a 6-digit WHATSAPP code (server/auth/phone-sign-up.ts);
 *     the account is created only after the code is verified.
 *
 * The password rules appear only as an error if a password is refused. The
 * three consents are still recorded server-side: submitting the form under
 * the agreement line is the acceptance, and the hidden fields say so.
 *
 * An email or mobile number that already has an account is answered with a
 * warning under the field and a "Log in instead" button (a server action that
 * carries what was typed to /auth/sign-in through an httpOnly cookie, never the
 * URL), so nobody waits for a code that will never come. The email code step
 * keeps the "Forgot password?" way out for the other reasons a code can be late.
 *
 * An unfinished email registration in this browser (`pendingEmail`, the
 * server-side routing cookie) reopens straight on the code step after a refresh
 * or a closed tab; there is no separate "continue registration" page.
 *
 * `next` is set only when the person arrived from an employee invitation
 * (`/auth/invite/...`); it rides the email verify step so a brand-new user
 * returns to the invitation after the code.
 */
export function PasswordSignUpForm({
  initialAccountType = "",
  next,
  providers = NO_PROVIDERS,
  pendingEmail = null,
}: { initialAccountType?: string; next?: string; providers?: OAuthAvailability; pendingEmail?: string | null } = {}) {
  const { t } = useI18n();
  const [sendState, dispatchSend] = useActionState(requestSignUp, initial);
  const [emailResendState, dispatchEmailResend] = useActionState(resendPasswordSignUpCode, initialEmail);
  const [emailVerifyState, dispatchEmailVerify] = useActionState(verifyPasswordSignUp, initialEmail);
  const [phoneResendState, dispatchPhoneResend] = useActionState(resendPhoneSignUpCode, initial);
  const [phoneVerifyState, dispatchPhoneVerify] = useActionState(verifyPhoneSignUp, initial);

  const [editing, setEditing] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [values, setValues] = useState({ contact: "", displayName: "", accountType: initialAccountType });
  const [password, setPassword] = useState("");
  const [restartCode, setRestartCode] = useState<string | undefined>();

  // This browser started an email registration and has not verified it (refresh, closed tab, lost connection): reopen its code step.
  // `pendingEmail` is the server-side httpOnly routing cookie, never the URL; it is only set when a code was really sent.
  const restoredEmail = pendingEmail && !sendState.ok ? pendingEmail : null;
  const codeSent = restoredEmail !== null || (sendState.ok && !editing);
  const channel = restoredEmail ? "email" : (sendState.channel ?? "email");
  const contact = restoredEmail ?? sendState.email ?? "";
  const errorField = fieldFor(sendState.ok ? undefined : sendState.code);
  const errorFor = (field: Field) => (errorField === field ? sendState.code : undefined);
  const set = (key: keyof typeof values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }));

  useEffect(() => {
    if (sendState.ok) {
      setEditing(false);
      setCooldown(sendState.channel === "phone" ? PHONE_RESEND_COOLDOWN_SECONDS : RESEND_COOLDOWN_SECONDS);
      // The password only needs to exist for the ONE submit above.
      setPassword("");
      setRestartCode(undefined);
    }
  }, [sendState]);

  // The pending phone sign-up is gone (expired, or the number was
  // taken meanwhile): back to the filled-in form, with the reason on top.
  useEffect(() => {
    if (phoneVerifyState.code && PHONE_RESTART_CODES.has(phoneVerifyState.code)) {
      setRestartCode(phoneVerifyState.code);
      setEditing(true);
    }
  }, [phoneVerifyState]);

  useEffect(() => {
    if (phoneResendState.ok) setCooldown(PHONE_RESEND_COOLDOWN_SECONDS);
    else if (emailResendState.ok) setCooldown(RESEND_COOLDOWN_SECONDS);
  }, [emailResendState, phoneResendState]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const footer = (
    <p>
      {t("authPasswordPreview.signUp.haveAccount")}{" "}
      <Link href="/auth/sign-in" className="font-semibold text-accent hover:underline">
        {t("authPasswordPreview.signUp.signInLink")}
      </Link>
    </p>
  );
  const badge = initialAccountType
    ? `${t("authPasswordPreview.accountTypeLocked")}: ${t(`onboarding.accountType.types.${initialAccountType}`)}`
    : undefined;

  if (codeSent) {
    return (
      <AuthCard
        centered
        title={t(channel === "phone" ? "authPasswordPreview.signUp.codeStepPhoneTitle" : "authPasswordPreview.signUp.codeStepTitle")}
        subtitle={channel === "phone" ? t("authPasswordPreview.signUp.codeStepPhone", { phone: contact }) : t("authPasswordPreview.signUp.codeStepSubtitle", { email: contact })}
        badge={badge}
        footer={footer}
      >
        {channel === "phone" ? (
          <div className="flex flex-col gap-md" data-sign-up-step="phone-code">
            <form action={dispatchPhoneVerify} className="flex flex-col gap-sm" noValidate>
              <label htmlFor="token" className="sr-only">{t("authPasswordPreview.codeLabel")}</label>
              <OtpInput id="token" name="token" autoFocus error={Boolean(phoneVerifyState.code)} />
              <FieldError code={phoneVerifyState.code} />
              {/* The account's first password sign-in is CAPTCHA-protected by GoTrue. */}
              <TurnstileWidget action="phone-sign-up-session" appearance="interaction-only" resetKey={phoneVerifyState} />
              <SubmitButton className="w-full" pendingLabel={t("authPasswordPreview.signUp.verifying")}>
                {t("authPasswordPreview.signUp.verify")}
              </SubmitButton>
            </form>
            <div className="flex flex-wrap items-center justify-between gap-sm border-t pt-md">
              <form action={dispatchPhoneResend} className="flex flex-wrap items-center gap-sm">
                <TurnstileWidget action="sign-up-resend" appearance="interaction-only" resetKey={phoneResendState} />
                <ResendButton cooldown={cooldown} />
              </form>
              <Button type="button" variant="ghost" size="sm" className="whitespace-nowrap" onClick={() => setEditing(true)}>
                {t("authPasswordPreview.signUp.startOver")}
              </Button>
            </div>
            {phoneResendState.code && !phoneResendState.ok ? <FieldError code={phoneResendState.code} /> : null}
          </div>
        ) : (
          <div className="flex flex-col gap-md" data-sign-up-step="email-code">
            {/* No password field exists on this step — verifyPasswordSignUp only
                takes the email + the 6-digit code. */}
            <form action={dispatchEmailVerify} className="flex flex-col gap-sm" noValidate>
              <input type="hidden" name="email" value={contact} />
              {next ? <input type="hidden" name="next" value={next} /> : null}
              <label htmlFor="token" className="sr-only">{t("authPasswordPreview.codeLabel")}</label>
              <OtpInput id="token" name="token" autoFocus error={Boolean(emailVerifyState.code) && !emailVerifyState.ok} />
              {emailVerifyState.code && !emailVerifyState.ok ? <FieldError code={emailVerifyState.code} /> : null}
              <SubmitButton className="w-full" pendingLabel={t("authPasswordPreview.signUp.verifying")}>
                {t("authPasswordPreview.signUp.verify")}
              </SubmitButton>
            </form>
            <div className="flex flex-wrap items-center justify-between gap-sm border-t pt-md">
              <form action={dispatchEmailResend} className="flex flex-wrap items-center gap-sm">
                <input type="hidden" name="email" value={contact} />
                <TurnstileWidget action="sign-up-resend" resetKey={emailResendState} />
                <ResendButton cooldown={cooldown} />
              </form>
              {restoredEmail ? (
                /* Restored from the routing cookie: forget it and show a clean form (nothing server-side changes). */
                <form action={forgetPendingRegistration}>
                  <Button type="submit" variant="ghost" size="sm" className="whitespace-nowrap">
                    {t("authPasswordPreview.changeEmail")}
                  </Button>
                </form>
              ) : (
                <Button type="button" variant="ghost" size="sm" className="whitespace-nowrap" onClick={() => setEditing(true)}>
                  {t("authPasswordPreview.changeEmail")}
                </Button>
              )}
            </div>
            {/* Never leave the caller waiting on a code GoTrue never sent (an
                already-confirmed email): a neutral way out. */}
            <p className="text-label text-fg-muted">
              {t("authPasswordPreview.signUp.noCodeHint")}{" "}
              <Link href="/auth/forgot-password" className="font-medium text-accent hover:underline">
                {t("authPasswordPreview.signIn.forgotPassword")}
              </Link>
            </p>
          </div>
        )}
      </AuthCard>
    );
  }

  return (
    <AuthCard centered title={t("authPasswordPreview.signUp.title")} subtitle={t("authPasswordPreview.signUp.subtitle")} badge={badge} footer={footer}>
      {hasOAuthProvider(providers) ? (
        <>
          <EntryOAuthButtons next={next} accountType={initialAccountType || undefined} providers={providers} />
          <OrDivider label={t("authPasswordPreview.signUp.or")} />
        </>
      ) : null}

      <form action={dispatchSend} className="flex flex-col gap-sm" noValidate data-sign-up-step="details">
        <FieldError code={restartCode} contact={values.contact} />

        <label htmlFor="contact" className="sr-only">{t("authPasswordPreview.signUp.contactLabel")}</label>
        <Input
          id="contact"
          name="contact"
          type="text"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          dir="ltr"
          required
          value={values.contact}
          onChange={set("contact")}
          placeholder={t("authPasswordPreview.signUp.contactLabel")}
          aria-invalid={errorField === "contact" || undefined}
        />
        <FieldError code={errorFor("contact")} contact={values.contact} />

        <label htmlFor="password" className="sr-only">{t("authPasswordPreview.passwordLabel")}</label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t("authPasswordPreview.passwordLabel")}
          aria-invalid={errorField === "password" || undefined}
        />
        <FieldError code={errorFor("password")} />

        <label htmlFor="displayName" className="sr-only">{t("authPasswordPreview.fullNameLabel")}</label>
        <Input
          id="displayName"
          name="displayName"
          type="text"
          autoComplete="name"
          required
          maxLength={DISPLAY_NAME_MAX_LENGTH}
          value={values.displayName}
          onChange={set("displayName")}
          placeholder={t("authPasswordPreview.fullNameLabel")}
          aria-invalid={errorField === "displayName" || undefined}
        />
        <FieldError code={errorFor("displayName")} />

        {initialAccountType ? (
          /* Type chosen on the landing page: no selector (the badge names it);
             the server action still validates the key. */
          <input type="hidden" name="accountType" value={initialAccountType} />
        ) : (
          <>
            <label htmlFor="accountType" className="sr-only">{t("authPasswordPreview.accountTypeLabel")}</label>
            {/* One dropdown over the ordered registration taxonomy. Coming Soon
                types stay visible but disabled; the server re-checks every key. */}
            <Select
              id="accountType"
              name="accountType"
              required
              value={values.accountType}
              onChange={set("accountType")}
              aria-invalid={errorField === "accountType" || undefined}
            >
              <option value="" disabled>
                {t("authPasswordPreview.accountTypePlaceholder")}
              </option>
              {REGISTRATION_CHOICE_ORDER.map((key) => {
                const comingSoon = CHOICES_BY_KEY[key]?.comingSoon === true;
                const label = t(`onboarding.accountType.types.${key}`);
                return (
                  <option key={key} value={key} disabled={comingSoon}>
                    {comingSoon ? t("authPasswordPreview.accountTypeComingSoonOption", { label }) : label}
                  </option>
                );
              })}
            </Select>
            <FieldError code={errorFor("accountType")} />
          </>
        )}

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

        {/* An email sign-up hands this token to GoTrue's signUp(); a mobile
            sign-up checks it with Siteverify before any WhatsApp code is sent. */}
        <TurnstileWidget action="sign-up" resetKey={sendState} />
        <FieldError code={errorFor("form")} />

        <SubmitButton className="w-full" pendingLabel={t("authPasswordPreview.signUp.submitting")}>
          {t("authPasswordPreview.signUp.submit")}
        </SubmitButton>
      </form>
    </AuthCard>
  );
}
