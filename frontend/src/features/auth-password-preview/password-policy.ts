import { z } from "zod";
import { evaluatePasswordStrength } from "./password-strength";

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

/**
 * AGE POLICY (PROPOSED INTERIM, pending legal approval; P1 PR-2). The application no longer collects or stores a date of birth. Eligibility
 * protection is kept as a server-enforced self-attestation: "I confirm I am 18 or older".
 *
 * CONTRACT (shared by every registration path and by the UI):
 *   * form field name  : `ageConfirmed` (AGE_CONFIRMATION_FIELD); a checkbox, submitted as "on" (or "true"/"1" from a script)
 *   * parsed value     : boolean, must be literally `true` (ageConfirmationSchema)
 *   * failure          : error code `authPasswordPreview.error.ageNotConfirmed` (AGE_NOT_CONFIRMED_CODE)
 * The attestation is checked at request time and is NOT persisted anywhere (no column, no metadata). Whether it must be recorded to prove
 * enforcement is an open legal question.
 */
export const AGE_CONFIRMATION_FIELD = "ageConfirmed";
export const MINIMUM_SIGN_UP_AGE = 18;
export const AGE_NOT_CONFIRMED_CODE = "authPasswordPreview.error.ageNotConfirmed";

/** Must be exactly boolean `true`; anything else (false, missing, "yes", 1) fails with AGE_NOT_CONFIRMED_CODE. */
export const ageConfirmationSchema = z.literal(true, { errorMap: () => ({ message: AGE_NOT_CONFIRMED_CODE }) });
export type AgeConfirmation = z.infer<typeof ageConfirmationSchema>;

/** Reads the checkbox value a form (or script) submitted into a boolean. Only "on", "true" and "1" mean confirmed. */
export function ageConfirmedFromForm(formData: FormData): boolean {
  const value = formData.get(AGE_CONFIRMATION_FIELD);
  return value === "on" || value === "true" || value === "1";
}

/** Server-side gate for flows without a zod schema: null when confirmed, else the typed error code. */
export function ageConfirmationError(formData: FormData): string | null {
  return ageConfirmationSchema.safeParse(ageConfirmedFromForm(formData)).success ? null : AGE_NOT_CONFIRMED_CODE;
}

export const registrationSchema = z
  .object({
    displayName: displayNameSchema,
    email: emailSchema,
    accountType: z.string().trim().min(1, { message: "authPasswordPreview.error.accountTypeRequired" }),
    password: passwordSchema,
    ageConfirmed: ageConfirmationSchema,
  })
  .superRefine((value, ctx) => {
    addWeakPasswordIssues(value.password, [value.email], ["password"], ctx);
  });

/**
 * Registration for INVITED PLATFORM STAFF: exactly the marketplace rules for name, e-mail, password and the 18+ attestation, with no username and no
 * account type (staff are never given a marketplace persona). Kept beside registrationSchema so the two cannot drift.
 */
export const staffRegistrationSchema = z
  .object({
    displayName: displayNameSchema,
    email: emailSchema,
    password: passwordSchema,
    ageConfirmed: ageConfirmationSchema,
  })
  .superRefine((value, ctx) => {
    addWeakPasswordIssues(value.password, [value.email], ["password"], ctx);
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
  accountType: "authPasswordPreview.error.accountTypeRequired",
  password: "authPasswordPreview.error.passwordTooShort",
  ageConfirmed: AGE_NOT_CONFIRMED_CODE,
};

export function registrationIssueCode(issue: { message?: string; path?: (string | number)[] } | undefined): string {
  const message = issue?.message ?? "";
  if (/^[A-Za-z]+(\.[A-Za-z0-9]+)+$/.test(message)) return message;
  return REGISTRATION_FIELD_CODES[String(issue?.path?.[0] ?? "")] ?? "authPasswordPreview.error.invalidEmail";
}
