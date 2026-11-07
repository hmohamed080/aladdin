import { MANAGE } from "./settings-change";
import type { ApplyOutcome, DeliveryPayload, UsageResult, WorkerUsage } from "./worker-admin";

/**
 * The orchestration of ONE Super Admin change of the WhatsApp OTP delivery switch, with every collaborator injected so each negative path can
 * be tested without a network or a database. The order is the security design (the same as the limits change):
 *
 *   0  identity and permission come from the VERIFIED server session (never the form); only `whatsapp_otp.manage` may switch
 *   1  the CURRENT state is read from the Worker's signed endpoint (never taken from the browser)
 *   2  optimistic concurrency: the version the admin saw must still be current
 *   3  turning ON needs every prerequisite the Worker reports (bindings, limits, environment permit, recipients); turning OFF never does
 *   4  begin (service role): the DATABASE re-checks the actor's permission, records the request and the "requested" audit event and signs a
 *      one-request grant
 *   5  signed POST to the Worker: it re-checks the grant, the prerequisites and the version, then applies the flag and its own audit row
 *      (actor, old, new, reason, time) in one atomic D1 batch
 *   6  finish (service role): record applied / failed. An AMBIGUOUS answer leaves the request pending; reconcile settles it from the
 *      Worker's authoritative audit record.
 */
type Rpc<T> = { data: T | null; code: string | null; message: string | null };

export type DeliveryDeps = {
  fetchUsage: () => Promise<UsageResult>;
  begin: (a: { actor: string; expectedVersion: number; old: boolean | null; next: boolean; reason: string }) => Promise<Rpc<{ request_id: string; reason: string; grant: string; grant_expires: number }>>;
  apply: (payload: DeliveryPayload) => Promise<ApplyOutcome>;
  finish: (a: { actor: string; request: string; status: "applied" | "failed"; version?: number; code?: string }) => Promise<Rpc<string>>;
};

export type DeliveryInput = {
  actorId: string;
  /** The caller's effective permissions as the server loaded them. A pre-check for clear messages; the database re-checks. */
  permissions: readonly string[];
  formVersion: number;
  /** The state the admin asked for. */
  enable: boolean;
  reason: string;
};

export type DeliveryResult = { ok: true; code: "whatsappOtp.delivery.doneOn" | "whatsappOtp.delivery.doneOff" | "whatsappOtp.delivery.pending" } | { ok: false; code: string };

const fail = (key: string): DeliveryResult => ({ ok: false, code: `whatsappOtp.errors.${key}` });

/** Worker refusal codes (a definite "nothing changed") to translation keys. */
const WORKER_CODE: Record<string, string> = {
  stale_version: "stale",
  no_change: "deliveryNoChange",
  reason_too_short: "reasonRequired",
  prerequisites_missing: "deliveryPrerequisites",
  unreadable: "unavailable",
  admin_unconfigured: "unavailable",
  grant_unconfigured: "unavailable",
  grant_invalid: "generic",
  storage_unavailable: "unavailable",
};

/** The database's refusal to a translation key. Messages are fixed strings raised by the RPC, never user input. */
export function mapDeliveryBeginError(code: string | null, message: string | null): string {
  const m = message ?? "";
  if (code === "55000") return "unavailable"; // no grant key yet: nothing can be authorized (fail closed)
  if (code === "42501") return "forbidden";
  if (code === "22023") {
    if (m.includes("reason_required")) return "reasonRequired";
    if (m.includes("no_change")) return "deliveryNoChange";
    if (m.includes("invalid_version")) return "stale";
    return "invalid";
  }
  return "generic";
}

/** The runtime blockers the Worker reported (comma list of codes), as an array. An older Worker without the field blocks turning ON. */
export function deliveryBlockers(usage: WorkerUsage): string[] {
  const v = usage.runtime?.delivery_blockers;
  if (typeof v !== "string") return ["worker_outdated"];
  return v === "" ? [] : v.split(",").filter((x) => /^[a-z0-9_]{1,48}$/.test(x));
}

export async function changeDelivery(deps: DeliveryDeps, input: DeliveryInput): Promise<DeliveryResult> {
  if (!input.permissions.includes(MANAGE)) return fail("forbidden");
  if (!Number.isSafeInteger(input.formVersion) || input.formVersion < 0) return fail("invalid");
  const reason = input.reason.trim();
  if (reason.length < 10 || reason.length > 500) return fail("reasonRequired");

  const usage = await deps.fetchUsage();
  if (!usage.ok) return fail("unavailable");
  const current = usage.usage.delivery;
  if (!current) return fail("unavailable"); // a Worker without the switch cannot be switched from here
  if (input.formVersion !== current.version) return fail("stale");
  if (current.enabled === input.enable) return fail("deliveryNoChange");
  if (input.enable && deliveryBlockers(usage.usage).length > 0) return fail("deliveryPrerequisites");

  const begun = await deps.begin({ actor: input.actorId, expectedVersion: current.version, old: current.version === 0 ? null : current.enabled, next: input.enable, reason });
  if (!begun.data) return fail(mapDeliveryBeginError(begun.code, begun.message));
  const requestId = begun.data.request_id;

  const outcome = await deps.apply({
    request_id: requestId,
    actor_id: input.actorId,
    expected_version: current.version,
    enabled: input.enable,
    // The reason EXACTLY as the database stored it: the grant covers its hash.
    reason: begun.data.reason,
    grant: begun.data.grant,
    grant_expires: begun.data.grant_expires,
  });

  if (outcome.kind === "applied") {
    // If this completion write fails the request stays pending and reconcile completes it from the Worker's own record.
    await deps.finish({ actor: input.actorId, request: requestId, status: "applied", version: outcome.version }).catch(() => undefined);
    return { ok: true, code: input.enable ? "whatsappOtp.delivery.doneOn" : "whatsappOtp.delivery.doneOff" };
  }
  if (outcome.kind === "refused") {
    await deps.finish({ actor: input.actorId, request: requestId, status: "failed", code: /^[a-z_]{1,48}$/.test(outcome.code) ? outcome.code : "refused" }).catch(() => undefined);
    return fail(WORKER_CODE[outcome.code] ?? "generic");
  }
  return { ok: true, code: "whatsappOtp.delivery.pending" };
}

/** Rows of the Worker's authoritative delivery audit that Supabase has to learn about. */
export function appliedDeliveryRows(usage: WorkerUsage): { request_id: string; actor: string; version: number; at: number; new: boolean }[] {
  return (usage.delivery_audit ?? []).map((a) => ({ request_id: a.request_id, actor: a.actor, version: a.version, at: a.at, new: a.new }));
}
