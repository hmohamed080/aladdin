import "server-only";
import { createHmac } from "node:crypto";

/**
 * Video tickets (shared with edge/media-worker/src/video.ts, pinned by
 * edge/media-worker/test/video-ticket-vectors.json).
 *
 * Format: `<kid>.<base64url(payload)>.<base64url(HMAC-SHA256)>`. The MAC covers
 * the prefix below, so an image ticket can never be replayed as a video ticket.
 *
 * A ticket is NOT authority. It binds one video to a viewer, Auth session and
 * workspace. The Worker asks the database (public.media_edge_video) on every
 * playlist, segment and poster request.
 *   * "page" tickets are minted at render and live 60–120 s.
 *   * "play" tickets are minted by the Worker when it serves the master playlist
 *     and live up to four hours, so a long video keeps playing.
 */
export const VIDEO_TICKET_PREFIX = "aladdin.media-video.v1.";

export type VideoTicketClaims = {
  v: 1; vid: string; sub: string; sid: string; ws: string | null; use: "page" | "play"; exp: number;
};

/** Canonical field order; must stay byte-identical to the Worker's encoder. */
export function encodeVideoClaims(c: VideoTicketClaims): string {
  return JSON.stringify({ v: c.v, vid: c.vid, sub: c.sub, sid: c.sid, ws: c.ws, use: c.use, exp: c.exp });
}

export function mintVideoTicket(kid: string, secret: Buffer, claims: VideoTicketClaims): string {
  const payload = Buffer.from(encodeVideoClaims(claims), "utf8").toString("base64url");
  const mac = createHmac("sha256", secret).update(`${VIDEO_TICKET_PREFIX}${kid}.${payload}`).digest("base64url");
  return `${kid}.${payload}.${mac}`;
}
