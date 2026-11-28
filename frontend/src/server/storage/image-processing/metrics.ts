/**
 * Per-isolate Cloudflare Images counters for `/api/health` (no keys, no bytes).
 * The durable signal is the `media.images_*` log events in Workers Logs and the
 * Images usage page; these counters only show one warm instance at a glance.
 * Kept on globalThis: Next builds route handlers and server actions in separate
 * module layers, so a module-level counter would not be the one health reads.
 */
type Counters = { transforms: number; infoCalls: number; quotaExceeded: number; failures: number; lastQuotaExceededAt: number | null };
const KEY = Symbol.for("aladdin.image-processing.metrics");

function counters(): Counters {
  const scope = globalThis as { [KEY]?: Counters };
  return (scope[KEY] ??= { transforms: 0, infoCalls: 0, quotaExceeded: 0, failures: 0, lastQuotaExceededAt: null });
}

export function countImages(event: "transform" | "info" | "failure" | "quota"): void {
  const c = counters();
  if (event === "transform") c.transforms++;
  else if (event === "info") c.infoCalls++;
  else if (event === "failure") c.failures++;
  else { c.quotaExceeded++; c.lastQuotaExceededAt = Date.now(); }
}

export function imageProcessingMetrics() {
  const { lastQuotaExceededAt, ...rest } = counters();
  return { ...rest, lastQuotaExceededAgoMs: lastQuotaExceededAt === null ? null : Date.now() - lastQuotaExceededAt };
}

export function resetImageProcessingMetrics(): void {
  (globalThis as { [KEY]?: Counters })[KEY] = undefined;
}
