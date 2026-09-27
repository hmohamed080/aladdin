/**
 * Weak-password detection — NOT a composition-rule engine. NIST SP 800-63B
 * (and the product brief) reject mandatory upper/lower/digit/symbol rules as
 * the security mechanism; instead this checks the things that actually
 * predict a fast crack: the password is a known-common string, a
 * keyboard/sequential pattern, or trivially derived from the account's own
 * identifiers. Composition variety only ever *adds* to the strength score —
 * it never substitutes for the three hard rejections below.
 *
 * This is a preview-grade, self-written heuristic (curated common-password
 * list + pattern detection), not a substitute for a real breach-corpus check.
 * See docs/frontend/auth-password-preview.md §Password policy for the
 * recommended production upgrade path (Supabase's native "Leaked password
 * protection" — Pro plan+ only; `aladdin-staging` is confirmed on the Free
 * plan today, so it is unavailable until the project upgrades) and the
 * documented fallback (a direct k-anonymity HaveIBeenPwned Pwned-Passwords
 * check) pending approval to add that external dependency.
 */

/**
 * A curated list of the passwords most frequently found in real breach
 * corpora (NCSC/HaveIBeenPwned "most common passwords" lists are public,
 * widely republished security data, not creative work), normalized
 * (lowercase, punctuation/whitespace stripped) — plus a handful of
 * product-specific guesses (the brand name, "genie", "lamp") that a generic
 * list would miss but a real attacker targeting Aladdin accounts would try
 * first. `isCommonPassword` also strips a trailing digit run before matching,
 * so "password123", "aladdin2024", and "qwerty!" are all caught without
 * enumerating every numeric suffix.
 */
const COMMON_PASSWORDS = new Set<string>(
  [
    "password", "passw0rd", "p@ssword", "letmein", "welcome", "welcome1",
    "admin", "administrator", "root", "toor", "test", "testing", "guest",
    "qwerty", "qwertyuiop", "asdfgh", "asdfghjkl", "zxcvbn", "zxcvbnm",
    "123456", "1234567", "12345678", "123456789", "1234567890", "0123456789",
    "111111", "000000", "121212", "654321", "1q2w3e4r", "1qaz2wsx",
    "iloveyou", "loveyou", "iloveu", "sunshine", "princess", "flower",
    "monkey", "dragon", "football", "baseball", "basketball", "soccer",
    "master", "superman", "batman", "starwars", "pokemon", "minecraft",
    "trustno1", "letmein1", "changeme", "temppass", "temp1234", "default",
    "abc123", "abcd1234", "a1b2c3", "aaaaaa", "bbbbbb", "aaaaaaaa",
    "shadow", "michael", "jennifer", "jordan", "hunter", "hunter2",
    "freedom", "whatever", "nothing", "internet", "computer", "system",
    "login", "signin", "access", "welcome123", "password1", "password123",
    "passw0rd1", "p@ssw0rd", "qazwsx", "qazwsxedc", "zaq12wsx",
    "aladdin", "aladin", "genie", "lamp", "openSesame".toLowerCase(),
    "opensesame", "jasmine", "sultan", "magic", "wish", "treasure",
    "cairo", "egypt", "misr", "welcome2024", "welcome2025", "welcome2026",
    "company123", "changeme123", "letmein123", "newpassword", "mypassword",
  ].map((value) => value.toLowerCase()),
);

function normalize(value: string): string {
  return value.toLowerCase().replace(/[\s\-_.!@#$%^&*()+=]/g, "");
}

function stripTrailingDigits(value: string): string {
  return value.replace(/\d+$/, "");
}

export function isCommonPassword(value: string): boolean {
  const norm = normalize(value);
  if (COMMON_PASSWORDS.has(norm)) return true;
  const stripped = stripTrailingDigits(norm);
  return stripped.length >= 4 && COMMON_PASSWORDS.has(stripped);
}

const KEYBOARD_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm", "1234567890"];
const RUN_LENGTH = 4;

/** 4+ identical characters, 4+ sequential character codes, or a 4+ run lifted from a keyboard row (either direction). */
export function hasSequentialOrRepetitiveRun(value: string): boolean {
  if (/(.)\1{3,}/.test(value)) return true;

  for (let i = 0; i + RUN_LENGTH <= value.length; i++) {
    let ascending = true;
    let descending = true;
    for (let j = 1; j < RUN_LENGTH; j++) {
      const diff = value.charCodeAt(i + j) - value.charCodeAt(i + j - 1);
      if (diff !== 1) ascending = false;
      if (diff !== -1) descending = false;
    }
    if (ascending || descending) return true;
  }

  const lower = value.toLowerCase();
  for (const row of KEYBOARD_ROWS) {
    for (let i = 0; i + RUN_LENGTH <= row.length; i++) {
      const forward = row.slice(i, i + RUN_LENGTH);
      const backward = [...forward].reverse().join("");
      if (lower.includes(forward) || lower.includes(backward)) return true;
    }
  }
  return false;
}

/**
 * Trivially derived from the account's own identifiers (email local-part,
 * full email, display name if supplied). Symmetric substring check so both
 * "ahmed12345678" (password contains the identifier) and a short password
 * that is itself contained in a longer identifier are caught.
 */
export function isAccountRelated(value: string, context: readonly string[]): boolean {
  const norm = normalize(value);
  for (const raw of context) {
    if (!raw) continue;
    // An email's DOMAIN is shared by every account on it and proves nothing
    // about this one — only the local-part (before "@") is a real
    // account-specific identifier. A bare identifier (no "@") is used as-is.
    const identifier = raw.includes("@") ? raw.split("@")[0] : raw;
    const c = normalize(identifier ?? raw);
    if (c.length >= 3 && (norm.includes(c) || c.includes(norm))) return true;
  }
  return false;
}

export type PasswordStrengthLevel = "weak" | "acceptable" | "strong";

export interface PasswordStrength {
  level: PasswordStrengthLevel;
  /** 0-4, drives the strength-meter fill. */
  score: number;
  tooShort: boolean;
  tooLong: boolean;
  common: boolean;
  sequential: boolean;
  accountRelated: boolean;
  /** True only when every hard gate passes — the Zod schema's pass/fail bit. */
  acceptable: boolean;
}

export function evaluatePasswordStrength(
  value: string,
  context: readonly string[] = [],
  minLength: number,
  maxBytes: number,
  byteLength: (v: string) => number,
): PasswordStrength {
  const bytes = byteLength(value);
  const tooShort = value.length < minLength;
  const tooLong = bytes > maxBytes;
  const common = !tooShort && isCommonPassword(value);
  const sequential = !tooShort && hasSequentialOrRepetitiveRun(value);
  const accountRelated = !tooShort && isAccountRelated(value, context);
  const acceptable = !tooShort && !tooLong && !common && !sequential && !accountRelated;

  let score = 0;
  if (!tooShort && !tooLong) {
    if (value.length >= minLength) score = 1;
    if (value.length >= minLength + 4) score = 2;
    if (value.length >= minLength + 8) score = 3;
    if (value.length >= minLength + 14) score = 4;
    const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9\s]/].filter((re) => re.test(value)).length;
    // Composition variety only ever ADDS to the score — never a requirement.
    if (classes >= 3 && score < 4) score += 1;
  }
  if (common || sequential || accountRelated) score = 0;
  score = Math.min(score, 4);

  const level: PasswordStrengthLevel = score <= 1 ? "weak" : score === 2 ? "acceptable" : "strong";
  return { level, score, tooShort, tooLong, common, sequential, accountRelated, acceptable };
}
