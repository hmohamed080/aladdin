import "server-only";
import { createHash } from "node:crypto";
import { ConnectionTimeoutError, createClient } from "@redis/client";
import { readCacheEnv, type CacheEnv } from "@/lib/env/cache";
import { RestCommandError, restCommands, tcpCommands, type RedisCommands } from "./redis-commands";

export type { RedisCommands } from "./redis-commands";

/**
 * The one Redis connection for this server instance, and the key scheme every
 * cache and limiter uses.
 *
 * TRANSPORT. With REDIS_REST_URL + REDIS_REST_TOKEN set, every command is one
 * HTTPS request to Upstash's REST API (redis-commands.ts). Otherwise REDIS_URL
 * is used over TCP, as below. On Cloudflare Workers TCP is refused (Redis is
 * treated as unavailable, so the fallbacks apply): a socket opened in one
 * request cannot be used by a later one there, and @redis/client does not
 * notice; it just waits for a reply that never comes (ADR-0019, "Workers
 * runtime").
 *
 * WHAT REDIS IS HERE. An accelerator for data that is the same for every caller
 * who may read it (reference vocabularies), and a counter store for rate limits.
 * It is never an authorization input: no permission, membership, visibility or
 * session decision is read from it, and no image or video byte is written to it.
 * Access to media is decided by Postgres on every request (ADR-0018).
 *
 * FAILURE IS SILENT AND SAFE. Every call is bounded by a short command timeout;
 * repeated errors open a breaker for a few seconds so a dead Redis costs one
 * timeout, not one per request. Caches fall back to Postgres; rate limits fall
 * back to a per-instance memory window (rate-limit.ts), never to "no limit".
 *
 * COMMAND BUDGET (Upstash bills and caps per command, ADR-0019):
 *   * RESP2 with no client-info or maintenance handshake: a new connection
 *     costs one AUTH, not HELLO plus three CLIENT commands.
 *   * No PING interval and no automatic reconnect. A connection the server or
 *     the network closes is dropped and reopened only when a request needs
 *     Redis, so an idle instance spends nothing. TCP keep-alive (not a Redis
 *     command) stays on.
 *   * One multiplexed connection per warm instance, reused across invocations.
 *   * REST has no connection and so no handshake: each command is billed once.
 */

type Client = ReturnType<typeof createClient>;

const COMMAND_TIMEOUT_MS = 150;
// One HTTPS round trip from the edge to the database's region, including a TLS
// handshake when the pooled connection has lapsed; TCP's 150 ms is for a
// command on a connection that is already open.
const REST_TIMEOUT_MS = 500;
const CONNECT_TIMEOUT_MS = 1_000;
// Outer bound on connect + AUTH. Longer than the socket's own timeout because
// a cold instance's event loop can be busy loading code when the socket timer
// fires, and a connection that did succeed must not be thrown away for that.
const READY_DEADLINE_MS = 2_000;
const BREAKER_MS = 5_000;
// A connection unused for this long may have been closed while the instance
// was frozen; one failure on it is retried once on a fresh connection.
const STALE_AFTER_MS = 30_000;
const DAY_MS = 86_400_000;
// A projection from a few minutes of one instance's traffic is noise.
const PROJECTION_MIN_MS = 15 * 60_000;

type Counters = { hits: number; misses: number; sets: number; errors: number; invalidations: number; limited: number; fallback: number };
const counters = new Map<string, Counters>();
// `since` starts on first use, not at module load: on Workers the clock reads
// 0 (the epoch) while a module initialises.
const usage = { commands: 0, connects: 0, since: 0, warned: 0 };
let latencyTotalMs = 0;
let latencyCount = 0;
let breakerUntil = 0;
let consecutiveFailures = 0;
let lastUsedAt = 0;
let lastOkAt = 0;
// Set when an outage is logged, cleared by the next success: one line per outage.
let outageLogged = false;
let tcpRefusedLogged = false;

const state = globalThis as typeof globalThis & { __aladdinRedis?: Promise<Client> | null };

