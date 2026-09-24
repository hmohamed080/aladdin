/**
 * Phone normalization, matched to `app.normalize_phone` in the database.
 *
 * WHY IT IS DUPLICATED AT ALL
 * The database is the authority — it normalizes on write and matches on
 * acceptance, and nothing here is trusted by it. This copy exists so the invite
 * form can reject "0100 200" before a round trip and, more importantly, so it
 * can SHOW the inviter the E.164 number the invitation will actually be issued
 * to. An Egyptian mobile typed as `01002003040` becomes `+201002003040`, and a
 * manager who cannot see that transformation has no way to notice they typed a
 * digit wrong until the invitee never arrives.
 *
 * The two implementations must stay in step; the rules are small and stable, and
 * they are stated once in the SQL comment and once here:
 *
 *   "00…"                  -> "+…"          (international prefix)
 *   "0##########" (11 dig) -> "+20" + rest  (EG local mobile)
 *   "20…"                  -> "+20…"        (already the EG country code)
 *   anything else          -> "+" + digits  (assume already international)
 *
 * This is a pragmatic MVP normalizer, NOT libphonenumber. It is good enough to
 * put a WhatsApp-reachable number in the right shape for this market, which is
 * the only claim either copy makes.
 */

/** E.164-ish: a leading +, a non-zero country digit, 7–15 digits in total. */
const E164 = /^\+[1-9][0-9]{6,14}$/;

export function normalizePhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (digits === "") return null;
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  if (digits.startsWith("0") && digits.length === 11) return `+20${digits.slice(1)}`;
  if (digits.startsWith("20")) return `+${digits}`;
  return `+${digits}`;
}

/** Normalize and validate in one step; null means "not a usable number". */
export function toE164(input: string): string | null {
  const normalized = normalizePhone(input);
  return normalized && E164.test(normalized) ? normalized : null;
}

export function isE164(value: string): boolean {
  return E164.test(value);
}

// ===========================================================================
// Canonical profile phone (staging-prep Increment 2,
// 20260924090002_canonical_phone.sql) — a real ISO-3166 country picker, ANY
// country selectable (Egypt pre-selected), backed by `libphonenumber-js`'s
// real numbering-plan parsing/validation rather than the pragmatic EG-only
// heuristic above. That heuristic stays exactly as it is for the WhatsApp
// invite form (`normalizePhone`/`toE164`/`isE164`) — a different caller with a
// different, narrower need — this section is additive, not a replacement.
//
// The database is never asked to validate a calling code or numbering plan
// (see the migration's header comment): this module does the real parse and
// produces the canonical E.164 string; `profile_set_phone` only re-checks the
// outer E.164 shape as a backstop.
// ===========================================================================
import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";

export const DEFAULT_PHONE_COUNTRY: CountryCode = "EG";

export type PhoneCountryOption = {
  iso2: CountryCode;
  callingCode: string;
};

/**
 * Every ISO-3166 country libphonenumber-js knows a numbering plan for, Egypt
 * first (the approved default), then the rest in ISO2 order. Display names are
 * resolved by the caller via `Intl.DisplayNames` (a platform API, not a second
 * dependency) rather than baked in here, so the label follows the UI's locale.
 */
export function listPhoneCountries(): PhoneCountryOption[] {
  const rest = getCountries()
    .filter((iso2) => iso2 !== DEFAULT_PHONE_COUNTRY)
    .sort((a, b) => a.localeCompare(b));
  return [DEFAULT_PHONE_COUNTRY, ...rest].map((iso2) => ({
    iso2,
    callingCode: getCountryCallingCode(iso2),
  }));
}

export type CanonicalPhone = {
  countryIso2: CountryCode;
  /** National significant number, as libphonenumber-js reports it back (no calling code, no '+'). */
  national: string;
  /** Canonical E.164 — what `profile_set_phone` persists verbatim. */
  e164: string;
};

/**
 * Parses a national number against the chosen country's real numbering plan.
 * Returns null for anything libphonenumber-js cannot validate — never a
 * best-effort guess, since a wrong "successful" parse would write a phone
 * number to `profiles.phone_e164` that does not actually reach the caller.
 */
export function toCanonicalPhone(national: string, countryIso2: CountryCode): CanonicalPhone | null {
  const trimmed = national.trim();
  if (trimmed === "") return null;
  const parsed = parsePhoneNumberFromString(trimmed, countryIso2);
  if (!parsed || !parsed.isValid()) return null;
  return { countryIso2, national: parsed.nationalNumber, e164: parsed.number };
}
