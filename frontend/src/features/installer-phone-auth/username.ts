/**
 * Internal username for the installer phone + password flow. `my_registration_state()`
 * requires a stored username before an account is `access_ready`, but this
 * flow deliberately asks for none — so one is generated.
 *
 * Shape: `craftsman.` + 8 random lowercase letters/digits (18 characters),
 * which satisfies every username rule (`ck_profiles_username_shape`: starts
 * with a letter, `[a-z0-9]` segments joined by a single "."; 3..24 long). The
 * random part comes from the platform CSPRNG (36^8 ≈ 2.8e12 values), and the
 * authoritative `profile_set_username` claim is retried on a collision, so
 * uniqueness never rests on luck alone.
 */

export const GENERATED_USERNAME_PREFIX = "craftsman.";
const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const SUFFIX_LENGTH = 8;

export function generateCraftsmanUsername(
  randomValues: (bytes: Uint8Array) => Uint8Array = (bytes) => crypto.getRandomValues(bytes),
): string {
  // Rejection sampling so every character is uniformly likely (256 % 36 ≠ 0).
  const limit = 256 - (256 % ALPHABET.length);
  let suffix = "";
  while (suffix.length < SUFFIX_LENGTH) {
    for (const byte of randomValues(new Uint8Array(SUFFIX_LENGTH * 2))) {
      if (byte < limit && suffix.length < SUFFIX_LENGTH) suffix += ALPHABET[byte % ALPHABET.length];
    }
  }
  return `${GENERATED_USERNAME_PREFIX}${suffix}`;
}
