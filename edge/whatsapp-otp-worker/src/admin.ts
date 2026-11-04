/**
 * Signed server-to-server admin routes. Reached only by the Aladdin app server, which has ALREADY proven the caller's permission and
 * identity from the verified session (see supabase RPC admin_whatsapp_otp_settings_begin); the actor id arrives inside the signed body,
 * never from a browser. Authentication here is an HMAC with a secret that is SEPARATE from the send secret and from the notify secret.
 *
 *   POST /v1/admin/usage     { "request_id": "<uuid>" }                 -> settings, usage, failure rates, outbox state, audit history
 *   POST /v1/admin/settings  { request_id, actor_id, expected_version, daily_limit, hard_ceiling, warn_percent, critical_percent, reason,
 *                              ceiling_confirmation? }                  -> applied (atomic compare-and-set + audit) or a coded refusal
 * headers: webhook-id = "adm_" + request_id (claimed once: a captured request can never be applied twice), webhook-timestamp, webhook-signature.
 */
import type { Db } from "./db.ts";
import type { Env } from "./index.ts";
import { type ApplyFailure, type OtpSettings, applySettings, parseSettingsRequest, usageReport } from "./settings.ts";
import { grantCanonical, sha256Hex, signPayload, verifyGrant, verifySignature } from "./signing.ts";

export const ADMIN_USAGE_PATH = "/v1/admin/usage";
export const ADMIN_SETTINGS_PATH = "/v1/admin/settings";
/** Release gate: proves, FROM THE WORKER, that the app's alert endpoint is reachable and accepts this Worker's signature (no data is sent or stored). */
export const ADMIN_NOTIFY_CHECK_PATH = "/v1/admin/notify-check";
const MAX_ADMIN_BODY = 2048;
/** A grant is issued for five minutes; a far-future expiry is never accepted. */
const GRANT_MAX_AHEAD = 900;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

const reply = (status: number, obj: unknown): Response => new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });
export const isAdminPath = (path: string): boolean => path === ADMIN_USAGE_PATH || path === ADMIN_SETTINGS_PATH || path === ADMIN_NOTIFY_CHECK_PATH;

const view = (s: OtpSettings | null) =>
  s && { daily_limit: s.dailyLimit, hard_ceiling: s.hardCeiling, warn_percent: s.warnPercent, critical_percent: s.criticalPercent, version: s.version, updated_at: s.updatedAt, updated_by: s.updatedBy };

const STATUS: Record<ApplyFailure, number> = {
  stale_version: 409, replay: 409, unreadable: 503,
  no_change: 422, reason_too_short: 422, ceiling_confirmation_required: 422, invalid_values: 422,
  thresholds_out_of_order: 422, daily_exceeds_ceiling: 422, ceiling_below_current_limit: 422, ceiling_not_authorized: 403,
};

function usageRequestId(raw: string): string | null {
  try {
    const b = JSON.parse(raw) as unknown;
    if (!b || typeof b !== "object" || Array.isArray(b)) return null;
    const keys = Object.keys(b);
    const id = (b as Record<string, unknown>).request_id;
    return keys.length === 1 && typeof id === "string" && UUID.test(id) ? id.toLowerCase() : null;
  } catch { return null; }
}

export type NotifyProbe = { result: "reachable" | "secret_mismatch" | "blocked_by_cloudflare" | "refused" | "app_unconfigured" | "unexpected" | "unreachable" | "not_configured"; status?: number };

/**
 * Send ONE correctly signed but deliberately invalid body (`{"probe":true}`) to the configured alert URL and report only the HTTP class of the
 * answer. A healthy path answers 400 (signature accepted, schema refused, nothing recorded and nobody notified). Nothing about the response body
 * is read. The URL is a pinned https variable of this Worker, never request input.
 */
