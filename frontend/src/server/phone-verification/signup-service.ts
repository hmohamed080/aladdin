import { candidateMacs, generateCode, ipBucketKey, issueMac, newChallengeId, type Keyring } from "./otp";
import type { PhoneVerificationDb } from "./service";
import type { PhoneOtpTransport } from "./transport";

/**
 * Application-server half of the SIGNUP proof (purpose `signup_proof`, R1).
 *
 * Lifecycle: there is no Auth user yet, so the proof is bound to a REGISTRATION id (a random UUID the sign-up flow keeps in its
 * sealed cookie) and to a canonical phone. Three steps, each one database function:
 *
 *   start   -> a code is generated here, MACed with a key the database never sees, and handed to the delivery adapter.
 *   verify  -> a correct code returns ONE single-use GRANT for creating the Auth user on exactly that phone alias.
 *   attach  -> after the caller created the Auth user (Admin API, with the grant in app_metadata) and ran the usual
 *              initialisation, sets profiles.phone_verified_at for the exact proven number.
 *
 * What this service never does: create or read an Auth user, return or log a code, return whether a number already has an
 * account (a taken number gets the same reply and simply no message), or grant anything but phone_verified_at.
 */
export type SignupStartOutcome =
  | { status: "sent"; challengeId: string; expiresAt: string; resendAvailableAt: string }
  | { status: "rate_limited"; retryAfterSeconds: number }
  | { status: "unavailable" };

export type SignupGrant = { id: string; registrationId: string; alias: string; phone: string; expiresAt: string };
export type SignupVerifyOutcome =
  | { status: "verified"; grant: SignupGrant }
  | { status: "invalid" }
  | { status: "rate_limited"; retryAfterSeconds: number }
  | { status: "unavailable" };
export type SignupAttachOutcome = { status: "attached" } | { status: "invalid" } | { status: "unavailable" };

type Deps = {
  db: PhoneVerificationDb;
  transport: PhoneOtpTransport;
  keyring: Keyring;
  enabled: boolean;
  /**
   * Runs the delivery AFTER the reply has been decided. Pass the platform's post-response hook (Next.js `after`, Workers `ctx.waitUntil`) in
   * production. The default is fire-and-forget, which is what tests use (they collect the tasks to await them).
   * Why it exists: if the reply waited for the network send only when a number is free, the response time would tell a caller whether a
   * number already has an account. With deferral both cases return right after the database call, in the same shape.
   */
  defer?: (task: Promise<void>) => void;
};

const UNAVAILABLE = { status: "unavailable" } as const;
const CODE = /^[0-9]{6}$/;
const E164 = /^\+[1-9][0-9]{7,14}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}
function retryAfter(row: Record<string, unknown>): number {
  const n = Number(row.retry_after_seconds);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.ceil(n), 86_400) : 60;
}

export function createPhoneSignupService(deps: Deps) {
  const { db, transport, keyring } = deps;
  const defer = deps.defer ?? ((task: Promise<void>) => { void task; });

  async function start(registrationId: string, e164: string, clientIp: string | null, locale: "en" | "ar" = "ar"): Promise<SignupStartOutcome> {
    if (!deps.enabled) return UNAVAILABLE;
    if (!UUID.test(registrationId) || !E164.test(e164)) return UNAVAILABLE;

    const challengeId = newChallengeId();
    const code = generateCode();
    const { kid, mac } = issueMac(keyring, { challengeId, registrationId, purpose: "signup_proof" }, code);

    const { data, error } = await db.rpc("phone_signup_start", {
      p_registration_id: registrationId, p_phone: e164, p_challenge_id: challengeId, p_kid: kid, p_code_mac: mac, p_ip_key: ipBucketKey(keyring, clientIp),
    });
    const row = asObject(data);
    if (error || !row) return UNAVAILABLE;
    if (row.status === "rate_limited") return { status: "rate_limited", retryAfterSeconds: retryAfter(row) };
    if (row.status !== "challenge_created") return UNAVAILABLE;

    const reply = { status: "sent" as const, challengeId, expiresAt: String(row.expires_at), resendAvailableAt: String(row.resend_available_at) };
    // The reply never depends on delivery: a number that already belongs to an account gets the identical reply (and no message), and a
    // delivery failure is not visible in it either. Delivery runs after the reply (see Deps.defer); a failure closes the challenge there.
    const deliver = row.deliver === true;
    defer((async () => {
      if (!deliver) return;
      try {
        await transport.send({ to: e164, code, ttlSeconds: 300, purpose: "signup_proof", locale, deliveryId: challengeId });
      } catch {
        try {
          await db.rpc("phone_signup_invalidate", { p_registration_id: registrationId, p_challenge_id: challengeId, p_reason: "delivery_failed" });
        } catch { /* nothing more can be done; the challenge expires on its own */ }
      }
    })());
    return reply;
  }

  async function verify(registrationId: string, challengeId: string, code: string, clientIp: string | null): Promise<SignupVerifyOutcome> {
    if (!deps.enabled) return UNAVAILABLE;
    if (!CODE.test(code) || !UUID.test(challengeId) || !UUID.test(registrationId)) return { status: "invalid" };

    const { data, error } = await db.rpc("phone_signup_verify", {
      p_registration_id: registrationId,
      p_challenge_id: challengeId,
      p_candidates: candidateMacs(keyring, { challengeId, registrationId, purpose: "signup_proof" }, code),
      p_ip_key: ipBucketKey(keyring, clientIp),
    });
    const row = asObject(data);
    if (error || !row) return UNAVAILABLE;
    if (row.status === "rate_limited") return { status: "rate_limited", retryAfterSeconds: retryAfter(row) };
    if (row.status === "unavailable") return UNAVAILABLE;
    if (row.status !== "verified" || typeof row.grant_id !== "string" || typeof row.alias !== "string" || typeof row.phone_e164 !== "string") return { status: "invalid" };
    return {
      status: "verified",
      grant: { id: row.grant_id, registrationId, alias: row.alias, phone: row.phone_e164, expiresAt: String(row.expires_at) },
    };
  }

  async function attach(userId: string, grantId: string): Promise<SignupAttachOutcome> {
    if (!deps.enabled) return UNAVAILABLE;
    if (!UUID.test(userId) || !UUID.test(grantId)) return { status: "invalid" };
    const { data, error } = await db.rpc("phone_signup_attach", { p_user_id: userId, p_grant_id: grantId });
    const row = asObject(data);
    if (error || !row) return UNAVAILABLE;
    if (row.status === "attached") return { status: "attached" };
    if (row.status === "unavailable") return UNAVAILABLE;
    return { status: "invalid" };
  }

  return { start, verify, attach };
}
export type PhoneSignupService = ReturnType<typeof createPhoneSignupService>;

/**
 * The exact Admin-API payload the sign-up flow must use to create the Auth user once a grant exists. Exported so the registration
 * code (PR #113) and the integration tests build it from one place. The marker rides app_metadata: a public /signup body can
 * never set it (measured in PR #122), and the database guard re-reads it at COMMIT.
 */
export function signupCreateUserPayload(grant: SignupGrant, fields: { password: string; fullName: string; locale: "en" | "ar"; appMetadata?: Record<string, unknown> }) {
  return {
    email: grant.alias,
    password: fields.password,
    email_confirm: true,
    user_metadata: { full_name: fields.fullName, locale: fields.locale },
    app_metadata: { ...(fields.appMetadata ?? {}), phone_signup_grant: grant.id, phone_signup_registration: grant.registrationId },
  };
}
