/**
 * TEMPORARY craftsman phone + password flow (docs/frontend/temporary-craftsman-auth.md).
 *
 * Supabase Auth has no phone identity in this project (the phone provider is
 * off and no SMS/WhatsApp sender exists), and every "verified caller" gate in
 * the database reads `auth.users.email_confirmed_at`. So an account created by
 * `/temporary/craftsman/sign-up` signs in with an INTERNAL login alias derived
 * from its canonical E.164 phone — e.g. `+201012345678` →
 * `p201012345678@craftsman-login.aladdin.invalid`. The real phone is stored
 * canonically in `profiles.phone_e164` (via `profile_set_phone`) like any other
 * account's.
 *
 * The alias is a LOGIN KEY, never a contact address: `.invalid` is reserved
 * (RFC 2606) so nothing can ever be delivered to it, and it must NEVER be shown
 * to anyone. Every place that renders the auth user's email passes it through
 * `userFacingEmail()` below, which drops the alias.
 *
 * Remove this module together with the temporary flow.
 */

export const CRAFTSMAN_LOGIN_ALIAS_DOMAIN = "craftsman-login.aladdin.invalid";

const E164 = /^\+[1-9][0-9]{6,14}$/;

/** The internal login alias for a CANONICAL E.164 phone. Throws on anything else — callers canonicalize first. */
export function craftsmanLoginAlias(e164: string): string {
  if (!E164.test(e164)) throw new Error("craftsmanLoginAlias expects a canonical E.164 phone");
  return `p${e164.slice(1)}@${CRAFTSMAN_LOGIN_ALIAS_DOMAIN}`;
}

/** True when `email` is an internal craftsman login alias (case-insensitive). */
export function isCraftsmanLoginAlias(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.trim().toLowerCase().endsWith(`@${CRAFTSMAN_LOGIN_ALIAS_DOMAIN}`);
}

/** The auth email as it may be SHOWN to a person: null for an internal alias (or no email). */
export function userFacingEmail(email: string | null | undefined): string | null {
  const trimmed = email?.trim() || null;
  if (!trimmed || isCraftsmanLoginAlias(trimmed)) return null;
  return trimmed;
}
