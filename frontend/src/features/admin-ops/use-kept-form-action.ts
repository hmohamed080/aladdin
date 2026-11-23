"use client";

import { useActionState, useState } from "react";
import type { FormState } from "@/server/actions/sales-forms";

const INITIAL: FormState = { ok: false };

/**
 * A form action that keeps what the person typed when the server refuses it.
 *
 * React resets an uncontrolled form after every action, failed or not, so a refused save (a bound, a variable, a missing
 * reason) would empty the fields and make the admin retype a long text. The submitted values are kept and handed back as the
 * fields' default values, which is what the reset restores. A success clears them, so the form shows the saved values.
 */
export function useKeptFormAction(
  action: (previous: FormState, formData: FormData) => Promise<FormState>,
  fieldNames: readonly string[],
) {
  const [kept, setKept] = useState<Record<string, string> | null>(null);
  const [state, formAction] = useActionState(async (previous: FormState, formData: FormData): Promise<FormState> => {
    const result = await action(previous, formData);
    setKept(result.ok ? null : Object.fromEntries(fieldNames.map((name) => [name, String(formData.get(name) ?? "")])));
    return result;
  }, INITIAL);
  /** The default value of a field: what was typed before a refusal, else the saved value. */
  const valueOf = (name: string, saved?: string) => kept?.[name] ?? saved;
  return { state, formAction, valueOf };
}
