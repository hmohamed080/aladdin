import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/server/actions/job-forms", () => ({
  publishJobAction: async () => ({ ok: true }),
  closeJobAction: async () => ({ ok: true }),
  cancelJobAction: async () => ({ ok: true }),
}));
// The awarded panel binds the assignment lifecycle actions (Increment 9).
vi.mock("@/server/actions/assignment-forms", () => ({
  startWorkAction: async () => ({ ok: true }),
  addProgressAction: async () => ({ ok: true }),
  cancelAssignmentAction: async () => ({ ok: true }),
  completeAssignmentAction: async () => ({ ok: true }),
}));
// And the completed-job panel binds the review action (Increment 12).
vi.mock("@/server/actions/reviews", () => ({
  submitReviewAction: async () => ({ ok: true }),
}));

import { JobDetail } from "./job-detail";
import type { JobListRow, JobAssignmentRow } from "@/server/queries/jobs";

const job = (over: Partial<JobListRow> = {}): JobListRow =>
  ({
    id: "j1",
    poster_org_id: "o1",
    poster_branch_id: null,
    title: "Marble staircase cladding",
    description: "Ground to first floor.",
    trade_id: "t3",
    offered_amount: 18000,
    offered_currency: "EGP",
    governorate: "Cairo",
    city: "New Cairo",
    site_address: "12 Street 90",
    expected_duration_days: 10,
    starts_on: null,
    ends_by: null,
    status: "draft",
    version: 1,
    published_at: null,
    closed_at: null,
    created_by: "u1",
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    tradeKey: "marble_granite",
    tradeRetired: false,
    applicationCount: 0,
    ...over,
  }) as JobListRow;

const assignment = (over: Partial<JobAssignmentRow> = {}): JobAssignmentRow =>
  ({
    id: "as1",
    job_id: "j1",
    application_id: "a1",
    installer_user_id: "u9",
    poster_org_id: "o1",
    agreed_amount: 18000,
    agreed_currency: "EGP",
    status: "scheduled",
    latest_progress_percent: 0,
    last_progress_at: null,
    version: 1,
    started_at: null,
    completed_at: null,
    cancelled_at: null,
    cancellation_reason: null,
    created_at: "2026-09-03T00:00:00Z",
    updated_at: "2026-09-03T00:00:00Z",
    ...over,
  }) as JobAssignmentRow;

const poster = { canPost: true, canManage: true, orgVerified: true };
const base = { assignee: null, assignment: null, progress: [], review: null, locale: "en" as const };

