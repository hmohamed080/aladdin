"use client";

import { startTransition, useActionState, useState } from "react";
import { InlineError, InlineSuccess } from "@/components/ui/primitives";
import { announceFormSaved } from "@/lib/ui/form-saved";
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
  const [choice, setChoice] = useState<string>(gender ?? "");
  const [state, submit] = useActionState(async (previous: IdentityFieldState, data: FormData) => {
    const result = await setGenderAction(previous, data);
    if (result.ok) announceFormSaved("personal-details", data);
    return result;
  }, INITIAL);

  return (
    // Submitted by hand: `<form action>` resets the radios afterwards, losing the choice on a failed save.
    <form
      id="personal-details"
      className="engineer-personal-details"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        startTransition(() => submit(data));
      }}
    >
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
              <input type="radio" name="gender" value={value} checked={choice === value} onChange={() => setChoice(value)} />
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
