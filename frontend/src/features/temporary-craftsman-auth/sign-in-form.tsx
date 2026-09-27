"use client";

import { useActionState, useState, type FormEvent } from "react";
import { useI18n } from "@/lib/i18n/context";
import { SubmitButton } from "@/components/ui/controls";
import { craftsmanSignIn, type CraftsmanAuthState, type CraftsmanField } from "@/server/actions/temporary-craftsman-auth";
import { IconField, PasswordField } from "./fields";
import { PhoneIcon } from "./icons";
import { parsePhone } from "./validation";

const initial: CraftsmanAuthState = { ok: false };
type ClientErrors = Partial<Record<CraftsmanField, string>>;

/**
 * TEMPORARY craftsman sign-in — phone + password, no OTP, no CAPTCHA (sign-in
 * never carries one in this project; GoTrue's own rate limits bound it).
 * Every credential failure renders ONE generic message — never which of the
 * phone or the password was wrong. There is deliberately no "forgot password"
 * link: the existing recovery flow is email-based and cannot reach these
 * accounts (docs/frontend/temporary-craftsman-auth.md).
 */
export function CraftsmanSignInForm() {
  const { t } = useI18n();
  const [state, dispatch] = useActionState(craftsmanSignIn, initial);
  const [clientErrors, setClientErrors] = useState<ClientErrors>({});
  const [lastState, setLastState] = useState(state);

  if (state !== lastState) {
    setLastState(state);
    setClientErrors({});
  }

  const serverErrors: ClientErrors = state.code && state.field ? { [state.field]: state.code } : {};
  const errors = Object.keys(clientErrors).length > 0 ? clientErrors : serverErrors;

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const data = new FormData(event.currentTarget);
    const next: ClientErrors = {};
    const phone = parsePhone(data.get("phone"));
    if (!phone.ok) next.phone = phone.code;
    const password = data.get("password");
    if (typeof password !== "string" || password.length === 0) next.password = "temporaryCraftsman.error.passwordRequired";
    setClientErrors(next);
    if (Object.keys(next).length > 0) event.preventDefault();
  }

  return (
    <form action={dispatch} onSubmit={onSubmit} className="flex flex-col gap-md" noValidate>
      {errors.form ? (
        <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 px-md py-2.5 text-body text-danger">
          {t(errors.form)}
        </p>
      ) : null}

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
        error={errors.phone ? t(errors.phone) : undefined}
      />

      <PasswordField
        id="craftsman-password"
        name="password"
        label={t("temporaryCraftsman.fields.passwordLabel")}
        autoComplete="current-password"
        required
        error={errors.password ? t(errors.password) : undefined}
      />

      <SubmitButton
        className="mt-sm min-h-14 w-full rounded-lg bg-shell text-body-lg font-semibold text-shell-fg shadow-card hover:opacity-90 tablet:min-h-16 tablet:text-title dark:bg-brand-lapis"
        pendingLabel={t("temporaryCraftsman.signIn.submitting")}
      >
        {t("temporaryCraftsman.signIn.submit")}
      </SubmitButton>
    </form>
  );
}
