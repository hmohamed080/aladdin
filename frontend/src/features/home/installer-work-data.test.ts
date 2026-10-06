import { describe, expect, it } from "vitest";
import { createTranslator } from "@/lib/i18n/translate";
import { countAssignmentsByStatus } from "@/lib/work/assignment-state";
import type { MyAssignmentRow } from "@/server/queries/job-assignments";
import {
  ALL_TAB,
  deliveryHint,
  initialsOf,
  rowAction,
  tabFromState,
  toActiveWorkVM,
  toWorkRowVM,
  toWorkRowVMs,
  toWorkTabs,
} from "./installer-work-data";

const t = createTranslator("en");
const NOW = new Date("2026-10-05T12:00:00Z");

function row(over: Partial<MyAssignmentRow> = {}): MyAssignmentRow {
  return {
    id: "a-1",
    job_id: "j-1",
    application_id: "app-1",
    job_title: "Interior painting",
    job_description: null,
    job_status: "awarded" as never,
    trade_key: "painting",
    poster_org_name: "Al Alwan Showroom",
    governorate: "Cairo",
    city: "Madinaty",
    site_address: "12 Street 90",
    agreed_amount: 3200,
    agreed_currency: "EGP",
    expected_duration_days: 4,
    starts_on: "2026-10-01",
    ends_by: "2026-10-10",
    status: "in_progress",
    latest_progress_percent: 60,
    last_progress_at: "2026-10-05T09:00:00Z",
    created_at: "2026-09-28T09:00:00Z",
    started_at: "2026-10-01T09:00:00Z",
    completed_at: null,
    cancelled_at: null,
    cancellation_reason: null,
    published_at: "2026-09-20T09:00:00Z",
    trade_is_active: true,
    version: 3,
    ...over,
  };
}

describe("toWorkRowVM — the four real statuses only", () => {
  it.each([
    ["scheduled", "info"],
    ["in_progress", "success"],
    ["completed", "neutral"],
    ["cancelled", "danger"],
  ] as const)("%s maps to its real label and a %s tone", (status, tone) => {
    const vm = toWorkRowVM(row({ status }), t, "en", NOW)!;
    expect(vm.status).toBe(status);
    expect(vm.statusTone).toBe(tone);
    expect(vm.statusLabel).toBe(t(`jobs.assignmentStatus.${status}` as never));
    expect(vm.statusLabel).not.toBe("");
  });

  it("carries the real facts and never a fixture's", () => {
    const vm = toWorkRowVM(row(), t, "en", NOW)!;
    expect(vm).toMatchObject({
      id: "a-1",
      title: "Interior painting",
      company: "Al Alwan Showroom",
      companyInitials: "AA",
      location: "Madinaty، Cairo",
      value: 3200,
      startsOn: "2026-10-01",
      endsBy: "2026-10-10",
    });
  });

  it("never supplies contact details or a client rating", () => {
    const vm = toWorkRowVM(row(), t, "en", NOW)!;
    expect(vm.contact).toBeNull();
    expect(vm.rating).toBeNull();
    expect(vm.image).toBeNull();
  });

  it("keeps a missing amount and a missing end date honest", () => {
    const vm = toWorkRowVM(row({ agreed_amount: null, ends_by: null, starts_on: null }), t, "en", NOW)!;
    expect(vm.value).toBeNull();
    expect(vm.deliveryDateLabel).toBeNull();
    expect(vm.deliveryHint).toBeNull();
  });

  it("preserves a fractional amount", () => {
    expect(toWorkRowVM(row({ agreed_amount: 4500.5 }), t, "en", NOW)!.value).toBe(4500.5);
  });

  it("skips a row missing its id or title", () => {
    expect(toWorkRowVMs([row({ id: null }), row({ job_title: null }), row({ id: "ok" })], t, "en", NOW).map((r) => r.id)).toEqual(["ok"]);
  });
});

describe("row actions are offered only where the server would authorise them", () => {
  it("scheduled: start work, via the real detail page", () => {
    expect(rowAction(row({ status: "scheduled" }), "en")).toEqual({ label: "Start work", href: "/home/work/a-1" });
  });
  it("in progress: update progress, via the real detail page", () => {
    expect(rowAction(row({ status: "in_progress" }), "en")).toEqual({ label: "Update progress", href: "/home/work/a-1" });
  });
  it("completed and cancelled: view only", () => {
    expect(rowAction(row({ status: "completed" }), "en").label).toBe("View");
    expect(rowAction(row({ status: "cancelled" }), "en").label).toBe("View");
  });
  it("every action is a link — there is no local progress logic", () => {
    for (const status of ["scheduled", "in_progress", "completed", "cancelled"] as const) {
      expect(rowAction(row({ status }), "en").href).toBe("/home/work/a-1");
    }
  });
});

