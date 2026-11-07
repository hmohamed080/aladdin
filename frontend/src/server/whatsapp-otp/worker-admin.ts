import { randomUUID } from "node:crypto";
import { signBody } from "./signing";

/**
 * The app server's signed client for the delivery Worker's admin routes (`/v1/admin/usage`, `/v1/admin/settings`). Only server code that
 * has ALREADY verified the caller's session and permission may use it. The admin secret is its own key: it is not the send secret.
 *
 * The caller learns one of three things: a usable answer, a definite refusal (nothing changed), or an AMBIGUOUS outcome (network error,
 * timeout, 5xx) in which the Worker may or may not have applied the change. That case is never reported as failed: it stays pending
 * in the Supabase ledger and is settled from the Worker's own audit record (reconcile).
 */
export type WorkerSettings = { daily_limit: number; hard_ceiling: number; warn_percent: number; critical_percent: number };
export type WorkerSettingsView = WorkerSettings & { version: number; updated_at: number; updated_by: string };
export type FailureWindow = { attempts: number; accepted: number; failed: number; failure_percent: number | null };
export type AuditEntry = { at: number; request_id: string; actor: string; kind: string; version: number; reason: string; old: WorkerSettings | null; new: WorkerSettings };

/** The persisted Super Admin delivery switch as the Worker reports it. `version` 0 = never set (no row = OFF). */
export type DeliveryState = { enabled: boolean; version: number; updated_at: number | null; updated_by: string | null };
export type DeliveryAuditEntry = { at: number; request_id: string; actor: string; old: boolean | null; new: boolean; version: number; reason: string };

export type WorkerUsage = {
  now: number;
  configured: boolean;
  settings: WorkerSettingsView | null;
  consumed: number;
  accepted: number;
  failed: number;
  reserved: number;
  remaining: number;
  effective_limit: number;
  percent: number;
  level: "ok" | "warning" | "critical" | "exhausted";
  failure: { last_hour: FailureWindow; last_24h: FailureWindow; last_7d: FailureWindow; last_failure_at: number | null };
  notifications: { pending: number; oldest_pending_at: number | null };
  audit: AuditEntry[];
  /** Absent on a Worker that predates the switch: treated as OFF and not switchable. */
  delivery?: DeliveryState;
  delivery_audit?: DeliveryAuditEntry[];
  /** The switch row is not accounted for by any audit row (a direct D1 write); null when consistent. */
  delivery_drift?: { version: number; at: number } | null;
  /** Non-secret facts about the Worker itself (which switches and bindings exist). Absent on an older Worker. */
  runtime?: Record<string, string | number | boolean>;
};

export type WorkerAdminConfig = { workerUrl: string | undefined; adminSecret: string | undefined; fetchImpl?: typeof fetch; timeoutMs?: number; now?: () => number };

export type UsageResult = { ok: true; usage: WorkerUsage } | { ok: false; code: "unconfigured" | "unavailable" };

export type SettingsPayload = {
  request_id: string;
  actor_id: string;
  expected_version: number;
  daily_limit: number;
  hard_ceiling: number;
  warn_percent: number;
  critical_percent: number;
  reason: string;
  ceiling_confirmation?: string;
  ceiling_authorized: boolean;
  /** The database-issued authorization for exactly this request (base64 HMAC) and its expiry. The app server cannot mint one. */
  grant: string;
  grant_expires: number;
};

export type DeliveryPayload = {
  request_id: string;
  actor_id: string;
  expected_version: number;
  enabled: boolean;
  reason: string;
  /** The database-issued authorization for exactly this request ("v1d" grant). The app server cannot mint one. */
  grant: string;
  grant_expires: number;
};

export type ApplyOutcome =
  | { kind: "applied"; version: number }
  | { kind: "refused"; code: string; currentVersion?: number; missing?: string }
  | { kind: "ambiguous" };

/** The Worker admin base is the ORIGIN of the configured send URL: the same Worker, a different (separately signed) path. */
export function adminBase(workerUrl: string | undefined): URL | null {
  if (!workerUrl) return null;
  try {
    const u = new URL(workerUrl);
    const local = ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname);
    if (u.protocol !== "https:" && !(local && u.protocol === "http:")) return null;
    return new URL(u.origin);
  } catch {
    return null;
  }
}

