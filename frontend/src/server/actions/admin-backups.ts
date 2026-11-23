"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { getCurrentUser } from "@/server/auth/session";
import {
  adminBackupActivate,
  adminBackupMarkDispatched,
  adminBackupRequest,
  adminBackupUpdateSchedule,
} from "@/lib/supabase/admin-server";
import { dispatchBackupWorkflow } from "@/server/backups/github";
import { reconcileBackupRuns } from "@/server/backups/reconcile";
import { loadBackupStatus, type BackupEnvironment } from "@/server/queries/admin-backups";
import type { FormState } from "@/server/actions/sales-forms";

/**
 * `/admin/backups` mutations. Nothing is decided here: the server derives the
 * actor from the VERIFIED session, the database re-checks that actor's
 * effective permission, and every sensitive action spends a single-use
 * current-password receipt bound to (actor, operation, environment). The
 * environment itself always comes from the database — never from the form.
 *
 * GitHub dispatch is the only side effect outside the database. A dispatch that
 * cannot be confirmed is recorded as a FAILURE; it is never reported as a
 * successful backup, and the run's real outcome is only settled later by the
 * server's cross-check of the run AND its data-moving job.
 */

const PASSWORD_OPERATION = {
  backup: "backup.execute",
  restore_test: "backup.restore_test",
  schedule: "backup.schedule_manage",
} as const;

type Client = Awaited<ReturnType<typeof getServerSupabase>>;

function text(fd: FormData, key: string): string {
  const value = fd.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function isProductionConfirmation(kind: string, environment: BackupEnvironment, confirmation: string): boolean {
  return kind !== "backup" || environment !== "production" || confirmation === "back up production";
}

async function confirmPassword(supabase: Client, password: string, operation: string, target: BackupEnvironment): Promise<{ ok: true; receipt: string } | { ok: false; code: string }> {
  if (!password) return { ok: false, code: "backups.errors.passwordRequired" };
  const { data, error } = await supabase.rpc("account_password_confirm", {
    p_password: password,
    p_operation: operation,
    p_target: target,
  });
  if (error) return { ok: false, code: "backups.errors.generic" };
  const result = (data ?? {}) as { ok?: boolean; receipt?: string; reason?: string };
  if (result.ok && typeof result.receipt === "string") return { ok: true, receipt: result.receipt };
  const reason = result.reason === "locked" || result.reason === "no_password" ? result.reason : "wrong_password";
  return {
    ok: false,
    code: {
      locked: "backups.errors.locked",
      no_password: "backups.errors.noPassword",
      wrong_password: "backups.errors.wrongPassword",
    }[reason],
  };
}

function mapBackupError(code: string | null, message: string | null): string {
  const text = message ?? "";
  if (code === "42501") return text.includes("current-password") ? "backups.errors.reauth" : "backups.errors.forbidden";
  if (code === "55000") {
    if (text.includes("not initialized")) return "backups.errors.notInitialized";
    if (text.includes("not activated")) return "backups.errors.productionOff";
    return "backups.errors.unavailable";
  }
  if (code === "23505") return "backups.errors.pending";
  if (code === "VC001") return "backups.errors.stale";
  if (code === "22023") {
    if (text.includes("type")) return "backups.errors.confirmation";
    if (text.includes("reason")) return "backups.errors.reason";
    return "backups.errors.invalid";
  }
  return "backups.errors.generic";
}

/** Start a backup or a restore test. */
export async function requestBackupAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const kind = text(fd, "kind");
  if (kind !== "backup" && kind !== "restore_test") return { ok: false, code: "backups.errors.invalid" };
  const reason = text(fd, "reason");
  if (reason.length < 10 || reason.length > 500) return { ok: false, code: "backups.errors.reason", fieldErrors: { reason: "backups.errors.reason" } };

  const user = await getCurrentUser();
  if (!user) return { ok: false, code: "backups.errors.forbidden" };
  const supabase = await getServerSupabase();
  const status = await loadBackupStatus(supabase);
  if (!status || !status.initialized || !status.environment) return { ok: false, code: "backups.errors.notInitialized" };
  if (status.environment === "production" && !status.settings.production_enabled) return { ok: false, code: "backups.errors.productionOff" };
  if (!isProductionConfirmation(kind, status.environment, text(fd, "confirmation"))) return { ok: false, code: "backups.errors.confirmation" };

  const confirmed = await confirmPassword(supabase, String(fd.get("password") ?? ""), PASSWORD_OPERATION[kind], status.environment);
  if (!confirmed.ok) return { ok: false, code: confirmed.code };

  const requested = await adminBackupRequest({ actor: user.id, kind, reason, receipt: confirmed.receipt });
  if (!requested.data) return { ok: false, code: mapBackupError(requested.code, requested.message) };
  const runId = requested.data.id;

  const dispatched = await dispatchBackupWorkflow({
    kind,
    environment: status.environment,
    requestId: runId,
    // The private workflow re-checks the typed phrase for a manual Production backup.
    confirm: text(fd, "confirmation"),
  });
  if (!dispatched.ok) {
    await adminBackupMarkDispatched({ actor: user.id, run: runId, ok: false, code: dispatched.code });
    revalidatePath("/admin/backups");
    return { ok: false, code: `backups.errors.${dispatched.code}` };
  }

  const marked = await adminBackupMarkDispatched({
    actor: user.id,
    run: runId,
    ok: true,
    githubRunId: dispatched.runId,
    githubRunUrl: dispatched.runUrl,
  });
  if (!marked.data) return { ok: false, code: mapBackupError(marked.code, marked.message) };
  revalidatePath("/admin/backups");
  return { ok: true, code: "backups.done.requested" };
}