/** Redis could not be reached at all (refused, timed out, TLS or AUTH failed). */
class ConnectFailed extends Error {
  constructor(readonly cause: unknown) {
    super("redis connect failed");
  }

  /**
   * A timeout can be false: on a cold instance the event loop may be busy
   * loading code for longer than the timeout, and the timer then fires before
   * the (successful) connect is processed. So a timeout counts like a failed
   * command (the second in a row opens the breaker); a refusal opens it at once.
   */
  get timedOut(): boolean {
    return this.cause instanceof ConnectionTimeoutError || (this.cause instanceof Error && this.cause.message === "redis connect timeout");
  }
}

/**
 * Commands this instance has sent, and a naive monthly projection from them.
 * One warm instance's view: the fleet total is the sum over instances, so the
 * Upstash dashboard stays the source of truth for billing.
 */
export function commandUsage() {
  const { REDIS_MONTHLY_COMMAND_BUDGET: budget } = readCacheEnv();
  if (usage.since === 0) usage.since = Date.now();
  const elapsed = Date.now() - usage.since;
  const projected = elapsed >= PROJECTION_MIN_MS ? Math.round((usage.commands / elapsed) * 30 * DAY_MS) : null;
  return { commands: usage.commands, connects: usage.connects, sinceMs: elapsed, projectedMonthly: projected, monthlyBudget: budget };
}

/** Per-namespace counters for /api/health and logs. In-process: one warm instance's view. */
export function cacheMetrics() {
  return {
    namespaces: Object.fromEntries(counters),
    usage: commandUsage(),
    commandLatencyAvgMs: latencyCount ? Number((latencyTotalMs / latencyCount).toFixed(2)) : null,
    transport: redisTransport(),
    breakerOpen: Date.now() < breakerUntil,
    lastOkAgoMs: lastOkAt ? Date.now() - lastOkAt : null,
  };
}

export function count(namespace: string, field: keyof Counters, by = 1) {
  const entry = counters.get(namespace) ?? { hits: 0, misses: 0, sets: 0, errors: 0, invalidations: 0, limited: 0, fallback: 0 };
  entry[field] += by;
  counters.set(namespace, entry);
}

/** Test seam: forget the connection, counters and breaker. */
export async function resetRedisForTests() {
  const pending = state.__aladdinRedis;
  state.__aladdinRedis = null;
  counters.clear();
  Object.assign(usage, { commands: 0, connects: 0, since: Date.now(), warned: 0 });
  latencyTotalMs = 0;
  latencyCount = 0;
  breakerUntil = 0;
  consecutiveFailures = 0;
  lastUsedAt = 0;
  lastOkAt = 0;
  outageLogged = false;
  tcpRefusedLogged = false;
  if (pending) await pending.then((client) => client.destroy()).catch(() => undefined);
}

/** Test seam: pretend this instance has been counting since `since`, or last used Redis at `lastUsed`. */
export function setUsageForTests(values: { since?: number; commands?: number; lastUsed?: number }) {
  if (values.since !== undefined) usage.since = values.since;
  if (values.commands !== undefined) usage.commands = values.commands;
  if (values.lastUsed !== undefined) lastUsedAt = values.lastUsed;
  usage.warned = 0;
}

/** Test seam: the open TCP client, if any, for tests that act on the connection itself. */
export function tcpClientForTests(): Promise<Client> | null {
  return state.__aladdinRedis ?? null;
}

/** Test seam: end the breaker's pause early, as the 5 s would. */
export function closeBreakerForTests() {
  breakerUntil = 0;
}

/** Commands a fresh connection sends before the first request: AUTH, and SELECT for a non-zero database. */
function handshakeCommands(url: URL): number {
  return (url.password ? 1 : 0) + (url.pathname.length > 1 && url.pathname !== "/0" ? 1 : 0);
}

