import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { createTranslator } from "@/lib/i18n/translate";
import type { PersonalHomeData } from "@/server/queries/personal-home";
import type { OpportunityRow } from "@/server/queries/job-opportunities";
import { ProfessionalHome } from "./professional-home";

/**
 * Defaults to a non-installer persona (`engineer`) so these tests exercise the
 * GENERIC `ProfessionalHome` composition their descriptions actually name
 * (current work, quick-access links, verification review, the stat strip) —
 * `installer_technician` renders a different composition entirely, delegated
 * to `InstallerHome` (see the "installer_technician" describe block below).
 */
const data = (over: Partial<PersonalHomeData> = {}): PersonalHomeData => ({
  variant: "professional",
  displayName: "Sayed Abdel-Rahman",
  accountType: "engineer",
  isSalesperson: false,
  phone: null,
  completeness: { percent: 100, completed: 8, total: 8, missing: [] },
  verification: { state: "verified", reason: null, decidedAt: null },
  availability: { available: false, updatedAt: null },
  consumer: { intent: null, interests: [], governorate: null, city: null, budget: null },
  professional: {
    concreteType: "engineer",
    headline: "Marble and granite fixing",
    yearsExperience: 18,
    specialization: "gypsum_paint",
    bio: null,
    services: [],
    additionalServices: [],
    languages: ["ar"],
    availability: "within_week",
    serviceAreas: [],
    offersRemote: false,
    governorate: null,
    city: null,
    maxTravelKm: null,
  },
  sales: null,
  ...over,
});

const assignment = {
  id: "a1",
  job_id: "j1",
  status: "in_progress",
  latest_progress_percent: 60,
  job_title: "Marble staircase cladding",
  poster_org_name: "Horizon Contracting",
} as never;

const opportunity = (over: Partial<OpportunityRow> = {}): OpportunityRow =>
  ({
    id: "op-1",
    title: "Tiling entrance hall - Zamalek",
    description: null,
    poster_org_id: "org-1",
    poster_org_name: "Horizon Contracting",
    trade_key: "tiling",
    governorate: "Cairo",
    city: "Zamalek",
    offered_amount: 4500,
    offered_currency: "EGP",
    expected_duration_days: 3,
    starts_on: null,
    ends_by: null,
    published_at: "2026-09-01T00:00:00Z",
    has_applied: false,
    ...over,
  }) as OpportunityRow;

const baseProps = {
  data: data(),
  currentWork: null,
  opportunities: [] as OpportunityRow[],
  pointsBalance: 0,
  recentPointsEntry: null,
  reviewsAverage: null as number | null,
  reviewsTotal: 0,
  networkCount: 0,
  completedJobsCount: 0,
  locale: "en" as const,
  t: createTranslator("en"),
};

/**
 * `/home`, Increment 14: an operational dashboard, not a profile summary
 * (revisit brief, reference 01). Practice detail (specialty, service area,
 * bio) moved to the Account Overview — this page's job now is real current
 * state: current work, real open opportunities, and a real snapshot strip.
 */
