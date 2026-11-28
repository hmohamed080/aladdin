/**
 * The keyset cursor of the installer's Reviews list.
 *
 * The list is ordered `created_at DESC, id DESC` (a TOTAL order: `id` breaks ties), so the row a page
 * ended on — its `created_at` and its `id` — is the whole position. A cursor is those two values, base64url
 * encoded so it travels as one opaque string. It is a CONTINUATION HINT, never authority: the database
 * still scopes every row to the signed-in installer, and a cursor can only choose where the next page
 * starts inside that caller's own rows.
 *
 * Because the two values end up inside a PostgREST filter expression, decoding is STRICT: the timestamp
 * must be a plain ISO-8601 instant and the id a canonical UUID, so nothing a client sends can carry filter
 * syntax (`,` `(` `)` `.` operators) into the query. Anything else decodes to `null` and the caller refuses it.
 */

/** `rating` is present only for the "highest rated" order (`rating DESC, created_at DESC, id DESC`). */
export type ReviewCursor = { createdAt: string; id: string; rating?: number };

const TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}(?::?\d{2})?)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CURSOR_LENGTH = 200;

function toBase64Url(text: string): string {
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    const padded = text.replace(/-/g, "+").replace(/_/g, "/");
    return atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  } catch {
    return null;
  }
}

/** True for a value that may safely be placed in a filter: a real instant and a canonical UUID. */
export function isValidReviewKey(createdAt: unknown, id: unknown): createdAt is string {
  return (
    typeof createdAt === "string" &&
    typeof id === "string" &&
    TIMESTAMP.test(createdAt) &&
    !Number.isNaN(Date.parse(createdAt)) &&
    UUID.test(id)
  );
}

function isStar(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;
}

export function encodeReviewCursor(cursor: ReviewCursor): string | null {
  if (!isValidReviewKey(cursor.createdAt, cursor.id)) return null;
  if (cursor.rating !== undefined && !isStar(cursor.rating)) return null;
  const tail = cursor.rating === undefined ? "" : `|${cursor.rating}`;
  return toBase64Url(`${cursor.createdAt}|${cursor.id.toLowerCase()}${tail}`);
}

/** The cursor a client sent, or `null` when it is not exactly something `encodeReviewCursor` produced. */
export function decodeReviewCursor(raw: unknown): ReviewCursor | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_CURSOR_LENGTH) return null;
  const text = fromBase64Url(raw);
  if (text === null) return null;
  const parts = text.split("|");
  if (parts.length !== 2 && parts.length !== 3) return null;
  const [createdAt, id, star] = parts as [string, string, string | undefined];
  if (!isValidReviewKey(createdAt, id)) return null;
  if (star === undefined) return { createdAt, id };
  const rating = /^[1-5]$/.test(star) ? Number(star) : NaN;
  return isStar(rating) ? { createdAt, id, rating } : null;
}
