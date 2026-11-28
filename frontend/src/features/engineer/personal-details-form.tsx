"use client";

import { useActionState } from "react";
import { LabeledField } from "@/components/ui/controls";
import { DatePicker } from "./date-picker";
import { InlineSuccess } from "@/components/ui/primitives";
import { setPersonalDetailsAction, type IdentityFieldState } from "@/server/actions/profile-identity";

const INITIAL: IdentityFieldState = { ok: false };

export type PersonalDetailsLabels = {
  birthDate: string;
  gender: string;
  female: string;
  male: string;
  unspecified: string;
  saved: string;
  invalidDate: string;
  error: string;
  placeholder: string;
  clear: string;
  today: string;
};

/** Birth date and gender. Saved by the page-end button (see SettingsSaveBar), which submits this form by id. */
export function PersonalDetailsForm({
  birthDate,
  gender,
  locale,
  labels,
}: {
  birthDate: string | null;
  gender: "female" | "male" | null;
  locale: "ar" | "en";
  labels: PersonalDetailsLabels;
}) {
  const [state, submit] = useActionState(setPersonalDetailsAction, INITIAL);
  const error = !state.ok && state.code ? (state.code.endsWith("invalidDate") ? labels.invalidDate : labels.error) : undefined;

  return (
    <form action={submit} id="personal-details" className="engineer-personal-details">
      <LabeledField label={labels.birthDate} htmlFor="birthDate" error={error}>
        <DatePicker id="birthDate" name="birthDate" value={birthDate} locale={locale} label={labels.birthDate} placeholder={labels.placeholder} clearLabel={labels.clear} todayLabel={labels.today} />
      </LabeledField>
      <div className="engineer-gender" role="radiogroup" aria-labelledby="gender-label">
        <span id="gender-label">{labels.gender}</span>
        <div>
          {(
            [
              ["female", labels.female],
              ["male", labels.male],
              ["", labels.unspecified],
            ] as const
          ).map(([value, text]) => (
            <label key={value || "none"}>
              <input type="radio" name="gender" value={value} defaultChecked={(gender ?? "") === value} />
              <span>{text}</span>
            </label>
          ))}
        </div>
      </div>
      {state.ok ? <InlineSuccess>{labels.saved}</InlineSuccess> : null}
      <button type="submit" hidden />
    </form>
  );
}
