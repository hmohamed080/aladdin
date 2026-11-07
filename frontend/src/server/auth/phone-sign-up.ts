import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAuthSessionMissingError, type SupabaseClient } from "@supabase/supabase-js";
import { authFormWithinLimit } from "@/lib/auth/form-limits";
import { craftsmanLoginAlias } from "@/lib/auth/craftsman-login-alias";
import type { CanonicalPhone } from "@/lib/contact/phone";
import { readPhoneVerificationEnv } from "@/lib/env/phone-verification";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/config";
import { CHOICES_BY_KEY } from "@/lib/onboarding/account-types";
import { isUsernameWellFormed } from "@/lib/identity/username";
import { getServerSupabase } from "@/lib/supabase/server";
import { createPhoneSignUpUser, deleteCraftsmanPasswordUser, isCanonicalPhoneTaken, saveVerifiedBirthDate } from "@/lib/supabase/admin-server";
import { displayNameSchema, parseBirthDate, passwordWithContextSchema } from "@/features/auth-password-preview/password-policy";
import { phoneAuthLimit } from "@/server/auth/phone-auth-limit";
import { captchaTokenFrom, isCaptchaFailure } from "@/server/auth/captcha";
import { clientIpFrom, turnstileHostnamesFrom, verifyTurnstileToken } from "@/server/auth/turnstile";
import { getPhoneSignupService } from "@/server/phone-verification/runtime";
import type { PhoneSignupService, SignupGrant } from "@/server/phone-verification/signup-service";
import type { Database } from "@/types/database.types";

/**
 * Mobile-number sign-up on /auth/sign-up, for every account type, proven with a 6-digit WhatsApp code.
 *
 * There is ONE authority for that proof: the phone verification authority (server/phone-verification, migrations 20261030090001/2).
 * This file owns the form flow only. It generates, hashes, stores, sends and checks NO code of its own.
 *
 *   1. requestPhoneSignUp — validates every field, checks Turnstile with Siteverify (no GoTrue call happens here), applies the durable
 *      phone limiter, then asks the authority to open a challenge for a random REGISTRATION id. The authority generates and MACs the code,
 *      and the delivery adapter sends it AFTER this reply (Next `after`), so the reply never depends on delivery: a number that already
 *      belongs to an account gets the same screen, the same timing and simply no message. The registration fields ride a SEALED cookie
 *      (AES-256-GCM, httpOnly, 10 minutes, /auth only) because nothing exists in Auth yet.
 *   2. verifyPhoneSignUp — the authority checks the code (attempt caps live there) and returns ONE single-use GRANT for exactly that phone
 *      alias. Only then is the Auth user created, through the Admin API with the grant in app_metadata (the database guard refuses a
 *      phone-alias account without one). The user then signs in (GoTrue judges the second Turnstile token), is initialized through the same
 *      RPCs as every other sign-up, and only then is the proof attached: `attach` sets profiles.phone_verified_at for the exact proven
 *      number. Any failure — including a refused attach — rolls the new account back.
 *
 * The password exists only inside the sealed cookie between the two steps, and the cookie is deleted as soon as step 2 ends either way.
 * Email and OAuth registration never pass through here and never need WhatsApp proof.
 */

export type PhoneSignUpState = { ok: boolean; code?: string; email?: string; channel?: "email" | "phone" };

type Client = SupabaseClient<Database>;
type Locale = "en" | "ar";