export async function probeNotifyPath(env: Env, nowSeconds: number, fetcher: typeof fetch = fetch): Promise<NotifyProbe> {
  const url = env.OTP_NOTIFY_URL;
  if (!url || !env.OTP_NOTIFY_SIGNING_SECRET?.get) return { result: "not_configured" };
  let secret = "";
  try { secret = await env.OTP_NOTIFY_SIGNING_SECRET.get(); } catch { return { result: "not_configured" }; }
  const body = JSON.stringify({ probe: true });
  const id = "ntf_probe";
  const signature = secret ? await signPayload(secret, id, nowSeconds, body) : null;
  if (!signature) return { result: "not_configured" };
  try {
    const res = await fetcher(url, {
      method: "POST",
      headers: { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": String(nowSeconds), "webhook-signature": signature },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
    });
    const challenged = res.headers.get("cf-mitigated") === "challenge";
    await res.body?.cancel().catch(() => undefined);
    const status = res.status;
    if (challenged) return { result: "blocked_by_cloudflare", status };
    if (status === 400) return { result: "reachable", status };
    if (status === 401) return { result: "secret_mismatch", status };
    if (status === 403) return { result: "refused", status };
    if (status === 503) return { result: "app_unconfigured", status };
    return { result: "unexpected", status };
  } catch {
    return { result: "unreachable" };
  }
}

export async function handleAdminRequest(request: Request, env: Env, nowMs = Date.now(), runtime?: () => Promise<Record<string, string | number | boolean>>, fetcher: typeof fetch = fetch): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (request.method !== "POST" || !isAdminPath(path)) return reply(404, {});
  if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") return reply(415, {});
  if (Number(request.headers.get("content-length") ?? 0) > MAX_ADMIN_BODY) return reply(413, {});
  // The admin secret is a Secrets Store binding. Unbound or unreadable fails closed: with no admin secret nothing here can run.
  if (!env.OTP_ADMIN_SIGNING_SECRET?.get) return reply(503, { error: "admin_unconfigured" });
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_ADMIN_BODY) return reply(413, {});
  let secret: string;
  try { secret = await env.OTP_ADMIN_SIGNING_SECRET.get(); } catch { return reply(503, { error: "admin_unconfigured" }); }
  if (!secret) return reply(503, { error: "admin_unconfigured" });
  // Authenticate BEFORE parsing or touching any state.
  if (!(await verifySignature(raw, request.headers, secret, nowMs))) return reply(401, {});

  const db = env.IDEMPOTENCY_DB as unknown as Db | undefined;
  if (!db) return reply(503, { error: "storage_unavailable" });
  const webhookId = request.headers.get("webhook-id") ?? "";
  const nowSeconds = Math.floor(nowMs / 1000);

  const settingsReq = path === ADMIN_SETTINGS_PATH ? parseSettingsRequest(raw) : null;
  const requestId = path === ADMIN_SETTINGS_PATH ? settingsReq?.requestId ?? null : usageRequestId(raw);
  if (!requestId) return reply(400, { error: "invalid_request" });
  // The signed id must BE this request's identity, so one valid signature cannot be replayed as a different request.
  if (webhookId !== `adm_${requestId}`) return reply(400, { error: "invalid_request" });

  // A settings change must also carry a grant the Aladdin DATABASE issued for exactly this request (see begin). The grant key is a third,
  // separate secret that the app server never holds, so a leaked admin signing secret can authenticate a request but cannot authorize a
  // change or impersonate an administrator. Checked BEFORE the replay claim so a forged request does not burn a request id.
  if (settingsReq) {
    if (!env.OTP_ADMIN_GRANT_SECRET?.get) return reply(503, { error: "grant_unconfigured" });
    let grantSecret = "";
    try { grantSecret = await env.OTP_ADMIN_GRANT_SECRET.get(); } catch { return reply(503, { error: "grant_unconfigured" }); }
    if (!grantSecret) return reply(503, { error: "grant_unconfigured" });
    const fresh = settingsReq.grantExpires >= nowSeconds && settingsReq.grantExpires - nowSeconds <= GRANT_MAX_AHEAD;
    const canonical = await grantCanonical(settingsReq, settingsReq.reasonRaw);
    if (!fresh || !(await verifyGrant(grantSecret, canonical, settingsReq.grant))) return reply(403, { error: "grant_invalid" });
  }

  // One-time claim: a captured signed request is refused the second time, even inside the clock window.
  try {
    const claim = await db.prepare("INSERT OR IGNORE INTO otp_admin_requests (request_hash, created_at) VALUES (?1, ?2)").bind(await sha256Hex(webhookId), nowSeconds).run();
    if (claim.success !== true || typeof claim.meta?.changes !== "number") return reply(503, { error: "storage_unavailable" });
    if (claim.meta.changes !== 1) return reply(409, { error: "replay" });
  } catch { return reply(503, { error: "storage_unavailable" }); }

  try {
    if (path === ADMIN_NOTIFY_CHECK_PATH) return reply(200, await probeNotifyPath(env, nowSeconds, fetcher));
    if (path === ADMIN_USAGE_PATH) {
      const report = await usageReport(db, nowSeconds);
      let facts: Record<string, string | number | boolean> | undefined;
      try { facts = await runtime?.(); } catch { facts = undefined; }
      return reply(200, facts ? { ...report, runtime: facts } : report);
    }
    const result = await applySettings(db, settingsReq!, nowSeconds);
    if (!result.ok) return reply(STATUS[result.error], result.currentVersion === undefined ? { error: result.error } : { error: result.error, current_version: result.currentVersion });
    return reply(200, { status: "applied", old: view(result.old), new: view(result.new), version: result.new.version });
  } catch {
    return reply(503, { error: "storage_unavailable" });
  }
}
