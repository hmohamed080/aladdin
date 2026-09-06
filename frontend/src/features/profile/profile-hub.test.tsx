import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { createTranslator } from "@/lib/i18n/translate";
import type { PersonalHomeData } from "@/server/queries/personal-home";
import type { NetworkOrganization } from "@/server/queries/network";

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
/** A professional with no reviews yet — the state most of these tests are not about. */
const noReviews = { average: null, total: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };
/** A professional with no network yet — the state most of these tests are not about. */
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

const baseProps = {
  data: data(),
  publication,
  assets: noAssets,
  reviews: noReviews,
  network: noNetwork,
  pointsBalance: 0,
  completedJobsCount: 0,
  locale: "en" as const,
  t: createTranslator("en"),
};

describe("ProfileHub", () => {
  it("shows the live availability as a read-only badge in the identity header, not an editable control", () => {
    renderWithI18n(<ProfileHub {...baseProps} />, "en");
    expect(screen.getAllByText("Not taking work").length).toBeGreaterThan(0);
    // The toggle itself moved to /home/settings — the Overview states the
    // fact, it does not offer the control.
    expect(screen.queryByRole("button", { name: "Mark me available" })).toBeNull();
  });

  it("reflects an availability the person has already set", () => {
    renderWithI18n(
      <ProfileHub
        {...baseProps}
        data={data({
          availability: {
            available: true,
            updatedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
          },
        })}
      />,
      "en",
    );
    expect(screen.getAllByText("Available for work").length).toBeGreaterThan(0);
  });

  it("links to the real Edit Profile destination rather than reproducing its content", () => {
    const { container } = renderWithI18n(<ProfileHub {...baseProps} />, "en");
    expect(container.querySelector('a[href="/home/profile/edit"]')).toBeTruthy();
  });

  /**
   * The composition correction (revisit, Increment 14): trades, lead time,
   * languages, service area, core services and bio all belong to
   * `/home/profile/edit` now — restating them here is exactly what made the
   * previous pass a second profile editor instead of a dashboard.
   */
  it("does not reproduce the full professional-profile detail inline", () => {
    const { container } = renderWithI18n(<ProfileHub {...baseProps} />, "en");
    expect(container.textContent).not.toContain("The trades you work in");
    expect(container.textContent).not.toContain("Are you taking work?");
    expect(container.textContent).not.toContain("Your professional profile");
    expect(container.textContent).not.toContain("Core services");
    expect(screen.queryByTestId("trade-summary-empty")).toBeNull();
  });

  it("renders in Arabic with no key leak", () => {
    const { container } = renderWithI18n(
      <ProfileHub {...baseProps} locale="ar" t={createTranslator("ar")} />,
      "ar",
    );
    expect(screen.getAllByText("لا أقبل أعمالًا حاليًا").length).toBeGreaterThan(0);
    expect(container.textContent).not.toMatch(/profile\.|onboarding\./);
  });

  /**
   * The Network module (Increment 13, §10). Real data only: the module has no
   * input but the organization array itself, so a populated network can only
   * render from real completed-work rows.
   */
  it("tells a professional with no network yet that nothing has arrived", () => {
    renderWithI18n(<ProfileHub {...baseProps} />, "en");
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
    renderWithI18n(<ProfileHub {...baseProps} network={network} />, "en");
    expect(screen.getAllByText("My network").length).toBeGreaterThan(0);
    expect(screen.getByText("2 completed")).toBeTruthy();
  });
});

/**
 * The Account Overview redesign (Increment 14, reference 04): a real summary
 * strip and a six-module grid (Work and Points join Portfolio, Certificates,
 * Reviews and Network), reading the SAME functions `/home/points` and
 * `/home/work` themselves use — never a second derivation.
 */
describe("ProfileHub — Account Overview summary strip and module grid", () => {
  it("shows the real summary strip — reviews, rating, completed jobs and Points", () => {
    renderWithI18n(
      <ProfileHub {...baseProps} reviews={{ average: 4.8, total: 12, distribution: { 1: 0, 2: 0, 3: 1, 4: 3, 5: 8 } }} completedJobsCount={7} pointsBalance={350} />,
      "en",
    );
    expect(screen.getAllByText("12").length).toBeGreaterThan(0);
    expect(screen.getAllByText("4.8").length).toBeGreaterThan(0);
    expect(screen.getAllByText("7").length).toBeGreaterThan(0);
    expect(screen.getAllByText("350").length).toBeGreaterThan(0);
  });

  it("never shows 0.0 for a professional with no reviews yet", () => {
    const { container } = renderWithI18n(<ProfileHub {...baseProps} />, "en");
    expect(container.textContent).not.toContain("0.0");
  });

  it("adds real Work and Points modules to the grid, each linking to its own page", () => {
    const { container } = renderWithI18n(<ProfileHub {...baseProps} completedJobsCount={4} pointsBalance={200} />, "en");
    expect(container.querySelectorAll('a[href="/home/work"]').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('a[href="/home/points"]').length).toBeGreaterThan(0);
  });

  it("offers a real Settings entry point in the account action area", () => {
    const { container } = renderWithI18n(<ProfileHub {...baseProps} />, "en");
    expect(container.querySelector('a[href="/home/settings"]')).toBeTruthy();
  });

  it("invents no completion percentage, verification score or fake rating", () => {
    const { container } = renderWithI18n(<ProfileHub {...baseProps} />, "en");
    expect(container.textContent).not.toMatch(/\d+% complete/i);
    expect(container.textContent).not.toMatch(/trust score|verification score/i);
  });

  /**
   * The Public Profile destination (revisit, Increment 14): a real link when
   * listed, a real state with no action when not — never the two-paragraph
   * explainer a prior pass gave its own full section.
   */
  it("offers a real link to the public profile once it is listed", () => {
    const { container } = renderWithI18n(
      <ProfileHub {...baseProps} publication={{ profileId: "prof-1", listed: true }} />,
      "en",
    );
    expect(container.querySelector('a[href="/p/prof-1"]')).toBeTruthy();
    expect(screen.getByText("Your profile is published")).toBeTruthy();
  });

  it("states the public profile is not published yet, with no dead link", () => {
    const { container } = renderWithI18n(
      <ProfileHub {...baseProps} publication={{ profileId: null, listed: false }} />,
      "en",
    );
    expect(container.querySelector('a[href^="/p/"]')).toBeNull();
    expect(screen.getByText("Not published yet")).toBeTruthy();
  });
});
