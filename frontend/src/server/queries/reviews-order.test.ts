import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: vi.fn() }));

import { listMyReviewsPageFrom, sanitizeReviewSearch, type ReviewReader } from "./reviews";
import { decodeReviewCursor, encodeReviewCursor } from "@/lib/reviews/cursor";

/**
 * The approved Installer Reviews workspace adds orders, search and dates to the keyset read. These tests pin the
 * GENERATED query (filters, orders) and the cursor contract; the ordering itself was verified against a real local
 * PostgREST for all three orders (every row exactly once, in order).
 */
const ID = "00000000-0000-4000-8000-000000000001";
const AT = "2026-09-01T10:00:00.000+00:00";

function recorder(rows: unknown[] = []) {
  const asks = { or: [] as string[], order: [] as [string, boolean][], limit: 0 };
  const q = {
    select: () => q,
    eq: () => q,
    or: (f: string) => { asks.or.push(f); return q; },
    order: (c: string, o: { ascending: boolean }) => { asks.order.push([c, o.ascending]); return q; },
    limit: (n: number) => { asks.limit = n; return Promise.resolve({ data: rows as never, error: null }); },
  };
  return { reader: { from: () => q } as unknown as ReviewReader, asks };
}

describe("cursor with a rating (highest-rated order)", () => {
  it("round-trips and rejects a bad star", () => {
    const c = encodeReviewCursor({ createdAt: AT, id: ID, rating: 4 })!;
    expect(decodeReviewCursor(c)).toEqual({ createdAt: AT, id: ID, rating: 4 });
    expect(encodeReviewCursor({ createdAt: AT, id: ID, rating: 9 })).toBeNull();
    expect(decodeReviewCursor(Buffer.from(`${AT}|${ID}|7`).toString("base64url"))).toBeNull();
    expect(decodeReviewCursor(Buffer.from(`${AT}|${ID}|4,x`).toString("base64url"))).toBeNull();
  });
});

describe("listMyReviewsPageFrom orders", () => {
  it("highest: rating DESC then newest, and a 3-key continuation", async () => {
    const t = recorder();
    await listMyReviewsPageFrom(t.reader, { order: "highest", after: encodeReviewCursor({ createdAt: AT, id: ID, rating: 4 }) });
    expect(t.asks.order).toEqual([["rating", false], ["created_at", false], ["id", false]]);
    expect(t.asks.or).toEqual([`rating.lt.4,and(rating.eq.4,or(created_at.lt.${AT},and(created_at.eq.${AT},id.lt.${ID})))`]);
  });
  it("oldest: ascending with a gt continuation", async () => {
    const t = recorder();
    await listMyReviewsPageFrom(t.reader, { order: "oldest", after: encodeReviewCursor({ createdAt: AT, id: ID }) });
    expect(t.asks.order).toEqual([["created_at", true], ["id", true]]);
    expect(t.asks.or).toEqual([`created_at.gt.${AT},and(created_at.eq.${AT},id.gt.${ID})`]);
  });
  it("refuses a cursor from another order", async () => {
    const t = recorder();
    await expect(listMyReviewsPageFrom(t.reader, { order: "highest", after: encodeReviewCursor({ createdAt: AT, id: ID }) })).rejects.toThrow();
    await expect(listMyReviewsPageFrom(t.reader, { order: "newest", after: encodeReviewCursor({ createdAt: AT, id: ID, rating: 3 }) })).rejects.toThrow();
  });
  it("search and dates become SQL filters; invalid dates are ignored", async () => {
    const t = recorder();
    await listMyReviewsPageFrom(t.reader, { q: "marble bath", from: "2026-09-01", to: "2026-09-30" });
    expect(t.asks.or).toEqual([
      "created_at.gte.2026-09-01T00:00:00Z",
      "created_at.lt.2026-10-01T00:00:00Z",
      "org_name.ilike.*marble*bath*,job_title.ilike.*marble*bath*,comment.ilike.*marble*bath*",
    ]);
    const u = recorder();
    await listMyReviewsPageFrom(u.reader, { from: "2026-9-1", to: "x" });
    expect(u.asks.or).toEqual([]);
  });
});

describe("sanitizeReviewSearch", () => {
  it("strips filter syntax and keeps letters in any script", () => {
    expect(sanitizeReviewSearch("a,b)(c*d")).toBe("a b c d");
    expect(sanitizeReviewSearch("  رخام   حمام ")).toBe("رخام حمام");
    expect(sanitizeReviewSearch(",,,")).toBeNull();
    expect(sanitizeReviewSearch(42)).toBeNull();
    expect(sanitizeReviewSearch("x".repeat(200))?.length).toBe(80);
  });
});