/** Change the schedule. The version the admin SAW must still be current. */
export async function saveBackupScheduleAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const schedule = text(fd, "acceptance_schedule");
  if (schedule !== "off" && schedule !== "daily" && schedule !== "weekly") return { ok: false, code: "backups.errors.invalid" };
  const reason = text(fd, "reason");
  if (reason.length < 10 || reason.length > 500) return { ok: false, code: "backups.errors.reason", fieldErrors: { reason: "backups.errors.reason" } };
  const version = Number(text(fd, "version"));
  if (!Number.isSafeInteger(version) || version < 0) return { ok: false, code: "backups.errors.stale" };

  const user = await getCurrentUser();
  if (!user) return { ok: false, code: "backups.errors.forbidden" };
  const supabase = await getServerSupabase();
  const status = await loadBackupStatus(supabase);
  if (!status || !status.initialized || !status.environment) return { ok: false, code: "backups.errors.notInitialized" };

  const confirmed = await confirmPassword(supabase, String(fd.get("password") ?? ""), PASSWORD_OPERATION.schedule, status.environment);
  if (!confirmed.ok) return { ok: false, code: confirmed.code };

  const result = await adminBackupUpdateSchedule({
    actor: user.id,
    acceptanceSchedule: schedule,
    config: { time: text(fd, "schedule_time"), weekday: Number(text(fd, "schedule_weekday")),
      pause_hours: Number(text(fd, "pause_hours")), confirmation: text(fd, "confirmation") },
    productionRestoreScheduleEnabled: fd.get("production_restore_schedule_enabled") === "on",
    expectedVersion: version,
    reason,
    receipt: confirmed.receipt,
  });
  if (result.data === null) return { ok: false, code: mapBackupError(result.code, result.message) };
  revalidatePath("/admin/backups");
  return { ok: true, code: "backups.done.saved" };
}

/** Production-only activation switch. The typed phrase is part of the database check too. */
export async function setProductionBackupActivationAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const enabled = text(fd, "enabled") === "true";
  const reason = text(fd, "reason");
  if (reason.length < 10 || reason.length > 500) return { ok: false, code: "backups.errors.reason", fieldErrors: { reason: "backups.errors.reason" } };

  const user = await getCurrentUser();
  if (!user) return { ok: false, code: "backups.errors.forbidden" };
  const supabase = await getServerSupabase();
  const status = await loadBackupStatus(supabase);
  if (!status || !status.initialized || status.environment !== "production") return { ok: false, code: "backups.errors.notProduction" };

  const confirmed = await confirmPassword(supabase, String(fd.get("password") ?? ""), PASSWORD_OPERATION.schedule, status.environment);
  if (!confirmed.ok) return { ok: false, code: confirmed.code };

  const result = await adminBackupActivate({
    actor: user.id,
    enabled,
    confirmation: text(fd, "confirmation"),
    reason,
    receipt: confirmed.receipt,
  });
  if (result.data === null) return { ok: false, code: mapBackupError(result.code, result.message) };
  revalidatePath("/admin/backups");
  return { ok: true, code: enabled ? "backups.done.activated" : "backups.done.deactivated" };
}

/** Re-read GitHub for in-flight runs. Read-only on GitHub; never dispatches anything. */
export async function refreshBackupRunsAction(_prev: FormState, _fd: FormData): Promise<FormState> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, code: "backups.errors.forbidden" };
  const supabase = await getServerSupabase();
  const status = await loadBackupStatus(supabase);
  if (!status) return { ok: false, code: "backups.errors.forbidden" };
  const settled = await reconcileBackupRuns(status, user.id).catch(() => 0);
  revalidatePath("/admin/backups");
  return { ok: true, code: settled > 0 ? "backups.done.refreshed" : "backups.done.nothingToRefresh" };
}
