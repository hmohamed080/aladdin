/**
 * Validation patterns shared between server actions and client components, so
 * an immediate client-side check can never drift from the rule the server
 * actually enforces. Import this from both sides rather than re-typing the
 * pattern — a second copy is exactly the "contradictory validation model"
 * this file exists to prevent.
 */

/** Egyptian mobile: 01 + operator (0/1/2/5) + 8 digits. Matches `egPhoneSchema` in `server/actions/onboarding.ts`. */
export const EG_PHONE_PATTERN = /^01[0125]\d{8}$/;
