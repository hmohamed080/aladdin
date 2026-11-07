import { toAsciiDigits } from "@/lib/contact/phone";
import { parsePhone } from "@/features/installer-phone-auth/validation";
import type { CanonicalPhone } from "@/lib/contact/phone";

/**
 * The one sign-in field ("Mobile number, username or email"). Pure and
 * client-safe; the server action re-classifies from scratch.
 *
 *   * anything with "@"                        → email
 *   * digits with an optional leading "+"/"00",
 *     spaces, dashes or brackets               → mobile number (Egypt default)
 *   * anything else                            → username
 *
 * A username always starts with a letter (ck_profiles_username_shape), so a
 * digits-only value can never be a username and the split is unambiguous.
 */
export type SignInIdentifier =
  | { kind: "email"; value: string }
  | { kind: "phone"; value: CanonicalPhone }
  | { kind: "username"; value: string };

const PHONE_SHAPE = /^\+?[0-9][0-9\s\-().]{5,}$/;
const USERNAME_SHAPE = /^[A-Za-z][A-Za-z0-9._]{1,63}$/;

export function classifySignInIdentifier(input: unknown): SignInIdentifier | null {
  if (typeof input !== "string") return null;
  const raw = toAsciiDigits(input).trim();
  if (raw.length === 0 || raw.length > 254) return null;
  if (raw.includes("@")) return { kind: "email", value: raw.toLowerCase() };
  if (PHONE_SHAPE.test(raw)) {
    const phone = parsePhone(raw);
    return phone.ok ? { kind: "phone", value: phone.value } : null;
  }
  if (USERNAME_SHAPE.test(raw)) return { kind: "username", value: raw.toLowerCase() };
  return null;
}
