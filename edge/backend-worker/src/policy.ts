/**
 * Pure rules of the backend Worker (ADR-0022): which paths it serves, which
 * variables the FastAPI container may see, and which instance a request goes
 * to. No bindings and no `cloudflare:workers` import, so it is unit-tested in
 * Node like edge/media-worker.
 */

/** The public prefix FastAPI declares its routes under (backend/app/main.py `API_PREFIX`). */
export const BACKEND_PREFIX = "/api/backend";

export function isBackendPath(pathname: string): boolean {
  return pathname === BACKEND_PREFIX || pathname.startsWith(`${BACKEND_PREFIX}/`);
}

/** Environments the FastAPI settings accept (backend/app/config.py `ENVIRONMENTS`). */
const APP_ENVS = new Set(["local", "staging", "production"]);

/**
 * The only Worker variables and secrets copied into the container, by name.
 *
 * Request path only: the Supabase URL and anon key (JWT issuer, JWKS and the
 * caller-scoped `my_account_status` check), CORS origins, optional Redis (off
 * unless REDIS_CACHE_ENABLED=true; then rediss:// and REDIS_KEY_ENV are required) and
 * OpenAI. Never the service-role key, DATABASE_URL or R2 keys: nothing on a
 * request path uses them (Settings.missing_configuration), and the media jobs
 * that do run on an operator machine or the separate transcode container. A
 * value bound to the Worker but not listed here never reaches the container.
 */
export const CONTAINER_ENV_NAMES = [
  "APP_ENV",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_JWT_SECRET",
  "ALLOWED_ORIGINS",
  "REDIS_CACHE_ENABLED",
  "REDIS_URL",
  "REDIS_KEY_ENV",
  "OPENAI_API_KEY",
] as const;

/** Never copied, even if someone adds them to the list above by mistake. */
const FORBIDDEN = /SERVICE_ROLE|DATABASE_URL|^R2_|SECRET_ACCESS_KEY/;

export type ContainerEnvSource = Partial<Record<string, unknown>>;

export class ConfigurationError extends Error {}

/**
 * The container's environment. APP_ENV is required and must be a known
 * environment, so a deployed container can never fall back to `local` and skip
 * the backend's configuration checks. (The backend also treats a Cloudflare
 * container without APP_ENV as production; this is the first of two locks.)
 */
export function containerEnv(source: ContainerEnvSource): Record<string, string> {
  const appEnv = source.APP_ENV;
  if (typeof appEnv !== "string" || !APP_ENVS.has(appEnv)) {
    throw new ConfigurationError("APP_ENV must be local, staging or production");
  }
  const out: Record<string, string> = {};
  for (const name of CONTAINER_ENV_NAMES) {
    if (FORBIDDEN.test(name)) continue;
    const value = source[name];
    if (typeof value === "string" && value !== "") out[name] = value;
  }
  return out;
}

/** Instances in the pool: 1 to 8, from the BACKEND_INSTANCES variable (default 1). */
export function instanceCount(raw: unknown): number {
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 8 ? n : 1;
}

/**
 * The FastAPI app is stateless, so any instance can serve any request. A fixed
 * pool of named instances spreads load (the `getRandom` pattern of
 * @cloudflare/containers) while keeping the count, and so the cost, bounded.
 */
export function instanceName(count: number, random: () => number = Math.random): string {
  return `backend-${Math.min(count - 1, Math.floor(random() * count))}`;
}

/** Errors this Worker produces itself: JSON like FastAPI's own, never cached, no internals. */
export function serviceError(status: 404 | 503, reason: "not_found" | "unavailable"): Response {
  return Response.json({ status: reason, service: "backend" }, { status, headers: { "cache-control": "no-store" } });
}
