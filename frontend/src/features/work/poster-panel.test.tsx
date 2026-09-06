import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/server/actions/assignment-forms", () => ({
  startWorkAction: async () => ({ ok: true }),
  addProgressAction: async () => ({ ok: true }),
  cancelAssignmentAction: async () => ({ ok: true }),
  completeAssignmentAction: async () => ({ ok: true }),
}));

import { PosterAssignmentPanel } from "./poster-panel";
import type { JobAssignmentRow } from "@/server/queries/jobs";
import type { ProgressUpdateRow } from "@/server/queries/job-assignments";

const assignment = (over: Partial<JobAssignmentRow> = {}): JobAssignmentRow =>
  ({
    id: "a1",
    job_id: "j1",
    application_id: "ap1",
    installer_user_id: "u1",
    poster_org_id: "o1",
    status: "in_progress",
    agreed_amount: 18000,
    agreed_currency: "EGP",
    latest_progress_percent: 60,
    last_progress_at: "2026-09-05T09:00:00Z",
    version: 2,
    started_at: "2026-09-04T08:00:00Z",
    completed_at: null,
    cancelled_at: null,
    cancellation_reason: null,
    created_at: "2026-09-03T00:00:00Z",
    updated_at: "2026-09-05T09:00:00Z",
    ...over,
  }) as JobAssignmentRow;

const update = (over: Partial<ProgressUpdateRow> = {}): ProgressUpdateRow => ({
  id: "u1",
  progress_percent: 60,
  stage: "Second course",
  note: "First floor landing done.",
  created_at: "2026-09-05T09:00:00Z",
  ...over,
});

const base = {
  assignee: "Sayed Abdelrahman",
  updates: [] as ProgressUpdateRow[],
  locale: "en" as const,
};

