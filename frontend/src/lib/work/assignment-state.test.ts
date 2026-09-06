import { describe, expect, it } from "vitest";
import {
  ASSIGNMENT_STATUSES,
  CURRENT_STATUSES,
  countAssignmentsByStatus,
  currentAssignments,
  featuredAssignment,
  readyForCompletion,
  canStart,
  canReportProgress,
  canCancel,
  type AssignmentState,
} from "./assignment-state";

/**
 * The work state model.
 *
 * Everything here decides what to OFFER and what to COUNT — never what is
 * allowed. Each predicate mirrors a guard the RPC enforces, and the point of
 * testing them is that a mirror which drifts shows the reader a control the
 * database will refuse. The authority itself is asserted in pgTAP
 * (`46_job_assignment_work_test.sql`), where it lives.
 *
 * The module is PURE and lives outside `server/queries` for a reason the
 * `server-only` guard found on its own: every consumer of these functions is a
 * client component.
 */

type Row = AssignmentState & { id: string };

const row = (over: Partial<Row> = {}): Row =>
  ({
    id: "a1",
    job_id: "j1",
    application_id: "ap1",
    status: "scheduled",
    agreed_amount: 18000,
    agreed_currency: "EGP",
    latest_progress_percent: 0,
    last_progress_at: null,
    version: 1,
    started_at: null,
    completed_at: null,
    cancelled_at: null,
    cancellation_reason: null,
    created_at: "2026-09-03T00:00:00Z",
    job_title: "Marble staircase cladding",
    job_description: "Ground to first floor.",
    job_status: "awarded",
    trade_key: "marble_granite",
    trade_is_active: true,
    governorate: "Cairo",
    city: "New Cairo",
    site_address: "12 Street 90",
    expected_duration_days: 14,
    starts_on: null,
    ends_by: null,
    published_at: "2026-09-01T00:00:00Z",
    poster_org_name: "Horizon Contracting",
    ...over,
  }) as Row;

describe("the assignment status model", () => {
  /**
   * §5. The reference's tabs include "pending review", "on hold" and "archive".
   * None is a `job_assignment_status`, and inventing one here is how a fifth
   * state arrives without a migration.
   */
  it("knows exactly the four states the database has", () => {
    expect([...ASSIGNMENT_STATUSES]).toEqual([
      "scheduled",
      "in_progress",
      "completed",
      "cancelled",
    ]);
  });

  it("treats 'current' as a composite of two real states, not a fifth one", () => {
    expect([...CURRENT_STATUSES]).toEqual(["scheduled", "in_progress"]);
    expect(ASSIGNMENT_STATUSES).not.toContain("current");
  });
});

describe("counts", () => {
  it("counts the caller's own rows and invents nothing", () => {
    const counts = countAssignmentsByStatus([
      row({ status: "scheduled" }),
      row({ status: "in_progress" }),
      row({ status: "in_progress" }),
      row({ status: "completed" }),
    ]);
    expect(counts).toEqual({ scheduled: 1, in_progress: 2, completed: 1, cancelled: 0 });
  });

  /** §6. An honest zero, never a hidden tab or a placeholder figure. */
  it("reports zero for a state with nothing in it", () => {
    expect(countAssignmentsByStatus([])).toEqual({
      scheduled: 0,
      in_progress: 0,
      completed: 0,
      cancelled: 0,
    });
  });
});

describe("the featured assignment", () => {
  it("leads with work under way over work merely booked", () => {
    const scheduled = row({ id: "s", status: "scheduled" });
    const running = row({ id: "r", status: "in_progress" });
    expect(featuredAssignment([scheduled, running])?.id).toBe("r");
  });

  it("falls back to a scheduled assignment when nothing is under way", () => {
    expect(featuredAssignment([row({ id: "s", status: "scheduled" })])?.id).toBe("s");
  });

  /** History is history: a completed record must never be featured as current. */
  it("features nothing when every assignment is finished or cancelled", () => {
    expect(
      featuredAssignment([row({ status: "completed" }), row({ status: "cancelled" })]),
    ).toBeNull();
    expect(featuredAssignment([])).toBeNull();
  });

  it("counts scheduled and in-progress work as current, and nothing else", () => {
    const rows = [
      row({ id: "1", status: "scheduled" }),
      row({ id: "2", status: "in_progress" }),
      row({ id: "3", status: "completed" }),
      row({ id: "4", status: "cancelled" }),
    ];
    expect(currentAssignments(rows).map((r) => r.id)).toEqual(["1", "2"]);
  });
});

/**
 * §14, at the layer that decides what the page says.
 *
 * `readyForCompletion` is a DERIVED presentation state. There is no fifth status
 * and no `waiting_review` column; if this function ever starts reading one, the
 * installer's claim has been turned into a state they had authority to set.
 */
describe("100 percent is not completion", () => {
  it("is ready only while in progress AND at 100", () => {
    expect(readyForCompletion(row({ status: "in_progress", latest_progress_percent: 100 })))
      .toBe(true);
    expect(readyForCompletion(row({ status: "in_progress", latest_progress_percent: 99 })))
      .toBe(false);
    expect(readyForCompletion(row({ status: "scheduled", latest_progress_percent: 100 })))
      .toBe(false);
  });

  /** Completed is completed — it must not also read as "waiting". */
  it("is not ready once the organization has confirmed", () => {
    expect(readyForCompletion(row({ status: "completed", latest_progress_percent: 100 })))
      .toBe(false);
  });
});

describe("what each state permits, mirroring the RPCs", () => {
  it("allows starting only from scheduled", () => {
    expect(canStart(row({ status: "scheduled" }))).toBe(true);
    for (const status of ["in_progress", "completed", "cancelled"] as const) {
      expect(canStart(row({ status }))).toBe(false);
    }
  });

  it("allows progress only while the work is under way", () => {
    expect(canReportProgress(row({ status: "in_progress" }))).toBe(true);
    for (const status of ["scheduled", "completed", "cancelled"] as const) {
      expect(canReportProgress(row({ status }))).toBe(false);
    }
  });

  /** §17: `job_assignment_cancel` admits either party, from either live state. */
  it("allows cancellation from either live state and neither terminal one", () => {
    expect(canCancel(row({ status: "scheduled" }))).toBe(true);
    expect(canCancel(row({ status: "in_progress" }))).toBe(true);
    expect(canCancel(row({ status: "completed" }))).toBe(false);
    expect(canCancel(row({ status: "cancelled" }))).toBe(false);
  });

  /**
   * §16, as a structural claim about this module: there is no predicate here
   * that could gate an installer-side completion control, because there is no
   * such control and no action to bind it to.
   */
  it("exports no completion predicate for the installer's side", async () => {
    const mod = await import("./assignment-state");
    expect(Object.keys(mod).filter((k) => /complete/i.test(k))).toEqual([]);
  });
});
