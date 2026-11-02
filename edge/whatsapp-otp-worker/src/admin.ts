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
import { sha256Hex, verifySignature } from "./signing.ts";

export const ADMIN_USAGE_PATH = "/v1/admin/usage";
export const ADMIN_SETTINGS_PATH = "/v1/admin/settings";
const MAX_ADMIN_BODY = 2048;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

const reply = (status: number, obj: unknown): Response => new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });
export const isAdminPath = (path: string): boolean => path === ADMIN_USAGE_PATH || path === ADMIN_SETTINGS_PATH;

const view = (s: OtpSettings | null) =>
  s && { daily_limit: s.dailyLimit, hard_ceiling: s.hardCeiling, warn_percent: s.warnPercent, critical_percent: s.criticalPercent, version: s.version, updated_at: s.updatedAt, updated_by: s.updatedBy };

const STATUS: Record<ApplyFailure, number> = {
  stale_version: 409, replay: 409, unreadable: 503,
  no_change: 422, reason_too_short: 422, ceiling_confirmation_required: 422, invalid_values: 422,
  thresholds_out_of_order: 422, daily_exceeds_ceiling: 422, ceiling_below_current_limit: 422,
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

export async function handleAdminRequest(request: Request, env: Env, nowMs = Date.now()): Promise<Response> {
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

  // One-time claim: a captured signed request is refused the second time, even inside the clock window.
  try {
    const claim = await db.prepare("INSERT OR IGNORE INTO otp_admin_requests (request_hash, created_at) VALUES (?1, ?2)").bind(await sha256Hex(webhookId), nowSeconds).run();
    if (claim.success !== true || typeof claim.meta?.changes !== "number") return reply(503, { error: "storage_unavailable" });
    if (claim.meta.changes !== 1) return reply(409, { error: "replay" });
  } catch { return reply(503, { error: "storage_unavailable" }); }

  try {
    if (path === ADMIN_USAGE_PATH) return reply(200, await usageReport(db, nowSeconds));
    const result = await applySettings(db, settingsReq!, nowSeconds);
    if (!result.ok) return reply(STATUS[result.error], result.currentVersion === undefined ? { error: result.error } : { error: result.error, current_version: result.currentVersion });
    return reply(200, { status: "applied", old: view(result.old), new: view(result.new), version: result.new.version });
  } catch {
    return reply(503, { error: "storage_unavailable" });
  }
}
