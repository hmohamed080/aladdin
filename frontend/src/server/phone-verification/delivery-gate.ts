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
 */
export type DeliveryAvailability = () => Promise<boolean>;

export function usageAllowsDelivery(usage: WorkerUsage): boolean {
  if (usage.runtime?.delivery_enabled !== true) return false;
  if (usage.configured !== true) return false;
  if (usage.level === "exhausted") return false;
  return usage.remaining > 0;
}

export type DeliveryGateOptions = {
  fetchUsage: () => Promise<UsageResult>;
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
  let cached: { value: boolean; until: number } | null = null;

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
    const hit = cached;
    if (hit && hit.until > now()) return hit.value;
    const { value, definitive } = await probe();
    if (definitive) cached = { value, until: now() + ttl };
    return value;
  };
}
