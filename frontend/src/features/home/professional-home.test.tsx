import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { createTranslator } from "@/lib/i18n/translate";
import type { PersonalHomeData } from "@/server/queries/personal-home";
import type { OpportunityRow } from "@/server/queries/job-opportunities";
import { ProfessionalHome } from "./professional-home";

// The dashboard strip loads its other quick filters through a server action; these tests render the server-supplied strip only.
vi.mock("@/server/actions/dashboard-opportunities", () => ({ loadDashboardOpportunitiesAction: vi.fn() }));
vi.mock("@/server/actions/saved-jobs", () => ({ setJobSavedAction: vi.fn() }));

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
  availability: { available: false, updatedAt: null, state: "unknown" },
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
    // `baseProps` is an engineer — one of the five approved creators.
    expect(container.querySelector('a[href="/business/new"]')).toBeTruthy();
  });

  it("does not offer Add a business to a persona that is not entitled to create one", () => {
    for (const accountType of ["sales", "installer_technician", "contractor", "trainee"] as const) {
      const { container } = renderWithI18n(<ProfessionalHome {...baseProps} data={data({ accountType })} />, "en");
      expect(container.querySelector('a[href="/business/new"]'), accountType).toBeNull();
    }
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
    // The preview's fictional tiers must never appear on real data.
    expect(container.textContent).not.toMatch(/Silver|Gold/i);
  });

  it("shows the level DERIVED from the real balance (the approved bands), not stored or invented", () => {
    // Bands begin at 0 / 100 / 250 / 500 / 1000. 640 sits in level 4; 360 points reach level 5.
    renderWithI18n(<ProfessionalHome {...installerProps} pointsBalance={640} />, "en");
    expect(screen.getByText("Level 4")).toBeTruthy();
    expect(screen.getByText("360 points to Level 5")).toBeTruthy();
    expect(screen.getByText("640 / 1,000")).toBeTruthy();
  });

  it("derives level 1 for an empty ledger and the highest level without a next target", () => {
    const { unmount } = renderWithI18n(<ProfessionalHome {...installerProps} pointsBalance={0} />, "en");
    expect(screen.getByText("Level 1")).toBeTruthy();
    expect(screen.getByText("100 points to Level 2")).toBeTruthy();
    unmount();
    renderWithI18n(<ProfessionalHome {...installerProps} pointsBalance={1250} />, "en");
    expect(screen.getByText("Level 5")).toBeTruthy();
    expect(screen.getByText("Highest level reached")).toBeTruthy();
  });

  describe("welcome sentence — only what the data proves", () => {
    const welcome = (summary: { availableCount: number; nearbyCount: number | null }, lang: "en" | "ar" = "en") =>
      renderWithI18n(
        <ProfessionalHome {...installerProps} locale={lang} t={createTranslator(lang)} opportunitySummary={summary} />,
        lang,
      );

    it("says 'near you' only when a nearby count is proven, and states that count", () => {
      const { unmount } = welcome({ availableCount: 12, nearbyCount: 4 });
      expect(screen.getByText("You have 4 work opportunities near you")).toBeTruthy();
      unmount();
      welcome({ availableCount: 12, nearbyCount: 1 });
      expect(screen.getByText("You have 1 work opportunity near you")).toBeTruthy();
    });

    it("falls back to 'available' — never 'near you' — when location cannot be established (nearby unknown)", () => {
      const { container } = welcome({ availableCount: 12, nearbyCount: null });
      expect(screen.getByText("You have 12 work opportunities available")).toBeTruthy();
      expect(container.textContent).not.toMatch(/near you/i);
    });

    it("also falls back to 'available' when a location is known but nothing nearby exists", () => {
      const { container } = welcome({ availableCount: 12, nearbyCount: 0 });
      expect(screen.getByText("You have 12 work opportunities available")).toBeTruthy();
      expect(container.textContent).not.toMatch(/near you/i);
    });

    it("uses a grammatical sentence for exactly one available opening", () => {
      welcome({ availableCount: 1, nearbyCount: null });
      expect(screen.getByText("You have 1 work opportunity available")).toBeTruthy();
    });

    it("says there is nothing when nothing is open", () => {
      welcome({ availableCount: 0, nearbyCount: null });
      expect(screen.getByText("No work opportunities available right now")).toBeTruthy();
    });

    it("never calls an opening 'new': nothing records what the caller has already seen", () => {
      for (const summary of [
        { availableCount: 12, nearbyCount: 4 },
        { availableCount: 12, nearbyCount: null },
        { availableCount: 1, nearbyCount: null },
        { availableCount: 0, nearbyCount: null },
      ]) {
        const { container, unmount } = welcome(summary);
        const line = container.querySelector("p.mt-2")?.textContent ?? "";
        expect(line).not.toMatch(/\bnew\b/i);
        unmount();
      }
    });

    it("words every state in Arabic", () => {
      const { container, unmount } = welcome({ availableCount: 12, nearbyCount: 4 }, "ar");
      expect(container.textContent).toContain("لديك");
      expect(container.textContent).toContain("فرص عمل بالقرب منك");
      unmount();
      const second = welcome({ availableCount: 12, nearbyCount: null }, "ar");
      expect(second.container.textContent).toContain("فرص عمل متاحة");
      expect(second.container.textContent).not.toMatch(/بالقرب|جديدة/);
      second.unmount();
      const third = welcome({ availableCount: 1, nearbyCount: null }, "ar");
      expect(third.container.textContent).toContain("لديك فرصة عمل متاحة");
      third.unmount();
      const none = welcome({ availableCount: 0, nearbyCount: null }, "ar");
      expect(none.container.textContent).toContain("لا توجد فرص عمل متاحة الآن");
    });
  });

  it("carries the approved heading, 'Opportunities for you' — the strip is ordered for the caller by the database, and lists every open opening", () => {
    renderWithI18n(<ProfessionalHome {...installerProps} opportunities={[opportunity()]} />, "en");
    expect(screen.getByRole("heading", { name: "Opportunities for you" })).toBeTruthy();
    expect(screen.queryByText("Open opportunities")).toBeNull();
  });

  it("never prints a zero budget: a missing amount reads as 'Budget not specified'", () => {
    const { container } = renderWithI18n(
      <ProfessionalHome {...installerProps} opportunities={[opportunity({ offered_amount: null })]} />,
      "en",
    );
    expect(screen.getByText("Budget not specified")).toBeTruthy();
    expect(container.textContent).not.toMatch(/EGP\s?0\b|\b0\s?EGP/);
  });

  it("still shows the real amount when there is one", () => {
    const { container } = renderWithI18n(
      <ProfessionalHome {...installerProps} opportunities={[opportunity({ offered_amount: 4500 })]} />,
      "en",
    );
    expect(container.textContent).toMatch(/4,500/);
    expect(screen.queryByText("Budget not specified")).toBeNull();
  });

  it("never attaches a stock photograph to a real opening", () => {
    const { container } = renderWithI18n(
      <ProfessionalHome {...installerProps} opportunities={[opportunity(), opportunity({ id: "op-2", title: "Second job" })]} />,
      "en",
    );
    expect(container.querySelector("img[src*='/assets/installer-dashboard/jobs/']")).toBeNull();
  });

  it("draws the generic illustration for the opening's REAL trade when it has no photo", () => {
    const { container } = renderWithI18n(
      <ProfessionalHome {...installerProps} opportunities={[opportunity({ trade_key: "tiling" })]} />,
      "en",
    );
    const card = container.querySelector("#opportunities li")!;
    expect(card.querySelector('svg[data-illustration="tile"]')).toBeTruthy();
    expect(card.querySelector("img")).toBeNull();
  });

  it("chooses the illustration from the trade alone, never from list position", () => {
    const a = opportunity({ id: "op-a", title: "A", trade_key: "painting" });
    const b = opportunity({ id: "op-b", title: "B", trade_key: "plumbing" });
    const families = (list: OpportunityRow[]) => {
      const { container, unmount } = renderWithI18n(<ProfessionalHome {...installerProps} opportunities={list} />, "en");
      const out = [...container.querySelectorAll("#opportunities li")].map((li) => [
        li.querySelector("h3")?.textContent,
        li.querySelector("svg[data-illustration]")?.getAttribute("data-illustration"),
      ]);
      unmount();
      return Object.fromEntries(out);
    };
    expect(families([a, b])).toEqual(families([b, a]));
    expect(families([a, b])).toEqual({ A: "paint", B: "plumbing" });
  });

  it("uses the neutral toolbox for a trade the catalogue does not draw, rather than guessing", () => {
    const { container } = renderWithI18n(
      <ProfessionalHome {...installerProps} opportunities={[opportunity({ trade_key: "something_new" })]} />,
      "en",
    );
    expect(container.querySelector('svg[data-illustration="generic"]')).toBeTruthy();
  });

  it("offers only what the backend can honour on a real card: two separate links into the real flow, no local Apply, and a heart that is the REAL saved state", () => {
    const { container } = renderWithI18n(
      <ProfessionalHome {...installerProps} opportunities={[opportunity()]} />,
      "en",
    );
    // No button can apply from here: applying is a link into the opening's own page. The heart is the persisted
    // saved-jobs state (pressed = what the database says), never a local flip.
    expect(screen.queryByRole("button", { name: /apply now/i })).toBeNull();
    expect(screen.getByRole("button", { name: /save opportunity/i })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("link", { name: "Details" }).getAttribute("href")).toBe("/home/jobs/op-1");
    expect(screen.getByRole("link", { name: "Apply now" }).getAttribute("href")).toBe("/home/jobs/op-1?apply=1");
    expect(screen.queryByRole("link", { name: "View details and apply" })).toBeNull();
    expect(container.textContent).not.toMatch(/\d+% skill match|\bkm\b/);
  });

  it("reflects a real application: 'You applied' instead of an Apply action", () => {
    renderWithI18n(
      <ProfessionalHome {...installerProps} opportunities={[opportunity({ has_applied: true })]} />,
      "en",
    );
    expect(screen.getByText("You applied")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Apply now" })).toBeNull();
    expect(screen.getByRole("link", { name: "Details" }).getAttribute("href")).toBe("/home/jobs/op-1");
  });

  it("lists only assignments the caller can start now (scheduled), linked to the assignment", () => {
    const mk = (over: Record<string, unknown>) => ({ id: "a", job_title: "Job", poster_org_name: "Org", ...over }) as never;
    const { container } = renderWithI18n(
      <ProfessionalHome
        {...installerProps}
        assignments={[
          mk({ id: "s1", job_title: "Scheduled job", status: "scheduled", last_progress_at: null }),
          mk({ id: "p1", job_title: "Silent job", status: "in_progress", last_progress_at: null }),
          mk({ id: "p2", job_title: "Reported job", status: "in_progress", last_progress_at: "2026-09-30T10:00:00Z" }),
          mk({ id: "c1", job_title: "Finished job", status: "completed", last_progress_at: null }),
          mk({ id: "x1", job_title: "Cancelled job", status: "cancelled", last_progress_at: null }),
        ]}
      />,
      "en",
    );
    expect(screen.getByText("Scheduled job")).toBeTruthy();
    expect(container.querySelector('a[href="/home/work/s1"]')).toBeTruthy();
    expect(screen.getByText("Start work")).toBeTruthy();
    // An in-progress job with no report yet is NOT due anything: no rule makes a report due.
    expect(screen.queryByText("Silent job")).toBeNull();
    expect(container.querySelector('a[href="/home/work/p1"]')).toBeNull();
    expect(screen.queryByText("Reported job")).toBeNull();
    expect(screen.queryByText("Finished job")).toBeNull();
    expect(screen.queryByText("Cancelled job")).toBeNull();
    expect(screen.queryByText("Nothing needs your action right now.")).toBeNull();
  });

  it("shows the honest empty state when nothing is actionable, even with work in progress", () => {
    const inProgress = { id: "p1", job_title: "Silent job", status: "in_progress", last_progress_at: null, poster_org_name: "Org" } as never;
    renderWithI18n(<ProfessionalHome {...installerProps} assignments={[inProgress]} />, "en");
    expect(screen.getByText("Nothing needs your action right now.")).toBeTruthy();
    expect(screen.queryByText("Silent job")).toBeNull();
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

  it("shows the profile-completion banner from the database-defined completion, with its real percentage", () => {
    renderWithI18n(
      <ProfessionalHome {...installerProps} completion={{ percent: 62, missing: ["bio"] }} />,
      "en",
    );
    expect(screen.getByText("Complete your profile to appear more to showrooms")).toBeTruthy();
    expect(screen.getByText("62%")).toBeTruthy();
  });

  it("draws no banner when the database completion is unavailable or complete — it never substitutes another figure", () => {
    // A different, locally derived percentage exists on `data.completeness`; it must not leak in.
    const stale = installerData({ completeness: { percent: 62, completed: 5, total: 8, missing: ["bio"] } });
    const { unmount } = renderWithI18n(<ProfessionalHome {...installerProps} data={stale} completion={null} />, "en");
    expect(screen.queryByText("62%")).toBeNull();
    expect(screen.queryByText("Complete your profile to appear more to showrooms")).toBeNull();
    unmount();
    renderWithI18n(<ProfessionalHome {...installerProps} data={stale} completion={{ percent: 100, missing: [] }} />, "en");
    expect(screen.queryByText("Complete your profile to appear more to showrooms")).toBeNull();
  });

  it("renders in Arabic with no key leak", () => {
    const { container } = renderWithI18n(
      <ProfessionalHome {...installerProps} locale="ar" t={createTranslator("ar")} />,
      "ar",
    );
    expect(container.textContent).not.toMatch(/personalHome\.|jobs\.opportunities\./);
  });
});
