import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { createTranslator } from "@/lib/i18n/translate";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { ReviewsPage } from "./reviews-page";
import { summarizeReviews } from "@/lib/reviews/summary";
import type { Review } from "@/server/queries/reviews";

const t = createTranslator("en");

const review = (over: Partial<Review> = {}): Review => ({
  id: Math.random().toString(36).slice(2),
  rating: 5,
  comment: "Excellent finish and on time.",
  orgName: "Horizon Contracting",
  jobTitle: "Marble staircase cladding",
  tradeKey: "marble_granite",
  createdAt: "2026-09-01T00:00:00Z",
  ...over,
});

const render = (reviews: Review[], filter: number | null = null, locale: "en" | "ar" = "en") =>
  renderWithI18n(
    <ReviewsPage
      reviews={filter === null ? reviews : reviews.filter((r) => r.rating === filter)}
      summary={summarizeReviews(reviews)}
      filter={filter}
      t={locale === "en" ? t : createTranslator("ar")}
      locale={locale}
    />,
    locale,
  );

describe("ReviewsPage", () => {
  /**
   * §9's rule, rendered. A brand-new professional must not be shown `0.0` beside
   * five empty stars — that is a verdict nobody delivered.
   */
  it("shows no rating at all when there are no reviews", () => {
    const { container } = render([]);
    expect(screen.getByText("No reviews yet")).toBeTruthy();
    expect(container.textContent).not.toContain("0.0");
    expect(container.querySelector('[data-testid="rating-distribution"]')).toBeNull();
  });

  it("explains where reviews come from, which is the only useful thing to say", () => {
    render([]);
    expect(screen.getByText(/When a business confirms work you finished/)).toBeTruthy();
  });

  it("leads with the average and the count once reviews exist", () => {
    render([review({ rating: 5 }), review({ rating: 4 })]);
    expect(screen.getByText("4.5")).toBeTruthy();
    expect(screen.getByText("Based on 2 reviews")).toBeTruthy();
  });

  it("renders the full 5→1 distribution, including the stars nobody gave", () => {
    const { container } = render([review({ rating: 5 }), review({ rating: 5 }), review({ rating: 3 })]);
    const block = container.querySelector('[data-testid="rating-distribution"]')!;
    expect(within(block as HTMLElement).getByText("67% (2)")).toBeTruthy();
    expect(within(block as HTMLElement).getByText("33% (1)")).toBeTruthy();
    // Two stars nobody gave are still rows, so the shape of the record is legible.
    expect(within(block as HTMLElement).getAllByText("0% (0)")).toHaveLength(3);
  });

  it("shows the summary and the list from the same set, so they cannot disagree", () => {
    const reviews = [review({ rating: 5 }), review({ rating: 4 }), review({ rating: 4 })];
    render(reviews);
    expect(screen.getByText("Based on 3 reviews")).toBeTruthy();
    expect(screen.getAllByText("Horizon Contracting")).toHaveLength(3);
  });

  /**
   * The absences the reference has and this product cannot honestly render. Each
   * would need an authority that does not exist.
   */
  it("shows NO per-category scores, recommendation badge or satisfaction figure", () => {
    const { container } = render([review()]);
    const text = container.textContent ?? "";
    for (const word of [
      "Quality", "Punctuality", "Professionalism", "Cleanliness", "Value for money",
      "Recommended", "Satisfaction", "Positive", "Neutral", "Negative",
    ]) {
      expect(text).not.toContain(word);
    }
  });

  it("names the reviewing ORGANIZATION and never an individual", () => {
    const { container } = render([review()]);
    expect(screen.getByText("Horizon Contracting")).toBeTruthy();
    // No employee identity reaches this surface — the projection has no column
    // for one, and this is the rendering half of that guarantee.
    expect(container.textContent).not.toMatch(/submitted by/i);
  });

  it("carries the job and trade context beside the organization", () => {
    render([review()]);
    expect(screen.getByText(/Marble staircase cladding/)).toBeTruthy();
  });

  it("omits a missing comment rather than rendering an empty paragraph", () => {
    const { container } = render([review({ comment: null })]);
    expect(container.querySelector(".whitespace-pre-line")).toBeNull();
  });
});

describe("the rating filter", () => {
  it("offers only the star values that actually have reviews", () => {
    render([review({ rating: 5 }), review({ rating: 3 })]);
    expect(screen.getByRole("link", { name: "5 stars" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "3 stars" })).toBeTruthy();
    // A dead end that yields nothing would waste the reader's click.
    expect(screen.queryByRole("link", { name: "4 stars" })).toBeNull();
  });

  it("does not render at all when every review has the same rating", () => {
    render([review({ rating: 5 }), review({ rating: 5 })]);
    expect(screen.queryByRole("link", { name: "All ratings" })).toBeNull();
  });

  it("uses real links, so a filtered view can be shared and gone back from", () => {
    render([review({ rating: 5 }), review({ rating: 2 })]);
    expect(screen.getByRole("link", { name: "5 stars" }).getAttribute("href")).toBe(
      "/home/reviews?rating=5",
    );
  });

  /**
   * The summary is always of the WHOLE set. An average that moved when you
   * filtered would not be an average of anything a reader could name.
   */
  it("narrows the list but never the average", () => {
    render([review({ rating: 5 }), review({ rating: 1 })], 5);
    expect(screen.getByText("3.0")).toBeTruthy();
    expect(screen.getByText("Based on 2 reviews")).toBeTruthy();
    expect(screen.getAllByText("Horizon Contracting")).toHaveLength(1);
  });

  it("says the filter matched nothing rather than claiming the account is empty", () => {
    render([review({ rating: 5 })], 2);
    expect(screen.getByText("No reviews with that rating.")).toBeTruthy();
    expect(screen.queryByText("No reviews yet")).toBeNull();
  });
});

describe("mixed direction", () => {
  it("lets the organization name, context and comment resolve their own direction", () => {
    const { container } = render([review()], null, "ar");
    for (const node of container.querySelectorAll("[dir]")) {
      expect(node.getAttribute("dir")).toBe("auto");
    }
    // And there is at least one, so the assertion is not vacuous.
    expect(container.querySelectorAll('[dir="auto"]').length).toBeGreaterThan(0);
  });
});
