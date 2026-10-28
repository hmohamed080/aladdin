/** Preview-only signed Supabase Send SMS Hook transport. No OTP authority. */
/** Minimal Cloudflare D1 interface for atomic, durable replay claims. */
export interface ReplayDb {
  prepare(sql: string): {
    bind(...values: (string | number)[]): {
      run(): Promise<{ success: boolean; meta?: { changes?: number } }>;
      first<T>(): Promise<T | null>;
    };
  };
}

export interface Env {
  IDEMPOTENCY_DB?: ReplayDb;
  OTP_ALLOWED_RECIPIENTS?: string;
  SUPABASE_SEND_SMS_HOOK_SECRET: string;
  WHATSAPP_ACCESS_TOKEN: { get(): Promise<string> };
  WHATSAPP_PHONE_NUMBER_ID: string;
  WHATSAPP_OTP_TEMPLATE: string;
  WHATSAPP_OTP_LANGUAGE: string;
  WHATSAPP_GRAPH_API_VERSION: string;
  WHATSAPP_DELIVERY_ENABLED: string;
}
const PATH = "/hooks/supabase/send-sms";
const MOBILE = /^\+20(?:10|11|12|15)[0-9]{8}$/;
const CODE = /^[0-9]{6}$/;
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
function answer(status: number, obj: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });
}
function decode64(value: string): Uint8Array | null {
  try { return Uint8Array.from(atob(value), c => c.charCodeAt(0)); } catch { return null; }
}
/** Check raw body against Standard Webhooks signature with a 5-minute clock window. */
export async function verifySignature(body: string, headers: Headers, secret: string, now = Date.now()): Promise<boolean> {
  const id = headers.get("webhook-id");
  const stamp = headers.get("webhook-timestamp");
  const signatures = headers.get("webhook-signature");
  if (!id || id.length > 128 || id.includes(".") || !stamp || !signatures) return false;
  if (!/^\d{10}$/.test(stamp) || Math.abs(now - Number(stamp) * 1000) > 300_000) return false;
  const encoded = secret.startsWith("v1,") ? secret.slice(3) : secret;
  if (!encoded.startsWith("whsec_")) return false;
  const secretBytes = decode64(encoded.slice(6));
  if (!secretBytes || secretBytes.length < 32) return false;
  const key = await crypto.subtle.importKey("raw", secretBytes as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const signed = new TextEncoder().encode(id + "." + stamp + "." + body);
  for (const part of signatures.split(" ")) {
    if (!part.startsWith("v1,")) continue;
    const sig = decode64(part.slice(3));
    if (sig?.length === 32 && await crypto.subtle.verify("HMAC", key, sig as BufferSource, signed)) return true;
  }
  return false;
}
/** Retain only a hash of the opaque webhook-id, never OTP or phone details. */
async function replayHash(eventId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(eventId));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}

/** Unique database insert is the concurrency boundary; a failed DB operation must fail closed. */
export async function claimEvent(db: ReplayDb, eventId: string): Promise<{ outcome: "new" | "accepted" | "blocked" | "error"; idHash: string }> {
  const idHash = await replayHash(eventId);
  try {
    const result = await db.prepare(
      "INSERT OR IGNORE INTO whatsapp_hook_events (event_hash, created_at, state) VALUES (?1, ?2, 'reserved')"
    ).bind(idHash, Math.floor(Date.now() / 1000)).run();
    if (result.success !== true || typeof result.meta?.changes !== "number") return { outcome: "error", idHash };
    if (result.meta.changes === 1) return { outcome: "new", idHash };
    const saved = await db.prepare("SELECT state FROM whatsapp_hook_events WHERE event_hash = ?1").bind(idHash).first<{ state: string }>();
    return { outcome: saved?.state === "accepted" ? "accepted" : "blocked", idHash };
  } catch {
    return { outcome: "error", idHash };
  }
}
async function recordOutcome(db: ReplayDb, idHash: string, accepted: boolean): Promise<boolean> {
  try {
    const result = await db.prepare(
      "UPDATE whatsapp_hook_events SET state = ?1 WHERE event_hash = ?2 AND state = 'reserved'"
    ).bind(accepted ? "accepted" : "failed", idHash).run();
    return result.success === true && result.meta?.changes === 1;
  } catch { return false; }
}

/** Seven-day retention, far beyond the five-minute signature window.
 * Performs one bounded batch only; no cron trigger is installed on Preview.
 * Fail closed on storage failure. All stored values are event ID hashes and state.
 */
