import type { ApplyOutcome, SettingsPayload, UsageResult, WorkerUsage } from "./worker-admin";

/**
 * The orchestration of ONE Super Admin change to the WhatsApp OTP limits, with every collaborator injected so each negative path can be
 * tested without a network or a database. The order is the security design:
 *
 *   0  the caller's identity and permissions come from the VERIFIED server session (never the form)
 *   1  the CURRENT settings are read from the Worker's signed endpoint (never taken from the browser)
 *   2  optimistic concurrency: the version the admin saw must still be current
 *   3  begin (service role): the DATABASE checks the actor's effective permissions (manage, and ceiling_manage when the ceiling changes),
 *      validates, records the request and the "requested" audit event
 *   4  signed POST to the Worker: it re-validates, re-checks the version, refuses an unauthorized ceiling change, applies the change and
 *      its own audit row in one atomic D1 batch
 *   5  finish (service role): record applied / failed. An AMBIGUOUS Worker answer leaves the request pending; reconcile settles it from
 *      the Worker's authoritative audit record.
 */
export const MANAGE = "whatsapp_otp.manage";
export const CEILING_MANAGE = "whatsapp_otp.ceiling_manage";

type Rpc<T> = { data: T | null; code: string | null; message: string | null };

export type ChangeDeps = {
  fetchUsage: () => Promise<UsageResult>;
  begin: (a: { actor: string; expectedVersion: number; old: Record<string, number> | null; next: Record<string, number>; reason: string }) => Promise<Rpc<{ request_id: string; ceiling_changed: boolean }>>;
  apply: (payload: SettingsPayload) => Promise<ApplyOutcome>;
  finish: (a: { actor: string; request: string; status: "applied" | "failed"; version?: number; code?: string }) => Promise<Rpc<string>>;
};

export type ChangeInput = {
  actorId: string;
  /** The caller's effective permissions as the server loaded them for the page guard. A pre-check for clear messages; the database re-checks. */
  permissions: readonly string[];
  formVersion: number;
  dailyLimit: number;
  hardCeiling: number;
  warnPercent: number;
  criticalPercent: number;
  reason: string;
  ceilingConfirmation: string;
};

export type ChangeResult = { ok: true; code: "whatsappOtp.form.done" | "whatsappOtp.form.pending" } | { ok: false; code: string };

const fail = (key: string): ChangeResult => ({ ok: false, code: `whatsappOtp.errors.${key}` });

/** Worker refusal codes (a definite "nothing changed") to translation keys. */
const WORKER_CODE: Record<string, string> = {
  stale_version: "stale",
  no_change: "noChange",
  reason_too_short: "reasonRequired",
  ceiling_confirmation_required: "ceilingConfirmation",
  ceiling_not_authorized: "ceilingForbidden",
  invalid_values: "invalid",
  thresholds_out_of_order: "invalid",
  daily_exceeds_ceiling: "invalid",
  ceiling_below_current_limit: "ceilingBelowLimit",
  unreadable: "unavailable",
  admin_unconfigured: "unavailable",
  storage_unavailable: "unavailable",
};

/** The database's refusal (code + message) to a translation key. Messages are fixed strings raised by the RPC, never user input. */
export function mapBeginError(code: string | null, message: string | null): string {
  const m = message ?? "";
  if (code === "42501") return m.includes("ceiling_manage") ? "ceilingForbidden" : "forbidden";
  if (code === "22023") {
    if (m.includes("ceiling_below_current_limit")) return "ceilingBelowLimit";
    if (m.includes("reason_required")) return "reasonRequired";
    if (m.includes("no_change")) return "noChange";
    if (m.includes("invalid_version")) return "stale";
    return "invalid";
  }
  return "generic";
}

const isInt = (n: number) => Number.isSafeInteger(n);

export async function changeSettings(deps: ChangeDeps, input: ChangeInput): Promise<ChangeResult> {
  if (!input.permissions.includes(MANAGE)) return fail("forbidden");
  if (![input.dailyLimit, input.hardCeiling, input.warnPercent, input.criticalPercent, input.formVersion].every(isInt)) return fail("invalid");
  const reason = input.reason.trim();

  const usage = await deps.fetchUsage();
  if (!usage.ok) return fail("unavailable");
  const current = usage.usage.settings;
  const version = current?.version ?? 0;
  if (input.formVersion !== version) return fail("stale");

  const ceilingChanged = current === null || current.hard_ceiling !== input.hardCeiling;
  if (ceilingChanged) {
    if (!input.permissions.includes(CEILING_MANAGE)) return fail("ceilingForbidden");
    if (input.ceilingConfirmation.trim() !== String(input.hardCeiling)) return fail("ceilingConfirmation");
  }

  const next = { daily_limit: input.dailyLimit, hard_ceiling: input.hardCeiling, warn_percent: input.warnPercent, critical_percent: input.criticalPercent };
  const old = current ? { daily_limit: current.daily_limit, hard_ceiling: current.hard_ceiling, warn_percent: current.warn_percent, critical_percent: current.critical_percent } : null;

  const begun = await deps.begin({ actor: input.actorId, expectedVersion: version, old, next, reason });
  if (!begun.data) return fail(mapBeginError(begun.code, begun.message));
  const requestId = begun.data.request_id;

  const outcome = await deps.apply({
    request_id: requestId,
    actor_id: input.actorId,
    expected_version: version,
    ...next,
    reason,
    ...(ceilingChanged ? { ceiling_confirmation: String(input.hardCeiling) } : {}),
    // true ONLY because the database just confirmed ceiling_manage for this actor (begin refuses otherwise).
    ceiling_authorized: begun.data.ceiling_changed === true,
  });

  if (outcome.kind === "applied") {
    // If this completion write fails the request stays pending and reconcile completes it from the Worker's own record.
    await deps.finish({ actor: input.actorId, request: requestId, status: "applied", version: outcome.version }).catch(() => undefined);
    return { ok: true, code: "whatsappOtp.form.done" };
  }
  if (outcome.kind === "refused") {
    await deps.finish({ actor: input.actorId, request: requestId, status: "failed", code: /^[a-z_]{1,48}$/.test(outcome.code) ? outcome.code : "refused" }).catch(() => undefined);
    return fail(WORKER_CODE[outcome.code] ?? "generic");
  }
  return { ok: true, code: "whatsappOtp.form.pending" };
}

/** Rows of the Worker's authoritative audit that Supabase has to learn about (only changes, never the actor's input). */
export function appliedRows(usage: WorkerUsage): { request_id: string; actor: string; version: number }[] {
  return usage.audit
    .filter((a) => a.kind === "update" || a.kind === "initialize")
    .map((a) => ({ request_id: a.request_id, actor: a.actor, version: a.version }));
}
