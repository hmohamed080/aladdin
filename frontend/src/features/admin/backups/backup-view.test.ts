import { describe, expect, it } from "vitest";
import type { BackupRun, BackupSettings } from "@/server/queries/admin-backups";
import { historyFilterFrom, historyHref, isSystemReason, needsStopConfirmation, pageCount, latestRunTime, pauseHoursFor, requesterOf, runTime, runUrl, scheduleSummary } from "./backup-view";

const run = (over: Partial<BackupRun> = {}): BackupRun => ({
  id: "r1",
  kind: "backup",
  trigger: "schedule",
  status: "succeeded",
  requested_by: null,
  reason: "Scheduled run reported by GitHub.",
  github_run_id: 45722999580,
  github_run_url: null,
  github_conclusion: "success",
  summary: {},
  error_code: null,
  requested_at: "2026-11-23T18:16:36Z",
  dispatched_at: null,
  started_at: null,
  finished_at: "2026-11-24T11:02:49Z",
  reported_at: null,
  ...over,
});

const settings = (over: Partial<BackupSettings> = {}): BackupSettings => ({
  acceptance_schedule: "daily",
  production_enabled: true,
  production_restore_schedule_enabled: false,
  schedule_time: "01:30:00",
  schedule_weekday: 0,
  paused_until: null,
  version: 3,
  updated_at: null,
  updated_by: null,
  ...over,
});

const NOW = new Date("2026-11-26T09:00:00Z");

describe("runUrl", () => {
  it("builds the GitHub link when the reporter stored only the run id", () => {
    expect(runUrl(run(), "owner/repo")).toBe("https://github.com/owner/repo/actions/runs/45722999580");
  });
  it("keeps a stored link", () => {
    expect(runUrl(run({ github_run_url: "https://github.com/a/b/actions/runs/1" }), "owner/repo")).toBe(
      "https://github.com/a/b/actions/runs/1",
    );
  });
  it("has no link without a run id", () => {
    expect(runUrl(run({ github_run_id: null }), "owner/repo")).toBeNull();
  });
});

describe("run time", () => {
  it("is when the run was claimed, not when its result was verified later", () => {
    expect(runTime(run())).toBe("2026-11-23T18:16:36Z");
  });
  it("gives the summary tile the same time as the table row", () => {
    expect(latestRunTime({ id: "r1", at: "2026-11-24T11:02:49Z", github_run_id: 1 }, [run()])).toBe("2026-11-23T18:16:36Z");
  });
  it("falls back to the recorded time when the run is older than the listed history", () => {
    expect(latestRunTime({ id: "old", at: "2026-11-01T00:00:00Z", github_run_id: 1 }, [run()])).toBe("2026-11-01T00:00:00Z");
  });
});

describe("scheduleSummary", () => {
  it("says daily with the chosen Cairo time", () => {
    expect(scheduleSummary(settings(), "production", NOW)).toEqual({ state: "daily", time: "01:30", weekday: null });
  });
  it("says weekly with the day", () => {
    expect(scheduleSummary(settings({ acceptance_schedule: "weekly", schedule_weekday: 4 }), "acceptance", NOW)).toEqual({
      state: "weekly",
      time: "01:30",
      weekday: 4,
    });
  });
  it("shows an inactive Production before any frequency", () => {
    expect(scheduleSummary(settings({ production_enabled: false }), "production", NOW).state).toBe("inactive");
  });
  it("shows a running pause, and ignores an expired one", () => {
    expect(scheduleSummary(settings({ paused_until: "2026-11-27T09:00:00Z" }), "production", NOW).state).toBe("paused");
    expect(scheduleSummary(settings({ paused_until: "2026-11-25T09:00:00Z" }), "production", NOW).state).toBe("daily");
  });
  it("says off when automatic backups are off", () => {
    expect(scheduleSummary(settings({ acceptance_schedule: "off" }), "production", NOW).state).toBe("off");
  });
});

