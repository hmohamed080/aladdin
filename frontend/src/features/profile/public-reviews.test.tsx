import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { createTranslator } from "@/lib/i18n/translate";
import { PublicReviews } from "./public-reviews";
import { ReviewsModule } from "@/features/reviews/hub-module";
import { summarizeReviews } from "@/lib/reviews/summary";
import type { Review } from "@/server/queries/reviews";

const t = createTranslator("en");

const review = (over: Partial<Review> = {}): Review => ({
  id: Math.random().toString(36).slice(2),
  rating: 5,
  comment: "Excellent finish.",
  orgName: "Horizon Contracting",
  jobTitle: "Marble staircase cladding",
  tradeKey: "marble_granite",
  createdAt: "2026-09-01T00:00:00Z",
  ...over,
});

describe("PublicReviews", () => {
  /**
   * §13's hardest requirement, and the one easiest to get wrong by being tidy.
   * An empty "Client reviews" heading reads as an absence of ENDORSEMENT rather
   * than an absence of data — a judgement the product has no business rendering
   * about somebody. Same rule the portfolio section follows, sharper reason.
   */
  it("renders NOTHING when there are no reviews", () => {
    const { container } = renderWithI18n(<PublicReviews reviews={[]} t={t} locale="en" />, "en");
    expect(container.innerHTML).toBe("");
  });

  it("shows the section, the average and the count once reviews exist", () => {
    renderWithI18n(
      <PublicReviews reviews={[review({ rating: 5 }), review({ rating: 4 })]} t={t} locale="en" />,
      "en",
    );
    expect(screen.getByRole("heading", { name: "Client reviews" })).toBeTruthy();
    expect(screen.getByText("4.5")).toBeTruthy();
    expect(screen.getByText("Based on 2 reviews")).toBeTruthy();
  });

  /** A visitor can count the cards and get the number, because both come from one array. */
  it("computes the average from exactly the reviews it renders", () => {
    const reviews = [review({ rating: 5 }), review({ rating: 5 }), review({ rating: 2 })];
    renderWithI18n(<PublicReviews reviews={reviews} t={t} locale="en" />, "en");
    expect(screen.getByText("4.0")).toBeTruthy();
    expect(screen.getAllByText("Horizon Contracting")).toHaveLength(3);
  });

  it("attributes each review to the ORGANIZATION and never to a person", () => {
    const { container } = renderWithI18n(<PublicReviews reviews={[review()]} t={t} locale="en" />, "en");
    expect(screen.getByText("Horizon Contracting")).toBeTruthy();
    const text = container.textContent ?? "";
    for (const word of ["Submitted by", "Reviewer", "Verified client"]) {
      expect(text).not.toContain(word);
    }
  });

  it("shows no moderation state and no count of anything hidden", () => {
    const { container } = renderWithI18n(<PublicReviews reviews={[review()]} t={t} locale="en" />, "en");
    const text = container.textContent ?? "";
    for (const word of ["Suppressed", "Hidden", "Removed", "Under review"]) {
      expect(text).not.toContain(word);
    }
  });

  it("keeps the order it was given — newest first, decided by the query", () => {
    renderWithI18n(
      <PublicReviews
        reviews={[review({ jobTitle: "First" }), review({ jobTitle: "Second" })]}
        t={t}
        locale="en"
      />,
      "en",
    );
    const contexts = screen.getAllByText(/Marble & granite/).map((n) => n.textContent);
    expect(contexts[0]).toContain("First");
    expect(contexts[1]).toContain("Second");
  });

  it("lets a visitor-facing comment resolve its own direction on an Arabic profile", () => {
    const { container } = renderWithI18n(
      <PublicReviews reviews={[review()]} t={createTranslator("ar")} locale="ar" />,
      "ar",
    );
    for (const node of container.querySelectorAll("[dir]")) {
      expect(node.getAttribute("dir")).toBe("auto");
    }
  });
});

describe("ReviewsModule on the profile hub", () => {
  /** The reference card leads with 4.8; a fresh professional cannot lead with 0.0. */
  it("shows no numeral at all before the first review", () => {
    const { container } = renderWithI18n(
      <ReviewsModule summary={summarizeReviews([])} t={t} />,
      "en",
    );
    expect(screen.getByText("no reviews yet")).toBeTruthy();
    expect(container.textContent).not.toContain("0.0");
  });

  it("shows the real average and count once there are reviews", () => {
    renderWithI18n(
      <ReviewsModule summary={summarizeReviews([{ rating: 5 }, { rating: 4 }])} t={t} />,
      "en",
    );
    expect(screen.getByText("4.5")).toBeTruthy();
    expect(screen.getByText("Based on 2 reviews")).toBeTruthy();
  });

  it("links to the Reviews page rather than restating it", () => {
    const { container } = renderWithI18n(
      <ReviewsModule summary={summarizeReviews([{ rating: 5 }])} t={t} />,
      "en",
    );
    expect(container.querySelector('a[href="/home/reviews"]')).toBeTruthy();
  });
});
