import type { TranslateFn } from "./translate";

/**
 * The ONE place an account type becomes words on screen.
 *
 * Two forms, deliberately different:
 *   - `category` — naming the account type itself ("الصنايعية"): registration,
 *     account-type selection, directories.
 *   - `person`   — describing ONE signed-in person under their name ("صنايعي" /
 *     "Craftsman"): headers, profile-menu subtitles, profile cards.
 *
 * Only types with a distinct singular carry an `accountTypePerson.*` entry; every
 * other type reads the same in both forms and falls back to the category label,
 * so nothing is blindly singularised. The internal enum key (`installer_technician`)
 * is unchanged — this is presentation only.
 */
export type AccountTypeForm = "category" | "person";

export function accountTypeLabel(t: TranslateFn, type: string, form: AccountTypeForm = "category"): string {
  if (form === "person") {
    const key = `accountTypePerson.${type}`;
    const person = t(key);
    if (person !== key) return person;
  }
  return t(`accountType.${type}`);
}
