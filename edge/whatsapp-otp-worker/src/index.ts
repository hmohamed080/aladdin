/**
 * Aladdin WhatsApp OTP delivery Worker.
 *
 * DELIVERY ONLY. The phone verification authority (Aladdin's database + server code, R1/R2) is the only place a code is generated,
 * stored (as a MAC) and verified. This Worker receives a code the application server already generated, over a signed request, and
 * hands it to the Meta WhatsApp Cloud API. It keeps no proof state, never answers "is this code right", and holds the Meta access token
 * (a Secrets Store binding) that no other component has.
 *
 * Contract with the application (frontend/src/server/phone-verification/delivery.ts, createWorkerTransport):
 *   POST /v1/otp/send        body {to, code, purpose, locale, ttl_seconds, delivery_id}
 *   headers                  webhook-id = "otp_" + delivery_id, webhook-timestamp (unix s), webhook-signature = "v1," + base64(HMAC-SHA256(id.ts.body))
 *   POST /v1/preflight       signed the same way, body {"check":"preflight"}: booleans/counts only (secret PRESENCE, never values)
 * The Supabase Send-SMS-hook route of PR #114 is intentionally gone: nothing here can be driven by Supabase Phone Auth.
 *
 * Order of checks (each cheaper than the next; Meta is called only after ALL pass):
 *   method/path -> content type -> size -> signing secret bound -> signature+clock window -> body schema -> id binds to delivery_id ->
 *   delivery switch -> recipient policy -> D1 reachable -> atomic claim (INSERT OR IGNORE on the hash of the id) -> Meta, no retry.
 * Idempotency identity = the challenge (delivery_id): the same signed delivery can never produce a second Meta message, and a failed or
 * ambiguous attempt is never retried here (a resend is a NEW challenge decided by the authority's cooldowns).
 * Nothing logs a code, a number, a header or a body.
 */

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
  /** Secrets Store binding: "whsec_" + base64 (>= 32 bytes). The application holds the same value as PHONE_OTP_WORKER_SECRET. */
  OTP_SIGNING_SECRET: { get(): Promise<string> };
  /** Secrets Store binding: the Meta system-user token. Exists ONLY on this Worker. */
  WHATSAPP_ACCESS_TOKEN: { get(): Promise<string> };
  WHATSAPP_PHONE_NUMBER_ID: string;
  WHATSAPP_OTP_TEMPLATE: string;
  /** Comma list of template languages Meta has APPROVED for the template (default "ar"). A locale outside it is sent in "ar". */
  WHATSAPP_OTP_LANGUAGES?: string;
  WHATSAPP_GRAPH_API_VERSION: string;
  /** Master switch. Anything but the literal "true" means nothing is sent. */
  WHATSAPP_DELIVERY_ENABLED: string;
  /** "acceptance" | "production" | "local". Only "production" may use recipient mode "open"; only "local" may redirect the Graph URL. */
  OTP_ENVIRONMENT?: string;
  /** "allowlist" (default; no list = no send) | "open" (production only, explicit). */
  OTP_RECIPIENT_MODE?: string;
  /** Exact E.164 numbers, comma separated. Set in the Worker dashboard, never in the repository. */
  OTP_ALLOWED_RECIPIENTS?: string;
  /** LOCAL rigs only (OTP_ENVIRONMENT=local): a loopback http URL standing in for graph.facebook.com. */
  WHATSAPP_GRAPH_BASE_URL?: string;
}

const SEND_PATH = "/v1/otp/send";
const PREFLIGHT_PATH = "/v1/preflight";
const MOBILE = /^\+20(?:10|11|12|15)[0-9]{8}$/;
const CODE = /^[0-9]{6}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PURPOSES = new Set(["primary_proof", "signup_proof"]);
const LOCALES = new Set(["ar", "en"]);
const MAX_BODY = 4096;
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function answer(status: number, obj: Record<string, string | number | boolean> = {}): Response {
  return new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });
}
function decode64(value: string): Uint8Array | null {
  try { return Uint8Array.from(atob(value), (c) => c.charCodeAt(0)); } catch { return null; }
}

/** Check the raw body against a Standard Webhooks style signature with a 5-minute clock window. */
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
    if (sig?.length === 32 && (await crypto.subtle.verify("HMAC", key, sig as BufferSource, signed))) return true;
  }
  return false;
}

