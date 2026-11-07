/**
 * Scheduled maintenance, deliberately OUTSIDE the send path: journal retention, threshold evaluation, and delivery of operational alerts to
 * the app's notification endpoint. Every step is isolated and best-effort. A failure here is logged (numbers only) and NEVER affects an
 * OTP delivery, because nothing in the send path waits for, reads from or depends on this module.
 *
 * The Worker holds no database credential and no email/Resend credential. It can only POST a signed, allow-listed statistics event to one
 * URL; the app turns it into notifications through the existing notification system.
 */
import type { Db } from "./db.ts";
import { runAttestation } from "./attest.ts";
import { DAY_SECONDS, HOUR_SECONDS, LEVEL_NAMES, budgetLevel, readSettings, windowCounts } from "./settings.ts";
import { type NotifyTransportEnv, notifyTransportAvailable, postSignedNotify } from "./notify-transport.ts";

/** Percentage points a metric must fall below a threshold before its alert re-arms, so a rolling window hovering at a threshold cannot flap. */
export const HYSTERESIS_POINTS = 5;
/** A burst of delivery failures is abnormal from this many attempts in the last hour at this failure rate. */
export const FAILURE_MIN_ATTEMPTS = 10;
export const FAILURE_RATE_PERCENT = 30;
const MAX_ATTEMPTS = 60;
const MAX_EVENT_AGE_SECONDS = 7 * DAY_SECONDS;

export type AlertKind = "budget_warning" | "budget_critical" | "budget_exhausted" | "failure_rate";
const KIND_BY_LEVEL: Record<number, AlertKind> = { 1: "budget_warning", 2: "budget_critical", 3: "budget_exhausted" };

type State = { budget_level: number; failure_alert: number; episode: number };

/** The level to hold: it rises immediately, and falls only once usage is HYSTERESIS_POINTS below the threshold that raised it. */
export function nextLevel(current: number, raw: number, percent: number, warn: number, critical: number): number {
  if (raw >= current) return raw;
  const threshold = (lvl: number) => (lvl === 1 ? warn : lvl === 2 ? critical : 100);
  let level = current;
  while (level > raw && percent < threshold(level) - HYSTERESIS_POINTS) level -= 1;
  return Math.max(level, raw);
}

async function enqueue(db: Db, key: string, kind: AlertKind, payload: Record<string, number | string>, nowSeconds: number): Promise<void> {
  await db
    .prepare("INSERT OR IGNORE INTO otp_notification_outbox (event_key, kind, payload, created_at, next_attempt_at) VALUES (?1, ?2, ?3, ?4, ?4)")
    .bind(key, kind, JSON.stringify(payload), nowSeconds)
    .run();
}

