import "server-only";

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAuthSessionMissingError, type SupabaseClient } from "@supabase/supabase-js";
import { authFormWithinLimit } from "@/lib/auth/form-limits";
import { craftsmanLoginAlias } from "@/lib/auth/craftsman-login-alias";
import type { CanonicalPhone } from "@/lib/contact/phone";
import { readAuthIdentifierSecret } from "@/lib/env";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/config";
import { CHOICES_BY_KEY } from "@/lib/onboarding/account-types";
import { isUsernameWellFormed } from "@/lib/identity/username";
import { getServerSupabase } from "@/lib/supabase/server";
import {
  consumePhoneChallenge,
  countRecentPhoneChallenges,
  createPhoneSignUpUser,
  deleteCraftsmanPasswordUser,
  deletePhoneChallenge,
  insertPhoneChallenge,
  isCanonicalPhoneTaken,
  loadPhoneChallenge,
  recordPhoneChallengeAttempt,
  saveVerifiedBirthDate,
} from "@/lib/supabase/admin-server";
import { displayNameSchema, parseBirthDate, passwordWithContextSchema } from "@/features/auth-password-preview/password-policy";
import { phoneAuthLimit } from "@/server/auth/phone-auth-limit";
import { captchaTokenFrom, isCaptchaFailure } from "@/server/auth/captcha";
import { clientIpFrom, turnstileHostnamesFrom, verifyTurnstileToken } from "@/server/auth/turnstile";
import { sendWhatsAppCode } from "@/server/auth/whatsapp-otp";
import type { Database } from "@/types/database.types";

/**
 * Mobile-number sign-up on /auth/sign-up, for every account type, verified
 * with a 6-digit WhatsApp code (Meta Cloud API, server/auth/whatsapp-otp.ts).
 *
 *   1. requestPhoneSignUp — validates every field, checks Turnstile with
 *      Siteverify (no GoTrue call happens here, and each send costs money),
 *      applies the durable phone limiter plus a per-number send cap, stores an
 *      HMAC of a fresh code with a 10-minute expiry and 5 attempts, and sends
 *      it. The registration fields ride a SEALED cookie (AES-256-GCM, httpOnly,
 *      10 minutes, /auth only) because nothing exists in Auth yet.
 *   2. verifyPhoneSignUp — counts the guess first (compare-and-set), checks the
 *      code in constant time, consumes it once, and only then creates the
 *      account (internal login alias, lib/auth/craftsman-login-alias.ts),
 *      signs in (GoTrue judges the second Turnstile token) and initializes it
 *      through the same RPCs as every other sign-up. Any failure rolls the new
 *      account back.
 *
 * The password exists only inside the sealed cookie between the two steps,
 * and the cookie is deleted as soon as step 2 ends either way.
 */

export type PhoneSignUpState = { ok: boolean; code?: string; email?: string; channel?: "email" | "phone" };

type Client = SupabaseClient<Database>;
type Locale = "en" | "ar";

const COOKIE = "psu";
const COOKIE_PATH = "/auth";
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const SENDS_PER_HOUR = 5;
const CONSENT_TYPES = ["terms", "privacy", "pilot"] as const;
const E = (key: string) => `authPasswordPreview.error.${key}`;

type Pending = {
  cid: string;
  name: string;
  phone: CanonicalPhone;
  username: string;
  accountType: string;
  birthDate: string;
  password: string;
  locale: Locale;
  exp: number;
};

function key(purpose: string): Buffer {
  return createHash("sha256").update(`${purpose}:${readAuthIdentifierSecret()}`).digest();
}

function seal(value: Pending): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key("phone-sign-up-cookie"), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

function unseal(token: string | undefined): Pending | null {
  if (!token) return null;
  try {
    const raw = Buffer.from(token, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key("phone-sign-up-cookie"), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    const value = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8")) as Pending;
    if (typeof value.exp !== "number" || value.exp < Date.now() || typeof value.cid !== "string") return null;
    return value;
  } catch {
    return null;
  }
}

function codeHash(challengeId: string, code: string): string {
  return createHmac("sha256", key("phone-sign-up-code")).update(`${challengeId}:${code}`).digest("hex");
}

async function writeCookie(value: Pending): Promise<void> {
  (await cookies()).set(COOKIE, seal(value), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: COOKIE_PATH,
    maxAge: Math.floor(CODE_TTL_MS / 1000),
  });
}

