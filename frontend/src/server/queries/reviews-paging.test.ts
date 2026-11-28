import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: vi.fn() }));

import { listMyReviewsPageFrom, REVIEW_PAGE_STEP, type ReviewReader } from "./reviews";
import { encodeReviewCursor } from "@/lib/reviews/cursor";
import { summarizeReviewCounts, summarizeReviews } from "@/lib/reviews/summary";

/**
 * An in-memory `my_job_reviews` that actually EVALUATES what the query asks for: the star filter, the keyset
 * predicate in the exact `or(...)` shape the query builds, the `created_at DESC, id DESC` order and the limit.
 * It does not replicate Postgres; it makes "page 2 starts strictly after page 1's last row" a property of the
 * generated filter rather than of a canned result. RLS scoping is the database's business (pgTAP 49).
 */
type Row = { id: string; rating: number; comment: string | null; org_name: string | null; job_title: string; trade_key: string; created_at: string | null };

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = (minute: number, second = 0) => `2026-09-01T10:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}.000+00:00`;
const row = (n: number, minute: number, rating = 5, over: Partial<Row> = {}): Row => ({
  id: uuid(n), rating, comment: "ok", org_name: "Horizon", job_title: "Job", trade_key: "tiling", created_at: at(minute), ...over,
});

function makeReader(rows: Row[]) {
  const asks = { or: [] as string[], eq: [] as [string, number][], order: [] as [string, boolean][], limit: [] as number[], relation: [] as string[] };
  const reader: ReviewReader = {
    from(relation) {
      asks.relation.push(relation);
      let result = [...rows];
      const q = {
        select: () => q,
        eq: (column: string, value: number) => {
          asks.eq.push([column, value]);
          result = result.filter((r) => (r as Record<string, unknown>)[column] === value);
          return q;
        },
        or: (filters: string) => {
          asks.or.push(filters);
          const m = /^created_at\.lt\.(.+),and\(created_at\.eq\.(.+),id\.lt\.(.+)\)$/.exec(filters);
          if (!m || m[1] !== m[2]) throw new Error(`unexpected keyset filter: ${filters}`);
          const [, c, , i] = m as unknown as [string, string, string, string];
          result = result.filter((r) => Date.parse(r.created_at!) < Date.parse(c) || (Date.parse(r.created_at!) === Date.parse(c) && r.id < i));
          return q;
        },
        order: (column: string, { ascending }: { ascending: boolean }) => {
          asks.order.push([column, ascending]);
          return q;
        },
        limit: (count: number) => {
          asks.limit.push(count);
          const sorted = [...result].sort((a, b) => Date.parse(b.created_at!) - Date.parse(a.created_at!) || (a.id < b.id ? 1 : -1));
          return Promise.resolve({ data: sorted.slice(0, count), error: null });
        },
      };
      return q as never;
    },
  };
  return { reader, asks };
}

/** 25 reviews, with ties on created_at (the id breaks them) and a mix of stars. */
const dataset = (): Row[] =>
  Array.from({ length: 25 }, (_, i) => row(i + 1, 10 + Math.floor(i / 2), (i % 5) + 1));

async function drain(reader: ReviewReader, rating: number | null = null, limit = 10) {
  const pages: string[][] = [];
  let after: string | null = null;
  for (let guard = 0; guard < 20; guard += 1) {
    const page = await listMyReviewsPageFrom(reader, { rating, after, limit });
    pages.push(page.reviews.map((r) => r.id));
    if (!page.nextCursor) break;
    after = page.nextCursor;
  }
  return pages;
}

