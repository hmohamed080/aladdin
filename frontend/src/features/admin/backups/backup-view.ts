import type { BackupEnvironment, BackupOutcome, BackupRun, BackupSettings } from "@/server/queries/admin-backups";

/** Display rules of `/admin/backups`. Pure: the database and the private runner stay authoritative. */

/** What `backup_report_run` writes as the reason of a run nobody requested from the console. */
const SYSTEM_REPORT_REASONS = ["Scheduled run reported by GitHub.", "Run started directly on GitHub."];

export function isSystemReason(reason: string): boolean {
  return SYSTEM_REPORT_REASONS.includes(reason);
}

/** A console request names its person; otherwise the schedule or someone on GitHub started the run. */
export function requesterOf(run: Pick<BackupRun, "requested_by" | "trigger">): "person" | "system" | "github" {
  if (run.requested_by) return "person";
  return run.trigger === "schedule" ? "system" : "github";
}

const HOUR = 3_600_000;
const MAX_PAUSE_HOURS = 168;

/** The background reporter stores the run id only, so the link is derived from the configured repository. */
export function runUrl(run: Pick<BackupRun, "github_run_url" | "github_run_id">, repo: string): string | null {
  if (!run.github_run_id) return null;
  return run.github_run_url ?? `https://github.com/${repo}/actions/runs/${run.github_run_id}`;
}

/** `finished_at` is when the result was VERIFIED, which can be a day later. The claim time is when it ran. */
export function runTime(run: Pick<BackupRun, "requested_at">): string {
  return run.requested_at;
}

/** The summary tiles show the same time as the matching history row. */
export function latestRunTime(outcome: NonNullable<BackupOutcome>, runs: BackupRun[]): string {
  const run = runs.find((r) => r.id === outcome.id);
  return run ? runTime(run) : outcome.at;
}

export type ScheduleSummary = {
  state: "inactive" | "off" | "paused" | "daily" | "weekly";
  time: string;
  weekday: number | null;
};

export function scheduleSummary(settings: BackupSettings, environment: BackupEnvironment, now = new Date()): ScheduleSummary {
  const time = settings.schedule_time.slice(0, 5);
  const weekday = settings.acceptance_schedule === "weekly" ? settings.schedule_weekday : null;
  const of = (state: ScheduleSummary["state"]): ScheduleSummary => ({ state, time, weekday });
  if (environment === "production" && !settings.production_enabled) return of("inactive");
  if (settings.acceptance_schedule === "off") return of("off");
  if (isPaused(settings.paused_until, now)) return of("paused");
  return of(settings.acceptance_schedule);
}

export function isPaused(pausedUntil: string | null, now = new Date()): boolean {
  return pausedUntil !== null && Date.parse(pausedUntil) > now.getTime();
}

/**
 * The database sets the pause from a number of hours and CLEARS it for 0, so "keep" must send what is
 * left (rounded up, at most one hour long). An unknown choice returns -1, which the database refuses.
 */
export function pauseHoursFor(choice: string, pausedUntil: string | null, now = new Date()): number {
  if (choice === "keep") {
    if (!isPaused(pausedUntil, now)) return 0;
    return Math.min(MAX_PAUSE_HOURS, Math.ceil((Date.parse(pausedUntil!) - now.getTime()) / HOUR));
  }
  return /^\d{1,3}$/.test(choice) ? Number(choice) : -1;
}

/** A skipped run is a later check that found the day's backup already complete. */
export function splitSkipped(runs: BackupRun[], includeSkipped: boolean): { shown: BackupRun[]; skippedCount: number } {
  const skippedCount = runs.filter((r) => r.status === "skipped").length;
  return { shown: includeSkipped ? runs : runs.filter((r) => r.status !== "skipped"), skippedCount };
}