async function clearCookie(): Promise<void> {
  (await cookies()).set(COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: COOKIE_PATH, maxAge: 0 });
}

function logStepFailure(step: string, error: { code?: string } | null | undefined): void {
  console.error(`phone sign-up: ${step} failed (code ${error?.code ?? "unknown"})`);
}

/** Issues a fresh code for `pending.phone` and sends it. Returns an error code, or null on success. */
async function issueCode(phone: CanonicalPhone, locale: Locale): Promise<{ cid: string } | { code: string }> {
  try {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    if ((await countRecentPhoneChallenges(phone.e164, since)) >= SENDS_PER_HOUR) return { code: E("rateLimited") };
  } catch (error) {
    logStepFailure("send_count", error as { code?: string });
    return { code: E("sendFailed") };
  }
  const cid = randomUUID();
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  try {
    await insertPhoneChallenge({ id: cid, phoneE164: phone.e164, codeHash: codeHash(cid, code), expiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString() });
  } catch (error) {
    logStepFailure("challenge", error as { code?: string });
    return { code: E("sendFailed") };
  }
  const sent = await sendWhatsAppCode(phone.e164, code, locale);
  if (sent === "sent") return { cid };
  await deletePhoneChallenge(cid).catch(() => undefined);
  if (sent === "invalid_number") return { code: E("whatsappNumberInvalid") };
  if (sent === "unavailable") return { code: E("whatsappUnavailable") };
  return { code: E("sendFailed") };
}

async function siteverify(formData: FormData, action: string): Promise<string | null> {
  const h = await headers();
  const result = await verifyTurnstileToken(formData.get("captchaToken"), {
    remoteIp: clientIpFrom((name) => h.get(name)),
    expectedAction: action,
    expectedHostnames: turnstileHostnamesFrom((name) => h.get(name)),
  });
  if (result.ok) return null;
  return result.reason === "missing" ? E("captchaRequired") : E("captchaRejected");
}

// ---------------------------------------------------------------------------
// Step 1 — validate, send the WhatsApp code.
// ---------------------------------------------------------------------------
export async function requestPhoneSignUp(formData: FormData, phone: CanonicalPhone): Promise<PhoneSignUpState> {
  const echo = String(formData.get("contact") ?? "").trim();
  const fail = (code: string): PhoneSignUpState => ({ ok: false, code, email: echo, channel: "phone" });
  if (!authFormWithinLimit(formData)) return fail(E("passwordTooLong"));

  const name = displayNameSchema.safeParse(formData.get("displayName"));
  if (!name.success) return fail(name.error.issues[0]?.message ?? E("fullNameRequired"));
  const username = String(formData.get("username") ?? "").trim();
  if (!isUsernameWellFormed(username)) return fail("registration.error.usernameShape");
  const choice = CHOICES_BY_KEY[String(formData.get("accountType") ?? "")];
  if (!choice || choice.comingSoon || choice.transitional || !choice.accountType) return fail(E("accountTypeRequired"));
  const password = passwordWithContextSchema([phone.e164, phone.national, username]).safeParse(formData.get("password"));
  if (!password.success) return fail(password.error.issues[0]?.message ?? E("passwordTooShort"));
  const birthDate = parseBirthDate(formData.get("birthDate"));
  if (!birthDate.ok) return fail(birthDate.code);
  if (!CONSENT_TYPES.every((type) => formData.get(`consent_${type}`) === "on")) return fail(E("consentRequired"));

  // Never replace a signed-in person's identity or create a second account.
  const supabase = await getServerSupabase();
  const current = await supabase.auth.getUser();
  if (current.error && !isAuthSessionMissingError(current.error)) return fail(E("sendFailed"));
  if (current.data.user) redirect("/onboarding");

  const captchaError = await siteverify(formData, "sign-up");
  if (captchaError) return fail(captchaError);

  const limited = await phoneAuthLimit("sign-up", phone.e164, await headers());
  if (limited !== "allowed") return fail(limited === "limited" ? E("rateLimited") : E("sendFailed"));

  try {
    if (await isCanonicalPhoneTaken(phone.e164)) return fail(E("phoneExists"));
  } catch (error) {
    logStepFailure("phone_precheck", error as { code?: string });
    return fail(E("sendFailed"));
  }
  const { data: available, error: availabilityError } = await supabase.rpc("username_available", { p_username: username });
  if (availabilityError || typeof available !== "boolean") return fail(E("sendFailed"));
  if (!available) return fail("registration.error.usernameUnavailable");

  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value) as Locale;
  const issued = await issueCode(phone, locale);
  if ("code" in issued) return fail(issued.code);

  await writeCookie({
    cid: issued.cid,
    name: name.data,
    phone,
    username,
    accountType: choice.key,
    birthDate: birthDate.value,
    password: password.data,
    locale,
    exp: Date.now() + CODE_TTL_MS,
  });
  return { ok: true, code: "authPasswordPreview.info.whatsappCodeSent", email: echo, channel: "phone" };
}