describe("ProfessionalHome", () => {
  it("shows the real snapshot strip — Points, rating, network and completed jobs", () => {
    renderWithI18n(
      <ProfessionalHome
        {...baseProps}
        pointsBalance={350}
        reviewsAverage={4.8}
        reviewsTotal={12}
        networkCount={3}
        completedJobsCount={7}
      />,
      "en",
    );
    expect(screen.getByText("350")).toBeTruthy();
    expect(screen.getByText("4.8")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
  });

  it("shows an honest dash for the rating tile when there are no reviews yet, never 0.0", () => {
    renderWithI18n(<ProfessionalHome {...baseProps} reviewsAverage={null} reviewsTotal={0} />, "en");
    expect(screen.queryByText("0.0")).toBeNull();
  });

  it("leads the work section with the assignment actually under way", () => {
    const { container } = renderWithI18n(
      <ProfessionalHome {...baseProps} currentWork={assignment} />,
      "en",
    );
    expect(screen.getAllByText("Marble staircase cladding").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Horizon Contracting").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("progressbar", { name: "Reported progress" }).getAttribute("aria-valuenow"),
    ).toBe("60");
    expect(container.querySelector('a[href="/home/work/a1"]')).toBeTruthy();
  });

  it("shows a compact honest entry point when there is no current work", () => {
    const { container } = renderWithI18n(<ProfessionalHome {...baseProps} currentWork={null} />, "en");
    expect(screen.getByText("No work under way")).toBeTruthy();
    expect(container.querySelector('a[href="/home/jobs"]')).toBeTruthy();
  });

  it("shows a REAL opportunities preview, each linking to its own detail page", () => {
    const { container } = renderWithI18n(
      <ProfessionalHome {...baseProps} opportunities={[opportunity(), opportunity({ id: "op-2", title: "Bathroom marble replacement" })]} />,
      "en",
    );
    expect(screen.getByText("Tiling entrance hall - Zamalek")).toBeTruthy();
    expect(screen.getByText("Bathroom marble replacement")).toBeTruthy();
    expect(container.querySelector('a[href="/home/jobs/op-1"]')).toBeTruthy();
    expect(container.querySelector('a[href="/home/jobs"]')).toBeTruthy();
  });

  it("shows an honest empty state when there are no open opportunities, never an invented one", () => {
    renderWithI18n(<ProfessionalHome {...baseProps} opportunities={[]} />, "en");
    expect(screen.getByText("No opportunities right now")).toBeTruthy();
  });

  it("invents no match percentage, distance, count phrase or activity feed", () => {
    const { container } = renderWithI18n(
      <ProfessionalHome {...baseProps} opportunities={[opportunity()]} currentWork={assignment} />,
      "en",
    );
    expect(container.textContent).not.toMatch(/\d+% match/i);
    expect(container.textContent).not.toMatch(/matched|nearby|recommended for you/i);
    expect(container.textContent).not.toMatch(/\d+ (jobs?|opportunities|assignments) (waiting|available|matched)/i);
  });

  it("offers real quick-access links: edit profile, settings and add a business", () => {
    const { container } = renderWithI18n(<ProfessionalHome {...baseProps} />, "en");
    expect(container.querySelector('a[href="/home/profile/edit"]')).toBeTruthy();
    expect(container.querySelector('a[href="/home/settings"]')).toBeTruthy();
    expect(container.querySelector('a[href="/business/new"]')).toBeTruthy();
  });

  it("offers the verification review link only when it needs attention", () => {
    const { container: clean } = renderWithI18n(<ProfessionalHome {...baseProps} />, "en");
    expect(clean.querySelector('a[href="/onboarding/professional/review"]')).toBeNull();

    const { container: needsWork } = renderWithI18n(
      <ProfessionalHome
        {...baseProps}
        data={data({ verification: { state: "needs_more_info", reason: "blurry document", decidedAt: null } })}
      />,
      "en",
    );
    expect(needsWork.querySelector('a[href="/onboarding/professional/review"]')).toBeTruthy();
  });

  it("renders in Arabic with no key leak", () => {
    const { container } = renderWithI18n(
      <ProfessionalHome {...baseProps} locale="ar" t={createTranslator("ar")} />,
      "ar",
    );
    expect(container.textContent).not.toMatch(/personalHome\.|jobs\.opportunities\./);
  });
});

/**
 * `installer_technician` delegates to `InstallerHome`, which renders the SAME
 * approved presentation components as `/preview/installer-dashboard`
 * (`features/installer-dashboard-preview/*`) — see that component's own doc
 * comment. These tests pin the real-data contract: no mock content reaches
 * this path, no fabricated field (match %, distance, points level) appears,
 * and a module with no real backend source yet renders its approved empty
 * state rather than the old bespoke "Current work" / "My network" modules.
 *
 * Empirically cross-checked (2026-09-21) against two real, live-seeded
 * `installer_technician` accounts (local Supabase, OTP sign-in) — the same
 * composition asserted here rendered in the browser with zero console
 * errors and none of the legacy generic-path strings.
 */
describe("ProfessionalHome — installer_technician (shared with /preview/installer-dashboard)", () => {
  const installerData = (over: Partial<PersonalHomeData> = {}) =>
    data({
      accountType: "installer_technician",
      professional: {
        concreteType: "installer_technician",
        headline: "Marble and granite fixing",
        yearsExperience: 18,
        specialization: "gypsum_paint",
        bio: null,
        services: [],
        additionalServices: [],
        languages: ["ar"],
        availability: "within_week",
        serviceAreas: [],
        offersRemote: false,
        governorate: null,
        city: null,
        maxTravelKm: null,
      },
      ...over,
    });

  const installerProps = {
    ...baseProps,
    data: installerData(),
  };

  it("renders the shared installer dashboard root, not the generic professional layout", () => {
    const { container } = renderWithI18n(<ProfessionalHome {...installerProps} />, "en");
    expect(container.querySelector('[data-testid="installer-home"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="professional-home"]')).toBeNull();
  });

  it("greets by first name and shows the real points balance, never mock figures", () => {
    renderWithI18n(<ProfessionalHome {...installerProps} pointsBalance={640} />, "en");
    expect(screen.getByText(/Hi Sayed/)).toBeTruthy();
    // Mock preview balance (4,850) must never leak onto the real page.
    expect(screen.queryByText("4,850")).toBeNull();
  });

  it("shows the real, bounded opportunities and their real EGP amounts — no invented skill match or distance", () => {
    const { container } = renderWithI18n(
      <ProfessionalHome {...installerProps} opportunities={[opportunity()]} />,
      "en",
    );
    expect(screen.getByText("Tiling entrance hall - Zamalek")).toBeTruthy();
    expect(container.querySelector('a[href="/home/jobs/op-1"]')).toBeTruthy();
    expect(container.textContent).not.toMatch(/\d+% skill match/i);
    expect(container.textContent).not.toMatch(/\bkm\b/);
  });

  it("shows the approved empty states for needs-action, brand ecosystem and learning — never the preview's mock content", () => {
    const { container } = renderWithI18n(<ProfessionalHome {...installerProps} />, "en");
    expect(screen.getByText("Nothing needs your action right now.")).toBeTruthy();
    expect(screen.getByText("No factory or brand updates yet.")).toBeTruthy();
    expect(screen.getByText("Training content will appear here once it is published.")).toBeTruthy();
    // Mock-only brand/action/course names must never reach real /home.
    expect(container.textContent).not.toMatch(/Jotun|WPC Factory|SPC Academy|MarbleX/);
    expect(container.textContent).not.toMatch(/Confirm the site visit|Upload work photos/);
  });

  it("shows real points, rating and completed-jobs in the rewards card, with no invented level system", () => {
    const { container } = renderWithI18n(
      <ProfessionalHome {...installerProps} pointsBalance={640} reviewsAverage={4.8} reviewsTotal={12} completedJobsCount={7} />,
      "en",
    );
    expect(screen.getByText("640")).toBeTruthy();
    expect(screen.getByText("4.8")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
    // The mock's fictional level/progression copy must never appear on real data.
    expect(container.textContent).not.toMatch(/Silver Pro|Gold Pro|next level/i);
  });

  it("does not render the old bespoke Current-work or My-network modules", () => {
    renderWithI18n(<ProfessionalHome {...installerProps} currentWork={assignment} />, "en");
    expect(screen.queryByText("Marble staircase cladding")).toBeNull();
    expect(screen.queryByText("My showroom network")).toBeNull();
  });

  it("hides the profile-completion banner completely at 100% — no legacy standalone cards either", () => {
    // installerProps.data defaults to completeness.percent === 100.
    const { container } = renderWithI18n(<ProfessionalHome {...installerProps} />, "en");
    expect(screen.queryByText("Complete your profile to appear more to showrooms")).toBeNull();
    expect(screen.queryByText("Complete profile")).toBeNull();
    // The legacy generic-path strings (quick-access panel, standalone
    // completeness/verification cards, a "current work" section heading)
    // must never appear on the installer path, at any completeness level.
    expect(container.textContent).not.toMatch(/Quick access/);
    expect(screen.queryByText("Profile completion")).toBeNull();
    expect(screen.queryByText("Verification", { selector: "h2, h3" })).toBeNull();
  });

  it("shows the profile-completion banner when completeness is under 100%, with the real percentage", () => {
    renderWithI18n(
      <ProfessionalHome
        {...installerProps}
        data={installerData({ completeness: { percent: 62, completed: 5, total: 8, missing: ["bio"] } })}
      />,
      "en",
    );
    expect(screen.getByText("Complete your profile to appear more to showrooms")).toBeTruthy();
    expect(screen.getByText("62%")).toBeTruthy();
  });

  it("renders in Arabic with no key leak", () => {
    const { container } = renderWithI18n(
      <ProfessionalHome {...installerProps} locale="ar" t={createTranslator("ar")} />,
      "ar",
    );
    expect(container.textContent).not.toMatch(/personalHome\.|jobs\.opportunities\./);
  });
});