/** Retain only a hash of the opaque delivery id, never a code or phone detail. */
async function replayHash(eventId: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(eventId));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The unique insert is the concurrency boundary; any storage problem fails closed. */
export async function claimEvent(db: ReplayDb, eventId: string): Promise<{ outcome: "new" | "accepted" | "blocked" | "error"; idHash: string }> {
  const idHash = await replayHash(eventId);
  try {
    const result = await db
      .prepare("INSERT OR IGNORE INTO whatsapp_hook_events (event_hash, created_at, state) VALUES (?1, ?2, 'reserved')")
      .bind(idHash, Math.floor(Date.now() / 1000))
      .run();
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
    const result = await db
      .prepare("UPDATE whatsapp_hook_events SET state = ?1 WHERE event_hash = ?2 AND state = 'reserved'")
      .bind(accepted ? "accepted" : "failed", idHash)
      .run();
    return result.success === true && result.meta?.changes === 1;
  } catch {
    return false;
  }
}

/** Seven-day retention, far beyond the five-minute signature window. One bounded batch per call; no cron is installed by this repo. */
export async function purgeExpiredReplayClaims(
  db: ReplayDb | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<{ success: boolean; deleted: number }> {
  if (!db || !Number.isSafeInteger(nowSeconds) || nowSeconds < 604800) return { success: false, deleted: 0 };
  try {
    const result = await db
      .prepare("DELETE FROM whatsapp_hook_events WHERE event_hash IN (SELECT event_hash FROM whatsapp_hook_events WHERE created_at < ?1 ORDER BY created_at LIMIT 250)")
      .bind(nowSeconds - 604800)
      .run();
    if (result.success !== true || typeof result.meta?.changes !== "number") return { success: false, deleted: 0 };
    return { success: true, deleted: result.meta.changes };
  } catch {
    return { success: false, deleted: 0 };
  }
}

export type SendRequest = { to: string; code: string; purpose: "primary_proof" | "signup_proof"; locale: "ar" | "en"; ttlSeconds: number; deliveryId: string };

/** Strict schema of the application's request; anything else is refused before any state is touched. */
export function parseSend(body: string): SendRequest | null {
  let v: unknown;
  try { v = JSON.parse(body); } catch { return null; }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.to !== "string" || !MOBILE.test(o.to)) return null;
  if (typeof o.code !== "string" || !CODE.test(o.code)) return null;
  if (typeof o.purpose !== "string" || !PURPOSES.has(o.purpose)) return null;
  if (typeof o.locale !== "string" || !LOCALES.has(o.locale)) return null;
  if (typeof o.ttl_seconds !== "number" || !Number.isInteger(o.ttl_seconds) || o.ttl_seconds < 30 || o.ttl_seconds > 900) return null;
  if (typeof o.delivery_id !== "string" || !UUID.test(o.delivery_id)) return null;
  return { to: o.to, code: o.code, purpose: o.purpose as SendRequest["purpose"], locale: o.locale as SendRequest["locale"], ttlSeconds: o.ttl_seconds, deliveryId: o.delivery_id.toLowerCase() };
}

function allowedRecipients(env: Env): string[] {
  return (env.OTP_ALLOWED_RECIPIENTS ?? "").split(",").map((x) => x.trim()).filter((x) => MOBILE.test(x));
}
/** An isolated allow-list is the default and mandatory outside production: no list means no send. "open" only counts in production. */
export function recipientAllowed(phone: string, env: Env): boolean {
  if (env.OTP_RECIPIENT_MODE === "open" && env.OTP_ENVIRONMENT === "production") return true;
  return allowedRecipients(env).includes(phone);
}

/** Template language for a locale: the locale if Meta approved it for the template, otherwise Arabic (which must itself be approved). */
export function templateLanguage(locale: "ar" | "en", env: Env): string | null {
  const approved = (env.WHATSAPP_OTP_LANGUAGES ?? "ar").split(",").map((x) => x.trim()).filter((x) => /^[a-z]{2}(_[A-Z]{2})?$/.test(x));
  if (approved.includes(locale)) return locale;
  return approved.includes("ar") ? "ar" : null;
}

function graphBase(env: Env): string {
  if (env.OTP_ENVIRONMENT === "local" && env.WHATSAPP_GRAPH_BASE_URL) {
    const u = new URL(env.WHATSAPP_GRAPH_BASE_URL);
    if (u.protocol === "http:" && ["127.0.0.1", "localhost"].includes(u.hostname)) return u.origin;
  }
  return "https://graph.facebook.com";
}

/**
 * The exact Meta payload for an approved AUTHENTICATION template with a copy-code (one-tap/copy) button: the code goes in the body
 * parameter AND in the button's text parameter (sub_type "url", index "0"). No retries: a Meta message id means "accepted", not "delivered".
 */
export function buildMetaPayload(phone: string, code: string, template: string, language: string) {
  return {
    messaging_product: "whatsapp",
    to: phone.slice(1),
    type: "template",
    template: {
      name: template,
      language: { code: language },
      components: [
        { type: "body", parameters: [{ type: "text", text: code }] },
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
      ],
    },
  };
}

