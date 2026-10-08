import type { JobKeyset, OpportunitySort } from "@/server/queries/job-opportunities";

/**
 * OPAQUE PAGE CURSORS for the two installer boards.
 *
 * A cursor is the position after the last row a viewer has seen: the ordering keys of that row, and
 * nothing else. The server mints it from a row it just read, hands it to the browser as an opaque
 * string, and decodes + validates it again when "Show more" returns it. The browser never builds one
 * and never reads one, so it can neither mint a position nor learn anything from it.
 *
 * What a cursor is NOT is an authority. It cannot widen what the signed-in caller may see: every page
 * is produced by a database function that applies discoverability (`job_opportunities_page`) or the
 * caller's own scope (`my_work_page`, from `auth.uid()`) as a separate, always-applied predicate whatever
 * the cursor says — the cursor only moves the starting point inside the caller's own result. That is why
 * it is validated strictly (version, sort, every field's type and shape, the id format, a bounded length,
 * and a hash of the question it was minted for) rather than signed: a forged cursor can at worst show the
 * caller a different slice of rows they already own, and an HMAC would protect nothing that matters.
 *
 * Two more things are bound into it so a cursor cannot be replayed against a different list:
 *   - the SORT it was minted under (a "nearest" cursor is meaningless to "highest"), and
 *   - a hash of the QUESTION (the canonical filter query string), so a cursor from one filter set is
 *     refused by another instead of silently continuing a different list.
 */

/** The cursor does not belong to this question (malformed, another sort, or another set of filters). */
export class InvalidCursorError extends Error {
  constructor() {
    super("invalid page cursor");
    this.name = "InvalidCursorError";
  }
}

const VERSION = "v1";
const MAX_LENGTH = 600;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/;

/** FNV-1a, 32 bit — a fingerprint of the question, not a secret. */
export function questionHash(question: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < question.length; i++) {
    h ^= question.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function toBase64Url(json: string): string {
  return btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): string | null {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/");
    return atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  } catch {
    return null;
  }
}

function seal(payload: Record<string, unknown>, question: string): string {
  return `${VERSION}.${toBase64Url(JSON.stringify({ ...payload, q: questionHash(question) }))}`;
}

function open(cursor: unknown, question: string): Record<string, unknown> | null {
  if (typeof cursor !== "string" || cursor.length === 0 || cursor.length > MAX_LENGTH) return null;
  const [version, body, ...extra] = cursor.split(".");
  if (version !== VERSION || !body || extra.length) return null;
  const json = fromBase64Url(body);
  if (json === null) return null;
  try {
    const value: unknown = JSON.parse(json);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    return record.q === questionHash(question) ? record : null;
  } catch {
    return null;
  }
}

const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const isTimestamp = (v: unknown): v is string => typeof v === "string" && v.length <= 40 && TIMESTAMP.test(v);

/* ------------------------------------------------------------------------- */
/* JOBS                                                                       */
/* ------------------------------------------------------------------------- */

export function encodeJobCursor(keyset: JobKeyset, question: string): string {
  switch (keyset.sort) {
    case "newest":
      return seal({ s: "newest", p: keyset.publishedAt, i: keyset.id }, question);
    case "highest":
      return seal({ s: "highest", a: keyset.amount, p: keyset.publishedAt, i: keyset.id }, question);
    case "nearest":
      return seal({ s: "nearest", t: keyset.tier, p: keyset.publishedAt, i: keyset.id }, question);
  }
}

/** The keyset a cursor stands for, or null when it is malformed, from another sort, or from another question. */
export function decodeJobCursor(cursor: unknown, sort: OpportunitySort, question: string): JobKeyset | null {
  const c = open(cursor, question);
  if (!c || c.s !== sort || !isTimestamp(c.p) || !isUuid(c.i)) return null;
  if (sort === "newest") return { sort, publishedAt: c.p, id: c.i };
  if (sort === "highest") {
    // The budget is NOT NULL in the database, so a cursor without one was never minted by this server.
    if (!(typeof c.a === "number" && Number.isFinite(c.a) && c.a >= 0 && c.a < 1e12)) return null;
    return { sort, amount: c.a, publishedAt: c.p, id: c.i };
  }
  // The Near me tier is always one of the four location tiers (0 city, 1 primary governorate, 2 another area, 3 the rest).
  if (!(c.t === 0 || c.t === 1 || c.t === 2 || c.t === 3)) return null;
  return { sort, tier: c.t, publishedAt: c.p, id: c.i };
}

/* ------------------------------------------------------------------------- */
/* MY WORK                                                                    */
/* ------------------------------------------------------------------------- */

export const WORK_CURSOR_SORTS = ["default", "recent-added", "last-added", "oldest-first", "last-action"] as const;
export type WorkCursorSort = (typeof WORK_CURSOR_SORTS)[number];

/**
 * The position in a My Work ordering. For `last-action` the keys are (last_progress_at, created_at); for
 * every other sort `key` is created_at and `key2` is unused. Either may be null — those rows sort LAST.
 */
export type WorkKeyset = { sort: WorkCursorSort; key: string | null; key2: string | null; id: string };

export function encodeWorkCursor(keyset: WorkKeyset, question: string): string {
  return seal({ s: keyset.sort, a: keyset.key, b: keyset.key2, i: keyset.id }, question);
}

export function decodeWorkCursor(cursor: unknown, sort: WorkCursorSort, question: string): WorkKeyset | null {
  const c = open(cursor, question);
  if (!c || c.s !== sort || !isUuid(c.i)) return null;
  if (c.a !== null && !isTimestamp(c.a)) return null;
  if (c.b !== null && !isTimestamp(c.b)) return null;
  // Only last-action carries a second key.
  if (sort !== "last-action" && c.b !== null) return null;
  return { sort, key: c.a as string | null, key2: c.b as string | null, id: c.i };
}