export async function purgeExpiredReplayClaims(
  db: ReplayDb | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<{ success: boolean; deleted: number }> {
  if (!db || !Number.isSafeInteger(nowSeconds) || nowSeconds < 604800) {
    return { success: false, deleted: 0 };
  }
  try {
    const result = await db.prepare(
      "DELETE FROM whatsapp_hook_events WHERE event_hash IN (SELECT event_hash FROM whatsapp_hook_events WHERE created_at < ?1 ORDER BY created_at LIMIT 250)"
    ).bind(nowSeconds - 604800).run();
    if (result.success !== true || typeof result.meta?.changes !== "number") return { success: false, deleted: 0 };
    return { success: true, deleted: result.meta.changes };
  } catch {
    return { success: false, deleted: 0 };
  }
}

export function parseEvent(body: string): { phone: string; otp: string } | null {
  let event: unknown;
  try { event = JSON.parse(body); } catch { return null; }
  if (!event || typeof event !== "object") return null;
  const v = event as {
    new_phone?: unknown;
    user?: { phone?: unknown; new_phone?: unknown };
    sms?: { otp?: unknown; new_phone?: unknown };
  };
  // Supabase phone_change may carry the proposed recipient as new_phone while
  // user.phone still refers to the old number. NEVER send a change OTP to user.phone.
  // This transport does not implement a verified phone_change payload contract yet.
  if (v.new_phone !== undefined || v.user?.new_phone !== undefined || v.sms?.new_phone !== undefined) return null;
  if (typeof v.user?.phone !== "string" || !MOBILE.test(v.user.phone)) return null;
  if (typeof v.sms?.otp !== "string" || !CODE.test(v.sms.otp)) return null;
  return { phone: v.user.phone, otp: v.sms.otp };
}
/** No retries. The Meta ID means accepted, not delivered. */
export async function submitOtp(phone: string, otp: string, env: Env, fetcher: typeof fetch = fetch): Promise<boolean> {
  if (!MOBILE.test(phone) || !CODE.test(otp)) return false;
  if (!/^\d{5,30}$/.test(env.WHATSAPP_PHONE_NUMBER_ID)) return false;
  if (!/^[a-z][a-z0-9_]{0,511}$/.test(env.WHATSAPP_OTP_TEMPLATE)) return false;
  if (!/^v\d{1,2}\.\d$/.test(env.WHATSAPP_GRAPH_API_VERSION)) return false;
  if (env.WHATSAPP_OTP_LANGUAGE !== "ar") return false;
  const uri = "https://graph.facebook.com/" + env.WHATSAPP_GRAPH_API_VERSION + "/" + env.WHATSAPP_PHONE_NUMBER_ID + "/messages";
  const payload = {
    messaging_product: "whatsapp", to: phone.slice(1), type: "template",
    template: {
      name: env.WHATSAPP_OTP_TEMPLATE,
      language: { code: "ar" },
      components: [
        { type: "body", parameters: [{ type: "text", text: otp }] },
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: otp }] },
      ],
    },
  };
  try {
    // Resolve the account-level Secret only after signature validation and the delivery gate.
    const token = await env.WHATSAPP_ACCESS_TOKEN.get();
    if (!token) return false;
    const r = await fetcher(uri, {
      method: "POST",
      headers: { authorization: "Bearer " + token, "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(9000),
    });
    if (!r.ok) return false;
    const data = await r.json() as { messages?: Array<{ id?: unknown }> };
    return typeof data?.messages?.[0]?.id === "string";
  } catch { return false; }
}
export async function handleRequest(request: Request, env: Env, fetcher: typeof fetch = fetch): Promise<Response> {
  if (request.method !== "POST" || new URL(request.url).pathname !== PATH) return answer(404);
  if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") return answer(415);
  if (Number(request.headers.get("content-length") ?? 0) > 16384) return answer(413);
  if (!env.SUPABASE_SEND_SMS_HOOK_SECRET) return answer(503);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > 16384) return answer(413);
  if (!await verifySignature(raw, request.headers, env.SUPABASE_SEND_SMS_HOOK_SECRET)) return answer(401);
  const v = parseEvent(raw);
  if (!v) return answer(422);
  // An isolated acceptance-only allowlist is mandatory. No allowlist means no send.
  if (env.WHATSAPP_DELIVERY_ENABLED !== "true") return answer(503, { error: "delivery_disabled" });
  const allowed = (env.OTP_ALLOWED_RECIPIENTS ?? "").split(",").map(x => x.trim()).filter(Boolean);
  if (!allowed.includes(v.phone)) return answer(403);
  const db = env.IDEMPOTENCY_DB;
  if (!db) return answer(503, { error: "idempotency_unavailable" });
  const eventId = request.headers.get("webhook-id");
  if (!eventId) return answer(401);
  const claim = await claimEvent(db, eventId);
  if (claim.outcome === "error") return answer(503, { error: "idempotency_unavailable" });
  if (claim.outcome === "accepted") return answer(200); // same signed event, never re-send
  if (claim.outcome === "blocked") return answer(503, { error: "already_attempted" });
  // Reservation is written BEFORE Meta request. Even ambiguous network failures are never retried.
  const accepted = await submitOtp(v.phone, v.otp, env, fetcher);
  const saved = await recordOutcome(db, claim.idHash, accepted);
  if (!saved) return answer(503, { error: "idempotency_unavailable" });
  return accepted ? answer(200) : answer(502, { error: "delivery_unavailable" });
}
export default { fetch(request: Request, env: Env): Promise<Response> { return handleRequest(request, env); } };