function connect(url: string): Promise<Client> {
  const client = createClient({
    url,
    RESP: 2,
    disableClientInfo: true,
    maintNotifications: "disabled",
    // Fail fast instead of queueing commands while disconnected: a cache miss
    // is cheaper than a request waiting on a reconnect.
    disableOfflineQueue: true,
    commandOptions: { timeout: COMMAND_TIMEOUT_MS },
    socket: { connectTimeout: CONNECT_TIMEOUT_MS, reconnectStrategy: false },
  });
  // Without a listener an 'error' event would crash the process. A closed
  // connection is noticed (not ready) and replaced by the next request.
  client.on("error", () => undefined);
  // The socket bounds the TCP/TLS connect; this also bounds the handshake.
  return new Promise<Client>((resolve, reject) => {
    const timer = setTimeout(() => {
      client.destroy();
      reject(new ConnectFailed(new Error("redis connect timeout")));
    }, READY_DEADLINE_MS);
    client.connect().then(() => {
      clearTimeout(timer);
      usage.connects += 1;
      usage.commands += handshakeCommands(new URL(url));
      resolve(client as Client);
    }, (error: unknown) => {
      clearTimeout(timer);
      client.destroy();
      reject(new ConnectFailed(error));
    });
  });
}

function errorCode(error: unknown): string {
  if (error instanceof RestCommandError) return error.code;
  if (error instanceof ConnectFailed) return error.timedOut ? "connect:timeout" : `connect:${errorCode(error.cause)}`;
  if (error && typeof error === "object") {
    const { code, name } = error as { code?: unknown; name?: unknown };
    if (typeof code === "string") return code;
    if (typeof name === "string") return name;
  }
  return "unknown";
}

function recordFailure(namespace: string, error: unknown) {
  count(namespace, "errors");
  consecutiveFailures += 1;
  // One failed command or connect timeout may be a single dropped connection or
  // a busy cold start; two in a row, or a refused connection, is an outage.
  const immediate = (error instanceof ConnectFailed && !error.timedOut) || (error instanceof RestCommandError && error.rejectedCredentials);
  if (consecutiveFailures < 2 && !immediate) return;
  breakerUntil = Date.now() + BREAKER_MS;
  // Logged once per outage, however often the breaker re-opens, never per request.
  if (!outageLogged) {
    outageLogged = true;
    console.warn(JSON.stringify({ event: "cache.redis_unavailable", namespace, error: errorCode(error) }));
  }
}

function checkBudget() {
  const { projectedMonthly, monthlyBudget, commands } = commandUsage();
  if (projectedMonthly === null) return;
  const level = projectedMonthly >= monthlyBudget * 0.8 ? 80 : projectedMonthly >= monthlyBudget * 0.5 ? 50 : 0;
  if (level > usage.warned) {
    usage.warned = level;
    console.warn(JSON.stringify({ event: "cache.redis_budget", thresholdPercent: level, projectedMonthly, monthlyBudget, instanceCommands: commands }));
  }
}

/** True when Redis is configured on. Says nothing about whether it is reachable. */
export function redisEnabled(): boolean {
  return readCacheEnv().REDIS_CACHE_ENABLED;
}

/** When the last successful command on this instance finished (0 = never). */
export function lastRedisSuccessAt(): number {
  return lastOkAt;
}

/** The Cloudflare Workers runtime (workerd), where no I/O object may outlive its request. */
function onWorkers(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
}

type Transport = { kind: "rest"; url: string; token: string } | { kind: "tcp"; url: string } | { kind: "none" };

function transportFor(env: CacheEnv): Transport {
  if (!env.REDIS_CACHE_ENABLED) return { kind: "none" };
  if (env.REDIS_REST_URL && env.REDIS_REST_TOKEN) return { kind: "rest", url: env.REDIS_REST_URL, token: env.REDIS_REST_TOKEN };
  if (!env.REDIS_URL) return { kind: "none" };
  if (onWorkers()) {
    // Not an outage, a configuration that cannot work here: say so once.
    if (!tcpRefusedLogged) {
      tcpRefusedLogged = true;
      console.warn(JSON.stringify({ event: "cache.redis_tcp_unsupported", runtime: "workers", fix: "set REDIS_REST_URL and REDIS_REST_TOKEN" }));
    }
    return { kind: "none" };
  }
  return { kind: "tcp", url: env.REDIS_URL };
}

