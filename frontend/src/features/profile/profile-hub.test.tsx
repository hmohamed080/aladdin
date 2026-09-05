import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { createTranslator } from "@/lib/i18n/translate";
import type { PersonalHomeData } from "@/server/queries/personal-home";
import type { NetworkOrganization } from "@/server/queries/network";

vi.mock("@/server/actions/availability", () => ({
  setAvailabilityAction: async () => ({ ok: true }),
}));

import { ProfileHub } from "./profile-hub";

const data = (over: Partial<PersonalHomeData> = {}): PersonalHomeData => ({
  variant: "professional",
  displayName: "Sayed Abdel-Rahman",
  accountType: "installer_technician",
  isSalesperson: false,
  phone: null,
  completeness: { percent: 100, completed: 8, total: 8, missing: [] },
  verification: { state: "verified", reason: null, decidedAt: null },
  availability: { available: false, updatedAt: null },
  consumer: { intent: null, interests: [], governorate: null, city: null, budget: null },
  professional: {
    concreteType: "installer_technician",
    headline: "Marble and granite fixing",
    yearsExperience: 18,
    specialization: "gypsum_paint",
    bio: null,
    services: ["finishing"],
    languages: ["ar"],
    // The PRIVATE lead-time preference — the field this increment had to stop
    // sharing a word with.
    availability: "within_week",
    serviceAreas: ["nasr_city"],
    offersRemote: false,
    governorate: "cairo",
    city: "nasr_city",
    maxTravelKm: 40,
    additionalServices: [],
  },
  sales: null,
  ...over,
});

const publication = { profileId: null, listed: false };
/** No canonical trades unless a test says so — the common state at Pilot start. */
const noTrades = { keys: [], primaryKey: null };

/**
 * The hub's wiring for availability.
 *
 * The assertion that earns its place is the LAST one. Before this increment the
 * hub had a row labelled "Availability" holding the one-off onboarding lead time.
 * Adding a live availability control to the same page would have put two
 * different facts under one word — and the failure is silent, because both render
 * perfectly. The label was changed; this pins it.
 */
/**
 * An account with nothing stored yet — the state every professional starts in,
 * and the one these tests care about, since none of them is about Portfolio.
 */
