import { describe, expect, it } from "vitest";
import type { BackupRun, BackupSettings } from "@/server/queries/admin-backups";
import { latestRunTime, pauseHoursFor, runTime, runUrl, scheduleSummary, splitSkipped } from "./backup-view";

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

describe("splitSkipped", () => {
  it("separates the checks that found nothing to do", () => {
    const rows = [run({ id: "a", status: "skipped" }), run({ id: "b" }), run({ id: "c", status: "failed" })];
    const { shown, skippedCount } = splitSkipped(rows, false);
    expect(shown.map((r) => r.id)).toEqual(["b", "c"]);
    expect(skippedCount).toBe(1);
  });
  it("shows everything on request", () => {
    expect(splitSkipped([run({ status: "skipped" })], true).shown).toHaveLength(1);
  });
});
