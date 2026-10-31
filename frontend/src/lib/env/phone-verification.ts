import { z } from "zod";

/**
 * Server-only configuration for the phone verification authority (Phase B1). Kept in its own file under lib/env so it does not
 * share lines with the main env schema; it is still the single sanctioned place that reads these variables from process.env.
 *
 * - PHONE_VERIFICATION_ENABLED: anything other than the literal "true" is OFF (the database has its own switch that also ships off).
 * - PHONE_OTP_HMAC_KEYS: {"current":"<kid>","keys":{"<kid>":"<base64, >= 32 random bytes>"}} - at most 3 keys (current + previous
 *   during rotation). Parsed and validated by server/phone-verification/otp.ts. Server-only secret: never in the database,
 *   NEXT_PUBLIC_*, a log or the repository. Generate: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 * - PHONE_SIGNUP_VERIFICATION_ENABLED: same rule, for the signup_proof entry points (needs PHONE_VERIFICATION_ENABLED too).
 * - PHONE_OTP_DELIVERY: "off" (default) | "outbox" (local fake, refused when NODE_ENV=production) | "worker" (reserved for the
 *   Cloudflare Worker adapter, NOT wired in R1). Anything else - including a typo or a missing value - means "off". This is a
 *   server-only switch; it is never derived from NEXT_PUBLIC_APP_ENV, which is public and also selects test keys.
 * - PHONE_OTP_OUTBOX_DIR: where the local outbox writes (default .local/phone-otp-outbox, git-ignored).
 * - PHONE_SIGNUP_COOKIE_SECRET: >= 32 characters, server-only. Keys ONLY the sealed pending-sign-up cookie (it holds the password for <= 10
 *   minutes). Separate from the code keyring and from AUTH_PASSWORD_PREVIEW_GRANT_SECRET so that no other secret's exposure opens this cookie.
 *   Required whenever phone sign-up is enabled (the sign-up action refuses to request a code without it).
 */
export const phoneVerificationEnvSchema = z.object({
  PHONE_VERIFICATION_ENABLED: z.enum(["true", "false"]).optional(),
  PHONE_SIGNUP_VERIFICATION_ENABLED: z.enum(["true", "false"]).optional(),
  PHONE_OTP_HMAC_KEYS: z.string().trim().min(20).optional(),
  PHONE_OTP_DELIVERY: z.string().trim().max(32).optional(),
  PHONE_OTP_OUTBOX_DIR: z.string().trim().max(300).optional(),
  PHONE_SIGNUP_COOKIE_SECRET: z.string().trim().min(32).max(512).optional(),
});

export type PhoneVerificationEnv = {
  enabled: boolean;
  signupEnabled: boolean;
  hmacKeys: string | undefined;
  /** Raw switch value; interpreted (fail-closed) by server/phone-verification/delivery.ts. */
  delivery: string | undefined;
  outboxDir: string | undefined;
  signupCookieSecret: string | undefined;
};

export function parsePhoneVerificationEnv(source: Record<string, string | undefined>): PhoneVerificationEnv {
  const result = phoneVerificationEnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid phone verification environment configuration:\n${issues}`);
  }
  const enabled = result.data.PHONE_VERIFICATION_ENABLED === "true";
  return {
    enabled,
    // The signup entry points need BOTH switches.
    signupEnabled: enabled && result.data.PHONE_SIGNUP_VERIFICATION_ENABLED === "true",
    hmacKeys: result.data.PHONE_OTP_HMAC_KEYS,
    delivery: result.data.PHONE_OTP_DELIVERY,
    outboxDir: result.data.PHONE_OTP_OUTBOX_DIR,
    signupCookieSecret: result.data.PHONE_SIGNUP_COOKIE_SECRET,
  };
}

export function readPhoneVerificationEnv(): PhoneVerificationEnv {
  return parsePhoneVerificationEnv({
    PHONE_VERIFICATION_ENABLED: process.env.PHONE_VERIFICATION_ENABLED,
    PHONE_SIGNUP_VERIFICATION_ENABLED: process.env.PHONE_SIGNUP_VERIFICATION_ENABLED,
    PHONE_OTP_HMAC_KEYS: process.env.PHONE_OTP_HMAC_KEYS,
    PHONE_OTP_DELIVERY: process.env.PHONE_OTP_DELIVERY,
    PHONE_OTP_OUTBOX_DIR: process.env.PHONE_OTP_OUTBOX_DIR,
    PHONE_SIGNUP_COOKIE_SECRET: process.env.PHONE_SIGNUP_COOKIE_SECRET,
  });
}
