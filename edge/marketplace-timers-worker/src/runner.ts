/**
 * Marketplace timer runner: the scheduling half. ALL logic lives in Postgres (public.marketplace_timers_run and
 * public.marketplace_checkout_sessions_purge, both service-role-only, bounded and idempotent); this code only calls them.
 *
 * Rules:
 *   - the service-role key is a Worker secret, sent only to the configured Supabase origin, never logged;
 *   - only NUMBERS are logged (counts, HTTP status): no id, no name, no response body, no error text from the server;
 *   - a failure of one call never blocks the other, and nothing is retried here (the next cron tick is the retry; the database
 *     functions are idempotent, so a double fire is safe).
 */

export interface TimersEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  APP_ENV?: string;
  TIMERS_BATCH_LIMIT?: string;
  SESSIONS_PURGE_LIMIT?: string;
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export type Logger = (line: string) => void;

export interface RunSummary {
  timers: { ok: boolean; status: number; counts: Record<string, number> | null };
  purge: { ok: boolean; status: number; purged: number | null };
}

export class ConfigError extends Error {}

const LIMIT_MIN = 1;
const LIMIT_MAX = 500;
const REQUEST_TIMEOUT_MS = 25_000;

/** A configured limit, clamped to what the database function accepts; garbage falls back to the default. */
export function clampLimit(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  if (raw === undefined || raw === "" || !Number.isInteger(n)) return fallback;
  return Math.min(Math.max(n, LIMIT_MIN), LIMIT_MAX);
}

/** The PostgREST RPC base: https only (plain http only for a local stack). Throws ConfigError with a fixed message. */
export function restBase(rawUrl: string | undefined): string {
  let url: URL;
  try {
    url = new URL(String(rawUrl));
  } catch {
    throw new ConfigError("SUPABASE_URL is missing or invalid");
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw new ConfigError("SUPABASE_URL must be https");
  return `${url.origin}/rest/v1/rpc`;
}

export function requireConfig(env: Partial<TimersEnv>): { base: string; key: string } {
  const base = restBase(env.SUPABASE_URL);
  const key = typeof env.SUPABASE_SERVICE_ROLE_KEY === "string" ? env.SUPABASE_SERVICE_ROLE_KEY.trim() : "";
  if (!key) throw new ConfigError("SUPABASE_SERVICE_ROLE_KEY is missing");
  return { base, key };
}

function isCounts(value: unknown): value is Record<string, number> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((v) => typeof v === "number" && Number.isFinite(v));
}

async function callRpc(fetcher: FetchLike, base: string, key: string, name: string, args: Record<string, number>) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(`${base}/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: key, authorization: `Bearer ${key}` },
      body: JSON.stringify(args),
      signal: controller.signal,
    });
    let data: unknown = null;
    if (response.ok) {
      try {
        data = await response.json();
      } catch {
        data = null;
      }
    }
    return { ok: response.ok, status: response.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  } finally {
    clearTimeout(timer);
  }
}

/** One cron tick: run the timers, then purge old checkout sessions. Returns numbers only. */
export async function runTick(env: Partial<TimersEnv>, fetcher: FetchLike, log: Logger = () => {}): Promise<RunSummary> {
  const { base, key } = requireConfig(env);
  const timersLimit = clampLimit(env.TIMERS_BATCH_LIMIT, 200);
  const purgeLimit = clampLimit(env.SESSIONS_PURGE_LIMIT, 200);

  const timers = await callRpc(fetcher, base, key, "marketplace_timers_run", { p_limit: timersLimit });
  const counts = timers.ok && isCounts(timers.data) ? timers.data : null;
  log(
    counts
      ? `marketplace-timers ok processed=${counts.processed ?? 0} reminders=${counts.reminders ?? 0} cancelled=${counts.cancelled ?? 0} errors=${counts.errors ?? 0}`
      : `marketplace-timers failed status=${timers.status}`,
  );

  const purge = await callRpc(fetcher, base, key, "marketplace_checkout_sessions_purge", { p_limit: purgeLimit });
  const purged = purge.ok && typeof purge.data === "number" ? purge.data : null;
  log(purged !== null ? `marketplace-sessions-purge ok purged=${purged}` : `marketplace-sessions-purge failed status=${purge.status}`);

  return {
    timers: { ok: counts !== null, status: timers.status, counts },
    purge: { ok: purged !== null, status: purge.status, purged },
  };
}
