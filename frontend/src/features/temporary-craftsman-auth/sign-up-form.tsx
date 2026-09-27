"use client";

import { useActionState, useState, type FormEvent } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n/context";
import { Checkbox, SubmitButton } from "@/components/ui/controls";
import { TurnstileWidget } from "@/features/auth-password-preview/turnstile-widget";
import { craftsmanSignUp, type CraftsmanAuthState, type CraftsmanField } from "@/server/actions/temporary-craftsman-auth";
import { IconField, PasswordField } from "./fields";
import { PhoneIcon, UserIcon } from "./icons";
import { checkNewPassword, parseFullName, parsePhone } from "./validation";
import { CRAFTSMAN_SIGN_IN_PATH } from "./routes";

const initial: CraftsmanAuthState = { ok: false };
type ClientErrors = Partial<Record<CraftsmanField, string>>;

/**
 * TEMPORARY craftsman sign-up — full name, phone, password, one consent
 * checkbox (covering the three consent receipts the account needs), and the
 * application-scoped Turnstile check. No email, no OTP, no username, no role
 * picker: the server action creates an ordinary installer/technician account.
 *
 * The same rules run here (instant feedback) and again on the server (the
 * authority). The submit button is disabled while the action is pending, so
 * one click is one attempt.
 */
export function CraftsmanSignUpForm() {
  const { t } = useI18n();
  const [state, dispatch] = useActionState(craftsmanSignUp, initial);
  const [consented, setConsented] = useState(false);
  const [clientErrors, setClientErrors] = useState<ClientErrors>({});
  const [lastState, setLastState] = useState(state);

  // A new server result supersedes any earlier client-side messages.
  if (state !== lastState) {
    setLastState(state);
    setClientErrors({});
  }

  const serverErrors: ClientErrors = state.code && state.field ? { [state.field]: state.code } : {};
  const errors = Object.keys(clientErrors).length > 0 ? clientErrors : serverErrors;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const data = new FormData(event.currentTarget);
    const next: ClientErrors = {};
    const name = parseFullName(data.get("name"));
    if (!name.ok) next.name = name.code;
    const phone = parsePhone(data.get("phone"));
    if (!phone.ok) next.phone = phone.code;
    const password = checkNewPassword(data.get("password"), {
      phone: phone.ok ? phone.value : null,
      name: name.ok ? name.value : null,
    });
    if (!password.ok) next.password = password.code;
    if (!consented) next.consent = "temporaryCraftsman.error.consentRequired";
    setClientErrors(next);
    if (Object.keys(next).length > 0) event.preventDefault();
  }

  const phoneError = errors.phone ? (
    errors.phone === "temporaryCraftsman.error.phoneExists" ? (
      <span>
        {t(errors.phone)}{" "}
        <Link href={CRAFTSMAN_SIGN_IN_PATH} className="font-medium text-brand-lapis underline dark:text-brand-lapis-bright">
          {t("temporaryCraftsman.error.phoneExistsAction")}
        </Link>
      </span>
    ) : (
      t(errors.phone)
    )
  ) : undefined;

  return (
    <form action={dispatch} onSubmit={onSubmit} className="flex flex-col gap-md" noValidate>
      {errors.form ? (
        <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-md py-2.5 text-body text-danger">
          {t(errors.form)}
        </p>
      ) : null}

      <IconField
        id="craftsman-name"
        name="name"
        label={t("temporaryCraftsman.fields.nameLabel")}
        placeholder={t("temporaryCraftsman.fields.namePlaceholder")}
        autoComplete="name"
        required
        maxLength={80}
        defaultValue={state.values?.name ?? ""}
        icon={<UserIcon />}
        error={errors.name ? t(errors.name) : undefined}
      />

      <IconField
        id="craftsman-phone"
        name="phone"
        label={t("temporaryCraftsman.fields.phoneLabel")}
        placeholder={t("temporaryCraftsman.fields.phonePlaceholder")}
        type="tel"
        inputMode="tel"
        autoComplete="tel-national"
        dir="ltr"
        className="text-end"
        required
        defaultValue={state.values?.phone ?? ""}
        icon={<PhoneIcon />}
        error={phoneError}
      />

      <PasswordField
        id="craftsman-password"
        name="password"
        label={t("temporaryCraftsman.fields.passwordLabel")}
        autoComplete="new-password"
        required
        hint={t("temporaryCraftsman.fields.passwordHint")}
        error={errors.password ? t(errors.password) : undefined}
      />

      <div className="flex flex-col gap-1.5">
        <Checkbox id="craftsman-consent" name="consent" checked={consented} onChange={setConsented}>
          {t("temporaryCraftsman.signUp.consentPrefix")}{" "}
          <Link href="/legal/terms" target="_blank" className="text-brand-lapis underline dark:text-brand-lapis-bright">
            {t("temporaryCraftsman.signUp.termsLink")}
          </Link>{" "}
          {t("temporaryCraftsman.signUp.consentAnd")}
          <Link href="/legal/privacy" target="_blank" className="text-brand-lapis underline dark:text-brand-lapis-bright">
            {t("temporaryCraftsman.signUp.privacyLink")}
          </Link>
          {t("temporaryCraftsman.signUp.consentSuffix")}
        </Checkbox>
        {errors.consent ? (
          <p role="alert" className="text-label text-danger">
            {t(errors.consent)}
          </p>
        ) : null}
      </div>

      <TurnstileWidget resetKey={state} />
      {errors.captcha ? (
        <p role="alert" className="text-label text-danger">
          {t(errors.captcha)}
        </p>
      ) : null}

      <SubmitButton
        className="mt-sm min-h-14 w-full rounded-lg bg-shell text-body-lg font-semibold text-shell-fg shadow-card hover:opacity-90 tablet:min-h-16 tablet:text-title dark:bg-brand-lapis"
        pendingLabel={t("temporaryCraftsman.signUp.submitting")}
      >
        {t("temporaryCraftsman.signUp.submit")}
      </SubmitButton>
    </form>
  );
}
