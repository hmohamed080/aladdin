import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/server/actions/application-forms", () => ({
  applyToJobAction: async () => ({ ok: true }),
  withdrawApplicationAction: async () => ({ ok: true }),
}));

import {
  OpportunityDetail,
  type OpportunityView,
  type MyCandidacy,
} from "./opportunity-detail";

const job = (over: Partial<OpportunityView> = {}): OpportunityView => ({
  jobId: "j1",
  title: "Marble staircase cladding",
  description: "Ground to first floor, including nosings.",
  tradeKey: "marble_granite",
  posterOrgName: "Horizon Contracting",
  governorate: "Cairo",
  city: "New Cairo",
  offeredAmount: 18000,
  expectedDurationDays: 14,
  startsOn: "2026-09-20",
  endsBy: null,
  publishedAt: "2026-09-01T00:00:00Z",
  discoverable: true,
  jobStatus: "open",
  ...over,
});

const candidacy = (over: Partial<MyCandidacy> = {}): MyCandidacy => ({
  applicationId: "a1",
  status: "submitted",
  note: "Available from Sunday.",
  appliedAt: "2026-09-02T00:00:00Z",
  decidedAt: null,
  decisionReason: null,
  ...over,
});

const base = { canApply: true, locale: "en" as const };

describe("OpportunityDetail", () => {
  it("leads with the opening, who is offering it, and the terms", () => {
    renderWithI18n(<OpportunityDetail {...base} job={job()} application={null} />, "en");
    expect(screen.getByRole("heading", { name: "Marble staircase cladding" })).toBeTruthy();
    expect(screen.getByText(/Horizon Contracting/)).toBeTruthy();
    expect(screen.getByText("Marble & granite")).toBeTruthy();
    expect(screen.getByText(/Ground to first floor/)).toBeTruthy();
  });

  it("prints the currency exactly once", () => {
    const { container } = renderWithI18n(
      <OpportunityDetail {...base} job={job()} application={null} />,
      "en",
    );
    expect(container.textContent?.match(/EGP/g)?.length).toBe(1);
  });

  /**
   * §7. `site_address` is not in either read seam, so it CANNOT leak — but a
   * blank where an address would be reads as missing data. Naming the rule is
   * what turns an absence into an explanation.
   */
  it("states the withheld site address as a rule rather than leaving a gap", () => {
    const { container } = renderWithI18n(
      <OpportunityDetail {...base} job={job()} application={null} />,
      "en",
    );
    expect(screen.getByText(/exact site address is shared with the professional who is awarded/i))
      .toBeTruthy();
    expect(container.textContent).not.toMatch(/12 Street 90|Street 90/);
  });

  it("exposes no poster-side management control", () => {
    const { container } = renderWithI18n(
      <OpportunityDetail {...base} job={job()} application={null} />,
      "en",
    );
    for (const name of [/publish/i, /edit/i, /cancel job/i, /stop recruiting/i, /applicants/i]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(container.querySelector('a[href^="/b2b"]')).toBeNull();
  });

  // ---- Apply -------------------------------------------------------------
  it("offers Apply on a live opening the caller has not applied to", () => {
    renderWithI18n(<OpportunityDetail {...base} job={job()} application={null} />, "en");
    expect(screen.getByRole("button", { name: "Apply for this job" })).toBeTruthy();
  });

  /** §26: no completeness, verification, certificate or portfolio gate exists. */
  it("gates Apply on nothing but the account being professional", () => {
    const allowed = renderWithI18n(
      <OpportunityDetail {...base} job={job()} application={null} />,
      "en",
    );
    expect(allowed.container.querySelector("button")).toBeTruthy();
    allowed.unmount();

    renderWithI18n(
      <OpportunityDetail {...base} canApply={false} job={job()} application={null} />,
      "en",
    );
    expect(screen.queryByRole("button", { name: "Apply for this job" })).toBeNull();
    expect(screen.getByText(/Only professional accounts can apply/)).toBeTruthy();
  });

  it("offers no Apply on an opening that has left discovery", () => {
    renderWithI18n(
      <OpportunityDetail
        {...base}
        job={job({ discoverable: false, jobStatus: "awarded" })}
        application={null}
      />,
      "en",
    );
    expect(screen.queryByRole("button", { name: "Apply for this job" })).toBeNull();
    expect(screen.getByText(/no longer accepting applications/i)).toBeTruthy();
  });

  // ---- The caller's own candidacy ----------------------------------------
  it("replaces Apply with the candidacy's state once they have applied", () => {
    renderWithI18n(
      <OpportunityDetail {...base} job={job()} application={candidacy()} />,
      "en",
    );
    expect(screen.queryByRole("button", { name: "Apply for this job" })).toBeNull();
    expect(screen.getByText("Applied")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Withdraw application" })).toBeTruthy();
  });

  it("shows what they wrote to the organization", () => {
    renderWithI18n(<OpportunityDetail {...base} job={job()} application={candidacy()} />, "en");
    expect(screen.getByText("Available from Sunday.")).toBeTruthy();
  });

  it("offers no withdrawal once the candidacy is decided", () => {
    for (const status of ["accepted", "rejected"] as const) {
      const { unmount } = renderWithI18n(
        <OpportunityDetail
          {...base}
          job={job()}
          application={candidacy({ status, decisionReason: "x", decidedAt: "2026-09-03T00:00:00Z" })}
        />,
        "en",
      );
      expect(screen.queryByRole("button", { name: "Withdraw application" })).toBeNull();
      unmount();
    }
  });

  /**
   * §20. The acceptance now leads somewhere — and the work controls still do NOT
   * live here. Starting, reporting progress and ending the engagement belong to
   * `/home/work/[assignmentId]`; this page hands the reader a route and stops.
   */
  it("routes an acceptance to My Work without growing work controls of its own", () => {
    const { container } = renderWithI18n(
      <OpportunityDetail
        {...base}
        job={job()}
        application={candidacy({ status: "accepted", decidedAt: "2026-09-03T00:00:00Z" })}
        assignmentId="asg-1"
      />,
      "en",
    );
    expect(screen.getByText("Your application was accepted")).toBeTruthy();
    expect(container.querySelector('a[href="/home/work/asg-1"]')).toBeTruthy();
    for (const name of [/start work/i, /update progress/i, /confirm completion/i, /review/i]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  it("offers no My Work route when the assignment did not resolve", () => {
    const { container } = renderWithI18n(
      <OpportunityDetail
        {...base}
        job={job()}
        application={candidacy({ status: "accepted", decidedAt: "2026-09-03T00:00:00Z" })}
      />,
      "en",
    );
    expect(container.querySelector('a[href*="/home/work"]')).toBeNull();
  });

  it("shows a rejection with the organization's own reason, and no way to argue", () => {
    renderWithI18n(
      <OpportunityDetail
        {...base}
        job={job()}
        application={candidacy({
          status: "rejected",
          decisionReason: "We need marble experience on site.",
          decidedAt: "2026-09-03T00:00:00Z",
        })}
      />,
      "en",
    );
    expect(screen.getByText("We need marble experience on site.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /apply/i })).toBeNull();
    for (const name of [/appeal/i, /message/i, /contact/i]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  /**
   * The one system-written reason. `job_application_accept` closes losing
   * candidacies with a fixed English sentence; an Arabic reader must not be
   * shown it, and it must not read as the organization's own words.
   */
  it("translates the system's own auto-rejection instead of printing it raw", () => {
    const { container } = renderWithI18n(
      <OpportunityDetail
        {...base}
        job={job()}
        application={candidacy({
          status: "rejected",
          decisionReason: "the job was awarded to another applicant",
          decidedAt: "2026-09-03T00:00:00Z",
        })}
      />,
      "ar",
    );
    expect(container.textContent).not.toContain("the job was awarded to another applicant");
    expect(container.textContent).toContain("أُسندت الفرصة إلى مهني آخر.");
  });

  // ---- Withdrawal and re-application -------------------------------------
  it("offers Apply again on a withdrawn candidacy while the opening is still live", () => {
    renderWithI18n(
      <OpportunityDetail
        {...base}
        job={job()}
        application={candidacy({ status: "withdrawn" })}
      />,
      "en",
    );
    expect(screen.getByRole("button", { name: "Apply again" })).toBeTruthy();
  });

  /** §17: withdrawn-and-closed is its own state, not a rejection. */
  it("explains a withdrawn candidacy that can no longer be sent again", () => {
    renderWithI18n(
      <OpportunityDetail
        {...base}
        job={job({ discoverable: false, jobStatus: "closed" })}
        application={candidacy({ status: "withdrawn" })}
      />,
      "en",
    );
    expect(screen.queryByRole("button", { name: "Apply again" })).toBeNull();
    expect(screen.getByText(/no longer accepting applications, so it cannot be sent again/i))
      .toBeTruthy();
  });

  it("never describes the compensation as paid, owed or handled by Aladdin", () => {
    const { container } = renderWithI18n(
      <OpportunityDetail {...base} job={job()} application={null} />,
      "en",
    );
    expect(container.textContent).not.toMatch(
      /\b(paid|earned|payout|escrow|wallet|invoice|balance|commission|owed)\b/i,
    );
  });

  it("renders in Arabic with no raw key, enum or message path", () => {
    const { container } = renderWithI18n(
      <OpportunityDetail {...base} job={job()} application={candidacy()} />,
      "ar",
    );
    expect(container.textContent).not.toMatch(/marble_granite|submitted|withdrawn/);
    expect(container.textContent).not.toMatch(/jobs\.|onboarding\./);
  });
});
