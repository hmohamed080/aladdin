import { toCanonicalPhone, DEFAULT_PHONE_COUNTRY, type CanonicalPhone } from "@/lib/contact/phone";
import {
  PASSWORD_MAX_BYTES,
  PASSWORD_MIN_LENGTH,
  passwordByteLength,
  strengthOf,
} from "@/features/auth-password-preview/password-policy";

/**
 * Field rules for the installer/technician phone + password flow
 * (docs/frontend/installer-phone-auth.md). Pure and client-safe: the form
 * uses it for immediate feedback, and the server action re-runs it from
 * scratch — the client result is never trusted.
 *
 * Nothing here is a new policy:
 *   * phone — the canonical `toCanonicalPhone` (libphonenumber-js, Egypt as the
 *     default country), producing the same E.164 `profile_set_phone` stores;
 *   * password — the project's existing length-first policy (10 characters
 *     minimum, 72 bytes maximum) and weak-password rejection;
 *   * name — the same 1..80 bound `profiles.display_name` enforces.
 *
 * Every returned code is a translation key under `temporaryCraftsman.error`.
 */

export const NAME_MAX_LENGTH = 80;

type Err = { ok: false; code: string };

/**
 * Egyptian users often type Arabic-Indic (٠-٩) or Eastern Arabic-Indic (۰-۹)
 * digits. Map them to ASCII before parsing so a valid number is not rejected
 * for its script.
 */
export function toAsciiDigits(value: string): string {
  return value.replace(/[٠-٩۰-۹]/g, (d) => {
    const code = d.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

export function parseFullName(input: unknown): { ok: true; value: string } | Err {
  const value = typeof input === "string" ? input.trim().replace(/\s+/g, " ") : "";
  if (value.length === 0) return { ok: false, code: "temporaryCraftsman.error.nameRequired" };
  if (value.length > NAME_MAX_LENGTH) return { ok: false, code: "temporaryCraftsman.error.nameTooLong" };
  return { ok: true, value };
}

export function parsePhone(input: unknown): { ok: true; value: CanonicalPhone } | Err {
  const raw = typeof input === "string" ? toAsciiDigits(input).trim() : "";
  if (raw.length === 0) return { ok: false, code: "temporaryCraftsman.error.phoneInvalid" };
  const canonical = toCanonicalPhone(raw, DEFAULT_PHONE_COUNTRY);
  if (!canonical) return { ok: false, code: "temporaryCraftsman.error.phoneInvalid" };
  return { ok: true, value: canonical };
}

/**
 * The existing password policy, with the account's own identifiers (the phone
 * in both its local and E.164 forms, and the name) as the "account-related"
 * context — the same rule the email flow applies to the email.
 */
export function checkNewPassword(
  password: unknown,
  context: { phone?: CanonicalPhone | null; name?: string | null } = {},
): { ok: true; value: string } | Err {
  if (typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, code: "temporaryCraftsman.error.passwordTooShort" };
  }
  if (passwordByteLength(password) > PASSWORD_MAX_BYTES) {
    return { ok: false, code: "temporaryCraftsman.error.passwordTooLong" };
  }
  const identifiers: string[] = [];
  if (context.phone) {
    identifiers.push(context.phone.e164.slice(1), context.phone.national, `0${context.phone.national}`);
  }
  if (context.name) identifiers.push(context.name.replace(/\s+/g, ""));
  const strength = strengthOf(password, identifiers);
  if (strength.common) return { ok: false, code: "temporaryCraftsman.error.passwordCommon" };
  if (strength.sequential) return { ok: false, code: "temporaryCraftsman.error.passwordSequential" };
  if (strength.accountRelated) return { ok: false, code: "temporaryCraftsman.error.passwordAccountRelated" };
  return { ok: true, value: password };
}