describe("PosterAssignmentPanel", () => {
  // ---- §15, what the organization can see --------------------------------
  it("names the assigned professional, the state, and the agreed amount", () => {
    renderWithI18n(
      <PosterAssignmentPanel {...base} assignment={assignment()} canManage />,
      "en",
    );
    expect(screen.getByText("Sayed Abdelrahman")).toBeTruthy();
    expect(screen.getByText("In progress")).toBeTruthy();
    expect(screen.getByText("EGP 18,000.00")).toBeTruthy();
  });

  it("shows the reported progress and the history behind it", () => {
    renderWithI18n(
      <PosterAssignmentPanel
        {...base}
        assignment={assignment()}
        updates={[update()]}
        canManage
      />,
      "en",
    );
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("60");
    expect(screen.getByText("Second course")).toBeTruthy();
    expect(screen.getByText("First floor landing done.")).toBeTruthy();
  });

  /**
   * §16, the mirror of the installer-side assertion. Reporting is the
   * professional's alone — `job_progress_add` refuses anyone else — so this side
   * reads the history and has no way to add to it.
   */
  it("offers the organization NO way to report progress on the professional's behalf", () => {
    renderWithI18n(
      <PosterAssignmentPanel
        {...base}
        assignment={assignment()}
        updates={[update()]}
        canManage
      />,
      "en",
    );
    for (const name of [/update progress/i, /report progress/i, /start work/i]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
  });

  it("says plainly that the work has not started yet, rather than showing an empty meter", () => {
    renderWithI18n(
      <PosterAssignmentPanel
        {...base}
        assignment={assignment({ status: "scheduled", latest_progress_percent: 0, started_at: null })}
        canManage
      />,
      "en",
    );
    expect(screen.getByText(/has not started this work yet/i)).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  // ---- §14 / §15, the readiness handoff -----------------------------------
  it("at 100 says the work was REPORTED finished and offers the confirmation", () => {
    renderWithI18n(
      <PosterAssignmentPanel
        {...base}
        assignment={assignment({ latest_progress_percent: 100 })}
        canManage
      />,
      "en",
    );
    // Twice: the badge beside the status, and the heading of the notice below.
    expect(screen.getAllByText("Reported as finished").length).toBe(2);
    expect(screen.getByText(/waiting for your confirmation/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirm completion" })).toBeTruthy();
    // Still in progress: the claim did not move the state.
    expect(screen.getByText("In progress")).toBeTruthy();
  });

  /**
   * Completion is reachable from `in_progress` only — the RPC refuses a
   * scheduled assignment, so the control is not offered on one.
   */
  it("offers completion only where the RPC would accept it", () => {
    const scheduled = renderWithI18n(
      <PosterAssignmentPanel
        {...base}
        assignment={assignment({ status: "scheduled", latest_progress_percent: 0 })}
        canManage
      />,
      "en",
    );
    expect(screen.queryByRole("button", { name: "Confirm completion" })).toBeNull();
    // ...but the engagement can still be ended from `scheduled`.
    expect(screen.getByRole("button", { name: "End assignment" })).toBeTruthy();
    scheduled.unmount();

    for (const status of ["completed", "cancelled"] as const) {
      const { unmount } = renderWithI18n(
        <PosterAssignmentPanel
          {...base}
          assignment={assignment({ status, cancellation_reason: "x" })}
          canManage
        />,
        "en",
      );
      expect(screen.queryByRole("button", { name: "Confirm completion" })).toBeNull();
      expect(screen.queryByRole("button", { name: "End assignment" })).toBeNull();
      unmount();
    }
  });

  /**
   * A colleague WITHOUT job.manage reads the queue and decides nothing — the
   * same line `job_applicants` draws for the applicants list.
   */
  it("gives a colleague without job.manage a read-only panel", () => {
    renderWithI18n(
      <PosterAssignmentPanel
        {...base}
        assignment={assignment({ latest_progress_percent: 100 })}
        updates={[update()]}
        canManage={false}
      />,
      "en",
    );
    expect(screen.getByText("Sayed Abdelrahman")).toBeTruthy();
    expect(screen.getByText("Second course")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Confirm completion" })).toBeNull();
    expect(screen.queryByRole("button", { name: "End assignment" })).toBeNull();
  });

  // ---- §17, the organization's wording ------------------------------------
  it("ends the engagement in the organization's own words, with a required reason", () => {
    const { container } = renderWithI18n(
      <PosterAssignmentPanel {...base} assignment={assignment()} canManage />,
      "en",
    );
    fireEvent.click(screen.getByRole("button", { name: "End assignment" }));
    expect(screen.getByText(/returns to open so you can award it again/i)).toBeTruthy();
    expect(screen.getByText(/already declined stay declined/i)).toBeTruthy();
    expect(container.querySelector('input[name="reason"]')?.hasAttribute("required")).toBe(true);
  });

  it("keeps the cancellation reason on the record afterwards", () => {
    renderWithI18n(
      <PosterAssignmentPanel
        {...base}
        assignment={assignment({
          status: "cancelled",
          cancelled_at: "2026-09-06T00:00:00Z",
          cancellation_reason: "The client postponed the handover.",
        })}
        canManage
      />,
      "en",
    );
    expect(screen.getByText("The client postponed the handover.")).toBeTruthy();
  });

  it("falls back to the identity summary when there is no assignment row", () => {
    renderWithI18n(
      <PosterAssignmentPanel {...base} assignment={null} canManage />,
      "en",
    );
    expect(screen.getByText("Sayed Abdelrahman")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Confirm completion" })).toBeNull();
  });

  it("renders in Arabic with no raw enum, key or message path", () => {
    const { container } = renderWithI18n(
      <PosterAssignmentPanel
        {...base}
        assignment={assignment({ latest_progress_percent: 100 })}
        updates={[update()]}
        canManage
      />,
      "ar",
    );
    expect(container.textContent).not.toMatch(/in_progress|scheduled|cancelled|completed/);
    expect(container.textContent).not.toMatch(/work\.|jobs\./);
  });
});
