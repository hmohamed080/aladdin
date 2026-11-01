import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isViewAsMediaEnabled, readViewAsEdgeConfig } from "@/lib/env/view-as";
import { readSessionIdentity } from "@/server/auth/session";

/**
 * Admin View-As private media (Stage 4, ADR-0018 + docs/admin/ADMIN_VIEW_AS_ARCHITECTURE.md).
 *
 * A View-As ticket is NOT authority and carries NO storage key, path or file name. It names one DATABASE RECORD (a portfolio item,
 * certificate or avatar upload id), the viewed account, the Admin and the Admin's Supabase Auth session for at most 120 s. The
 * media-edge Worker calls `public.media_edge_view_as_authorize` on every request; the database re-checks `users.view_as`, the live
 * audited view session bound to that Auth session, the subject's eligibility and the record-to-owner link. Exit, sign-out,
 * revocation, rank change or deletion therefore deny the next request whatever the ticket says.
 *
 * Own HMAC domain-separation prefix: an owner image ticket cannot be replayed here, nor the reverse. Pinned byte for byte by
 * edge/media-worker/test/view-as-ticket-vectors.json (shared with edge/media-worker/src/view-as-ticket.ts).
 *
 * There is deliberately NO fallback: when the switch is off, edge delivery is off, or the caller has no Auth session, the result is
 * null and the page keeps its placeholder. Nothing is ever served through the application proxy or Supabase Storage.
 */
export const VIEW_AS_TICKET_PREFIX = "aladdin.media-view-as.v1.";
export type ViewAsMediaKind = "portfolio_item" | "certificate" | "avatar";
export type ViewAsMediaVariant = "original" | "thumb" | "card" | "full";
export type ViewAsTicketClaims = {
  v: 1; kind: ViewAsMediaKind; rid: string; var: ViewAsMediaVariant; adm: string; sid: string; subj: string; exp: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Deliberately NOT imported from server/storage/edge-ticket.ts (it reaches the owner media machinery, server/storage/media.ts) nor
// lib/env/storage.ts (it names the service-role key): the View-As read-only import-graph test forbids both. Only the small, pure pieces
// are mirrored here; the expiry rule and env rules are pinned equal to the owner modules by tests so the copies cannot drift. Same Worker, same HMAC keys.

/** Expiry rounded up to the next minute plus one: 60-120 s of life, the same URL for every render inside one minute. */
export function viewAsTicketExpiry(nowMs: number): number {
  return Math.ceil(nowMs / 60_000) * 60 + 60;
}

/** The locally verified Admin and Auth session behind this request. */
async function adminViewer(client: SupabaseClient): Promise<{ sub: string; sid: string } | null> {
  const identity = await readSessionIdentity(client);
  if (!identity || !UUID.test(identity.id) || !identity.sessionId || !UUID.test(identity.sessionId)) return null;
  return { sub: identity.id, sid: identity.sessionId };
}

/** Canonical field order; must stay byte-identical to the Worker's encoder. */
export function encodeViewAsClaims(c: ViewAsTicketClaims): string {
  return JSON.stringify({ v: c.v, kind: c.kind, rid: c.rid, var: c.var, adm: c.adm, sid: c.sid, subj: c.subj, exp: c.exp });
}

export async function mintViewAsTicket(kid: string, secret: Uint8Array, claims: ViewAsTicketClaims): Promise<string> {
  const payload = Buffer.from(encodeViewAsClaims(claims), "utf8").toString("base64url");
  const key = await crypto.subtle.importKey("raw", secret as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${VIEW_AS_TICKET_PREFIX}${kid}.${payload}`));
  return `${kid}.${payload}.${Buffer.from(mac).toString("base64url")}`;
}

/**
 * The URL for one record of the viewed account, or null. `client` is the ADMIN's own session client (never a service role).
 * The viewed account's id and the record id are both ones the Admin already sees in the page; the database decides every request.
 */
export async function viewAsMediaUrl(client: SupabaseClient, subjectUserId: string, kind: ViewAsMediaKind, recordId: string,
  options: { variant?: ViewAsMediaVariant; nowMs?: number } = {}): Promise<string | null> {
  if (!isViewAsMediaEnabled() || !UUID.test(subjectUserId) || !UUID.test(recordId)) return null;
  const config = readViewAsEdgeConfig();
  if (!config) return null;
  const viewer = await adminViewer(client);
  if (!viewer || viewer.sub === subjectUserId) return null;
  const variant = options.variant ?? "original";
  const ticket = await mintViewAsTicket(config.kid, config.secret, { v: 1, kind, rid: recordId, var: variant,
    adm: viewer.sub, sid: viewer.sid, subj: subjectUserId, exp: viewAsTicketExpiry(options.nowMs ?? Date.now()) });
  return `${config.origin}/a/${kind}/${variant}?t=${ticket}`;
}
