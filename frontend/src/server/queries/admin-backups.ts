import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { readPublicEnv } from "@/lib/env";

/**
 * Read model for `/admin/backups`. ONE self-guarding RPC
 * (`admin_backup_status`, permission `backup.view`) returns the environment,
 * the schedule, the latest outcomes and the last 25 runs. Nothing here is
 * trusted from the browser: the RPC checks the caller's effective permission in
 * the database, and every mutation re-checks it again.
 */

type Client = SupabaseClient<Database>;

export type BackupEnvironment = "acceptance" | "production";
export type BackupKind = "backup" | "restore_test";
export type BackupRunStatus = "requested" | "dispatched" | "running" | "succeeded" | "failed" | "skipped" | "unknown";

export type BackupSettings = {
  acceptance_schedule: "off" | "daily" | "weekly";
  production_enabled: boolean;
  production_restore_schedule_enabled: boolean;
  schedule_time: string;
  schedule_weekday: number;
  paused_until: string | null;
  version: number;
  updated_at: string | null;
  updated_by: string | null;
};

export type BackupRun = {
  id: string;
  kind: BackupKind;
  trigger: "schedule" | "manual";
  status: BackupRunStatus;
  requested_by: string | null;
  reason: string;
  github_run_id: number | null;
  github_run_url: string | null;
  github_conclusion: string | null;
  summary: Record<string, unknown>;
  error_code: string | null;
  requested_at: string;
  dispatched_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  reported_at: string | null;
};

export type BackupOutcome = { at: string; id: string; github_run_id: number | null } | null;
export type BackupFailure = { at: string; id: string; github_run_id: number | null; kind: BackupKind; code: string | null } | null;

export type BackupStatus = {
  initialized: boolean;
  environment: BackupEnvironment | null;
  settings: BackupSettings;
  latest: {
    backup: BackupOutcome;
    restore_test: BackupOutcome;
    last_failure: BackupFailure;
  };
  runs: BackupRun[];
};

const str = (value: unknown): string | null => (typeof value === "string" ? value : null);
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const bool = (value: unknown): boolean => value === true;

function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function environment(value: unknown): BackupEnvironment | null {
  return value === "acceptance" || value === "production" ? value : null;
}

function outcome(value: unknown): BackupOutcome {
  const o = obj(value);
  if (typeof o.at !== "string" || typeof o.id !== "string") return null;
  return { at: o.at, id: o.id, github_run_id: num(o.github_run_id) };
}

function failure(value: unknown): BackupFailure {
  const o = obj(value);
  const base = outcome(value);
  if (!base) return null;
  return { ...base, kind: o.kind === "restore_test" ? "restore_test" : "backup", code: str(o.code) };
}

function parseRun(value: unknown): BackupRun | null {
  const r = obj(value);
  if (typeof r.id !== "string" || typeof r.requested_at !== "string") return null;
  if (r.kind !== "backup" && r.kind !== "restore_test") return null;
  if (r.trigger !== "schedule" && r.trigger !== "manual") return null;
  const status = r.status;
  if (typeof status !== "string" || !["requested", "dispatched", "running", "succeeded", "failed", "skipped", "unknown"].includes(status)) return null;
  return {
    id: r.id,
    kind: r.kind,
    trigger: r.trigger,
    status: status as BackupRunStatus,
    requested_by: str(r.requested_by),
    reason: typeof r.reason === "string" ? r.reason : "",
    github_run_id: num(r.github_run_id),
    github_run_url: str(r.github_run_url),
    github_conclusion: str(r.github_conclusion),
    summary: obj(r.summary),
    error_code: str(r.error_code),
    requested_at: r.requested_at,
    dispatched_at: str(r.dispatched_at),
    started_at: str(r.started_at),
    finished_at: str(r.finished_at),
    reported_at: str(r.reported_at),
  };
}

export function parseBackupStatus(raw: unknown): BackupStatus | null {
  const root = obj(raw);
  if (!("initialized" in root) || !("settings" in root)) return null;
  const settings = obj(root.settings);
  const acceptance = settings.acceptance_schedule;
  if (acceptance !== "off" && acceptance !== "daily" && acceptance !== "weekly") return null;
  const version = num(settings.version);
  if (version === null) return null;
  const latest = obj(root.latest);
  return {
    initialized: bool(root.initialized),
    environment: environment(root.environment),
    settings: {
      acceptance_schedule: acceptance,
      production_enabled: bool(settings.production_enabled),
      production_restore_schedule_enabled: bool(settings.production_restore_schedule_enabled),
      schedule_time: str(settings.schedule_time) ?? "01:30",
      schedule_weekday: num(settings.schedule_weekday) ?? 0,
      paused_until: str(settings.paused_until),
      version,
      updated_at: str(settings.updated_at),
      updated_by: str(settings.updated_by),
    },
    latest: {
      backup: outcome(latest.backup),
      restore_test: outcome(latest.restore_test),
      last_failure: failure(latest.last_failure),
    },
    runs: Array.isArray(root.runs) ? root.runs.flatMap((r) => parseRun(r) ?? []) : [],
  };
}

export async function loadBackupStatus(supabase: Client): Promise<BackupStatus | null> {
  const { data, error } = await supabase.rpc("admin_backup_status");
  if (error) return null;
  const status = parseBackupStatus(data);
  const env = readPublicEnv();
  const expected = env.NEXT_PUBLIC_APP_ENV === "production" ? "production" : "acceptance";
  const project = expected === "production" ? "kkpkgjrweysgvhvkhzun" : "nxossqhdfltcqdwvbewi";
  // A wrongly bound Preview database must never become a Production control panel.
  if (env.NEXT_PUBLIC_APP_ENV !== "local" && env.NEXT_PUBLIC_SUPABASE_URL !== `https://${project}.supabase.co`) return null;
  if (status?.initialized && status.environment !== expected) return null;
  return status;
}
