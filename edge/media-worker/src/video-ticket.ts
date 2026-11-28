// Video ticket v1: `<kid>.<base64url(payload JSON)>.<base64url(HMAC-SHA256)>`, with
// its own domain-separation prefix so an image ticket can never be replayed as a
// video ticket (or the reverse). Same keys as image tickets (TICKET_KEYS).
// The app mints "page" tickets in frontend/src/server/video/ticket.ts; this
// Worker mints "play" tickets when it serves a master playlist. Both sides are
// pinned by test/video-ticket-vectors.json.
import { CLOCK_SKEW_SECONDS, fromBase64Url, hmacKey, isUuid, toBase64Url } from "./ticket";

export const VIDEO_TICKET_PREFIX = "aladdin.media-video.v1.";
export const PAGE_TICKET_TTL_SECONDS = 120;
export const PLAY_TICKET_TTL_SECONDS = 4 * 60 * 60;

export type VideoTicketClaims = {
  v: 1; vid: string; sub: string; sid: string; ws: string | null; use: "page" | "play"; exp: number;
};

const encoder = new TextEncoder();

export function encodeVideoClaims(c: VideoTicketClaims): string {
  return JSON.stringify({ v: c.v, vid: c.vid, sub: c.sub, sid: c.sid, ws: c.ws, use: c.use, exp: c.exp });
}

export async function signVideoTicket(kid: string, secret: Uint8Array<ArrayBuffer>, claims: VideoTicketClaims): Promise<string> {
  const payload = toBase64Url(encoder.encode(encodeVideoClaims(claims)));
  const mac = await crypto.subtle.sign("HMAC", await hmacKey(secret, "sign"), encoder.encode(`${VIDEO_TICKET_PREFIX}${kid}.${payload}`));
  return `${kid}.${payload}.${toBase64Url(new Uint8Array(mac))}`;
}

function validClaims(value: unknown): value is VideoTicketClaims {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  return Object.keys(c).length === 7 && c.v === 1 && isUuid(c.vid) && isUuid(c.sub) && isUuid(c.sid)
    && (c.ws === null || isUuid(c.ws)) && (c.use === "page" || c.use === "play")
    && typeof c.exp === "number" && Number.isSafeInteger(c.exp);
}

/** The claims of an authentic, unexpired video ticket, or null. The database re-checks expiry. */
export async function verifyVideoTicket(ticket: string, keys: ReadonlyMap<string, Uint8Array<ArrayBuffer>>, nowSeconds: number): Promise<VideoTicketClaims | null> {
  if (ticket.length > 2048) return null;
  const parts = ticket.split(".");
  if (parts.length !== 3) return null;
  const [kid, payload, mac] = parts as [string, string, string];
  const secret = keys.get(kid);
  const macBytes = fromBase64Url(mac);
  if (!secret || !macBytes || macBytes.length !== 32 || !/^[A-Za-z0-9_-]+$/.test(payload)) return null;
  const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), macBytes, encoder.encode(`${VIDEO_TICKET_PREFIX}${kid}.${payload}`));
  if (!ok) return null;
  const bytes = fromBase64Url(payload);
  if (!bytes) return null;
  let claims: unknown;
  try { claims = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { return null; }
  if (!validClaims(claims)) return null;
  const ttl = claims.use === "page" ? PAGE_TICKET_TTL_SECONDS : PLAY_TICKET_TTL_SECONDS;
  if (nowSeconds > claims.exp + CLOCK_SKEW_SECONDS || claims.exp > nowSeconds + ttl + CLOCK_SKEW_SECONDS) return null;
  return claims;
}