/** A professional with no reviews yet — the state these tests are not about. */
const noReviews = { average: null, total: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
/** A professional with no network yet — the state these tests are not about. */
const noNetwork: NetworkOrganization[] = [];

const noAssets = {
  portfolioTotal: 0,
  portfolioPublished: 0,
  portfolioPrivate: 0,
  portfolioUnfinished: 0,
  certificateTotal: 0,
  certificatesExpired: 0,
  certificateTitles: [],
  previewItemId: null,
};

describe("ProfileHub", () => {
  it("gives the professional a control for their own availability", () => {
    renderWithI18n(
      <ProfileHub data={data()} publication={publication} trades={noTrades} assets={noAssets} reviews={noReviews}
        network={noNetwork} t={createTranslator("en")} />,
      "en",
    );
    expect(screen.getByRole("button", { name: "Mark me available" })).toBeTruthy();
  });

  it("keeps the live flag and the onboarding LEAD TIME as two different things", () => {
    renderWithI18n(
      <ProfileHub data={data()} publication={publication} trades={noTrades} assets={noAssets} reviews={noReviews}
        network={noNetwork} t={createTranslator("en")} />,
      "en",
    );
    // The lead-time row is no longer called "Availability"…
    expect(screen.getByText("How soon you can start")).toBeTruthy();
    expect(screen.getByText("Within a week")).toBeTruthy();
    // …and the live state is stated in its own words, once.
    expect(screen.getByText("Not taking work")).toBeTruthy();
    expect(screen.queryByText("Availability")).toBeNull();
  });

  it("reflects an availability the person has already set", () => {
    renderWithI18n(
      <ProfileHub
        data={data({
          availability: {
            available: true,
            updatedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
          },
        })}
        publication={publication}
        trades={noTrades}
        assets={noAssets}
        reviews={noReviews}
        network={noNetwork}
        t={createTranslator("en")}
      />,
      "en",
    );
    expect(screen.getByText("Available for work")).toBeTruthy();
    expect(screen.getByText(/^Updated /)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mark me unavailable" })).toBeTruthy();
  });

  it("renders in Arabic with no key leak", () => {
    const { container } = renderWithI18n(
      <ProfileHub data={data()} publication={publication} trades={noTrades} assets={noAssets} reviews={noReviews}
        network={noNetwork} t={createTranslator("ar")} />,
      "ar",
    );
    expect(screen.getByText("لا أقبل أعمالًا حاليًا")).toBeTruthy();
    expect(screen.getByText("متى يمكنك البدء")).toBeTruthy();
    expect(container.textContent).not.toMatch(/profile\.|onboarding\./);
  });

  /**
   * The canonical taxonomy on the hub (Increment 5).
   *
   * The assertion that earns its place is the second one. `specialization` (free
   * text) and the canonical trade are THE SAME CLAIM in two vocabularies, and
   * this fixture holds both — `gypsum_paint` in the legacy column and
   * `marble_granite` in the taxonomy. Showing both would put two different
   * specialties on one profile with nothing to say which one the platform means.
   */
  it("states the canonical trades and marks the primary", () => {
    renderWithI18n(
      <ProfileHub
        data={data()}
        publication={publication}
        trades={{ keys: ["marble_granite", "tiling"], primaryKey: "marble_granite" }}
        assets={noAssets}
        reviews={noReviews}
        network={noNetwork}
        t={createTranslator("en")}
      />,
      "en",
    );
    expect(screen.getByText("Main trade")).toBeTruthy();
    expect(screen.getByText("Marble & granite")).toBeTruthy();
    expect(screen.getByText("Tiling")).toBeTruthy();
  });

  it("drops the legacy free-text specialty once a canonical trade exists", () => {
    renderWithI18n(
      <ProfileHub
        data={data()}
        publication={publication}
        trades={{ keys: ["marble_granite"], primaryKey: "marble_granite" }}
        assets={noAssets}
        reviews={noReviews}
        network={noNetwork}
        t={createTranslator("en")}
      />,
      "en",
    );
    // The fixture's legacy value is `gypsum_paint` — visible with no trades…
    expect(screen.queryByText("Gypsum & paint")).toBeNull();
  });

  it("keeps the legacy free text where there is no canonical trade to replace it", () => {
    renderWithI18n(
      <ProfileHub data={data()} publication={publication} trades={noTrades} assets={noAssets} reviews={noReviews}
        network={noNetwork} t={createTranslator("en")} />,
      "en",
    );
    // …and still the only answer there is without one. This increment deletes
    // nothing: a profile untouched since Increment 4 reads exactly as before.
    expect(screen.getByText("Gypsum & paint")).toBeTruthy();
  });

  it("tells a professional with no trades what to do about it", () => {
    renderWithI18n(
      <ProfileHub data={data()} publication={publication} trades={noTrades} assets={noAssets} reviews={noReviews}
        network={noNetwork} t={createTranslator("en")} />,
      "en",
    );
    expect(screen.getByTestId("trade-summary-empty")).toBeTruthy();
  });

  /**
   * The Network module (Increment 13, §10). Real data only: the module has no
   * input but the organization array itself, so a populated network can only
   * render from real completed-work rows.
   */
  it("tells a professional with no network yet that nothing has arrived", () => {
    renderWithI18n(
      <ProfileHub data={data()} publication={publication} trades={noTrades} assets={noAssets} reviews={noReviews}
        network={noNetwork} t={createTranslator("en")} />,
      "en",
    );
    expect(screen.getByText("no organizations yet")).toBeTruthy();
  });

  it("shows a real organization count once completed work exists", () => {
    const network: NetworkOrganization[] = [
      {
        orgId: "9a000000-aaaa-4aaa-8aaa-000000000005",
        orgName: "Horizon Contracting",
        completedCount: 2,
        firstCompletedAt: "2026-06-01T00:00:00Z",
        lastCompletedAt: "2026-08-01T00:00:00Z",
        tradeKeys: ["marble_granite", "tiling"],
        latestJobTitle: "Tiling entrance hall - Zamalek",
        latestAssignmentId: "a0000000-0000-4000-8000-000000000001",
        reviewCount: 1,
      },
    ];
    renderWithI18n(
      <ProfileHub data={data()} publication={publication} trades={noTrades} assets={noAssets} reviews={noReviews}
        network={network} t={createTranslator("en")} />,
      "en",
    );
    expect(screen.getByText("My network")).toBeTruthy();
    expect(screen.getByText("2 completed")).toBeTruthy();
  });
});
