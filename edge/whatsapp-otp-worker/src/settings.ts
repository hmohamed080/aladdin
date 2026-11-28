/**
 * The Super Admin-controlled limits: the authoritative row in this Worker's own D1, strict validation, the compare-and-set update with its
 * audit row (one atomic D1 batch), and the usage report. Nothing here talks to Supabase, Meta or any secret: the callers (admin.ts,
 * index.ts, maintenance.ts) own authentication and transport.
 */
import type { Db } from "./db.ts";

/** An integer sanity bound against typos and overflow. It is NOT an operational maximum: the operational Hard Ceiling is a value in D1. */
export const SANITY_MAX = 1_000_000;
export const DAY_SECONDS = 86_400;
export const HOUR_SECONDS = 3_600;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL = /[\u0000-\u001f\u007f]/;

export type OtpSettings = {
  dailyLimit: number;
  hardCeiling: number;
  warnPercent: number;
  criticalPercent: number;
  version: number;
  updatedAt: number;
  updatedBy: string;
};

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);

/** The invariants the D1 CHECKs, the RPC and this Worker all enforce. */
export function settingsAreValid(s: { dailyLimit: unknown; hardCeiling: unknown; warnPercent: unknown; criticalPercent: unknown }): boolean {
  return (
    isInt(s.dailyLimit) && isInt(s.hardCeiling) && isInt(s.warnPercent) && isInt(s.criticalPercent) &&
    s.dailyLimit >= 1 && s.dailyLimit <= s.hardCeiling && s.hardCeiling <= SANITY_MAX &&
    s.warnPercent >= 1 && s.warnPercent < s.criticalPercent && s.criticalPercent <= 100
  );
}

type SettingsRow = { daily_limit: number; hard_ceiling: number; warn_percent: number; critical_percent: number; version: number; updated_at: number; updated_by: string };

function fromRow(r: SettingsRow): OtpSettings {
  return { dailyLimit: r.daily_limit, hardCeiling: r.hard_ceiling, warnPercent: r.warn_percent, criticalPercent: r.critical_percent, version: r.version, updatedAt: r.updated_at, updatedBy: r.updated_by };
}

/**
 * The validated settings, or null when the row is missing OR invalid (which makes the Worker send nothing). Throws only when the database
 * cannot be read at all, so callers can tell "unconfigured" from "unreadable"; the send path treats both as fail-closed.
 */
export async function readSettings(db: Pick<Db, "prepare">): Promise<OtpSettings | null> {
  const row = await db
    .prepare("SELECT daily_limit, hard_ceiling, warn_percent, critical_percent, version, updated_at, updated_by FROM otp_settings WHERE id = 1")
    .bind()
    .first<SettingsRow>();
  if (!row) return null;
  const s = fromRow(row);
  return settingsAreValid(s) && isInt(s.version) && s.version >= 1 ? s : null;
}

/** Whole-number percent of the budget consumed, and the alert level (0 ok, 1 warning, 2 critical, 3 exhausted). */
export function budgetLevel(consumed: number, limit: number, warnPercent: number, criticalPercent: number): { percent: number; level: 0 | 1 | 2 | 3 } {
  const percent = limit > 0 ? Math.floor((consumed * 100) / limit) : 100;
  if (consumed >= limit) return { percent, level: 3 };
  if (percent >= criticalPercent) return { percent, level: 2 };
  if (percent >= warnPercent) return { percent, level: 1 };
  return { percent, level: 0 };
}
export const LEVEL_NAMES = ["ok", "warning", "critical", "exhausted"] as const;

// ---------------------------------------------------------------------------------------------------------------------------------
// The admin settings request
// ---------------------------------------------------------------------------------------------------------------------------------
export type SettingsRequest = {
  requestId: string;
  actorId: string;
  expectedVersion: number;
  dailyLimit: number;
  hardCeiling: number;
  warnPercent: number;
  criticalPercent: number;
  reason: string;
  ceilingConfirmation: string | null;
  /** Set by the app server ONLY after the database confirmed whatsapp_otp.ceiling_manage for the actor. A ceiling change without it is refused here. */
  ceilingAuthorized: boolean;
  /** The reason exactly as signed (untrimmed): the database grant covers its hash. */
  reasonRaw: string;
  /** The database-issued, single-request authorization (base64 HMAC) and its expiry (epoch seconds). Verified in admin.ts. */
  grant: string;
  grantExpires: number;
};

