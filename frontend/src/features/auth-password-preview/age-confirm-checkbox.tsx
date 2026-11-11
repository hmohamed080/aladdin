"use client";

import { useState, type FormEvent } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Checkbox } from "@/components/ui/controls";
import { AGE_CONFIRMATION_FIELD, AGE_NOT_CONFIRMED_CODE } from "./password-policy";

/**
 * PROPOSED INTERIM (Phase 1, account identity; pending legal approval): every registration form asks the person to
 * confirm they are 18 or older instead of collecting a birth date. The wire contract with the server (password-policy)
 * is a checkbox field `AGE_CONFIRMATION_FIELD` ("ageConfirmed") submitted as "on"; the server answers a missing/false
 * value with `AGE_NOT_CONFIRMED_CODE`. Nothing is stored.
 */
export const AGE_CONFIRMED_FIELD = AGE_CONFIRMATION_FIELD;
export const AGE_NOT_CONFIRMED_KEY = AGE_NOT_CONFIRMED_CODE;

/** True for the typed server code that belongs under the age checkbox. */
export function isAgeNotConfirmedCode(code: string | undefined): boolean {
  return Boolean(code) && /error\.ageNotConfirmed$/.test(code as string);
}

/**
 * Required "I confirm I am 18 or older" checkbox with an accessible error. `serverCode` is the server's typed code for
 * this field; the local check (`onSubmit`) only gives immediate feedback, the server stays the authority.
 *
 * Use the returned `guardSubmit` as the form's `onSubmit`: it blocks the submit while the box is unchecked.
 */
export function useAgeConfirmation(serverCode?: string) {
  const { t } = useI18n();
  const [checked, setChecked] = useState(false);
  const [showLocalError, setShowLocalError] = useState(false);
  const serverError = isAgeNotConfirmedCode(serverCode) ? serverCode : undefined;
  const errorText = showLocalError && !checked ? t(AGE_NOT_CONFIRMED_KEY) : serverError && !checked ? t(serverError) : null;

  const guardSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (checked) return;
    // Cancelling the submit event also skips the form's server action.
    event.preventDefault();
    setShowLocalError(true);
  };

  const field = (
    <div className="flex flex-col gap-1" data-age-confirmation>
      <Checkbox
        id="ageConfirmed"
        name={AGE_CONFIRMED_FIELD}
        checked={checked}
        onChange={(value) => {
          setChecked(value);
          if (value) setShowLocalError(false);
        }}
        aria-invalid={errorText ? true : undefined}
        aria-describedby={errorText ? "ageConfirmedError" : undefined}
        aria-required
      >
        {t("authPasswordPreview.signUp.ageConfirmLabel")}
      </Checkbox>
      {errorText ? (
        <p id="ageConfirmedError" role="alert" className="text-label text-danger">
          {errorText}
        </p>
      ) : null}
    </div>
  );

  return { field, guardSubmit, checked };
}
