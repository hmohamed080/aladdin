/**
 * Phase 0D — pure table-state helpers shared by every Admin Preview table.
 *
 * Kept free of React and of Next.js so the rules that decide what a table
 * shows (which page numbers, which page size, which sort) are unit-tested in
 * one place instead of re-derived per page — the Phase 0C directories each
 * carried their own copy, which is how the Registered header and the Profile
 * Completion header ended up sharing one ambiguous sort state.
 */

export const PAGE_SIZES = [10, 25, 50, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export const DEFAULT_PAGE_SIZE: PageSize = 10;

/** Any URL value → one of the approved page sizes (default 10). */
export function clampPageSize(raw: string | number | null | undefined): PageSize {
  const n = Number(raw);
  return (PAGE_SIZES as readonly number[]).includes(n) ? (n as PageSize) : DEFAULT_PAGE_SIZE;
}

export type PageSlice<T> = {
  rows: T[];
  page: number;
  totalPages: number;
  /** 1-based index of the first row shown (0 when empty). */
  from: number;
  /** 1-based index of the last row shown (0 when empty). */
  to: number;
  total: number;
};

export function paginate<T>(rows: readonly T[], page: number | string | null | undefined, pageSize: PageSize): PageSlice<T> {
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, Math.floor(Number(page)) || 1), totalPages);
  const start = (current - 1) * pageSize;
  const slice = rows.slice(start, start + pageSize);
  return {
    rows: slice,
    page: current,
    totalPages,
    from: total === 0 ? 0 : start + 1,
    to: total === 0 ? 0 : start + slice.length,
    total,
  };
}

/**
 * The page-number strip: `1 2 … N` style. Always shows the first and last
 * page and a window of one page either side of the current one; a single
 * skipped page is shown as its number rather than a "…" that hides nothing.
 */
export function pageItems(page: number, totalPages: number): (number | "gap")[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const wanted = new Set([1, totalPages, page - 1, page, page + 1]);
  const pages = [...wanted].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  for (const p of pages) {
    const prev = out[out.length - 1];
    if (typeof prev === "number" && p - prev === 2) out.push(prev + 1);
    else if (typeof prev === "number" && p - prev > 2) out.push("gap");
    out.push(p);
  }
  return out;
}

export type SortDir = "asc" | "desc";
export type SortState<F extends string> = { field: F; dir: SortDir } | null;

/**
 * `?sort=field:dir` → a sort state, but ONLY for a field this table declares.
 * An unknown field (or a malformed value) is no sort at all — never silently
 * reinterpreted as some other column's sort.
 */
export function parseSort<F extends string>(raw: string | null | undefined, fields: readonly F[]): SortState<F> {
  if (!raw) return null;
  const [field, dir] = raw.split(":");
  if (!field || !(fields as readonly string[]).includes(field)) return null;
  return { field: field as F, dir: dir === "asc" ? "asc" : "desc" };
}

/**
 * Next sort when a header is clicked. Clicking a DIFFERENT column always
 * starts at that column's own natural direction (both Registered and Profile
 * Completion start "desc": newest first / highest first); clicking the active
 * column flips it. The previous column's direction never leaks into the new one.
 */
export function nextSort<F extends string>(current: SortState<F>, field: F, naturalDir: SortDir = "desc"): string {
  if (current && current.field === field) return `${field}:${current.dir === "desc" ? "asc" : "desc"}`;
  return `${field}:${naturalDir}`;
}

/**
 * Sorts by exactly one accessor. Ties are broken by `tieBreak` (a stable,
 * unique key — the row id) so identical values never make the order look
 * random between two clicks of the same header.
 */
export function sortRows<T>(
  rows: readonly T[],
  dir: SortDir,
  value: (row: T) => number,
  tieBreak: (row: T) => string,
): T[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const d = value(a) - value(b);
    if (d !== 0) return d * sign;
    return tieBreak(a).localeCompare(tieBreak(b));
  });
}

/**
 * Preview-only registration-date variation (Phase 0D). Almost every local and
 * preview account was created within the same day or two, so a correct
 * Registered sort is visually indistinguishable from no sort at all. This
 * shifts each row's DISPLAYED date back by a deterministic 0–29 days derived
 * from its id. It never touches the database; the column is marked as a
 * Preview field wherever it is used, and the real date stays on the record.
 */
export function previewRegisteredAt(id: string, realIso: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const offsetDays = (hash >>> 0) % 30;
  const real = new Date(realIso).getTime();
  return new Date(real - offsetDays * 86_400_000).toISOString();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Groups a concrete URL path into its route pattern, so Top Pages reports
 * PAGES rather than one row per entity: `/p/9c1e…` and `/p/77ab…` both count
 * as `/p/[id]`. A segment is treated as an id when it is a UUID or all digits;
 * the query string and trailing slash are ignored.
 */
export function canonicalRoute(path: string): string {
  const clean = path.split(/[?#]/)[0] ?? "";
  const segments = clean.split("/").filter(Boolean);
  if (segments.length === 0) return "/";
  return `/${segments.map((s) => (UUID.test(s) || /^\d+$/.test(s) ? "[id]" : s)).join("/")}`;
}
