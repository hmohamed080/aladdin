/**
 * Pure, client-safe mirror of the DB-side username rules
 * (`supabase/migrations/20260924090001_username_identity.sql`:
 * `ck_profiles_username_shape`, `ck_profiles_username_length`,
 * `app.normalize_username_for_uniqueness`). NOTHING HERE IS AUTHORITY — the
 * database re-validates and re-normalizes independently
 * (`public.profile_set_username`); this exists purely for immediate
 * client-side feedback before a round-trip.
 *
 * Normalization is NON-DESTRUCTIVE, on purpose: it trims + lowercases for
 * the case-insensitive comparison and nothing else. A disallowed character
 * is REJECTED by `isUsernameWellFormed`, never silently stripped by
 * `normalizeUsernameForComparison`.
 */

const USERNAME_SHAPE = /^[a-zA-Z][a-zA-Z0-9]*([._][a-zA-Z0-9]+)*$/;

export function isUsernameWellFormed(username: string): boolean {
  return username.length >= 3 && username.length <= 24 && USERNAME_SHAPE.test(username);
}

/** Trim + lowercase only — mirrors app.normalize_username_for_uniqueness exactly. */
export function normalizeUsernameForComparison(username: string): string {
  return username.trim().toLowerCase();
}