// ---------------------------------------------------------------------------
// Resend — a fresh code for the same pending sign-up.
// ---------------------------------------------------------------------------
export async function resendPhoneSignUpCode(formData: FormData): Promise<PhoneSignUpState> {
  const pending = unseal((await cookies()).get(COOKIE)?.value);
  if (!pending) return { ok: false, code: E("phoneCodeExpired"), channel: "phone" };
  const captchaError = await siteverify(formData, "sign-up-resend");
  if (captchaError) return { ok: false, code: captchaError, channel: "phone" };
  const limited = await phoneAuthLimit("sign-up", pending.phone.e164, await headers());
  if (limited !== "allowed") return { ok: false, code: limited === "limited" ? E("rateLimited") : E("sendFailed"), channel: "phone" };
  const issued = await issueCode(pending.phone, pending.locale);
  if ("code" in issued) return { ok: false, code: issued.code, channel: "phone" };
  await deletePhoneChallenge(pending.cid).catch(() => undefined);
  await writeCookie({ ...pending, cid: issued.cid, exp: Date.now() + CODE_TTL_MS });
  return { ok: true, code: "authPasswordPreview.info.whatsappCodeSent", channel: "phone" };
}

class InitializationError extends Error {
  constructor(readonly outcome: "phone_taken" | "username_taken" | "captcha" | "failed") {
    super(outcome);
  }
}

async function initializeAccount(supabase: Client, userId: string, pending: Pending): Promise<void> {
  const step = async (name: string, call: PromiseLike<{ error: { code?: string } | null }>) => {
    const { error } = await call;
    if (!error) return;
    if (name === "phone" && error.code === "23505") throw new InitializationError("phone_taken");
    if (name === "username" && error.code === "23505") throw new InitializationError("username_taken");
    logStepFailure(name, error);
    throw new InitializationError("failed");
  };
  const choice = CHOICES_BY_KEY[pending.accountType];
  if (!choice?.accountType) throw new InitializationError("failed");
  await step("consent", supabase.rpc("record_consent", { p_types: [...CONSENT_TYPES], p_locale: pending.locale }));
  await step("account_type", supabase.rpc("onboarding_select_account_type", {
    p_track: choice.track === "business" ? "business" : "professional",
    p_account_type: choice.accountType,
  }));
  await step("phone", supabase.rpc("profile_set_phone", {
    p_country_iso2: pending.phone.countryIso2,
    p_national: pending.phone.national,
    p_e164: pending.phone.e164,
  }));
  await step("username", supabase.rpc("profile_set_username", { p_username: pending.username }));
  await step("display_name", supabase.rpc("profile_set_display_name", { p_display_name: pending.name }));
  try {
    await saveVerifiedBirthDate(userId, pending.birthDate);
  } catch {
    logStepFailure("birth_date", null);
    throw new InitializationError("failed");
  }
}

