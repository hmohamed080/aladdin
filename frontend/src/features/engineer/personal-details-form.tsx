"use client";

import { useActionState } from "react";
import { InlineError, InlineSuccess } from "@/components/ui/primitives";
import { setGenderAction, type IdentityFieldState } from "@/server/actions/profile-identity";

const INITIAL: IdentityFieldState = { ok: false };

export type PersonalDetailsLabels = {
  gender: string;
  female: string;
  male: string;
  unspecified: string;
  saved: string;
  error: string;
};

/** Gender. Saved by the page-end button (see SettingsSaveBar), which submits this form by id. */
export function PersonalDetailsForm({ gender, labels }: { gender: "female" | "male" | null; labels: PersonalDetailsLabels }) {
  const [state, submit] = useActionState(setGenderAction, INITIAL);

  return (
    <form action={submit} id="personal-details" className="engineer-personal-details">
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
      {!state.ok && state.code ? <InlineError>{labels.error}</InlineError> : null}
      {state.ok ? <InlineSuccess>{labels.saved}</InlineSuccess> : null}
      <button type="submit" hidden />
    </form>
  );
}