export async function submitOtp(req: SendRequest, env: Env, fetcher: typeof fetch = fetch): Promise<boolean> {
  if (!/^\d{5,30}$/.test(env.WHATSAPP_PHONE_NUMBER_ID)) return false;
  if (!/^[a-z][a-z0-9_]{0,511}$/.test(env.WHATSAPP_OTP_TEMPLATE)) return false;
  if (!/^v\d{1,2}\.\d$/.test(env.WHATSAPP_GRAPH_API_VERSION)) return false;
  const language = templateLanguage(req.locale, env);
  if (!language) return false;
  const uri = `${graphBase(env)}/${env.WHATSAPP_GRAPH_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  try {
    // The Meta token is resolved only now, after every gate passed.
    const token = await env.WHATSAPP_ACCESS_TOKEN.get();
    if (!token) return false;
    const r = await fetcher(uri, {
      method: "POST",
      headers: { authorization: "Bearer " + token, "content-type": "application/json" },
      body: JSON.stringify(buildMetaPayload(req.to, req.code, env.WHATSAPP_OTP_TEMPLATE, language)),
      signal: AbortSignal.timeout(9000),
    });
    if (!r.ok) return false;
    const data = (await r.json()) as { messages?: Array<{ id?: unknown }> };
    return typeof data?.messages?.[0]?.id === "string";
  } catch {
    return false;
  }
}

/** Signed, side-effect-free runtime check: reports whether each binding is PRESENT and the switches' state. Never a value. */
async function preflight(env: Env): Promise<Response> {
  let tokenBound = false;
  try { tokenBound = Boolean(await env.WHATSAPP_ACCESS_TOKEN?.get()); } catch { tokenBound = false; }
  let d1 = false;
  try { d1 = Boolean(env.IDEMPOTENCY_DB && (await env.IDEMPOTENCY_DB.prepare("SELECT 1 AS ok").bind().first<{ ok: number }>())?.ok === 1); } catch { d1 = false; }
  return answer(200, {
    signing_secret_bound: true,
    meta_token_bound: tokenBound,
    d1_reachable: d1,
    delivery_enabled: env.WHATSAPP_DELIVERY_ENABLED === "true",
    environment: env.OTP_ENVIRONMENT ?? "unset",
    recipient_mode: env.OTP_RECIPIENT_MODE === "open" && env.OTP_ENVIRONMENT === "production" ? "open" : "allowlist",
    allowlist_entries: allowedRecipients(env).length,
    template: env.WHATSAPP_OTP_TEMPLATE,
    languages: (env.WHATSAPP_OTP_LANGUAGES ?? "ar"),
    graph_version: env.WHATSAPP_GRAPH_API_VERSION,
    sender_id_suffix: String(env.WHATSAPP_PHONE_NUMBER_ID ?? "").slice(-4),
  });
}

export async function handleRequest(request: Request, env: Env, fetcher: typeof fetch = fetch): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (request.method !== "POST" || (path !== SEND_PATH && path !== PREFLIGHT_PATH)) return answer(404);
  if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") return answer(415);
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return answer(413);
  // The signing key is a Secrets Store binding resolved only for candidate requests; missing or erroring fails closed.
  if (!env.OTP_SIGNING_SECRET?.get) return answer(503);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY) return answer(413);
  let signingSecret: string;
  try { signingSecret = await env.OTP_SIGNING_SECRET.get(); } catch { return answer(503); }
  if (!signingSecret) return answer(503);
  if (!(await verifySignature(raw, request.headers, signingSecret))) return answer(401);

  if (path === PREFLIGHT_PATH) return preflight(env);

  const req = parseSend(raw);
  if (!req) return answer(422);
  const eventId = request.headers.get("webhook-id");
  // The signed id must BE this delivery's identity, so a valid signature for one challenge cannot be replayed as another.
  if (eventId !== `otp_${req.deliveryId}`) return answer(400);
  if (env.WHATSAPP_DELIVERY_ENABLED !== "true") return answer(503, { error: "delivery_disabled" });
  if (!recipientAllowed(req.to, env)) return answer(403);
  const db = env.IDEMPOTENCY_DB;
  if (!db) return answer(503, { error: "idempotency_unavailable" });
  const claim = await claimEvent(db, eventId);
  if (claim.outcome === "error") return answer(503, { error: "idempotency_unavailable" });
  if (claim.outcome === "accepted") return answer(200, { status: "duplicate" }); // the same delivery, never re-sent
  if (claim.outcome === "blocked") return answer(409, { error: "already_attempted" });
  // The reservation is written BEFORE Meta is called. Even an ambiguous network failure is never retried by this Worker.
  const accepted = await submitOtp(req, env, fetcher);
  const saved = await recordOutcome(db, claim.idHash, accepted);
  if (!saved) return answer(503, { error: "idempotency_unavailable" });
  return accepted ? answer(200, { status: "accepted" }) : answer(502, { error: "delivery_unavailable" });
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};