// ---------------------------------------------------------------------------
// Step 2 — check the code, then create and sign in the account.
// ---------------------------------------------------------------------------
export async function verifyPhoneSignUp(formData: FormData): Promise<PhoneSignUpState> {
  const fail = (code: string): PhoneSignUpState => ({ ok: false, code, channel: "phone" });
  const pending = unseal((await cookies()).get(COOKIE)?.value);
  if (!pending) return fail(E("phoneCodeExpired"));
  const token = formData.get("token");
  if (typeof token !== "string" || !/^\d{6}$/.test(token)) return fail(E("invalidCode"));
  // Forwarded to GoTrue for the password grant below (one verifier per token).
  const sessionCaptcha = captchaTokenFrom(formData);
  if (!sessionCaptcha) return fail(E("captchaRequired"));

  let challenge;
  try {
    challenge = await loadPhoneChallenge(pending.cid);
  } catch (error) {
    logStepFailure("challenge_load", error as { code?: string });
    return fail(E("verifyFailed"));
  }
  if (!challenge || challenge.phoneE164 !== pending.phone.e164 || challenge.consumedAt || Date.parse(challenge.expiresAt) < Date.now() || challenge.attempts >= MAX_ATTEMPTS) {
    return fail(E("phoneCodeExpired"));
  }
  try {
    if (!(await recordPhoneChallengeAttempt(challenge.id, challenge.attempts))) return fail(E("invalidCode"));
  } catch (error) {
    logStepFailure("challenge_attempt", error as { code?: string });
    return fail(E("verifyFailed"));
  }
  const expected = Buffer.from(challenge.codeHash, "hex");
  const actual = Buffer.from(codeHash(challenge.id, token), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return fail(challenge.attempts + 1 >= MAX_ATTEMPTS ? E("phoneCodeExpired") : E("invalidCode"));
  }
  try {
    if (!(await consumePhoneChallenge(challenge.id))) return fail(E("phoneCodeExpired"));
  } catch (error) {
    logStepFailure("challenge_consume", error as { code?: string });
    return fail(E("verifyFailed"));
  }

  // The number is now proven. Create the account only now.
  try {
    if (await isCanonicalPhoneTaken(pending.phone.e164)) {
      await clearCookie();
      return fail(E("phoneExists"));
    }
  } catch (error) {
    logStepFailure("phone_precheck", error as { code?: string });
    return fail(E("verifyFailed"));
  }
  const loginAlias = craftsmanLoginAlias(pending.phone.e164);
  const created = await createPhoneSignUpUser({ loginAlias, password: pending.password, fullName: pending.name, locale: pending.locale }).catch(() => ({ ok: false as const, reason: "failed" as const }));
  if (!created.ok) {
    await clearCookie();
    if (created.reason === "exists") return fail(E("phoneExists"));
    if (created.reason === "rate_limited") return fail(E("rateLimited"));
    return fail(E("verifyFailed"));
  }

  const supabase = await getServerSupabase();
  try {
    const { error } = await supabase.auth.signInWithPassword({ email: loginAlias, password: pending.password, options: { captchaToken: sessionCaptcha } });
    if (error) {
      logStepFailure("session", error as { code?: string });
      throw new InitializationError(isCaptchaFailure(error as { code?: string; message?: string }) ? "captcha" : "failed");
    }
    await initializeAccount(supabase, created.userId, pending);
  } catch (error) {
    try { await supabase.auth.signOut({ scope: "global" }); } catch { logStepFailure("session_revoke", null); }
    try { await deleteCraftsmanPasswordUser(created.userId); } catch { logStepFailure("rollback", null); }
    const outcome = error instanceof InitializationError ? error.outcome : "failed";
    // A rejected challenge keeps the pending sign-up, so "Resend code" can start over without retyping.
    if (outcome !== "captcha") await clearCookie();
    if (!(error instanceof InitializationError)) logStepFailure("initialization", error as { code?: string });
    if (outcome === "phone_taken") return fail(E("phoneExists"));
    if (outcome === "username_taken") return fail("registration.error.usernameUnavailable");
    if (outcome === "captcha") return fail(E("captchaRejected"));
    return fail(E("verifyFailed"));
  }

  await clearCookie();
  redirect("/onboarding");
}
