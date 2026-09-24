import { z } from "zod";
import { evaluatePasswordStrength } from "./password-strength";
import { isUsernameWellFormed } from "@/lib/identity/username";

/**
 * Length-first password policy (NIST SP 800-63B-aligned) PLUS weak-password
 * rejection (see `password-strength.ts`) — composition rules (mandatory
 * upper/lower/digit/symbol) are deliberately NOT part of this policy.
 * `PASSWORD_MIN_LENGTH` matches `minimum_password_length` in
 * `supabase/config.toml` — the two must be changed together, and Supabase
 * (not just this schema) is what actually rejects a short password.
 * `PASSWORD_MAX_BYTES` is not configurable: Supabase Auth hashes with bcrypt,
 * which hard-truncates at 72 BYTES (not characters — a multi-byte
 * Arabic/emoji passphrase can hit the byte cap well under 72 characters),
 * and GoTrue has no plan to change this.
 */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_BYTES = 72;

export function passwordByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function strengthOf(value: string, context: readonly string[] = []) {
  return evaluatePasswordStrength(value, context, PASSWORD_MIN_LENGTH, PASSWORD_MAX_BYTES, passwordByteLength);
}

/** Context-free base schema — length/byte bounds only, used where no account-context exists (e.g. type inference). */
export const passwordSchema = z
  .string()
  // Spaces are a deliberate part of the policy (passphrases) — never trim.
  .min(PASSWORD_MIN_LENGTH, { message: "authPasswordPreview.error.passwordTooShort" })
  .refine((value) => passwordByteLength(value) <= PASSWORD_MAX_BYTES, {
    message: "authPasswordPreview.error.passwordTooLong",
  });

export const emailSchema = z.string().trim().email();

/** Adds the weak-password checks (common / sequential / account-related) with `context` (typically [email]) as an issue on `path`. */
function addWeakPasswordIssues(password: string, context: readonly string[], path: (string | number)[], ctx: z.RefinementCtx) {
  if (password.length < PASSWORD_MIN_LENGTH || passwordByteLength(password) > PASSWORD_MAX_BYTES) return; // base schema already reports this
  const s = strengthOf(password, context);
  if (s.common) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "authPasswordPreview.error.passwordCommon", path });
  } else if (s.sequential) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "authPasswordPreview.error.passwordSequential", path });
  } else if (s.accountRelated) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "authPasswordPreview.error.passwordAccountRelated", path });
  }
}

/**
 * Username + account-type shape validation only — this schema exists purely
 * for immediate client-side feedback before a round-trip. Both are
 * REVALIDATED, from scratch, server-side against the live database
 * (`username_available`, the account-type enums) at the moment they are
 * actually applied (`verifyPasswordSignUp`, after `verifyOtp` succeeds) —
 * this schema's job is only to keep an obviously-invalid submission from
 * ever reaching `signUp()` in the first place, never to be trusted as the
 * final word on availability.
 */
export const registrationSchema = z
  .object({
    email: emailSchema,
    username: z
      .string()
      .trim()
      .refine((value) => isUsernameWellFormed(value), { message: "registration.error.usernameShape" }),
    accountType: z.string().trim().min(1, { message: "authPasswordPreview.error.accountTypeRequired" }),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .superRefine((value, ctx) => {
    if (value.password !== value.confirmPassword) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "authPasswordPreview.error.passwordMismatch", path: ["confirmPassword"] });
    }
    addWeakPasswordIssues(value.password, [value.email], ["password"], ctx);
  });

export const resetPasswordSchema = z
  .object({
    email: emailSchema,
    token: z.string().trim().regex(/^\d{6}$/, { message: "authPasswordPreview.error.invalidCode" }),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .superRefine((value, ctx) => {
    if (value.password !== value.confirmPassword) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "authPasswordPreview.error.passwordMismatch", path: ["confirmPassword"] });
    }
    addWeakPasswordIssues(value.password, [value.email], ["password"], ctx);
  });

/** For flows where the account's email is already known server-side (migration, recovery reset, change-password) but isn't a form field. */
export function passwordWithContextSchema(context: readonly string[]) {
  return passwordSchema.superRefine((password, ctx) => addWeakPasswordIssues(password, context, [], ctx));
}
