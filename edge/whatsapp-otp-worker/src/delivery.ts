/**
 * The Super Admin delivery switch: the persisted flag in this Worker's own D1, its prerequisites, the compare-and-set update with its audit
 * row (one atomic D1 batch), and the report. Like settings.ts it owns no authentication or transport: admin.ts verifies the signature and the
 * database-issued grant, index.ts enforces the flag on the send path.
 *
 * Fail closed everywhere: no row = OFF, an unreadable table = OFF, and the flag alone never sends: the environment permit
 * (WHATSAPP_DELIVERY_ENABLED = "true", set only by a deployment) and valid limits are still required by the send path.
 */
import type { Db } from "./db.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTROL = /[\u0000-\u001f\u007f]/;
const MIN_REASON = 10;
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v);

export type DeliverySwitch = { enabled: boolean; version: number; updatedAt: number; updatedBy: string };
type SwitchRow = { enabled: number; version: number; updated_at: number; updated_by: string };

/** The stored switch, or null when no row exists. Throws only when the database cannot be read, so callers can fail closed on both. */
export async function readDeliverySwitch(db: Pick<Db, "prepare">): Promise<DeliverySwitch | null> {
  const row = await db.prepare("SELECT enabled, version, updated_at, updated_by FROM otp_delivery_switch WHERE id = 1").bind().first<SwitchRow>();
  if (!row) return null;
  if ((row.enabled !== 0 && row.enabled !== 1) || !isInt(row.version) || row.version < 1) return null; // an impossible row (the CHECKs) is OFF
  return { enabled: row.enabled === 1, version: row.version, updatedAt: row.updated_at, updatedBy: row.updated_by };
}

/**
 * True ONLY for a readable row that says ON *and* is accounted for by the audit trail: the newest audit row must carry the same version, value
 * and actor as the switch row. A direct write to the switch table (no audit row, or a stale one) therefore leaves delivery OFF instead of
 * silently on. Missing, invalid, unaudited and unreadable are all false.
 */
export async function deliverySwitchIsOn(db: Pick<Db, "prepare">): Promise<boolean> {
  try {
    const row = await db.prepare(
      "SELECT s.enabled AS enabled FROM otp_delivery_switch s WHERE s.id = 1 AND s.enabled = 1 AND " +
      "(SELECT a.new_version || ':' || a.new_enabled || ':' || a.actor FROM otp_delivery_audit a ORDER BY a.id DESC LIMIT 1) = s.version || ':' || s.enabled || ':' || s.updated_by",
    ).bind().first<{ enabled: number }>();
    return row?.enabled === 1;
  } catch { return false; }
}

/**
 * The switch row disagrees with its audit trail (changed directly in D1, or its audit row removed). Reported to the app so the Super Admins are
 * alerted; the send path already treats it as OFF. False when there is no switch row.
 */
export async function deliveryDrift(db: Pick<Db, "prepare">): Promise<{ version: number; at: number } | null> {
  try {
    const row = await db.prepare(
      "SELECT s.version AS version, s.updated_at AS at FROM otp_delivery_switch s WHERE s.id = 1 AND " +
      "(SELECT a.new_version || ':' || a.new_enabled || ':' || a.actor FROM otp_delivery_audit a ORDER BY a.id DESC LIMIT 1) IS NOT (s.version || ':' || s.enabled || ':' || s.updated_by)",
    ).bind().first<{ version: number; at: number }>();
    return row && isInt(row.version) && isInt(row.at) ? { version: row.version, at: row.at } : null;
  } catch { return null; }
}

export type DeliveryFacts = Record<string, string | number | boolean>;

/**
 * What stops the switch being turned ON, from the Worker's own non-secret runtime facts (the same ones the page shows). Empty = ready.
 * Turning OFF never consults this.
 */
export function deliveryBlockers(f: DeliveryFacts): string[] {
  const out: string[] = [];
  if (f.delivery_permitted !== true) out.push("environment_not_permitted");
  if (f.admin_secret_bound !== true) out.push("admin_secret_missing");
  if (f.admin_grant_secret_bound !== true) out.push("grant_secret_missing");
  if (f.notify_configured !== true) out.push("notify_not_configured");
  if (f.meta_token_bound !== true) out.push("meta_token_missing");
  if (f.d1_reachable !== true) out.push("d1_unreachable");
  if (f.settings_initialized !== true) out.push("settings_not_initialized");
  if (f.recipient_mode !== "open" && !(Number(f.allowlist_entries) > 0)) out.push("recipients_not_configured");
  return out;
}

export type DeliveryRequest = {
  requestId: string; actorId: string; expectedVersion: number; enabled: boolean;
  /** The reason exactly as signed (untrimmed): the database grant covers its hash. */
  reasonRaw: string; reason: string;
  grant: string; grantExpires: number;
};

const REQUEST_KEYS = new Set(["request_id", "actor_id", "expected_version", "enabled", "reason", "grant", "grant_expires"]);

/** Strict schema: exact key set, exact types, no coercion. */
export function parseDeliveryRequest(raw: string): DeliveryRequest | null {
  let b: unknown;
  try { b = JSON.parse(raw); } catch { return null; }
  if (!b || typeof b !== "object" || Array.isArray(b)) return null;
  const o = b as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!REQUEST_KEYS.has(k)) return null;
  const { request_id, actor_id, expected_version, enabled, reason, grant, grant_expires } = o;
  if (typeof request_id !== "string" || !UUID.test(request_id) || typeof actor_id !== "string" || !UUID.test(actor_id)) return null;
  if (!isInt(expected_version) || expected_version < 0 || typeof enabled !== "boolean") return null;
  if (typeof reason !== "string" || reason.length > 500 || CONTROL.test(reason)) return null;
  if (typeof grant !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(grant) || !isInt(grant_expires) || grant_expires < 1) return null;
  return { requestId: request_id.toLowerCase(), actorId: actor_id.toLowerCase(), expectedVersion: expected_version, enabled, reasonRaw: reason, reason: reason.trim(), grant, grantExpires: grant_expires };
}

