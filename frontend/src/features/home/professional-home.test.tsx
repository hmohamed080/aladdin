import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { createTranslator } from "@/lib/i18n/translate";
import type { PersonalHomeData } from "@/server/queries/personal-home";
import type { OpportunityRow } from "@/server/queries/job-opportunities";
import { ProfessionalHome } from "./professional-home";

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