describe("the installer's Reviews page read", () => {
  it("returns the first page newest first, with a cursor because more exist", async () => {
    const { reader, asks } = makeReader(dataset());
    const page = await listMyReviewsPageFrom(reader);
    expect(page.reviews).toHaveLength(REVIEW_PAGE_STEP);
    expect(page.nextCursor).not.toBeNull();
    const times = page.reviews.map((r) => Date.parse(r.createdAt));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    expect(asks.relation).toEqual(["my_job_reviews"]);
    expect(asks.order).toEqual([["created_at", false], ["id", false]]);
    expect(asks.limit).toEqual([REVIEW_PAGE_STEP + 1]);
    expect(asks.or).toEqual([]);
  });

  it("pages through every review exactly once: no duplicates, no gaps, a total order despite equal timestamps", async () => {
    const rows = dataset();
    const pages = await drain(makeReader(rows).reader);
    const flat = pages.flat();
    expect(pages.map((p) => p.length)).toEqual([10, 10, 5]);
    expect(new Set(flat).size).toBe(flat.length);
    expect(flat).toHaveLength(rows.length);
    const expected = [...rows]
      .sort((a, b) => Date.parse(b.created_at!) - Date.parse(a.created_at!) || (a.id < b.id ? 1 : -1))
      .map((r) => r.id);
    expect(flat).toEqual(expected);
  });

  it("the last page has no cursor, and an exactly-full last page does not invent one", async () => {
    const pages = await drain(makeReader(dataset().slice(0, 20)).reader);
    expect(pages.map((p) => p.length)).toEqual([10, 10]);
    const last = await listMyReviewsPageFrom(makeReader(dataset().slice(0, 20)).reader, { limit: 20 });
    expect(last.nextCursor).toBeNull();
  });

  it("the second page uses the keyset filter built from the first page's last row, never an offset", async () => {
    const { reader, asks } = makeReader(dataset());
    const first = await listMyReviewsPageFrom(reader);
    await listMyReviewsPageFrom(reader, { after: first.nextCursor });
    const last = first.reviews[first.reviews.length - 1]!;
    expect(asks.or).toEqual([`created_at.lt.${last.createdAt},and(created_at.eq.${last.createdAt},id.lt.${last.id})`]);
    expect(JSON.stringify(asks)).not.toMatch(/range|offset/i);
  });

  it("a stars filter narrows in SQL and pages through ALL matching reviews, not a loaded window", async () => {
    const rows = dataset();
    const fives = rows.filter((r) => r.rating === 5).length;
    const pages = await drain(makeReader(rows).reader, 5, 2);
    expect(pages.flat()).toHaveLength(fives);
    expect(pages.flat().every((id) => rows.find((r) => r.id === id)!.rating === 5)).toBe(true);
    expect(new Set(pages.flat()).size).toBe(fives);
  });

  it("is stable when a newer review arrives between pages: nothing repeats, nothing shifts", async () => {
    const rows = dataset();
    const first = await listMyReviewsPageFrom(makeReader(rows).reader);
    const withNew = [...rows, row(99, 59)];
    const second = await listMyReviewsPageFrom(makeReader(withNew).reader, { after: first.nextCursor });
    expect(second.reviews.map((r) => r.id)).not.toContain(uuid(99));
    expect(second.reviews.some((r) => first.reviews.some((f) => f.id === r.id))).toBe(false);
  });

  it("refuses a malformed or hand-made cursor and an out-of-range rating before querying", async () => {
    const { reader, asks } = makeReader(dataset());
    for (const after of ["garbage!", "a".repeat(300), btoa("x|y"), btoa(`${at(10)},or=(id.neq.0)|${uuid(1)}`)]) {
      await expect(listMyReviewsPageFrom(reader, { after })).rejects.toThrow();
    }
    for (const rating of [0, 6, 2.5, Number.NaN]) {
      await expect(listMyReviewsPageFrom(reader, { rating })).rejects.toThrow();
    }
    expect(asks.relation).toEqual([]);
  });

  it("skips an incomplete row without letting it become the next page's start", async () => {
    const rows = dataset();
    rows[20] = { ...rows[20]!, org_name: null };
    const pages = await drain(makeReader(rows).reader);
    expect(pages.flat()).toHaveLength(rows.length - 1);
    expect(new Set(pages.flat()).size).toBe(pages.flat().length);
  });

  it("encodes a cursor only from a valid key", () => {
    expect(encodeReviewCursor({ createdAt: at(10), id: uuid(1) })).not.toBeNull();
  });
});

describe("the summary from exact counts", () => {
  it("matches the row-based summary for the same data", () => {
    const ratings = [5, 5, 4, 3, 5, 1, 2, 4];
    const fromRows = summarizeReviews(ratings.map((rating) => ({ rating })));
    const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<1 | 2 | 3 | 4 | 5, number>;
    for (const r of ratings) counts[r as 1 | 2 | 3 | 4 | 5] += 1;
    expect(summarizeReviewCounts(counts)).toEqual(fromRows);
  });

  it("stays exact far past any list cap, and is null (not 0) when there are no reviews", () => {
    expect(summarizeReviewCounts({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }).average).toBeNull();
    const big = summarizeReviewCounts({ 1: 0, 2: 0, 3: 0, 4: 250, 5: 750 });
    expect(big.total).toBe(1000);
    expect(big.average).toBe(4.8);
  });
});
