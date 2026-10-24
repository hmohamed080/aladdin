import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";

const loadMore = vi.hoisted(() => vi.fn());
vi.mock("@/server/actions/review-list", () => ({ loadMoreReviewsAction: loadMore }));

import { ReviewsList } from "./reviews-list";
import type { Review } from "@/server/queries/reviews";

const review = (n: number, over: Partial<Review> = {}): Review => ({
  id: `r-${n}`, rating: 5, comment: `Comment ${n}`, orgName: `Org ${n}`, jobTitle: `Job ${n}`,
  tradeKey: "tiling", createdAt: "2026-09-01T00:00:00Z", ...over,
});

describe("ReviewsList (append by cursor)", () => {
  it("shows the first page and a Show more button only while a cursor exists", () => {
    const { unmount } = renderWithI18n(<ReviewsList reviews={[review(1), review(2)]} nextCursor="c1" rating={null} />, "en");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Show more" })).toBeTruthy();
    unmount();
    renderWithI18n(<ReviewsList reviews={[review(1)]} nextCursor={null} rating={null} />, "en");
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("appends the next page with the cursor and the star filter, drops duplicates, and ends when no cursor returns", async () => {
    loadMore.mockResolvedValueOnce({ ok: true, reviews: [review(2), review(3)], nextCursor: null });
    renderWithI18n(<ReviewsList reviews={[review(1), review(2)]} nextCursor="c1" rating={4} />, "en");
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(3));
    expect(loadMore).toHaveBeenCalledWith(4, "c1");
    expect(screen.getByText("Org 3")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("keeps what is shown and offers a retry when a page fails to load", async () => {
    loadMore.mockResolvedValueOnce({ ok: false });
    renderWithI18n(<ReviewsList reviews={[review(1)]} nextCursor="c1" rating={null} />, "en");
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Show more" })).toBeTruthy();
  });

  it("renders the Arabic load button and error without key leaks", async () => {
    loadMore.mockResolvedValueOnce({ ok: false });
    const { container } = renderWithI18n(<ReviewsList reviews={[review(1)]} nextCursor="c1" rating={null} />, "ar");
    fireEvent.click(screen.getByRole("button", { name: "عرض المزيد" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(container.textContent).not.toMatch(/reviews\.|common\./);
  });
});
