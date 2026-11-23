/**
 * One-time-code cryptography for the phone verification authority (Phase B1).
 *
 * Self-contained on purpose (node:crypto only, no path aliases, no framework imports) so the same code is exercised by the
 * Vitest unit tests AND by the local integration harness against a real database.
 *
 * Trust boundary: THIS module runs in the application server. The database stores only the MAC produced here and the key id;
 * it never sees the code or the key (see supabase/migrations/20261030090001_phone_verification_authority.sql).
 */
import { createHmac, randomInt, randomUUID } from "node:crypto";

const KID = /^[A-Za-z0-9_-]{1,32}$/;
const MAX_KEYS = 3;
const MIN_KEY_BYTES = 32;

export type Keyring = { current: string; keys: ReadonlyMap<string, Buffer> };
/**
 * What a challenge is bound to. `primary_proof` proves an EXISTING user's primary phone (subject = the user id); `signup_proof`
 * proves a phone for a registration that has no Auth user yet (subject = the registration id kept in the sealed sign-up cookie).
 * The subject sits in the MAC, so a code issued to one subject can never verify for another.
 */
export type ChallengeContext =
  | { challengeId: string; purpose: "primary_proof"; userId: string }
  | { challengeId: string; purpose: "signup_proof"; registrationId: string };

function subjectOf(ctx: ChallengeContext): string {
  return ctx.purpose === "primary_proof" ? ctx.userId : ctx.registrationId;
}

/**
 * Parses PHONE_OTP_HMAC_KEYS: {"current":"k2","keys":{"k2":"<base64>","k1":"<base64>"}}.
 * Keys must decode to >= 32 bytes. At most 3 are accepted (current + previous during rotation). Throws a message that never
 * contains key material.
 */
export function parseKeyring(raw: string | undefined): Keyring {
  if (!raw) throw new Error("PHONE_OTP_HMAC_KEYS is required to verify phone numbers");
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error("PHONE_OTP_HMAC_KEYS is not valid JSON"); }
  const value = parsed as { current?: unknown; keys?: unknown };
  if (typeof value?.current !== "string" || !KID.test(value.current) || typeof value.keys !== "object" || value.keys === null) {
    throw new Error("PHONE_OTP_HMAC_KEYS must be {current, keys}");
  }
  const entries = Object.entries(value.keys as Record<string, unknown>);
  if (entries.length < 1 || entries.length > MAX_KEYS) throw new Error(`PHONE_OTP_HMAC_KEYS must hold 1..${MAX_KEYS} keys`);
  const keys = new Map<string, Buffer>();
  for (const [kid, material] of entries) {
    if (!KID.test(kid) || typeof material !== "string") throw new Error("PHONE_OTP_HMAC_KEYS has an invalid key entry");
    const bytes = Buffer.from(material, "base64");
    if (bytes.length < MIN_KEY_BYTES) throw new Error(`PHONE_OTP_HMAC_KEYS key '${kid}' must decode to at least ${MIN_KEY_BYTES} bytes`);
    keys.set(kid, bytes);
  }
  if (!keys.has(value.current)) throw new Error("PHONE_OTP_HMAC_KEYS.current must name one of the keys");
  return { current: value.current, keys };
}

/** Domain-separated subkey so one secret can never be confused across purposes. */
function subkey(key: Buffer, label: string): Buffer {
  return createHmac("sha256", key).update(label).digest();
}

/** A 6-digit code from the OS CSPRNG, uniform over 000000..999999 (no modulo bias). */
export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function newChallengeId(): string {
  return randomUUID();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIGITS = /^[0-9]{1,12}$/;

/**
 * HMAC-SHA256 over a delimited context + the code. Hex, 64 chars.
 * The fields are joined with "|", so they must be unable to contain it: ids must be UUIDs and the code digits, otherwise this
 * throws. That makes the encoding injective without relying on callers having validated first.
 */
export function computeMac(key: Buffer, ctx: ChallengeContext, code: string): string {
  const purposeOk = ctx.purpose === "primary_proof" || ctx.purpose === "signup_proof";
  const subject = purposeOk ? subjectOf(ctx) : "";
  if (!purposeOk || !UUID.test(ctx.challengeId) || !UUID.test(subject) || !DIGITS.test(code)) {
    throw new Error("invalid MAC context");
  }
  return createHmac("sha256", subkey(key, "aladdin.phone-otp.v1"))
    .update(`otp1|${ctx.challengeId}|${subject}|${ctx.purpose}|${code}`)
    .digest("hex");
}

/** The MAC under the CURRENT key, plus its key id, for issuing a challenge. */
export function issueMac(ring: Keyring, ctx: ChallengeContext, code: string): { kid: string; mac: string } {
  return { kid: ring.current, mac: computeMac(ring.keys.get(ring.current)!, ctx, code) };
}

/** {kid: mac} for every accepted key, so the database can compare the entry for the challenge's own kid. */
export function candidateMacs(ring: Keyring, ctx: ChallengeContext, code: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [kid, key] of ring.keys) out[kid] = computeMac(key, ctx, code);
  return out;
}

/**
 * Non-reversible bucket key for a client address, so the database never stores or sees an IP. Uses the CURRENT key
 * (rotation restarts the buckets, which only ever loosens a limit for one window).
 */
export function ipBucketKey(ring: Keyring, ip: string | null | undefined): string {
  return createHmac("sha256", subkey(ring.keys.get(ring.current)!, "aladdin.phone-ip.v1")).update(ip && ip.length > 0 ? ip : "unknown").digest("hex");
}
