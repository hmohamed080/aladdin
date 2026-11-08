import type { UsageResult, WorkerUsage } from "@/server/whatsapp-otp/worker-admin";

/**
 * Fail-closed, GLOBAL "can a code be delivered right now?" signal for the mobile sign-up path.
 *
 * Why: the sign-up reply is independent of delivery by design (anti-enumeration), so without this gate an outage of the sending service
 * (Super Admin kill switch OFF, budget or hard ceiling reached, attestation lost) would still ask people for a code that never arrives.
 *
 * Signal: the Worker's signed `/v1/admin/usage` answer (the one the Super Admin page already reads). It is available when ALL hold:
 *   - `runtime.delivery_enabled === true`  (Worker-side EFFECTIVE switch: permit AND audited D1 switch AND attestation; see preflightReport)
 *   - `configured === true`                (budget settings exist; missing settings make the Worker send nothing)
 *   - `level !== "exhausted"` and `remaining > 0` (daily budget / ceiling not reached)
 * Anything else, an error, a timeout or an older Worker without `runtime`, is UNAVAILABLE.
 *
 * The signal never depends on a phone number (nothing number-derived is read, sent or logged), so the reply cannot become an
 * existence oracle. A definitive answer is cached per isolate for a few seconds as plain data; each request on a cache miss runs its own probe (nothing is shared
 * across requests but that value). Errors and timeouts answer UNAVAILABLE and are not cached, so recovery is immediate.
 *
 * LIMITS (full text: docs/security/PHONE_SIGNUP_R2_INTEGRATION.md, "Delivery-availability gate (sign-up)"):
 *   - The 5 s positive cache is per isolate. After the kill switch goes OFF or the budget is exhausted, mobile sign-up can keep creating
 *     challenges for up to ~5 s per isolate; the Worker then answers 503 and those challenges are invalidated (the user waits for a code
 *     that never comes). This narrows the window, it does not make it zero.
 *   - 3 s probe timeout, fail closed: a slow or failing Worker blocks MOBILE sign-up only (email is unaffected). Failures are not cached,
 *     so each mobile attempt probes again (recovery is immediate; an outage costs one probe per attempt).
 *   - It reuses PHONE_OTP_ADMIN_SECRET on the public sign-up server path; rotating that secret affects Super Admin settings and this gate.
 *   - It does not replace the budget, ceiling, rate limits or kill switch, which the Worker enforces. Outbox mode (local) counts as
 *     available, "off" as unavailable.
 *   - Not covered: per-number recipient policy, Meta-side failures after acceptance (no delivery receipts or webhooks), in-flight challenges.
 *   - Until this is live, turning delivery OFF must also set app.phone_verification_config.signup_enabled=false (PR #158 release sequence).
 */
export type DeliveryAvailability = () => Promise<boolean>;

export function usageAllowsDelivery(usage: WorkerUsage): boolean {
  if (usage.runtime?.delivery_enabled !== true) return false;
  if (usage.configured !== true) return false;
  if (usage.level === "exhausted") return false;
  return usage.remaining > 0;
}

/** Plain data only (never a promise, binding or I/O object): the one thing a caller may keep at module level across requests. */
export type DeliveryGateCache = { entry: { value: boolean; until: number } | null };
export function createDeliveryGateCache(): DeliveryGateCache {
  return { entry: null };
}

export type DeliveryGateOptions = {
  /** Resolved by the CURRENT request (its own service binding and config). Do not build the gate once and keep it across requests. */
  fetchUsage: () => Promise<UsageResult>;
  /** Shared plain-data cache. Omit for an isolated one (tests). */
  cache?: DeliveryGateCache;
  /** How long an answer is reused. Default 5 s: a kill switch takes effect for sign-up within seconds. */
  ttlMs?: number;
  /** Hard cap on one status call, so a hung Worker answers UNAVAILABLE. Default 3 s. */
  timeoutMs?: number;
  now?: () => number;
};

export function createDeliveryGate(options: DeliveryGateOptions): DeliveryAvailability {
  const ttl = options.ttlMs ?? 5_000;
  const timeout = options.timeoutMs ?? 3_000;
  const now = options.now ?? Date.now;
  // The ONLY thing shared across requests: plain data. Never a promise or an I/O object (on Workers those are bound to the request that
  // created them and can be cancelled when it ends). Only a definitive answer from the Worker is stored, never an error or a timeout.
  const store = options.cache ?? createDeliveryGateCache();

  /** One probe, entirely owned by the calling request: its own timer, its own call. definitive=false means error or timeout. */
  async function probe(): Promise<{ value: boolean; definitive: boolean }> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        options.fetchUsage(),
        new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeout); }),
      ]);
      if (result === null || !result.ok) return { value: false, definitive: false };
      return { value: usageAllowsDelivery(result.usage), definitive: true };
    } catch {
      return { value: false, definitive: false };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return async function available(): Promise<boolean> {
    const hit = store.entry;
    if (hit && hit.until > now()) return hit.value;
    const { value, definitive } = await probe();
    if (definitive) store.entry = { value, until: now() + ttl };
    return value;
  };
}