const REQUEST_KEYS = new Set(["request_id", "actor_id", "expected_version", "daily_limit", "hard_ceiling", "warn_percent", "critical_percent", "reason", "ceiling_confirmation", "ceiling_authorized", "grant", "grant_expires"]);

/** Strict schema: exact key set, exact types, no coercion. A signed but malformed request is still refused. */
export function parseSettingsRequest(raw: string): SettingsRequest | null {
  let b: unknown;
  try { b = JSON.parse(raw); } catch { return null; }
  if (!b || typeof b !== "object" || Array.isArray(b)) return null;
  const o = b as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!REQUEST_KEYS.has(k)) return null;
  const { request_id, actor_id, expected_version, daily_limit, hard_ceiling, warn_percent, critical_percent, reason, ceiling_confirmation, ceiling_authorized, grant, grant_expires } = o;
  if (typeof request_id !== "string" || !UUID.test(request_id) || typeof actor_id !== "string" || !UUID.test(actor_id)) return null;
  if (!isInt(expected_version) || expected_version < 0) return null;
  if (!isInt(daily_limit) || !isInt(hard_ceiling) || !isInt(warn_percent) || !isInt(critical_percent)) return null;
  if (typeof reason !== "string" || reason.length > 500 || CONTROL.test(reason)) return null;
  if (ceiling_confirmation !== undefined && (typeof ceiling_confirmation !== "string" || ceiling_confirmation.length > 12)) return null;
  if (ceiling_authorized !== undefined && typeof ceiling_authorized !== "boolean") return null;
  if (typeof grant !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(grant) || !isInt(grant_expires) || grant_expires < 1) return null;
  return {
    requestId: request_id.toLowerCase(), actorId: actor_id.toLowerCase(), expectedVersion: expected_version,
    dailyLimit: daily_limit, hardCeiling: hard_ceiling, warnPercent: warn_percent, criticalPercent: critical_percent,
    reason: reason.trim(), ceilingConfirmation: ceiling_confirmation === undefined ? null : ceiling_confirmation,
    ceilingAuthorized: ceiling_authorized === true,
    reasonRaw: reason, grant, grantExpires: grant_expires,
  };
}

export type ApplyFailure =
  | "stale_version" | "replay" | "no_change" | "reason_too_short" | "ceiling_confirmation_required" | "ceiling_not_authorized"
  | "invalid_values" | "thresholds_out_of_order" | "daily_exceeds_ceiling" | "ceiling_below_current_limit" | "unreadable";
export type ApplyResult = { ok: true; old: OtpSettings | null; new: OtpSettings } | { ok: false; error: ApplyFailure; currentVersion?: number };

const MIN_REASON = 10;
const MIN_REASON_CEILING = 20;

/**
 * Validate and apply a settings change atomically. Both limits are always written together. The audit row is inserted by the SAME batch,
 * conditioned on the SAME version, so a change is either fully recorded and applied or neither. Changing the Hard Ceiling is sensitive:
 * a longer reason and a typed confirmation of the new number are required.
 */
