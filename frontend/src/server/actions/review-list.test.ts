import { describe, expect, it, vi } from "vitest";

const page = vi.hoisted(() => vi.fn());
vi.mock("@/server/queries/reviews", () => ({ listMyReviewsPage: page }));

import { loadMoreReviewsAction } from "./review-list";

describe("loadMoreReviewsAction", () => {
  it("passes a valid rating and cursor straight to the keyset read and returns its page", async () => {
    page.mockResolvedValueOnce({ reviews: [], nextCursor: "next" });
    await expect(loadMoreReviewsAction(3, "abc")).resolves.toEqual({ ok: true, reviews: [], nextCursor: "next" });
    expect(page).toHaveBeenCalledWith({ rating: 3, after: "abc" });
  });

  it("refuses a bad rating or an empty / oversized cursor without querying", async () => {
    page.mockClear();
    for (const [rating, cursor] of [[0, "c"], [6, "c"], [2.5, "c"], [null, ""], [null, "x".repeat(201)]] as const) {
      await expect(loadMoreReviewsAction(rating, cursor)).resolves.toEqual({ ok: false });
    }
    expect(page).not.toHaveBeenCalled();
  });

  it("turns a rejected cursor (the read throws) into a plain failure, not an error", async () => {
    page.mockRejectedValueOnce(new Error("invalid review cursor"));
    await expect(loadMoreReviewsAction(null, "garbage")).resolves.toEqual({ ok: false });
  });
});