describe("JobDetail", () => {
  /**
   * A browser found `EGP 18,000.00 EGP` on the list and the detail: `formatMoney`
   * already emits the currency, and the code appended it again. No test looked at
   * the rendered money string, so nothing caught it. This is that test.
   */
  it("prints the currency exactly once", () => {
    const { container } = renderWithI18n(
      <JobDetail {...base} job={job()} role={poster} />,
      "en",
    );
    const text = container.textContent ?? "";
    expect(text.match(/EGP/g)?.length).toBe(1);
    expect(text).not.toMatch(/EGP[\d\s,.]*EGP/);
  });

  /**
   * A trade the platform has retired keeps its name on the job that was posted
   * in it — `job_trade_labels` is what makes that readable again. Showing a dash
   * here would erase the poster's own decision from their own record.
   */
  it("keeps the label of a trade that has since been retired", () => {
    renderWithI18n(
      <JobDetail {...base} job={job({ tradeRetired: true })} role={poster} />,
      "en",
    );
    expect(screen.getByText(/Marble & granite/)).toBeTruthy();
    // And says it is history rather than a choice still on the menu — on a draft
    // this is also the reason Publish is about to refuse.
    expect(screen.getByText(/no longer offered/i)).toBeTruthy();
  });

  it("says nothing about retirement for a trade that is current", () => {
    const { container } = renderWithI18n(<JobDetail {...base} job={job()} role={poster} />, "en");
    expect(container.textContent).not.toMatch(/no longer offered/i);
  });

  it("marks a retired trade in Arabic too, with no key path", () => {
    const { container } = renderWithI18n(
      <JobDetail {...base} job={job({ tradeRetired: true })} role={poster} />,
      "ar",
    );
    expect(container.textContent).not.toMatch(/jobs\.hint/);
    expect(screen.getByText(/لم تعد هذه المهنة متاحة/)).toBeTruthy();
  });

  it("leads with the job's identity, state and canonical trade", () => {
    renderWithI18n(<JobDetail {...base} job={job()} role={poster} />, "en");
    expect(screen.getByRole("heading", { name: "Marble staircase cladding" })).toBeTruthy();
    expect(screen.getByText("Draft")).toBeTruthy();
    expect(screen.getByText("Marble & granite")).toBeTruthy();
  });

  // ---- Publish -----------------------------------------------------------
  it("offers Publish on a draft from a verified organization", () => {
    renderWithI18n(<JobDetail {...base} job={job()} role={poster} />, "en");
    expect(screen.getByRole("button", { name: "Publish" })).toBeTruthy();
  });

  /**
   * The genuine requirement, named — with a route to the one thing that fixes
   * it. No bypass, and no button that would be refused.
   */
  it("replaces Publish with the verification requirement when the org is unverified", () => {
    const { container } = renderWithI18n(
      <JobDetail {...base} job={job()} role={{ ...poster, orgVerified: false }} />,
      "en",
    );
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
    expect(screen.getByText(/needs to be verified/i)).toBeTruthy();
    expect(container.querySelector('a[href="/b2b/organization"]')).toBeTruthy();
  });

  it("warns that the offer freezes on the first application, before publishing", () => {
    renderWithI18n(<JobDetail {...base} job={job()} role={poster} />, "en");
    expect(screen.getByText(/can no longer change/i)).toBeTruthy();
  });

  // ---- Close / cancel ----------------------------------------------------
  it("offers Stop recruiting and Cancel on an open job", () => {
    renderWithI18n(<JobDetail {...base} job={job({ status: "open" })} role={poster} />, "en");
    expect(screen.getByRole("button", { name: "Stop recruiting" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel job" })).toBeTruthy();
  });

  /**
   * THE TWO-STEP INVARIANT, on screen. Increment 6's review removed
   * `awarded -> cancelled`, so a Cancel button here would be an action guaranteed
   * to fail. The rule is stated instead.
   */
  it("offers no Cancel on an awarded job, and says what has to happen first", () => {
    renderWithI18n(
      <JobDetail
        {...base}
        job={job({ status: "awarded" })}
        assignment={assignment()}
        assignee="Sayed Abdel-Rahman"
        role={poster}
      />,
      "en",
    );
    expect(screen.queryByRole("button", { name: "Cancel job" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Stop recruiting" })).toBeNull();
    expect(screen.getByText(/assignment has to be ended first/i)).toBeTruthy();
  });

  it("offers no lifecycle action at all on a terminal job", () => {
    for (const status of ["completed", "closed", "cancelled"] as const) {
      const { unmount } = renderWithI18n(
        <JobDetail {...base} job={job({ status })} role={poster} />,
        "en",
      );
      expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Cancel job" })).toBeNull();
      unmount();
    }
  });

  // ---- Awarded -----------------------------------------------------------
  it("shows who holds the work, the agreed amount and the work state", () => {
    renderWithI18n(
      <JobDetail
        {...base}
        job={job({ status: "awarded" })}
        assignment={assignment({ status: "in_progress" })}
        assignee="Sayed Abdel-Rahman"
        role={poster}
      />,
      "en",
    );
    expect(screen.getByText("Sayed Abdel-Rahman")).toBeTruthy();
    expect(screen.getByText("Assigned to")).toBeTruthy();
    expect(screen.getAllByText("In progress").length).toBeGreaterThan(0);
  });

  /**
   * Increment 9 owns active work management. An awarded job here is READ ONLY —
   * no start, no progress, no completion, no review.
   */
  it("builds none of Increment 9: no progress, completion or review control", () => {
    renderWithI18n(
      <JobDetail
        {...base}
        job={job({ status: "awarded" })}
        assignment={assignment({ status: "in_progress" })}
        assignee="Sayed Abdel-Rahman"
        role={poster}
      />,
      "en",
    );
    for (const name of [/mark complete/i, /complete/i, /progress/i, /review/i, /start/i]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  // ---- Capability separation --------------------------------------------
  it("hides every lifecycle action from a caller who only holds job.manage", () => {
    renderWithI18n(
      <JobDetail {...base} job={job()} role={{ ...poster, canPost: false }} />,
      "en",
    );
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
    expect(screen.queryByText("Edit")).toBeNull();
  });

  it("still lets that caller reach the applicants queue", () => {
    const { container } = renderWithI18n(
      <JobDetail
        {...base}
        job={job({ status: "open", applicationCount: 2 })}
        role={{ ...poster, canPost: false }}
      />,
      "en",
    );
    expect(container.querySelector('a[href="/b2b/jobs/j1/applicants"]')).toBeTruthy();
  });

  it("offers no applicants link on a draft, which cannot have any", () => {
    const { container } = renderWithI18n(
      <JobDetail {...base} job={job()} role={poster} />,
      "en",
    );
    expect(container.querySelector('a[href="/b2b/jobs/j1/applicants"]')).toBeNull();
  });

  // ---- i18n --------------------------------------------------------------
  it("renders in Arabic with no raw key, enum or message path", () => {
    const { container } = renderWithI18n(
      <JobDetail
        {...base}
        job={job({ status: "awarded" })}
        assignment={assignment()}
        assignee="سيد عبد الرحمن"
        role={poster}
      />,
      "ar",
    );
    expect(container.textContent).not.toMatch(/marble_granite|scheduled|awarded/);
    expect(container.textContent).not.toMatch(/jobs\.|onboarding\./);
    expect(screen.getByText("تم الإسناد")).toBeTruthy();
  });

  /** No payment vocabulary anywhere on the poster's operational view (§5.4). */
  it("never describes the amount as paid, earned or owed", () => {
    const { container } = renderWithI18n(
      <JobDetail
        {...base}
        job={job({ status: "awarded" })}
        assignment={assignment()}
        assignee="X"
        role={poster}
      />,
      "en",
    );
    expect(container.textContent).not.toMatch(
      /\b(paid|earned|payout|escrow|wallet|invoice|balance|commission|due|owed)\b/i,
    );
  });
});
