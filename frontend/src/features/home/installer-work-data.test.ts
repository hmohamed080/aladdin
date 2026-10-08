import { describe, expect, it } from "vitest";
import { createTranslator } from "@/lib/i18n/translate";
import { countAssignmentsByStatus } from "@/lib/work/assignment-state";
import type { MyAssignmentRow } from "@/server/queries/job-assignments";
import {
  ALL_TAB,
  deliveryHint,
  initialsOf,
  rowAction,
  rowMoreActions,
  contactsOf,
  filtersToState,
  stateToFilters,
  tabFromState,
  toActiveWorkVM,
  toWorkRowVM,
  toWorkRowVMs,
  toWorkTabs,
  workResultsTitle,
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

  it("never supplies contact details (the read model holds none) and never a rating without a real review", () => {
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

describe("overflow menu — every action that genuinely applies, and no other", () => {
  const menu = (over: Partial<MyAssignmentRow>, review: { rating: number } | null = null) =>
    rowMoreActions(row(over), "en", review).map((a) => a.label);

  it("in progress: View details, and Update progress because canReportProgress", () => {
    expect(menu({ status: "in_progress" })).toEqual(["View details", "Update progress"]);
  });
  it("completed: View details, and View rating only when a REAL review exists", () => {
    expect(menu({ status: "completed" })).toEqual(["View details"]);
    expect(menu({ status: "completed" }, { rating: 4 })).toEqual(["View details", "View rating"]);
  });
  it("scheduled: View details and Start work (canStart)", () => {
    expect(menu({ status: "scheduled" })).toEqual(["View details", "Start work"]);
  });
  it("cancelled: View details only, even if a review were passed", () => {
    expect(menu({ status: "cancelled" })).toEqual(["View details"]);
    expect(menu({ status: "cancelled" }, { rating: 5 })).toEqual(["View details"]);
  });
  it("a rating is never offered for work that is not completed", () => {
    expect(menu({ status: "in_progress" }, { rating: 5 })).not.toContain("View rating");
  });
  it("every entry is a link to the assignment's own page", () => {
    expect(rowMoreActions(row({ status: "completed" }), "en", { rating: 5 }).map((a) => a.href)).toEqual(["/home/work/a-1", "/home/work/a-1"]);
  });
  it("carries the real rating onto the row, and null without a review", () => {
    expect(toWorkRowVMs([row({ status: "completed" })], t, "en", NOW, new Map([["a-1", { rating: 4 }]]))[0]!.rating).toBe(4);
    expect(toWorkRowVMs([row({ status: "completed" })], t, "en", NOW)[0]!.rating).toBeNull();
  });
});

describe("assignment contact — real or absent", () => {
  const contact = { org_name: "Al Alwan Showroom", contact_name: "Mostafa Bakr", phone: "+201000000001", email: "m@example.test" };
  const vm = (c: Parameters<typeof toWorkRowVMs>[5] extends ReadonlyMap<string, infer V> | undefined ? V | null : never) =>
    toWorkRowVMs([row({ id: "a-1" })], t, "en", NOW, new Map(), c ? new Map([["a-1", c]]) : new Map())[0]!;

  it("shows the released contact exactly", () => {
    expect(vm(contact).contact).toEqual({ name: "Mostafa Bakr", phone: "+201000000001", fullPhone: "+201000000001", email: "m@example.test" });
  });
  it("is null when the database released none — never a placeholder", () => {
    expect(vm(null).contact).toBeNull();
  });
  it("is null when the row carries neither a phone nor an e-mail", () => {
    expect(vm({ ...contact, phone: null, email: null }).contact).toBeNull();
  });
  it("an e-mail alone is a real contact; so is a phone alone", () => {
    expect(vm({ ...contact, phone: null }).contact).toMatchObject({ phone: null, email: "m@example.test" });
    expect(vm({ ...contact, email: null }).contact).toMatchObject({ phone: "+201000000001", email: null });
  });
});

describe("tabs", () => {
  const counts = countAssignmentsByStatus([
    row({ status: "scheduled" }), row({ status: "in_progress" }), row({ status: "in_progress" }), row({ status: "completed" }),
  ]);
  const tabs = toWorkTabs(counts, t);

  it("offers all + in progress + completed in the filter, and keeps current / scheduled / cancelled reachable but out of it", () => {
    expect(tabs.map((x) => x.key)).toEqual([ALL_TAB, "in_progress", "completed", "current", "scheduled", "cancelled"]);
    expect(tabs.filter((x) => x.inFilter !== false).map((x) => x.key)).toEqual([ALL_TAB, "in_progress", "completed"]);
    for (const k of ["paused", "review", "archived", "accepted"]) expect(tabs.map((x) => x.key)).not.toContain(k);
  });

  it("'All' is exactly the in-progress + completed work — scheduled and cancelled are not in it", () => {
    expect(tabs.find((x) => x.key === ALL_TAB)!.statuses).toEqual(["in_progress", "completed"]);
    expect(tabs.find((x) => x.key === ALL_TAB)!.count).toBe(3);
  });

  it("counts come from the same rows, and current is scheduled + in progress", () => {
    const by = Object.fromEntries(tabs.map((x) => [x.key, x.count]));
    expect(by).toEqual({ all: 3, in_progress: 2, completed: 1, current: 3, scheduled: 1, cancelled: 0 });
  });

  it("uses the real status labels, not a second vocabulary", () => {
    expect(tabs.find((x) => x.key === "scheduled")!.label).toBe(t("jobs.assignmentStatus.scheduled" as never));
  });

  it("'current' is a presentation composite over two real statuses", () => {
    expect(tabs.find((x) => x.key === "current")!.statuses).toEqual(["scheduled", "in_progress"]);
  });

  it("?state= resolves to a real tab, or all", () => {
    expect(tabFromState(undefined)).toBe("all");
    expect(tabFromState("current")).toBe("current");
    expect(tabFromState("completed")).toBe("completed");
    expect(tabFromState("paused")).toBe("all");
    expect(tabFromState("archived")).toBe("all");
  });

  it("an out-of-list view is titled as such; the default views keep 'All your work'", () => {
    expect(workResultsTitle(ALL_TAB, tabs, "en")).toBeUndefined();
    expect(workResultsTitle("completed", tabs, "en")).toBeUndefined();
    expect(workResultsTitle("scheduled", tabs, "en")).toBe(`Your work — ${t("jobs.assignmentStatus.scheduled" as never)}`);
  });
});

describe("saved-search state <-> stored filters", () => {
  it("round-trips, storing only non-blank values", () => {
    const state = { tab: "completed", q: "villa", company: "", from: "2026-10-01", to: "", contact: "available", sort: "last-action" };
    const stored = stateToFilters(state);
    expect(stored).toEqual({ tab: "completed", q: "villa", from: "2026-10-01", contact: "available", sort: "last-action" });
    expect(filtersToState(stored)).toEqual(state);
  });
  it("fills every missing key with its default", () => {
    expect(filtersToState({})).toEqual({ tab: "all", q: "", company: "", from: "", to: "", contact: "all", sort: "default" });
  });
  it("never trusts a stored value this page no longer offers", () => {
    expect(filtersToState({ tab: "archived", contact: "phone-only", sort: "last-added", from: "soon" })).toEqual({ tab: "all", q: "", company: "", from: "", to: "", contact: "all", sort: "default" });
  });
});

describe("contactsOf — the contact the database released with a page of rows", () => {
  const page = (over: Record<string, unknown>) =>
    ({ id: "a-1", poster_org_name: "Horizon", contact_name: null, contact_phone: null, contact_email: null, ...over }) as never;

  it("keys each released contact by its assignment", () => {
    const map = contactsOf([page({ contact_name: "Mostafa", contact_phone: "+201000000001" }), page({ id: "a-2", contact_email: "m@example.test" })]);
    expect(map.get("a-1")).toEqual({ org_name: "Horizon", contact_name: "Mostafa", phone: "+201000000001", email: null });
    expect(map.get("a-2")).toMatchObject({ phone: null, email: "m@example.test" });
  });
  it("has no entry for a row with no contact — nothing is invented", () => {
    expect(contactsOf([page({})]).size).toBe(0);
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
