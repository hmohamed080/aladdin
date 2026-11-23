import { signBody, verifyBody } from "./signing";

/**
 * The Worker's periodic reconciliation call (POST /api/internal/whatsapp-otp/delivery-attest), the Aladdin database's half of
 * edge/whatsapp-otp-worker/src/attest.ts. Authenticated ONLY by the notify secret's HMAC over the private service binding, like the alert callback.
 *
 * The Worker reports what its D1 claims (switch row, last audit rows). This route:
 *   1. settles pending requests the audit tail proves applied (delivery reconcile) and alerts on Worker rows nobody approved here;
 *   2. reads the AUTHORIZED state from the Aladdin database (the latest applied request; none = OFF, version 0);
 *   3. if the Worker's switch is not exactly that state, raises `whatsapp_otp.delivery_unmatched` (once per version/time) to the staff holding
 *      whatsapp_otp.view;
 *   4. answers the authorized state SIGNED with the notify secret and bound to the Worker's nonce and environment. The Worker only treats its switch
 *      as ON when this signature says ON at the same version, fresh. D1 contents alone cannot forge it.
 *
 * Statistics only: the answer carries an ON/OFF flag and a version. Errors never reveal which step failed beyond the status code.
 * 200 answered, 401 bad signature, 400 malformed, 403 wrong environment, 503 not configured or the database failed (the Worker keeps its previous
 * attestation, which expires on its own: fail closed).
 */
const MAX_BODY = 8192;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEYS = new Set(["source_env", "nonce", "switch", "audit", "drift"]);
const HOUR = 3600;

export type AuditRow = { request_id: string; actor: string; version: number; at: number; new: boolean };
export type AttestRequest = {
  sourceEnv: string;
  nonce: string;
  switchState: { enabled: boolean; version: number; updatedAt: number } | null;
  audit: AuditRow[];
  drift: { version: number; at: number } | null;
};
export type Authorized = { enabled: boolean; version: number };

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/** "v1a|environment|enabled|version|issued_at|nonce": byte-identical to the Worker's attestationCanonical. */
export function attestationCanonical(f: { env: string; enabled: boolean; version: number; issuedAt: number; nonce: string }): string {
  return ["v1a", f.env, f.enabled ? 1 : 0, f.version, f.issuedAt, f.nonce].join("|");
}

export function parseAttestBody(raw: string): AttestRequest | null {
  let b: unknown;
  try { b = JSON.parse(raw); } catch { return null; }
  if (!b || typeof b !== "object" || Array.isArray(b)) return null;
  const o = b as Record<string, unknown>;
  if (Object.keys(o).some((k) => !KEYS.has(k))) return null;
  if (typeof o.source_env !== "string" || !/^[a-z]{3,16}$/.test(o.source_env)) return null;
  if (typeof o.nonce !== "string" || !/^[0-9a-f]{32}$/.test(o.nonce)) return null;
  let switchState: AttestRequest["switchState"] = null;
  if (o.switch !== null) {
    const s = o.switch as Record<string, unknown>;
    if (!s || typeof s !== "object" || Array.isArray(s) || typeof s.enabled !== "boolean" || !isInt(s.version) || !isInt(s.updated_at)) return null;
    switchState = { enabled: s.enabled, version: s.version, updatedAt: s.updated_at };
  }
  if (!Array.isArray(o.audit) || o.audit.length > 20) return null;
  const audit: AuditRow[] = [];
  for (const r of o.audit) {
    const a = r as Record<string, unknown>;
    if (!a || typeof a !== "object" || typeof a.request_id !== "string" || !UUID.test(a.request_id) || typeof a.actor !== "string" || !UUID.test(a.actor)
      || !isInt(a.version) || !isInt(a.at) || typeof a.new !== "boolean") return null;
    audit.push({ request_id: a.request_id.toLowerCase(), actor: a.actor.toLowerCase(), version: a.version, at: a.at, new: a.new });
  }
  let drift: AttestRequest["drift"] = null;
  if (o.drift !== null && o.drift !== undefined) {
    const d = o.drift as Record<string, unknown>;
    if (!d || typeof d !== "object" || !isInt(d.version) || !isInt(d.at)) return null;
    drift = { version: d.version, at: d.at };
  }
  return { sourceEnv: o.source_env, nonce: o.nonce, switchState, audit, drift };
}

/** Does the Worker's claimed switch equal what the Aladdin database authorized? No row means OFF at version 0. */
export function switchMatches(sw: AttestRequest["switchState"], auth: Authorized): boolean {
  return (sw?.enabled ?? false) === auth.enabled && (sw?.version ?? 0) === auth.version;
}

export type AttestDeps = {
  secret: string | undefined;
  expectedSourceEnv: string | undefined;
  /** admin_whatsapp_otp_delivery_reconcile: settles requests and alerts on unmatched rows / drift. false = the database failed. */
  reconcile: (rows: AuditRow[], drift: { version: number; at: number } | null) => Promise<boolean>;
  /** admin_whatsapp_otp_delivery_authorized. null = the database failed. */
  authorized: () => Promise<Authorized | null>;
  now?: () => number;
};

const status = (code: number) => new Response(null, { status: code, headers: { "cache-control": "no-store" } });

export async function handleAttest(request: Request, deps: AttestDeps): Promise<Response> {
  if (request.method !== "POST") return status(405);
  if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") return status(415);
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return status(413);
  if (!deps.secret || !deps.expectedSourceEnv) return status(503);
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY) return status(413);
  const nowMs = deps.now?.() ?? Date.now();
  // Authenticate BEFORE parsing or touching any state.
  if (!verifyBody(deps.secret, raw, request.headers, nowMs)) return status(401);
  const req = parseAttestBody(raw);
  if (!req) return status(400);
  if (req.sourceEnv !== deps.expectedSourceEnv) return status(403);
  // The signed id must BE this request's identity (att_<nonce>): one signature cannot be re-labelled as another call.
  if (request.headers.get("webhook-id") !== `att_${req.nonce}`) return status(400);
  const nowSeconds = Math.floor(nowMs / 1000);
  try {
    if (!(await deps.reconcile(req.audit, req.drift))) return status(503);
    const auth = await deps.authorized();
    if (!auth) return status(503);
    const match = switchMatches(req.switchState, auth);
    if (!match) {
      // The Worker's switch is not what the Aladdin database authorized (a forged or rolled-back D1): alert, once per version/time.
      const at = req.switchState && req.switchState.updatedAt >= 1_000_000_000 ? req.switchState.updatedAt : Math.floor(nowSeconds / HOUR) * HOUR;
      if (!(await deps.reconcile([], { version: req.switchState?.version ?? auth.version, at }))) return status(503);
    }
    const mac = signBody(deps.secret, "attest", nowSeconds, attestationCanonical({ env: deps.expectedSourceEnv, enabled: auth.enabled, version: auth.version, issuedAt: nowSeconds, nonce: req.nonce }));
    if (!mac) return status(503);
    return new Response(JSON.stringify({ authorized: auth, issued_at: nowSeconds, nonce: req.nonce, mac, match }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  } catch {
    return status(503);
  }
}