export async function applySettings(db: Db, req: SettingsRequest, nowSeconds: number): Promise<ApplyResult> {
  let current: OtpSettings | null;
  try { current = await readSettings(db); } catch { return { ok: false, error: "unreadable" }; }
  // An existing but invalid row (impossible through the CHECKs) must be fixed by hand, never silently overwritten.
  if (current === null) {
    const exists = await db.prepare("SELECT 1 AS present FROM otp_settings WHERE id = 1").bind().first<{ present: number }>().catch(() => ({ present: -1 }));
    if (exists) return { ok: false, error: "unreadable" };
  }

  const expected = current ? current.version : 0;
  if (req.expectedVersion !== expected) return { ok: false, error: "stale_version", currentVersion: expected };

  if (![req.dailyLimit, req.hardCeiling, req.warnPercent, req.criticalPercent].every(isInt)) return { ok: false, error: "invalid_values" };
  if (req.hardCeiling < 1 || req.hardCeiling > SANITY_MAX || req.dailyLimit < 1) return { ok: false, error: "invalid_values" };
  if (req.warnPercent < 1 || req.criticalPercent > 100 || req.warnPercent >= req.criticalPercent) return { ok: false, error: "thresholds_out_of_order" };
  if (req.dailyLimit > req.hardCeiling) {
    // Lowering the ceiling below the current limit without lowering the limit in the SAME request is refused with its own explanation.
    if (current && req.dailyLimit === current.dailyLimit && req.hardCeiling < current.dailyLimit) return { ok: false, error: "ceiling_below_current_limit" };
    return { ok: false, error: "daily_exceeds_ceiling" };
  }

  const ceilingChanged = current === null || current.hardCeiling !== req.hardCeiling;
  // Defence in depth: whatever the caller believes the current ceiling is, THIS Worker compares against its own row and refuses a ceiling
  // change that the app server did not mark as authorized after the database confirmed the elevated permission.
  if (ceilingChanged && !req.ceilingAuthorized) return { ok: false, error: "ceiling_not_authorized" };
  if (req.reason.length < (ceilingChanged ? MIN_REASON_CEILING : MIN_REASON)) return { ok: false, error: "reason_too_short" };
  if (ceilingChanged && req.ceilingConfirmation !== String(req.hardCeiling)) return { ok: false, error: "ceiling_confirmation_required" };
  if (current && current.dailyLimit === req.dailyLimit && current.hardCeiling === req.hardCeiling && current.warnPercent === req.warnPercent && current.criticalPercent === req.criticalPercent) {
    return { ok: false, error: "no_change" };
  }

  const auditCols =
    "(at, request_id, actor, kind, old_daily_limit, new_daily_limit, old_hard_ceiling, new_hard_ceiling, old_warn_percent, new_warn_percent, old_critical_percent, new_critical_percent, new_version, reason)";
  try {
    let results;
    if (current === null) {
      results = await db.batch([
        db.prepare(`INSERT INTO otp_settings_audit ${auditCols} SELECT ?1, ?2, ?3, 'initialize', NULL, ?4, NULL, ?5, NULL, ?6, NULL, ?7, 1, ?8 WHERE NOT EXISTS (SELECT 1 FROM otp_settings)`)
          .bind(nowSeconds, req.requestId, req.actorId, req.dailyLimit, req.hardCeiling, req.warnPercent, req.criticalPercent, req.reason),
        db.prepare("INSERT INTO otp_settings (id, daily_limit, hard_ceiling, warn_percent, critical_percent, version, updated_at, updated_by) SELECT 1, ?1, ?2, ?3, ?4, 1, ?5, ?6 WHERE NOT EXISTS (SELECT 1 FROM otp_settings)")
          .bind(req.dailyLimit, req.hardCeiling, req.warnPercent, req.criticalPercent, nowSeconds, req.actorId),
      ]);
    } else {
      results = await db.batch([
        db.prepare(`INSERT INTO otp_settings_audit ${auditCols} SELECT ?1, ?2, ?3, 'update', daily_limit, ?4, hard_ceiling, ?5, warn_percent, ?6, critical_percent, ?7, version + 1, ?8 FROM otp_settings WHERE id = 1 AND version = ?9`)
          .bind(nowSeconds, req.requestId, req.actorId, req.dailyLimit, req.hardCeiling, req.warnPercent, req.criticalPercent, req.reason, current.version),
        db.prepare("UPDATE otp_settings SET daily_limit = ?1, hard_ceiling = ?2, warn_percent = ?3, critical_percent = ?4, version = version + 1, updated_at = ?5, updated_by = ?6 WHERE id = 1 AND version = ?7")
          .bind(req.dailyLimit, req.hardCeiling, req.warnPercent, req.criticalPercent, nowSeconds, req.actorId, current.version),
      ]);
    }
    if (results[1]?.meta?.changes !== 1) return { ok: false, error: "stale_version", currentVersion: expected };
  } catch {
    // A UNIQUE violation on the audit request id (a replay that slipped past the claim) or any storage error rolls the whole batch back.
    return { ok: false, error: "replay" };
  }
  let updated: OtpSettings | null;
  try { updated = await readSettings(db); } catch { updated = null; }
  if (!updated) return { ok: false, error: "unreadable" };
  return { ok: true, old: current, new: updated };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Usage report
// ---------------------------------------------------------------------------------------------------------------------------------
type WindowRow = {
  c24: number; a24: number; f24: number; r24: number;
  c1: number; a1: number; f1: number;
  c7: number; a7: number; f7: number;
  last_failed: number | null;
};
type AuditRow = {
  at: number; request_id: string; actor: string; kind: string;
  old_daily_limit: number | null; new_daily_limit: number; old_hard_ceiling: number | null; new_hard_ceiling: number;
  old_warn_percent: number | null; new_warn_percent: number; old_critical_percent: number | null; new_critical_percent: number;
  new_version: number; reason: string;
};

const rate = (failed: number, accepted: number) => (accepted + failed > 0 ? Math.round((failed * 100) / (accepted + failed)) : null);
const win = (attempts: number, accepted: number, failed: number) => ({ attempts, accepted, failed, failure_percent: rate(failed, accepted) });

export type OutboxStats = { pending: number; oldest_pending_at: number | null };

export async function windowCounts(db: Pick<Db, "prepare">, nowSeconds: number): Promise<WindowRow> {
  const row = await db
    .prepare(
      `SELECT
         COALESCE(SUM(created_at >= ?1), 0) AS c24,
         COALESCE(SUM(created_at >= ?1 AND state = 'accepted'), 0) AS a24,
         COALESCE(SUM(created_at >= ?1 AND state = 'failed'), 0) AS f24,
         COALESCE(SUM(created_at >= ?1 AND state = 'reserved'), 0) AS r24,
         COALESCE(SUM(created_at >= ?2), 0) AS c1,
         COALESCE(SUM(created_at >= ?2 AND state = 'accepted'), 0) AS a1,
         COALESCE(SUM(created_at >= ?2 AND state = 'failed'), 0) AS f1,
         COUNT(*) AS c7,
         COALESCE(SUM(state = 'accepted'), 0) AS a7,
         COALESCE(SUM(state = 'failed'), 0) AS f7,
         MAX(CASE WHEN state = 'failed' THEN created_at END) AS last_failed
       FROM whatsapp_hook_events WHERE created_at >= ?3`,
    )
    .bind(nowSeconds - DAY_SECONDS, nowSeconds - HOUR_SECONDS, nowSeconds - 7 * DAY_SECONDS)
    .first<WindowRow>();
  return row ?? { c24: 0, a24: 0, f24: 0, r24: 0, c1: 0, a1: 0, f1: 0, c7: 0, a7: 0, f7: 0, last_failed: null };
}

export async function usageReport(db: Db, nowSeconds: number) {
  const settings = await readSettings(db).catch(() => null);
  const w = await windowCounts(db, nowSeconds);
  const limit = settings ? Math.min(settings.dailyLimit, settings.hardCeiling) : 0;
  const { percent, level } = settings ? budgetLevel(w.c24, limit, settings.warnPercent, settings.criticalPercent) : { percent: 0, level: 0 as const };
  const outbox = await db.prepare("SELECT COUNT(*) AS pending, MIN(created_at) AS oldest FROM otp_notification_outbox WHERE delivered_at IS NULL").bind().first<{ pending: number; oldest: number | null }>();
  const audit = await db
    .prepare(
      "SELECT at, request_id, actor, kind, old_daily_limit, new_daily_limit, old_hard_ceiling, new_hard_ceiling, old_warn_percent, new_warn_percent, old_critical_percent, new_critical_percent, new_version, reason FROM otp_settings_audit ORDER BY id DESC LIMIT 20",
    )
    .bind()
    .all<AuditRow>();
  return {
    now: nowSeconds,
    configured: settings !== null,
    settings: settings && {
      daily_limit: settings.dailyLimit, hard_ceiling: settings.hardCeiling, warn_percent: settings.warnPercent, critical_percent: settings.criticalPercent,
      version: settings.version, updated_at: settings.updatedAt, updated_by: settings.updatedBy,
    },
    window_hours: 24,
    consumed: w.c24, accepted: w.a24, failed: w.f24, reserved: w.r24,
    remaining: settings ? Math.max(0, limit - w.c24) : 0,
    effective_limit: limit,
    percent,
    level: LEVEL_NAMES[level],
    failure: { last_hour: win(w.c1, w.a1, w.f1), last_24h: win(w.c24, w.a24, w.f24), last_7d: win(w.c7, w.a7, w.f7), last_failure_at: w.last_failed },
    notifications: { pending: outbox?.pending ?? 0, oldest_pending_at: outbox?.oldest ?? null },
    audit: (audit.results ?? []).map((a) => ({
      at: a.at, request_id: a.request_id, actor: a.actor, kind: a.kind, version: a.new_version, reason: a.reason,
      old: a.old_daily_limit === null ? null : { daily_limit: a.old_daily_limit, hard_ceiling: a.old_hard_ceiling, warn_percent: a.old_warn_percent, critical_percent: a.old_critical_percent },
      new: { daily_limit: a.new_daily_limit, hard_ceiling: a.new_hard_ceiling, warn_percent: a.new_warn_percent, critical_percent: a.new_critical_percent },
    })),
  };
}