/** Which transport this instance would use now (`none`: Redis off, or TCP on Workers). */
export function redisTransport(): Transport["kind"] {
  return transportFor(readCacheEnv()).kind;
}

function succeeded(started: number) {
  latencyTotalMs += performance.now() - started;
  latencyCount += 1;
  consecutiveFailures = 0;
  outageLogged = false;
  lastOkAt = Date.now();
  checkBudget();
}

/**
 * Runs `command` against Redis, or returns `undefined` when Redis is off,
 * unreachable, slow or failing. Never throws. `commands` is how many Redis
 * commands the callback sends, for the budget counter.
 */
export async function withRedis<T>(namespace: string, command: (redis: RedisCommands) => Promise<T>, commands = 1): Promise<T | undefined> {
  const transport = transportFor(readCacheEnv());
  if (transport.kind === "none") return undefined;
  if (usage.since === 0) usage.since = Date.now();
  if (Date.now() < breakerUntil) return undefined;
  if (transport.kind === "rest") {
    const started = performance.now();
    lastUsedAt = Date.now();
    try {
      usage.commands += commands;
      const result = await command(restCommands({ url: transport.url, token: transport.token, timeoutMs: REST_TIMEOUT_MS }));
      succeeded(started);
      return result;
    } catch (error) {
      recordFailure(namespace, error);
      return undefined;
    }
  }
  const { url } = transport;
  const attempt = async (): Promise<T> => {
    state.__aladdinRedis ??= connect(url).catch((error: unknown) => {
      state.__aladdinRedis = null;
      throw error;
    });
    const client = await state.__aladdinRedis;
    if (!client.isReady) {
      // Closed by the server or the network since the last request.
      void client.destroy();
      state.__aladdinRedis = null;
      return attempt();
    }
    usage.commands += commands;
    return command(tcpCommands(client));
  };
  const started = performance.now();
  const stale = lastUsedAt > 0 && Date.now() - lastUsedAt > STALE_AFTER_MS;
  lastUsedAt = Date.now();
  try {
    let result: T;
    try {
      result = await attempt();
    } catch (error) {
      if (!stale) throw error;
      // The idle connection was probably closed under us: one fresh try.
      const old = state.__aladdinRedis;
      state.__aladdinRedis = null;
      if (old) void old.then((client) => client.destroy()).catch(() => undefined);
      result = await attempt();
    }
    succeeded(started);
    return result;
  } catch (error) {
    recordFailure(namespace, error);
    return undefined;
  }
}

const SEGMENT = /^[a-z0-9_-]{1,40}$/;

/**
 * `aladdin:{env}:v1:{namespace}:{scope}:{digest}`.
 *
 * `scope` is `global` for data identical for every permitted caller, or
 * `t-<uuid>` / `u-<uuid>` for data that belongs to one tenant or one user, so a
 * tenant's entry can never be read under another tenant's key. The parameters
 * are hashed: no raw identifier, phone or email ever appears in a key.
 */
export function cacheKey(namespace: string, scope: "global" | { tenant: string } | { user: string }, ...params: string[]): string {
  if (!SEGMENT.test(namespace)) throw new Error("invalid cache namespace");
  const env = readCacheEnv();
  const environment = env.REDIS_KEY_ENV ?? env.APP_ENV;
  let scopeSegment = "global";
  if (scope !== "global") {
    const id = "tenant" in scope ? scope.tenant : scope.user;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw new Error("invalid cache scope");
    scopeSegment = `${"tenant" in scope ? "t" : "u"}-${id}`;
  }
  const digest = createHash("sha256").update(JSON.stringify(params)).digest("hex").slice(0, 32);
  return `aladdin:${environment}:v1:${namespace}:${scopeSegment}:${digest}`;
}
