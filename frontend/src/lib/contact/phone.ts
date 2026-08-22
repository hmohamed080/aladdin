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