const COOKIE = "psu";
const COOKIE_PATH = "/auth";
const COOKIE_TTL_MS = 10 * 60 * 1000;
const CONSENT_TYPES = ["terms", "privacy", "pilot"] as const;
const E = (key: string) => `authPasswordPreview.error.${key}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Pending = {
  /** The registration id the authority binds every challenge and the grant to. Random, never derived from the number. */
  rid: string;
  /** The latest challenge id (replaced on resend). */
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

// The pending-sign-up cookie holds the password for at most 10 minutes, so it gets its OWN secret (PHONE_SIGNUP_COOKIE_SECRET): neither the code
// keyring nor the shared auth secret can open it. The ciphertext is also bound to this purpose with AEAD associated data.
const COOKIE_AAD = Buffer.from("aladdin/phone-sign-up/psu/v1");
function cookieKey(): Buffer {
  const secret = readPhoneVerificationEnv().signupCookieSecret;
  if (!secret || secret.length < 32) throw new Error("PHONE_SIGNUP_COOKIE_SECRET is not configured");
  return createHash("sha256").update(`phone-sign-up-cookie:${secret}`).digest();
}

function seal(value: Pending): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", cookieKey(), iv);
  cipher.setAAD(COOKIE_AAD);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

function unseal(token: string | undefined): Pending | null {
  if (!token) return null;
  try {
    const raw = Buffer.from(token, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", cookieKey(), raw.subarray(0, 12));
    decipher.setAAD(COOKIE_AAD);
    decipher.setAuthTag(raw.subarray(12, 28));
    const value = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8")) as Pending;
    if (typeof value.exp !== "number" || value.exp < Date.now()) return null;
    if (typeof value.rid !== "string" || !UUID.test(value.rid) || typeof value.cid !== "string" || !UUID.test(value.cid)) return null;
    return value;
  } catch {
    return null;
  }
}

async function writeCookie(value: Pending): Promise<void> {
  (await cookies()).set(COOKIE, seal(value), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: COOKIE_PATH,
    maxAge: Math.floor(COOKIE_TTL_MS / 1000),
  });
}

async function clearCookie(): Promise<void> {
  (await cookies()).set(COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: COOKIE_PATH, maxAge: 0 });
}

function logStepFailure(step: string, error: { code?: string } | null | undefined): void {
  console.error(`phone sign-up: ${step} failed (code ${error?.code ?? "unknown"})`);
}

async function callerIp(): Promise<string | null> {
  const h = await headers();
  return clientIpFrom((name) => h.get(name)) ?? null;
}

/**
 * Opens (or, on resend, replaces) the challenge through the authority. The authority's reply is identical for a free and a taken
 * number; this function must not add any await on delivery or any branch that depends on whether the number is registered.
 * `getPhoneSignupService()` is called here, inside the server action, because it wires Next `after()` to the request.
 */
async function startChallenge(rid: string, phone: CanonicalPhone, locale: Locale): Promise<{ cid: string } | { code: string }> {
  try {
    const service = getPhoneSignupService();
    if (!service) return { code: E("whatsappUnavailable") };
    const outcome = await service.start(rid, phone.e164, await callerIp(), locale);
    if (outcome.status === "sent") return { cid: outcome.challengeId };
    if (outcome.status === "rate_limited") return { code: E("rateLimited") };
    return { code: E("whatsappUnavailable") };
  } catch (error) {
    logStepFailure("challenge_start", error as { code?: string });
    return { code: E("sendFailed") };
  }
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
// Step 1 — validate, open the challenge (the code is sent after the reply).
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

  // There is deliberately NO "is this number registered?" check here: the answer would be a phone-number existence oracle. A number that
  // already has an account goes through the same screens and simply receives no code (the authority suppresses delivery).
  const { data: available, error: availabilityError } = await supabase.rpc("username_available", { p_username: username });
  if (availabilityError || typeof available !== "boolean") return fail(E("sendFailed"));
  if (!available) return fail("registration.error.usernameUnavailable");

  // Fail closed BEFORE a code is requested: without the cookie secret the pending sign-up cannot be kept, so no message may be sent.
  try {
    cookieKey();
  } catch {
    logStepFailure("cookie_key", null);
    return fail(E("whatsappUnavailable"));
  }

  const locale = resolveLocale((await cookies()).get(LOCALE_COOKIE)?.value) as Locale;
  const rid = randomUUID();
  const started = await startChallenge(rid, phone, locale);
  if ("code" in started) return fail(started.code);

  await writeCookie({
    rid,
    cid: started.cid,
    name: name.data,
    phone,
    username,
    accountType: choice.key,
    birthDate: birthDate.value,
    password: password.data,
    locale,
    exp: Date.now() + COOKIE_TTL_MS,
  });
  return { ok: true, code: "authPasswordPreview.info.whatsappCodeSent", email: echo, channel: "phone" };
}

// ---------------------------------------------------------------------------
// Resend — a fresh challenge for the same registration (the authority supersedes the previous one and enforces the cooldown).
// ---------------------------------------------------------------------------
export async function resendPhoneSignUpCode(formData: FormData): Promise<PhoneSignUpState> {
  const pending = unseal((await cookies()).get(COOKIE)?.value);
  if (!pending) return { ok: false, code: E("phoneCodeExpired"), channel: "phone" };
  const captchaError = await siteverify(formData, "sign-up-resend");
  if (captchaError) return { ok: false, code: captchaError, channel: "phone" };
  const limited = await phoneAuthLimit("sign-up", pending.phone.e164, await headers());
  if (limited !== "allowed") return { ok: false, code: limited === "limited" ? E("rateLimited") : E("sendFailed"), channel: "phone" };
  const started = await startChallenge(pending.rid, pending.phone, pending.locale);
  if ("code" in started) return { ok: false, code: started.code, channel: "phone" };
  await writeCookie({ ...pending, cid: started.cid, exp: Date.now() + COOKIE_TTL_MS });
  return { ok: true, code: "authPasswordPreview.info.whatsappCodeSent", channel: "phone" };
}

class InitializationError extends Error {
  constructor(readonly outcome: "phone_taken" | "username_taken" | "captcha" | "failed") {
    super(outcome);
  }
}

async function initializeAccount(supabase: Client, userId: string, pending: Pending, grant: SignupGrant, service: PhoneSignupService): Promise<void> {
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
  // Last: the profile now holds exactly the proven number, so the authority can stamp phone_verified_at for it. Anything but a clean
  // "attached" (grant expired, wrong user, wrong number, feature switched off meanwhile) fails the whole sign-up and rolls it back.
  const attached = await service.attach(userId, grant.id);
  if (attached.status !== "attached") {
    logStepFailure("attach", null);
    throw new InitializationError("failed");
  }
}

// ---------------------------------------------------------------------------
// Step 2 — the authority checks the code and returns a grant; then create, sign in and initialize the account.
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

  const service = (() => {
    try {
      return getPhoneSignupService();
    } catch (error) {
      logStepFailure("service", error as { code?: string });
      return null;
    }
  })();
  if (!service) return fail(E("whatsappUnavailable"));

  let proof;
  try {
    proof = await service.verify(pending.rid, pending.cid, token, await callerIp());
  } catch (error) {
    logStepFailure("challenge_verify", error as { code?: string });
    return fail(E("verifyFailed"));
  }
  if (proof.status === "rate_limited") return fail(E("rateLimited"));
  if (proof.status === "unavailable") return fail(E("verifyFailed"));
  if (proof.status !== "verified") return fail(E("invalidCode"));

  // The number is now proven. The grant must be for exactly the number and alias this sign-up asked for — never trust that alone.
  const loginAlias = craftsmanLoginAlias(pending.phone.e164);
  const grant = proof.grant;
  if (grant.phone !== pending.phone.e164 || grant.alias !== loginAlias || grant.registrationId !== pending.rid) {
    await clearCookie();
    logStepFailure("grant_mismatch", null);
    return fail(E("verifyFailed"));
  }

  // The number may have been taken by another account since the code was sent (the authority re-checks too).
  try {
    if (await isCanonicalPhoneTaken(pending.phone.e164)) {
      await clearCookie();
      return fail(E("phoneExists"));
    }
  } catch (error) {
    logStepFailure("phone_precheck", error as { code?: string });
    return fail(E("verifyFailed"));
  }

  const created = await createPhoneSignUpUser({ grant, password: pending.password, fullName: pending.name, locale: pending.locale }).catch(() => ({ ok: false as const, reason: "failed" as const }));
  if (!created.ok) {
    await clearCookie();
    if (created.reason === "exists") return fail(E("phoneExists"));
    if (created.reason === "rate_limited") return fail(E("rateLimited"));
    // Auth refused the password (for example a breached one when leaked-password protection is on). The Auth user was never created, so the
    // grant is unspent; the cookie holding the refused password is already gone, so the person starts again with another one.
    if (created.reason === "rejected") return fail(E("passwordRejected"));
    return fail(E("verifyFailed"));
  }

  const supabase = await getServerSupabase();
  try {
    const { error } = await supabase.auth.signInWithPassword({ email: loginAlias, password: pending.password, options: { captchaToken: sessionCaptcha } });
    if (error) {
      logStepFailure("session", error as { code?: string });
      throw new InitializationError(isCaptchaFailure(error as { code?: string; message?: string }) ? "captcha" : "failed");
    }
    await initializeAccount(supabase, created.userId, pending, grant, service);
  } catch (error) {
    try { await supabase.auth.signOut({ scope: "global" }); } catch { logStepFailure("session_revoke", null); }
    try { await deleteCraftsmanPasswordUser(created.userId); } catch { logStepFailure("rollback", null); }
    const outcome = error instanceof InitializationError ? error.outcome : "failed";
    // A rejected captcha keeps the pending sign-up, so "Resend code" can start over (same registration) without retyping.
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
