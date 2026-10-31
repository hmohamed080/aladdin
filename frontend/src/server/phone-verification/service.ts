import { candidateMacs, generateCode, ipBucketKey, issueMac, newChallengeId, type Keyring } from "./otp";
import type { PhoneOtpTransport } from "./transport";

/**
 * Application-server half of the phone verification authority (Phase B1).
 *
 * Responsibilities here: generate the code, MAC it with a key the database never sees, hand the code to the delivery adapter,
 * and translate the database's answers. Everything that decides truth (limits, binding, single use, the completion write)
 * lives in the database functions. This service is only ever given a user id that the caller has already authenticated.
 *
 * It grants nothing but `profiles.phone_verified_at` (written by the database). It never calls Auth, never reads or creates
 * an identity, and never logs or returns a code.
 */
export type RpcResult = { data: unknown; error: { code?: string } | null };
export interface PhoneVerificationDb {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
}

export type StartOutcome =
  | { status: "sent"; challengeId: string; expiresAt: string; resendAvailableAt: string }
  | { status: "already_verified" }
  | { status: "rate_limited"; retryAfterSeconds: number }
  | { status: "unavailable" };

export type VerifyOutcome = { status: "verified" } | { status: "invalid" } | { status: "rate_limited"; retryAfterSeconds: number } | { status: "unavailable" };

type Deps = { db: PhoneVerificationDb; transport: PhoneOtpTransport; keyring: Keyring; enabled: boolean };

const UNAVAILABLE = { status: "unavailable" } as const;
const CODE = /^[0-9]{6}$/;

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
function retryAfter(row: Record<string, unknown>): number {
  const n = Number(row.retry_after_seconds);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.ceil(n), 86_400) : 60;
}

export function createPhoneVerificationService(deps: Deps) {
  const { db, transport, keyring } = deps;

  async function start(userId: string, clientIp: string | null): Promise<StartOutcome> {
    // Feature flag first: when off, nothing is generated, no database call is made, nothing is sent.
    if (!deps.enabled) return UNAVAILABLE;

    const challengeId = newChallengeId();
    const code = generateCode();
    const ctx = { challengeId, userId, purpose: "primary_proof" as const };
    const { kid, mac } = issueMac(keyring, ctx, code);

    const { data, error } = await db.rpc("phone_verification_start", {
      p_user_id: userId, p_challenge_id: challengeId, p_kid: kid, p_code_mac: mac, p_ip_key: ipBucketKey(keyring, clientIp),
    });
    const row = asObject(data);
    if (error || !row) return UNAVAILABLE;

    if (row.status === "already_verified") return { status: "already_verified" };
    if (row.status === "rate_limited") return { status: "rate_limited", retryAfterSeconds: retryAfter(row) };
    if (row.status !== "challenge_created" || typeof row.phone_e164 !== "string") return UNAVAILABLE;

    try {
      await transport.send({ to: row.phone_e164, code, ttlSeconds: 300 });
    } catch {
      // The code could not be delivered: close the challenge so it cannot be guessed blind. The attempt still counts toward
      // the account's resend budget (cost control). No detail about the transport reaches the caller.
      await db.rpc("phone_verification_invalidate", { p_user_id: userId, p_challenge_id: challengeId, p_reason: "delivery_failed" });
      return UNAVAILABLE;
    }
    return { status: "sent", challengeId, expiresAt: String(row.expires_at), resendAvailableAt: String(row.resend_available_at) };
  }

  async function verify(userId: string, challengeId: string, code: string, clientIp: string | null): Promise<VerifyOutcome> {
    if (!deps.enabled) return UNAVAILABLE;
    // A malformed code can never match; answer exactly like a wrong one without spending a database round trip.
    if (!CODE.test(code) || !/^[0-9a-f-]{36}$/i.test(challengeId)) return { status: "invalid" };

    const { data, error } = await db.rpc("phone_verification_verify", {
      p_user_id: userId,
      p_challenge_id: challengeId,
      p_candidates: candidateMacs(keyring, { challengeId, userId, purpose: "primary_proof" }, code),
      p_ip_key: ipBucketKey(keyring, clientIp),
    });
    const row = asObject(data);
    if (error || !row) return UNAVAILABLE;
    if (row.status === "verified") return { status: "verified" };
    if (row.status === "rate_limited") return { status: "rate_limited", retryAfterSeconds: retryAfter(row) };
    if (row.status === "unavailable") return UNAVAILABLE;
    return { status: "invalid" };
  }

  return { start, verify };
}
export type PhoneVerificationService = ReturnType<typeof createPhoneVerificationService>;
