/**
 * Independent periodic reconciliation of the delivery switch against the Aladdin database (the authority OUTSIDE this Worker's D1).
 *
 * Why: D1 can be written by anyone holding the Cloudflare token. The audit-row check in delivery.ts catches a forged switch row, but not a
 * forged switch row PLUS a forged audit row. So the switch only counts as ON when the Aladdin database has, recently, told this Worker over the
 * private service binding that exactly this version is authorized ON, in a message signed with the notify secret (held by the app and by this
 * Worker's Secrets Store, NOT in D1). D1 contents alone can never produce that signature.
 *
 *   every cron run:  Worker --(signed, private binding)--> app: { switch state, audit tail, nonce }
 *                    app: settles pending requests from the audit tail, ALERTS on any mismatch (delivery_unmatched),
 *                         answers { authorized: { enabled, version }, issued_at, nonce, mac }
 *                    Worker: verifies the MAC, stores the attestation row in D1
 *   every send:      ON  <=>  audited switch row says ON  AND  a fresh, correctly signed attestation says ON at the SAME version
 *
 * Fail closed: no attestation, a stale one (older than ATTEST_TTL_SECONDS), a bad signature, a version mismatch, an unreadable secret or an
 * unreachable app all mean OFF. Turning OFF never waits for an attestation (OFF is read from the switch row first). Turning ON takes effect at the
 * next successful attestation (at most one cron interval). A replay of an older genuine attestation is bounded by the TTL.
 */
import type { Db } from "./db.ts";
import { deliveryReport, deliverySwitchIsOn, readDeliverySwitch } from "./delivery.ts";
import { notifyTransportAvailable, postSignedNotify, type NotifyTransportEnv } from "./notify-transport.ts";
import { signPayload } from "./signing.ts";

export const ATTEST_TTL_SECONDS = 600;
export const ATTEST_PATH = "/api/internal/whatsapp-otp/delivery-attest";
const MAX_FUTURE_SKEW = 60;
const NONCE = /^[0-9a-f]{32}$/;
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);

export type AttestEnv = NotifyTransportEnv & {
  OTP_NOTIFY_URL?: string;
  OTP_NOTIFY_SIGNING_SECRET?: { get(): Promise<string> };
  OTP_ENVIRONMENT?: string;
};

/** "v1a|environment|enabled|version|issued_at|nonce": what the app signs and this Worker re-derives. */
export function attestationCanonical(f: { env: string; enabled: boolean; version: number; issuedAt: number; nonce: string }): string {
  return ["v1a", f.env, f.enabled ? 1 : 0, f.version, f.issuedAt, f.nonce].join("|");
}

const sign = (secret: string, f: Parameters<typeof attestationCanonical>[0]) => signPayload(secret, "attest", f.issuedAt, attestationCanonical(f));

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

type AttestationRow = { enabled: number; version: number; issued_at: number; nonce: string; mac: string };

async function readAttestation(db: Pick<Db, "prepare">): Promise<AttestationRow | null> {
  return (await db.prepare("SELECT enabled, version, issued_at, nonce, mac FROM otp_delivery_attestation WHERE id = 1").bind().first<AttestationRow>()) ?? null;
}

async function secretOf(env: AttestEnv): Promise<string | null> {
  try { return (await env.OTP_NOTIFY_SIGNING_SECRET?.get()) || null; } catch { return null; }
}

/** The stored attestation verified against this Worker's secret and environment, or null. */
async function verifiedAttestation(env: AttestEnv, db: Pick<Db, "prepare">, nowSeconds: number): Promise<{ enabled: boolean; version: number; issuedAt: number } | null> {
  const secret = await secretOf(env);
  if (!secret || !env.OTP_ENVIRONMENT) return null;
  let row: AttestationRow | null;
  try { row = await readAttestation(db); } catch { return null; }
  if (!row || (row.enabled !== 0 && row.enabled !== 1) || !isInt(row.version) || !isInt(row.issued_at) || !NONCE.test(row.nonce)) return null;
  if (nowSeconds - row.issued_at > ATTEST_TTL_SECONDS || row.issued_at - nowSeconds > MAX_FUTURE_SKEW) return null;
  const expected = await sign(secret, { env: env.OTP_ENVIRONMENT, enabled: row.enabled === 1, version: row.version, issuedAt: row.issued_at, nonce: row.nonce });
  if (!expected || !constantTimeEqual(expected, row.mac)) return null;
  return { enabled: row.enabled === 1, version: row.version, issuedAt: row.issued_at };
}

/**
 * True ONLY when the switch is ON and audited (delivery.ts) AND a fresh, correctly signed attestation from the Aladdin database says ON at the
 * same version. Everything else, including every error, is false.
 */
