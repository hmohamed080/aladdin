import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { OpportunityList } from "./opportunity-list";
import type { OpportunityRow } from "@/server/queries/job-opportunities";

const opportunity = (over: Partial<OpportunityRow> = {}): OpportunityRow =>
  ({
    id: "j1",
    title: "Marble staircase cladding",
    description: "Ground to first floor.",
    trade_key: "marble_granite",
    offered_amount: 18000,
    offered_currency: "EGP",
    governorate: "Cairo",
    city: "New Cairo",
    expected_duration_days: 14,
    starts_on: "2026-09-20",
    ends_by: null,
    published_at: "2026-09-01T00:00:00Z",
    poster_org_id: "o1",
    poster_org_name: "Horizon Contracting",
    has_applied: false,
    ...over,
  }) as OpportunityRow;

describe("OpportunityList", () => {
  it("names the opening, the organization offering it and its canonical trade", () => {
    renderWithI18n(
      <OpportunityList opportunities={[opportunity()]} locale="en" filtered={false} />,
      "en",
    );
    expect(screen.getByRole("heading", { name: "Marble staircase cladding" })).toBeTruthy();
    expect(screen.getByText(/Horizon Contracting/)).toBeTruthy();
    expect(screen.getByText("Marble & granite")).toBeTruthy();
  });

  /**
   * The bug Increment 7's browser pass found on the poster side: `formatMoney`
   * already emits the currency, and the code appended it again. Asserted here
   * before a browser has to.
   */
  it("prints the currency exactly once", () => {
    const { container } = renderWithI18n(
      <OpportunityList opportunities={[opportunity()]} locale="en" filtered={false} />,
      "en",
    );
    expect(container.textContent?.match(/EGP/g)?.length).toBe(1);
  });

  /**
   * §0 and §24. Every one of these is on the reference board and none has any
   * authority behind it — a match score the product invented is one the reader
   * would then trust, and a bookmark that saves nothing is a promise the schema
   * cannot keep.
   */
  it("invents no match score, distance, rating, urgency or saved-job affordance", () => {
    const { container } = renderWithI18n(
      <OpportunityList opportunities={[opportunity()]} locale="en" filtered={false} />,
      "en",
    );
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/\b(match|fit|score|%|km|rating|urgent|recommended)\b/i);
    expect(container.querySelector('[aria-label*="save" i]')).toBeNull();
    expect(container.querySelector('[aria-label*="bookmark" i]')).toBeNull();
  });

  /** §3: the exact site address is not in the read seam, and must not appear. */
  it("shows the city and governorate but never a street address", () => {
    const { container } = renderWithI18n(
      <OpportunityList
        opportunities={[opportunity({ city: "New Cairo", governorate: "Cairo" })]}
        locale="en"
        filtered={false}
      />,
      "en",
    );
    expect(container.textContent).toContain("New Cairo, Cairo");
    expect(container.textContent).not.toMatch(/street|road|\b\d+\s+\w+\s+(St|Rd)\b/i);
  });

  it("marks an opening this professional has already applied to", () => {
    renderWithI18n(
      <OpportunityList
        opportunities={[opportunity({ has_applied: true })]}
        locale="en"
        filtered={false}
      />,
      "en",
    );
    expect(screen.getByText("You applied")).toBeTruthy();
  });

  it("says nothing about applying on an opening they have not", () => {
    const { container } = renderWithI18n(
      <OpportunityList opportunities={[opportunity()]} locale="en" filtered={false} />,
      "en",
    );
    expect(container.textContent).not.toContain("You applied");
  });

  /** §6: one primary action, and it is not Apply — applying is deliberate. */
  it("offers exactly one action per card, to the details page", () => {
    const { container } = renderWithI18n(
      <OpportunityList opportunities={[opportunity()]} locale="en" filtered={false} />,
      "en",
    );
    const links = [...container.querySelectorAll("a")];
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute("href")).toBe("/home/jobs/j1");
    expect(container.querySelector("button")).toBeNull();
  });

  /**
   * §29: "nothing here yet" and "nothing matched your filters" are different
   * facts, and telling somebody the board is empty when they simply narrowed it
   * to nothing sends them away from work that exists.
   */
  it("tells an empty board apart from an over-narrow filter", () => {
    const bare = renderWithI18n(
      <OpportunityList opportunities={[]} locale="en" filtered={false} />,
      "en",
    );
    expect(bare.container.textContent).toContain("No opportunities right now");
    bare.unmount();

    renderWithI18n(<OpportunityList opportunities={[]} locale="en" filtered />, "en");
    expect(screen.getByText(/No opportunities match those filters/)).toBeTruthy();
  });

  /** And the empty board says WHY it is empty, without implying a trade gate. */
  it("says the board is not filtered by the reader's declared trades", () => {
    const { container } = renderWithI18n(
      <OpportunityList opportunities={[]} locale="en" filtered={false} />,
      "en",
    );
    expect(container.textContent).toMatch(/Nothing is hidden from you because of the trades/);
  });

  it("renders in Arabic with no raw trade key, enum or message path", () => {
    const { container } = renderWithI18n(
      <OpportunityList opportunities={[opportunity()]} locale="ar" filtered={false} />,
      "ar",
    );
    expect(container.textContent).not.toMatch(/marble_granite/);
    expect(container.textContent).not.toMatch(/jobs\.|onboarding\./);
  });

  it("lists several openings without collapsing them", () => {
    renderWithI18n(
      <OpportunityList
        opportunities={[opportunity(), opportunity({ id: "j2", title: "Bathroom fitting" })]}
        locale="en"
        filtered={false}
      />,
      "en",
    );
    expect(screen.getAllByRole("heading")).toHaveLength(2);
  });
});