export type DeliveryFailure = "stale_version" | "replay" | "no_change" | "reason_too_short" | "prerequisites_missing" | "unreadable";
export type DeliveryResult =
  | { ok: true; old: DeliverySwitch | null; new: DeliverySwitch }
  | { ok: false; error: DeliveryFailure; currentVersion?: number; missing?: string[] };

/**
 * Validate and apply a switch change atomically. The audit row is inserted by the SAME batch, conditioned on the SAME version, so a change
 * is either fully recorded and applied or neither. Enabling needs every prerequisite (`blockers` empty); disabling is always allowed.
 */
export async function applyDelivery(db: Db, req: DeliveryRequest, nowSeconds: number, blockers: string[]): Promise<DeliveryResult> {
  let current: DeliverySwitch | null;
  try { current = await readDeliverySwitch(db); } catch { return { ok: false, error: "unreadable" }; }
  if (current === null) {
    const exists = await db.prepare("SELECT 1 AS present FROM otp_delivery_switch WHERE id = 1").bind().first<{ present: number }>().catch(() => ({ present: -1 }));
    if (exists) return { ok: false, error: "unreadable" }; // an invalid row must be fixed by hand, never silently overwritten
  }
  const expected = current ? current.version : 0;
  if (req.expectedVersion !== expected) return { ok: false, error: "stale_version", currentVersion: expected };
  if (req.reason.length < MIN_REASON) return { ok: false, error: "reason_too_short" };
  // No row already means OFF, so "turn OFF" with no row, or the value it already has, is a refused no-op.
  if ((current?.enabled ?? false) === req.enabled) return { ok: false, error: "no_change" };
  if (req.enabled && blockers.length > 0) return { ok: false, error: "prerequisites_missing", missing: blockers };

  const flag = req.enabled ? 1 : 0;
  try {
    let results;
    if (current === null) {
      results = await db.batch([
        db.prepare("INSERT INTO otp_delivery_audit (at, request_id, actor, old_enabled, new_enabled, new_version, reason) SELECT ?1, ?2, ?3, NULL, ?4, 1, ?5 WHERE NOT EXISTS (SELECT 1 FROM otp_delivery_switch)")
          .bind(nowSeconds, req.requestId, req.actorId, flag, req.reason),
        db.prepare("INSERT INTO otp_delivery_switch (id, enabled, version, updated_at, updated_by) SELECT 1, ?1, 1, ?2, ?3 WHERE NOT EXISTS (SELECT 1 FROM otp_delivery_switch)")
          .bind(flag, nowSeconds, req.actorId),
      ]);
    } else {
      results = await db.batch([
        db.prepare("INSERT INTO otp_delivery_audit (at, request_id, actor, old_enabled, new_enabled, new_version, reason) SELECT ?1, ?2, ?3, enabled, ?4, version + 1, ?5 FROM otp_delivery_switch WHERE id = 1 AND version = ?6")
          .bind(nowSeconds, req.requestId, req.actorId, flag, req.reason, current.version),
        db.prepare("UPDATE otp_delivery_switch SET enabled = ?1, version = version + 1, updated_at = ?2, updated_by = ?3 WHERE id = 1 AND version = ?4")
          .bind(flag, nowSeconds, req.actorId, current.version),
      ]);
    }
    if (results[1]?.meta?.changes !== 1) return { ok: false, error: "stale_version", currentVersion: expected };
  } catch {
    return { ok: false, error: "replay" }; // a UNIQUE violation on the audit request id, or any storage error: the batch rolled back
  }
  let updated: DeliverySwitch | null;
  try { updated = await readDeliverySwitch(db); } catch { updated = null; }
  if (!updated) return { ok: false, error: "unreadable" };
  return { ok: true, old: current, new: updated };
}

type AuditRow = { at: number; request_id: string; actor: string; old_enabled: number | null; new_enabled: number; new_version: number; reason: string };

/** The switch and its last 20 audit rows for the usage report. An unreadable table reports OFF. */
export async function deliveryReport(db: Pick<Db, "prepare">) {
  let s: DeliverySwitch | null = null;
  try { s = await readDeliverySwitch(db); } catch { s = null; }
  let rows: AuditRow[] = [];
  try {
    rows = (await db.prepare("SELECT at, request_id, actor, old_enabled, new_enabled, new_version, reason FROM otp_delivery_audit ORDER BY id DESC LIMIT 20").bind().all<AuditRow>()).results ?? [];
  } catch { rows = []; }
  const drift = await deliveryDrift(db);
  return {
    delivery_drift: drift,
    delivery: { enabled: s?.enabled === true, version: s?.version ?? 0, updated_at: s?.updatedAt ?? null, updated_by: s?.updatedBy ?? null },
    delivery_audit: rows.map((a) => ({ at: a.at, request_id: a.request_id, actor: a.actor, old: a.old_enabled === null ? null : a.old_enabled === 1, new: a.new_enabled === 1, version: a.new_version, reason: a.reason })),
  };
}