/** Raises at most one event per crossing. Compare-and-set on the episode counter makes overlapping runs harmless. */
export async function evaluateAlerts(db: Db, nowSeconds: number): Promise<{ raised: AlertKind[]; skipped?: string }> {
  const raised: AlertKind[] = [];
  const settings = await readSettings(db);
  if (!settings) return { raised, skipped: "unconfigured" };
  await db.prepare("INSERT OR IGNORE INTO otp_alert_state (id, updated_at) VALUES (1, ?1)").bind(nowSeconds).run();
  const w = await windowCounts(db, nowSeconds);
  const limit = Math.min(settings.dailyLimit, settings.hardCeiling);

  // --- budget level ---
  let state = await db.prepare("SELECT budget_level, failure_alert, episode FROM otp_alert_state WHERE id = 1").bind().first<State>();
  if (!state) return { raised, skipped: "no_state" };
  const { percent, level: rawLevel } = budgetLevel(w.c24, limit, settings.warnPercent, settings.criticalPercent);
  const held = nextLevel(state.budget_level, rawLevel, percent, settings.warnPercent, settings.criticalPercent);
  if (held > state.budget_level) {
    const cas = await db.prepare("UPDATE otp_alert_state SET budget_level = ?1, episode = episode + 1, updated_at = ?2 WHERE id = 1 AND episode = ?3").bind(held, nowSeconds, state.episode).run();
    if (cas.meta?.changes === 1) {
      const kind = KIND_BY_LEVEL[held]!;
      await enqueue(db, `${kind}:${state.episode + 1}`, kind, {
        limit, ceiling: settings.hardCeiling, consumed: w.c24, remaining: Math.max(0, limit - w.c24), percent,
        warn_percent: settings.warnPercent, critical_percent: settings.criticalPercent, accepted: w.a24, failed: w.f24, reserved: w.r24, level: LEVEL_NAMES[held] ?? "ok",
      }, nowSeconds);
      raised.push(kind);
    }
  } else if (held < state.budget_level) {
    // Re-arm silently: usage fell back below the threshold (with hysteresis), so a later crossing raises a NEW event.
    await db.prepare("UPDATE otp_alert_state SET budget_level = ?1, updated_at = ?2 WHERE id = 1 AND episode = ?3").bind(held, nowSeconds, state.episode).run();
  }

  // --- abnormal delivery-failure rate (last hour) ---
  state = await db.prepare("SELECT budget_level, failure_alert, episode FROM otp_alert_state WHERE id = 1").bind().first<State>();
  if (!state) return { raised };
  const attempts = w.a1 + w.f1; // reserved attempts are still in flight and say nothing about success or failure yet
  const failurePercent = attempts > 0 ? Math.round((w.f1 * 100) / attempts) : 0;
  const abnormal = attempts >= FAILURE_MIN_ATTEMPTS && failurePercent >= FAILURE_RATE_PERCENT;
  if (state.failure_alert === 0 && abnormal) {
    const cas = await db.prepare("UPDATE otp_alert_state SET failure_alert = 1, episode = episode + 1, updated_at = ?1 WHERE id = 1 AND episode = ?2").bind(nowSeconds, state.episode).run();
    if (cas.meta?.changes === 1) {
      await enqueue(db, `failure_rate:${state.episode + 1}`, "failure_rate", { attempts, failed: w.f1, failure_percent: failurePercent, window_minutes: 60 }, nowSeconds);
      raised.push("failure_rate");
    }
  } else if (state.failure_alert === 1 && (attempts < FAILURE_MIN_ATTEMPTS || failurePercent < FAILURE_RATE_PERCENT / 2)) {
    await db.prepare("UPDATE otp_alert_state SET failure_alert = 0, updated_at = ?1 WHERE id = 1 AND episode = ?2").bind(nowSeconds, state.episode).run();
  }
  return { raised };
}

export type NotifyEnv = NotifyTransportEnv & {
  OTP_NOTIFY_URL?: string;
  OTP_NOTIFY_SIGNING_SECRET?: { get(): Promise<string> };
  OTP_ENVIRONMENT?: string;
};
type OutboxRow = { event_key: string; kind: AlertKind; payload: string; created_at: number; attempts: number };