export async function deliveryEffectivelyOn(env: AttestEnv, db: Pick<Db, "prepare">, nowSeconds: number): Promise<boolean> {
  try {
    if (!(await deliverySwitchIsOn(db))) return false;
    const sw = await readDeliverySwitch(db);
    if (!sw?.enabled) return false;
    const att = await verifiedAttestation(env, db, nowSeconds);
    return att !== null && att.enabled && att.version === sw.version;
  } catch { return false; }
}

/** Non-secret facts for the runtime report: is there a valid attestation, and how old is it (-1 = none). */
export async function attestationFacts(env: AttestEnv, db: Pick<Db, "prepare"> | undefined, nowSeconds: number): Promise<{ delivery_attested: boolean; delivery_attestation_age: number }> {
  if (!db) return { delivery_attested: false, delivery_attestation_age: -1 };
  try {
    const sw = await readDeliverySwitch(db);
    const att = await verifiedAttestation(env, db, nowSeconds);
    if (!att) return { delivery_attested: false, delivery_attestation_age: -1 };
    return { delivery_attested: sw !== null && att.enabled === sw.enabled && att.version === sw.version, delivery_attestation_age: Math.max(0, nowSeconds - att.issuedAt) };
  } catch { return { delivery_attested: false, delivery_attestation_age: -1 }; }
}

export type AttestSummary = { attested: boolean; skipped?: string };

/** One attestation round trip. Never throws; stores an attestation only when the app's answer verifies. */
export async function runAttestation(env: AttestEnv, db: Db, fetcher: typeof fetch, nowSeconds: number): Promise<AttestSummary> {
  if (!env.OTP_NOTIFY_URL || !env.OTP_ENVIRONMENT) return { attested: false, skipped: "notify_unconfigured" };
  const secret = await secretOf(env);
  if (!secret) return { attested: false, skipped: "notify_unconfigured" };
  if (!notifyTransportAvailable(env)) return { attested: false, skipped: "notify_transport_unavailable" };
  let url: URL;
  try {
    url = new URL(env.OTP_NOTIFY_URL);
    if (url.protocol !== "https:" && !["127.0.0.1", "localhost"].includes(url.hostname)) return { attested: false, skipped: "notify_unconfigured" };
    url.pathname = ATTEST_PATH;
  } catch { return { attested: false, skipped: "notify_unconfigured" }; }

  let sw: Awaited<ReturnType<typeof readDeliverySwitch>>;
  let report: Awaited<ReturnType<typeof deliveryReport>>;
  try { sw = await readDeliverySwitch(db); report = await deliveryReport(db); } catch { return { attested: false, skipped: "d1_unreadable" }; }
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  const body = JSON.stringify({
    source_env: env.OTP_ENVIRONMENT,
    nonce,
    switch: sw ? { enabled: sw.enabled, version: sw.version, updated_at: sw.updatedAt } : null,
    audit: report.delivery_audit.map((a) => ({ request_id: a.request_id, actor: a.actor, version: a.version, at: a.at, new: a.new })),
    drift: report.delivery_drift,
  });
  try {
    const sent = await postSignedNotify(env, url.toString(), secret, `att_${nonce}`, nowSeconds, body, fetcher);
    if (!sent.sent) return { attested: false, skipped: "notify_transport_unavailable" };
    if (!sent.response.ok) { await sent.response.body?.cancel().catch(() => undefined); return { attested: false, skipped: `app_${sent.response.status}` }; }
    const a = (await sent.response.json()) as { authorized?: { enabled?: unknown; version?: unknown }; issued_at?: unknown; nonce?: unknown; mac?: unknown };
    const enabled = a.authorized?.enabled, version = a.authorized?.version;
    if (typeof enabled !== "boolean" || !isInt(version) || version < 0 || !isInt(a.issued_at) || a.nonce !== nonce || typeof a.mac !== "string") return { attested: false, skipped: "answer_invalid" };
    if (Math.abs(a.issued_at - nowSeconds) > 300) return { attested: false, skipped: "answer_stale" };
    const expected = await sign(secret, { env: env.OTP_ENVIRONMENT, enabled, version, issuedAt: a.issued_at, nonce });
    if (!expected || !constantTimeEqual(expected, a.mac)) return { attested: false, skipped: "answer_unsigned" };
    await db.prepare("INSERT OR REPLACE INTO otp_delivery_attestation (id, enabled, version, issued_at, nonce, mac) VALUES (1, ?1, ?2, ?3, ?4, ?5)")
      .bind(enabled ? 1 : 0, version, a.issued_at, nonce, a.mac).run();
    return { attested: true };
  } catch { return { attested: false, skipped: "attest_failed" }; }
}