async function post(config: WorkerAdminConfig, path: string, requestId: string, body: string): Promise<Response | null> {
  const base = adminBase(config.workerUrl);
  if (!base || !config.adminSecret) return null;
  const stamp = Math.floor((config.now?.() ?? Date.now()) / 1000);
  const id = `adm_${requestId}`;
  const signature = signBody(config.adminSecret, id, stamp, body);
  if (!signature) return null;
  return (config.fetchImpl ?? fetch)(new URL(path, base).toString(), {
    method: "POST",
    headers: { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": String(stamp), "webhook-signature": signature },
    body,
    signal: AbortSignal.timeout(config.timeoutMs ?? 8000),
    cache: "no-store",
  });
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Defensive shape check: the page never renders a field the Worker did not send in the agreed shape. */
export function parseUsage(raw: unknown): WorkerUsage | null {
  if (!raw || typeof raw !== "object") return null;
  const u = raw as Record<string, unknown>;
  if (typeof u.configured !== "boolean" || !isNum(u.consumed) || !isNum(u.remaining) || !isNum(u.percent) || typeof u.level !== "string") return null;
  if (!["ok", "warning", "critical", "exhausted"].includes(u.level)) return null;
  if (u.settings !== null) {
    const s = u.settings as Record<string, unknown> | undefined;
    if (!s || !isNum(s.daily_limit) || !isNum(s.hard_ceiling) || !isNum(s.warn_percent) || !isNum(s.critical_percent) || !isNum(s.version)) return null;
  }
  return raw as WorkerUsage;
}

export async function fetchUsage(config: WorkerAdminConfig): Promise<UsageResult> {
  if (!adminBase(config.workerUrl) || !config.adminSecret) return { ok: false, code: "unconfigured" };
  const requestId = randomUUID();
  try {
    const res = await post(config, "/v1/admin/usage", requestId, JSON.stringify({ request_id: requestId }));
    if (!res || !res.ok) return { ok: false, code: "unavailable" };
    const usage = parseUsage(await res.json());
    return usage ? { ok: true, usage } : { ok: false, code: "unavailable" };
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

async function applyChange(config: WorkerAdminConfig, path: string, payload: { request_id: string }): Promise<ApplyOutcome> {
  if (!adminBase(config.workerUrl) || !config.adminSecret) return { kind: "refused", code: "admin_unconfigured" };
  try {
    const res = await post(config, path, payload.request_id, JSON.stringify(payload));
    if (!res) return { kind: "refused", code: "admin_unconfigured" };
    const body = (await res.json().catch(() => ({}))) as { status?: string; version?: number; error?: string; current_version?: number; missing?: string };
    if (res.ok && body.status === "applied" && isNum(body.version)) return { kind: "applied", version: body.version };
    // A 4xx is the Worker's definite answer (nothing changed). 5xx and anything unreadable might have been applied: ambiguous.
    if (res.status >= 400 && res.status < 500 && typeof body.error === "string" && /^[a-z_]{1,48}$/.test(body.error)) {
      return {
        kind: "refused",
        code: body.error,
        currentVersion: isNum(body.current_version) ? body.current_version : undefined,
        missing: typeof body.missing === "string" && /^[a-z0-9_,]{1,300}$/.test(body.missing) ? body.missing : undefined,
      };
    }
    return { kind: "ambiguous" };
  } catch {
    return { kind: "ambiguous" };
  }
}

export const applySettings = (config: WorkerAdminConfig, payload: SettingsPayload): Promise<ApplyOutcome> => applyChange(config, "/v1/admin/settings", payload);
export const applyDelivery = (config: WorkerAdminConfig, payload: DeliveryPayload): Promise<ApplyOutcome> => applyChange(config, "/v1/admin/delivery", payload);

export const NOTIFY_CHECK_RESULTS = ["reachable", "secret_mismatch", "blocked_by_cloudflare", "refused", "app_unconfigured", "unexpected", "unreachable", "not_configured"] as const;
export type NotifyCheckResult = (typeof NOTIFY_CHECK_RESULTS)[number];

/** Ask the Worker to prove, from ITS network position, that the app's alert endpoint is reachable (sends one signed, deliberately invalid probe). */
export async function probeNotify(config: WorkerAdminConfig): Promise<{ ok: true; result: NotifyCheckResult } | { ok: false }> {
  if (!adminBase(config.workerUrl) || !config.adminSecret) return { ok: false };
  const requestId = randomUUID();
  try {
    const res = await post(config, "/v1/admin/notify-check", requestId, JSON.stringify({ request_id: requestId }));
    if (!res || !res.ok) return { ok: false };
    const body = (await res.json().catch(() => null)) as { result?: unknown } | null;
    const result = (NOTIFY_CHECK_RESULTS as readonly unknown[]).includes(body?.result) ? (body!.result as NotifyCheckResult) : null;
    return result ? { ok: true, result } : { ok: false };
  } catch {
    return { ok: false };
  }
}
