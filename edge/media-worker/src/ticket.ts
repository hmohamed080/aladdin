// Media ticket v1: `<kid>.<base64url(payload JSON)>.<base64url(HMAC-SHA256)>`.
// The MAC covers a domain-separation prefix, the kid and the payload segment, so a
// ticket cannot be replayed under another key id or protocol. The app mints the
// same format in frontend/src/server/storage/edge-ticket.ts; both sides are
// pinned by test/ticket-vectors.json.
export const TICKET_PREFIX = "aladdin.media-edge.v1.";
export const MAX_TICKET_TTL_SECONDS = 120;
export const CLOCK_SKEW_SECONDS = 5;

export const NAMESPACES = ["avatar", "portfolio", "certificate", "product", "organization"] as const;
export const VARIANTS = ["original", "thumb", "card", "full"] as const;
export type Namespace = (typeof NAMESPACES)[number];
export type Variant = (typeof VARIANTS)[number];

export type TicketClaims = {
  v: 1; ns: Namespace; k: string; var: Variant;
  sub: string; sid: string; ws: string | null; exp: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/){0,2}[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|jpeg|png|webp|pdf)$/;
const KID = /^[a-z0-9]{1,16}$/;
const B64URL = /^[A-Za-z0-9_-]+$/;

export function isUuid(value: unknown): value is string { return typeof value === "string" && UUID.test(value); }
export function isObjectKey(value: unknown): value is string { return typeof value === "string" && value.length <= 256 && KEY.test(value); }

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!B64URL.test(text)) return null;
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch { return null; }
}

/** `{"kid":"<base64url secret>", ...}`; every secret must be at least 32 bytes. */
export function parseTicketKeys(json: string): Map<string, Uint8Array<ArrayBuffer>> {
  const parsed: unknown = JSON.parse(json);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("ticket keys must be an object");
  const keys = new Map<string, Uint8Array<ArrayBuffer>>();
  for (const [kid, secret] of Object.entries(parsed)) {
    const bytes = typeof secret === "string" ? fromBase64Url(secret) : null;
    if (!KID.test(kid) || !bytes || bytes.length < 32) throw new Error("invalid ticket key");
    keys.set(kid, bytes);
  }
  if (keys.size === 0) throw new Error("no ticket keys");
  return keys;
}

const encoder = new TextEncoder();
export async function hmacKey(secret: Uint8Array<ArrayBuffer>, usage: "sign" | "verify") {
  return crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

/** Canonical field order; the app's encoder must produce byte-identical JSON. */
export function encodeClaims(c: TicketClaims): string {
  return JSON.stringify({ v: c.v, ns: c.ns, k: c.k, var: c.var, sub: c.sub, sid: c.sid, ws: c.ws, exp: c.exp });
}

export async function signTicket(kid: string, secret: Uint8Array<ArrayBuffer>, claims: TicketClaims): Promise<string> {
  const payload = toBase64Url(encoder.encode(encodeClaims(claims)));
  const mac = await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), encoder.encode(`${TICKET_PREFIX}${kid}.${payload}`));
  return `${kid}.${payload}.${toBase64Url(new Uint8Array(mac))}`;
}

function validClaims(value: unknown): value is TicketClaims {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  return Object.keys(c).length === 8 && c.v === 1
    && (NAMESPACES as readonly unknown[]).includes(c.ns) && (VARIANTS as readonly unknown[]).includes(c.var)
    && isObjectKey(c.k) && isUuid(c.sub) && isUuid(c.sid) && (c.ws === null || isUuid(c.ws))
    && typeof c.exp === "number" && Number.isSafeInteger(c.exp)
    // Workspace is only meaningful for organization media; personal media never carries one.
    && ((c.ns === "product" || c.ns === "organization") || c.ws === null);
}

/**
 * Returns the claims only for an authentic, unexpired ticket. The MAC is checked
 * (constant time, by WebCrypto) before the payload is parsed. Expiry is also
 * re-checked by the database; this check only avoids a round trip.
 */
export async function verifyTicket(ticket: string, keys: ReadonlyMap<string, Uint8Array<ArrayBuffer>>, nowSeconds: number): Promise<TicketClaims | null> {
  if (ticket.length > 2048) return null;
  const parts = ticket.split(".");
  if (parts.length !== 3) return null;
  const [kid, payload, mac] = parts as [string, string, string];
  const secret = keys.get(kid);
  const macBytes = fromBase64Url(mac);
  if (!secret || !macBytes || macBytes.length !== 32 || !B64URL.test(payload)) return null;
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), macBytes, encoder.encode(`${TICKET_PREFIX}${kid}.${payload}`));
  if (!ok) return null;
  const bytes = fromBase64Url(payload);
  if (!bytes) return null;
  let claims: unknown;
  try { claims = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { return null; }
  if (!validClaims(claims)) return null;
  if (nowSeconds > claims.exp + CLOCK_SKEW_SECONDS) return null;
  if (claims.exp > nowSeconds + MAX_TICKET_TTL_SECONDS + CLOCK_SKEW_SECONDS) return null;
  return claims;
}
