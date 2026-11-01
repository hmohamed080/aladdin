// Admin View-As ticket v1: `<kid>.<base64url(payload JSON)>.<base64url(HMAC-SHA256)>`, with its OWN domain-separation prefix so an owner
// image ticket (`aladdin.media-edge.v1.`) or a video ticket can never be replayed as a View-As ticket, or the reverse. Same keys
// (TICKET_KEYS) as the other ticket types, exactly like the video ticket.
//
// Unlike an owner ticket it names NO storage key and NO path: it names a DATABASE RECORD (`rid`: portfolio item / certificate /
// avatar upload id) and the viewed account (`subj`). The object key is resolved only inside the database
// (public.media_edge_view_as_authorize), so a decoded ticket reveals nothing the Admin did not already see in the page.
// The app mints these in frontend/src/server/view-as/media-ticket.ts; both sides are pinned by test/view-as-ticket-vectors.json.
import { CLOCK_SKEW_SECONDS, MAX_TICKET_TTL_SECONDS, VARIANTS, fromBase64Url, hmacKey, isUuid, toBase64Url, type Variant } from "./ticket";

export const VIEW_AS_TICKET_PREFIX = "aladdin.media-view-as.v1.";
export const VIEW_AS_KINDS = ["portfolio_item", "certificate", "avatar"] as const;
export type ViewAsKind = (typeof VIEW_AS_KINDS)[number];

/** The storage namespace a kind lives in; used only to validate the grant the database returns. */
export const VIEW_AS_NAMESPACE: Record<ViewAsKind, string> = { portfolio_item: "portfolio", certificate: "certificate", avatar: "avatar" };

export type ViewAsClaims = {
  v: 1; kind: ViewAsKind; rid: string; var: Variant; adm: string; sid: string; subj: string; exp: number;
};

const encoder = new TextEncoder();
const B64URL = /^[A-Za-z0-9_-]+$/;

/** Canonical field order; the app's encoder must produce byte-identical JSON. */
export function encodeViewAsClaims(c: ViewAsClaims): string {
  return JSON.stringify({ v: c.v, kind: c.kind, rid: c.rid, var: c.var, adm: c.adm, sid: c.sid, subj: c.subj, exp: c.exp });
}

export async function signViewAsTicket(kid: string, secret: Uint8Array<ArrayBuffer>, claims: ViewAsClaims): Promise<string> {
  const payload = toBase64Url(encoder.encode(encodeViewAsClaims(claims)));
  const mac = await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), encoder.encode(`${VIEW_AS_TICKET_PREFIX}${kid}.${payload}`));
  return `${kid}.${payload}.${toBase64Url(new Uint8Array(mac))}`;
}

function validClaims(value: unknown): value is ViewAsClaims {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  return Object.keys(c).length === 8 && c.v === 1
    && (VIEW_AS_KINDS as readonly unknown[]).includes(c.kind) && (VARIANTS as readonly unknown[]).includes(c.var)
    && isUuid(c.rid) && isUuid(c.adm) && isUuid(c.sid) && isUuid(c.subj) && c.adm !== c.subj
    && typeof c.exp === "number" && Number.isSafeInteger(c.exp);
}

/** The claims of an authentic, unexpired View-As ticket, or null. The database re-checks expiry and everything else. */
export async function verifyViewAsTicket(ticket: string, keys: ReadonlyMap<string, Uint8Array<ArrayBuffer>>, nowSeconds: number): Promise<ViewAsClaims | null> {
  if (ticket.length > 2048) return null;
  const parts = ticket.split(".");
  if (parts.length !== 3) return null;
  const [kid, payload, mac] = parts as [string, string, string];
  const secret = keys.get(kid);
  const macBytes = fromBase64Url(mac);
  if (!secret || !macBytes || macBytes.length !== 32 || !B64URL.test(payload)) return null;
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), macBytes, encoder.encode(`${VIEW_AS_TICKET_PREFIX}${kid}.${payload}`));
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