describe("tabs", () => {
  const counts = countAssignmentsByStatus([
    row({ status: "scheduled" }), row({ status: "in_progress" }), row({ status: "in_progress" }), row({ status: "completed" }),
  ]);
  const tabs = toWorkTabs(counts, t);

  it("is all + current + the four real statuses — no paused, review or archived", () => {
    expect(tabs.map((x) => x.key)).toEqual([ALL_TAB, "current", "scheduled", "in_progress", "completed", "cancelled"]);
    expect(tabs.map((x) => x.key)).not.toContain("paused");
    expect(tabs.map((x) => x.key)).not.toContain("review");
    expect(tabs.map((x) => x.key)).not.toContain("archived");
    expect(tabs.map((x) => x.key)).not.toContain("accepted");
  });

  it("counts come from the same rows, and current is scheduled + in progress", () => {
    const by = Object.fromEntries(tabs.map((x) => [x.key, x.count]));
    expect(by).toEqual({ all: 4, current: 3, scheduled: 1, in_progress: 2, completed: 1, cancelled: 0 });
  });

  it("uses the real status labels, not a second vocabulary", () => {
    expect(tabs.find((x) => x.key === "scheduled")!.label).toBe(t("jobs.assignmentStatus.scheduled" as never));
  });

  it("'current' is a presentation composite over two real statuses", () => {
    expect(tabs.find((x) => x.key === "current")!.statuses).toEqual(["scheduled", "in_progress"]);
    expect(tabs.find((x) => x.key === ALL_TAB)!.statuses).toBeNull();
  });

  it("?state= resolves to a real tab, or all", () => {
    expect(tabFromState(undefined)).toBe("all");
    expect(tabFromState("current")).toBe("current");
    expect(tabFromState("completed")).toBe("completed");
    expect(tabFromState("paused")).toBe("all");
    expect(tabFromState("archived")).toBe("all");
  });
});

describe("deliveryHint", () => {
  it("counts whole days for work still ahead", () => {
    expect(deliveryHint("in_progress", "2026-10-10", "en", NOW)).toBe("5 days left");
    expect(deliveryHint("scheduled", "2026-10-06", "en", NOW)).toBe("1 day left");
    expect(deliveryHint("in_progress", "2026-10-05", "en", NOW)).toBe("Due today");
    expect(deliveryHint("in_progress", "2026-10-03", "en", NOW)).toBe("2 days overdue");
  });
  it("says nothing for finished work or when no end date is stated", () => {
    expect(deliveryHint("completed", "2026-10-10", "en", NOW)).toBeNull();
    expect(deliveryHint("cancelled", "2026-10-10", "en", NOW)).toBeNull();
    expect(deliveryHint("in_progress", null, "en", NOW)).toBeNull();
  });
});

describe("toActiveWorkVM", () => {
  it("shows the current stage only from the latest real progress update", () => {
    expect(toActiveWorkVM(row(), "Floor installation", t, "en", NOW)!.currentStage).toBe("Floor installation");
    expect(toActiveWorkVM(row(), null, t, "en", NOW)!.currentStage).toBeNull();
  });

  it("never shows a next stage — no stage plan exists", () => {
    expect(toActiveWorkVM(row(), "Floor installation", t, "en", NOW)!.nextStage).toBeNull();
  });

  it("a scheduled assignment has no progress, no stage, and offers Start work", () => {
    const vm = toActiveWorkVM(row({ status: "scheduled", latest_progress_percent: null }), "stale", t, "en", NOW)!;
    expect(vm.progress).toBeNull();
    expect(vm.currentStage).toBeNull();
    expect(vm.updateAction).toEqual({ label: "Start work", href: "/home/work/a-1" });
    expect(vm.badgeLabel).toBe(t("jobs.assignmentStatus.scheduled" as never));
  });

  it("an in-progress assignment reports the real percentage and offers Update progress", () => {
    const vm = toActiveWorkVM(row(), null, t, "en", NOW)!;
    expect(vm.progress).toBe(60);
    expect(vm.updateAction).toEqual({ label: "Update progress", href: "/home/work/a-1" });
    expect(vm.badgeLabel).toBe("Live now");
  });

  it("offers no update action for a finished assignment", () => {
    expect(toActiveWorkVM(row({ status: "completed" }), null, t, "en", NOW)!.updateAction).toBeNull();
  });

  it("states unknown facts as not specified", () => {
    const vm = toActiveWorkVM(row({ agreed_amount: null, expected_duration_days: null, ends_by: null }), null, t, "en", NOW)!;
    expect(vm.details.map((d) => d.value)).toEqual(["Not specified", "Not specified", "Not specified"]);
  });

  it("formats an exact amount", () => {
    expect(toActiveWorkVM(row({ agreed_amount: 4500.5 }), null, t, "en", NOW)!.details[0]!.value).toBe("4,500.50 EGP");
  });
});

describe("initialsOf", () => {
  it("takes the first letters of the first two words", () => {
    expect(initialsOf("Al Alwan Showroom")).toBe("AA");
    expect(initialsOf("Marble")).toBe("M");
    expect(initialsOf(null)).toBe("");
    expect(initialsOf("  ")).toBe("");
  });
});