/** Delivers pending events, oldest first, a few per run. Failures back off exponentially and are retried for up to 7 days. */
export async function deliverOutbox(env: NotifyEnv, db: Db, fetcher: typeof fetch, nowSeconds: number): Promise<{ delivered: number; failed: number; skipped?: string }> {
  if (!env.OTP_NOTIFY_URL || !env.OTP_NOTIFY_SIGNING_SECRET?.get) return { delivered: 0, failed: 0, skipped: "notify_unconfigured" };
  let url: URL;
  try { url = new URL(env.OTP_NOTIFY_URL); } catch { return { delivered: 0, failed: 0, skipped: "notify_unconfigured" }; }
  if (url.protocol !== "https:" && !["127.0.0.1", "localhost"].includes(url.hostname)) return { delivered: 0, failed: 0, skipped: "notify_unconfigured" };
  let secret: string;
  try { secret = await env.OTP_NOTIFY_SIGNING_SECRET.get(); } catch { return { delivered: 0, failed: 0, skipped: "notify_secret_unreadable" }; }
  if (!secret) return { delivered: 0, failed: 0, skipped: "notify_unconfigured" };
  // No private transport (the APP_NOTIFY Service Binding) sends nothing and burns no retry attempt: the events wait in the outbox for the fix. Never a public fallback.
  if (!notifyTransportAvailable(env)) return { delivered: 0, failed: 0, skipped: "notify_transport_unavailable" };

  const due = await db
    .prepare("SELECT event_key, kind, payload, created_at, attempts FROM otp_notification_outbox WHERE delivered_at IS NULL AND next_attempt_at <= ?1 AND attempts < ?2 AND created_at >= ?3 ORDER BY created_at LIMIT 10")
    .bind(nowSeconds, MAX_ATTEMPTS, nowSeconds - MAX_EVENT_AGE_SECONDS)
    .all<OutboxRow>();
  let delivered = 0;
  let failed = 0;
  for (const row of due.results ?? []) {
    let status = 0;
    try {
      const body = JSON.stringify({ event_key: row.event_key, kind: row.kind, source_env: env.OTP_ENVIRONMENT ?? "unknown", occurred_at: row.created_at, stats: JSON.parse(row.payload) });
      const id = `ntf_${row.event_key.replace(/[^A-Za-z0-9_:-]/g, "")}`;
      const sent = await postSignedNotify(env, url.toString(), secret, id, nowSeconds, body, fetcher);
      if (!sent.sent) throw new Error("notify transport unusable");
      const res = sent.response;
      status = res.status;
      await res.body?.cancel().catch(() => undefined);
      if (res.ok) {
        await db.prepare("UPDATE otp_notification_outbox SET delivered_at = ?1, last_status = ?2, attempts = attempts + 1 WHERE event_key = ?3 AND delivered_at IS NULL").bind(nowSeconds, status, row.event_key).run();
        delivered += 1;
        continue;
      }
    } catch {
      status = 0;
    }
    failed += 1;
    const backoff = Math.min(HOUR_SECONDS, 60 * 2 ** Math.min(row.attempts, 6));
    await db.prepare("UPDATE otp_notification_outbox SET attempts = attempts + 1, next_attempt_at = ?1, last_status = ?2 WHERE event_key = ?3").bind(nowSeconds + backoff, status, row.event_key).run();
    console.warn(JSON.stringify({ event: "whatsapp_otp_notify_failed", kind: row.kind, status, attempts: row.attempts + 1 })); // numbers only
  }
  return { delivered, failed };
}

/** Bounded retention for the helper tables (the journal itself is purged by purgeExpiredReplayClaims in index.ts). */
export async function purgeHelperTables(db: Db, nowSeconds: number): Promise<void> {
  await db.prepare("DELETE FROM otp_admin_requests WHERE request_hash IN (SELECT request_hash FROM otp_admin_requests WHERE created_at < ?1 LIMIT 250)").bind(nowSeconds - DAY_SECONDS).run();
  await db.prepare("DELETE FROM otp_notification_outbox WHERE event_key IN (SELECT event_key FROM otp_notification_outbox WHERE delivered_at IS NOT NULL AND delivered_at < ?1 LIMIT 250)").bind(nowSeconds - 30 * DAY_SECONDS).run();
}

export type MaintenanceSummary = { purged: boolean; evaluated: boolean; delivered: number; failed: number; attested?: boolean; errors: string[] };

/** One scheduled run. Each step is wrapped separately, so a failure in one never prevents the others and never throws. */
export async function runMaintenance(
  env: NotifyEnv & { IDEMPOTENCY_DB?: unknown },
  purgeJournal: (db: Db, nowSeconds: number) => Promise<unknown>,
  fetcher: typeof fetch = fetch,
  nowMs = Date.now(),
): Promise<MaintenanceSummary> {
  const summary: MaintenanceSummary = { purged: false, evaluated: false, delivered: 0, failed: 0, errors: [] };
  const db = env.IDEMPOTENCY_DB as Db | undefined;
  if (!db) { summary.errors.push("no_db"); return summary; }
  const nowSeconds = Math.floor(nowMs / 1000);
  try { await purgeJournal(db, nowSeconds); await purgeHelperTables(db, nowSeconds); summary.purged = true; } catch { summary.errors.push("purge"); }
  try { await evaluateAlerts(db, nowSeconds); summary.evaluated = true; } catch { summary.errors.push("evaluate"); }
  try { const r = await deliverOutbox(env, db, fetcher, nowSeconds); summary.delivered = r.delivered; summary.failed = r.failed; } catch { summary.errors.push("deliver"); }
  // Independent reconciliation against the Aladdin database (signed attestation the send path requires; see attest.ts). Never throws.
  try { summary.attested = (await runAttestation(env, db, fetcher, nowSeconds)).attested; } catch { summary.errors.push("attest"); }
  if (summary.errors.length) console.warn(JSON.stringify({ event: "whatsapp_otp_maintenance_errors", steps: summary.errors }));
  return summary;
}