describe("pauseHoursFor", () => {
  it("keeps a running pause when the schedule is saved for another reason", () => {
    expect(pauseHoursFor("keep", "2026-11-27T08:30:00Z", NOW)).toBe(24);
  });
  it("does not invent a pause when there is none left", () => {
    expect(pauseHoursFor("keep", "2026-11-25T09:00:00Z", NOW)).toBe(0);
    expect(pauseHoursFor("keep", null, NOW)).toBe(0);
  });
  it("passes an explicit choice through, including resume", () => {
    expect(pauseHoursFor("0", "2026-11-27T09:00:00Z", NOW)).toBe(0);
    expect(pauseHoursFor("72", null, NOW)).toBe(72);
  });
  it("never exceeds the database limit of 168 hours", () => {
    expect(pauseHoursFor("keep", "2026-12-20T09:00:00Z", NOW)).toBe(168);
  });
  it("rejects anything else so the database refuses it", () => {
    expect(pauseHoursFor("soon", null, NOW)).toBe(-1);
  });
});

describe("runs nobody requested from the console", () => {
  it("translates both reasons the database writes for them, and keeps a person's own words", () => {
    expect(isSystemReason("Scheduled run reported by GitHub.")).toBe(true);
    expect(isSystemReason("Run started directly on GitHub.")).toBe(true);
    expect(isSystemReason("Backup before the release")).toBe(false);
  });
  it("says who started a run", () => {
    expect(requesterOf(run({ requested_by: "u1", trigger: "manual" }))).toBe("person");
    expect(requesterOf(run())).toBe("system");
    expect(requesterOf(run({ trigger: "manual" }))).toBe("github");
  });
});

const DEFAULT_FILTER = { page: 1, kind: null, status: null, includeSkipped: false } as const;

describe("history address", () => {
  it("starts at the first page with no filter", () => {
    expect(historyFilterFrom({})).toEqual(DEFAULT_FILTER);
  });
  it("treats a page that is not a whole positive number as page 1", () => {
    for (const page of ["0", "-2", "abc", "1.5", "", "1e3", ["2", "3"]]) {
      expect(historyFilterFrom({ page }).page, String(page)).toBe(1);
    }
    expect(historyFilterFrom({ page: "12" }).page).toBe(12);
  });
  it("never sends the database a page it cannot read", () => {
    expect(historyFilterFrom({ page: "99999999999" }).page).toBe(1);
  });
  it("ignores filters it does not know", () => {
    expect(historyFilterFrom({ kind: "x", status: "done" })).toEqual(DEFAULT_FILTER);
    expect(historyFilterFrom({ kind: "restore_test", status: "failed", skipped: "1" })).toEqual({
      page: 1, kind: "restore_test", status: "failed", includeSkipped: true,
    });
  });
  it("keeps the address short and reads back what it wrote", () => {
    expect(historyHref({ ...DEFAULT_FILTER })).toBe("/admin/backups");
    const filter = { page: 3, kind: "backup", status: "failed", includeSkipped: true } as const;
    const query = new URLSearchParams(historyHref(filter).split("?")[1]);
    expect(historyFilterFrom(Object.fromEntries(query))).toEqual(filter);
  });
  it("counts pages, at least one", () => {
    expect([pageCount(0, 20), pageCount(20, 20), pageCount(21, 20)]).toEqual([1, 1, 2]);
  });
});

describe("needsStopConfirmation", () => {
  const next = (over: Partial<Parameters<typeof needsStopConfirmation>[1]> = {}) => ({ schedule: "daily" as const, pauseChoice: "0", restore: false, ...over });
  it("asks when something is switched off or paused", () => {
    expect(needsStopConfirmation(settings(), next({ schedule: "off" }))).toBe(true);
    expect(needsStopConfirmation(settings(), next({ pauseChoice: "24" }))).toBe(true);
    expect(needsStopConfirmation(settings({ production_restore_schedule_enabled: true }), next({ restore: false }))).toBe(true);
  });
  it("does not ask for other changes", () => {
    expect(needsStopConfirmation(settings({ acceptance_schedule: "off" }), next({ schedule: "off" }))).toBe(false);
    expect(needsStopConfirmation(settings(), next({ pauseChoice: "keep" }))).toBe(false);
    expect(needsStopConfirmation(settings(), next())).toBe(false);
    expect(needsStopConfirmation(settings(), next({ schedule: "weekly" as never }))).toBe(false);
    expect(needsStopConfirmation(settings(), next({ restore: true }))).toBe(false);
  });
});
