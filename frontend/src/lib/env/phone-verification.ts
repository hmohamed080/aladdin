import { z } from "zod";

/**
 * Server-only configuration for the phone verification authority (Phase B1). Kept in its own file under lib/env so it does not
 * share lines with the main env schema; it is still the single sanctioned place that reads these variables from process.env.
 *
 * - PHONE_VERIFICATION_ENABLED: anything other than the literal "true" is OFF (the database has its own switch that also ships off).
 * - PHONE_OTP_HMAC_KEYS: {"current":"<kid>","keys":{"<kid>":"<base64, >= 32 random bytes>"}} - at most 3 keys (current + previous
 *   during rotation). Parsed and validated by server/phone-verification/otp.ts. Server-only secret: never in the database,
 *   NEXT_PUBLIC_*, a log or the repository. Generate: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 */
export const phoneVerificationEnvSchema = z.object({
  PHONE_VERIFICATION_ENABLED: z.enum(["true", "false"]).optional(),
  PHONE_OTP_HMAC_KEYS: z.string().trim().min(20).optional(),
});

export type PhoneVerificationEnv = { enabled: boolean; hmacKeys: string | undefined };

export function parsePhoneVerificationEnv(source: Record<string, string | undefined>): PhoneVerificationEnv {
  const result = phoneVerificationEnvSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid phone verification environment configuration:\n${issues}`);
  }
  return { enabled: result.data.PHONE_VERIFICATION_ENABLED === "true", hmacKeys: result.data.PHONE_OTP_HMAC_KEYS };
}

export function readPhoneVerificationEnv(): PhoneVerificationEnv {
  return parsePhoneVerificationEnv({
    PHONE_VERIFICATION_ENABLED: process.env.PHONE_VERIFICATION_ENABLED,
    PHONE_OTP_HMAC_KEYS: process.env.PHONE_OTP_HMAC_KEYS,
  });
}
