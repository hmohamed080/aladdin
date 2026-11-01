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
 * whose supported input is limited to 72 BYTES (not characters — a multi-byte
 * Arabic/emoji passphrase can hit the byte cap well under 72 characters),
 * and the application rejects larger input before reaching GoTrue.
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
  .max(PASSWORD_MAX_BYTES, { message: "authPasswordPreview.error.passwordTooLong" })
  .refine(value => value.length <= PASSWORD_MAX_BYTES && Array.from(value).length >= PASSWORD_MIN_LENGTH, { message: "authPasswordPreview.error.passwordTooShort" })
  .refine((value) => value.length <= PASSWORD_MAX_BYTES && passwordByteLength(value) <= PASSWORD_MAX_BYTES, {
    message: "authPasswordPreview.error.passwordTooLong",
  });

/** Existing passwords need no new strength/minimum rule. Never trim or transform. */
export const loginPasswordSchema = z.string().min(1)
  .max(PASSWORD_MAX_BYTES, { message: "authPasswordPreview.error.passwordTooLong" })
  .refine(value => value.length <= PASSWORD_MAX_BYTES && passwordByteLength(value) <= PASSWORD_MAX_BYTES, { message: "authPasswordPreview.error.passwordTooLong" });

export const emailSchema = z.string().trim().email();

/** Adds the weak-password checks (common / sequential / account-related) with `context` (typically [email]) as an issue on `path`. */
function addWeakPasswordIssues(password: string, context: readonly string[], path: (string | number)[], ctx: z.RefinementCtx) {
  if (password.length > PASSWORD_MAX_BYTES || Array.from(password).length < PASSWORD_MIN_LENGTH || passwordByteLength(password) > PASSWORD_MAX_BYTES) return; // base schema already reports this
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
/**
 * The registrant's Full Name — PROFILE data, never authorization. Trimmed,
 * 1..80 characters: the same bounds `profile_set_display_name` enforces and
 * `app.handle_new_user()` truncates to. The server action is authoritative;
 * the form mirrors it only for early feedback.
 */
export const DISPLAY_NAME_MAX_LENGTH = 80;
export const displayNameSchema = z
  .string({ invalid_type_error: "authPasswordPreview.error.fullNameRequired", required_error: "authPasswordPreview.error.fullNameRequired" })
  .trim()
  .min(1, { message: "authPasswordPreview.error.fullNameRequired" })
  .max(DISPLAY_NAME_MAX_LENGTH, { message: "authPasswordPreview.error.fullNameTooLong" });

/** Minimum age to hold an account. */
export const MINIMUM_SIGN_UP_AGE = 18;

/**
 * The registrant's birthday: a real calendar date (YYYY-MM-DD, the value a
 * date input submits), at least MINIMUM_SIGN_UP_AGE years ago and not before
 * 1900. Private account data, never shown on a public profile. `today` is
 * injectable for tests.
 */
export function parseBirthDate(input: unknown, today: Date = new Date()): { ok: true; value: string } | { ok: false; code: string } {
  const raw = typeof input === "string" ? input.trim() : "";
  if (!raw) return { ok: false, code: "authPasswordPreview.error.birthDateRequired" };
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) return { ok: false, code: "authPasswordPreview.error.birthDateInvalid" };
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || year < 1900) {
    return { ok: false, code: "authPasswordPreview.error.birthDateInvalid" };
  }
  const adult = new Date(Date.UTC(today.getUTCFullYear() - MINIMUM_SIGN_UP_AGE, today.getUTCMonth(), today.getUTCDate()));
  if (date > adult) return { ok: false, code: "authPasswordPreview.error.birthDateTooYoung" };
  return { ok: true, value: raw };
}

export const registrationSchema = z
  .object({
    displayName: displayNameSchema,
    email: emailSchema,
    username: z
      .string()
      .trim()
      .refine((value) => isUsernameWellFormed(value), { message: "registration.error.usernameShape" }),
    accountType: z.string().trim().min(1, { message: "authPasswordPreview.error.accountTypeRequired" }),
    password: passwordSchema,
    birthDate: z.string({ invalid_type_error: "authPasswordPreview.error.birthDateRequired", required_error: "authPasswordPreview.error.birthDateRequired" }).trim(),
  })
  .superRefine((value, ctx) => {
    addWeakPasswordIssues(value.password, [value.email], ["password"], ctx);
    const birthDate = parseBirthDate(value.birthDate);
    if (!birthDate.ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: birthDate.code, path: ["birthDate"] });
  });

export const resetPasswordSchema = z
  .object({
    email: emailSchema,
    token: z.string().trim().regex(/^\d{6}$/, { message: "authPasswordPreview.error.invalidCode" }),
    password: passwordSchema,
    confirmPassword: loginPasswordSchema,
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

/** The message key a registration refusal shows: the schema's own key, else the field's plain one. */
const REGISTRATION_FIELD_CODES: Record<string, string> = {
  displayName: "authPasswordPreview.error.fullNameRequired",
  email: "authPasswordPreview.error.invalidEmail",
  username: "registration.error.usernameShape",
  accountType: "authPasswordPreview.error.accountTypeRequired",
  password: "authPasswordPreview.error.passwordTooShort",
  birthDate: "authPasswordPreview.error.birthDateRequired",
};

export function registrationIssueCode(issue: { message?: string; path?: (string | number)[] } | undefined): string {
  const message = issue?.message ?? "";
  if (/^[A-Za-z]+(\.[A-Za-z0-9]+)+$/.test(message)) return message;
  return REGISTRATION_FIELD_CODES[String(issue?.path?.[0] ?? "")] ?? "authPasswordPreview.error.invalidEmail";
}
