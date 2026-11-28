import "server-only";
import type { createClient } from "@redis/client";

/**
 * The only Redis commands the application sends, behind one interface so the
 * transport can change with the host (ADR-0019 "Workers runtime"):
 *   * TCP (`@redis/client`, one multiplexed connection per warm Node instance)
 *     on Node (local development and tests);
 *   * Upstash's HTTPS REST API (plain `fetch`, one request per command) where
 *     a socket may not outlive the request that opened it (Cloudflare Workers).
 * Add a command here only when a caller needs it.
 */
export type RedisCommands = {
  get(key: string): Promise<string | null>;
  /** SET with a TTL in seconds; every key the app writes expires. */
  setEx(key: string, value: string, ttlSeconds: number): Promise<unknown>;
  del(key: string): Promise<number>;
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;
  lPush(key: string, value: string): Promise<number>;
  ping(): Promise<string>;
};

type TcpClient = ReturnType<typeof createClient>;

export function tcpCommands(client: TcpClient): RedisCommands {
  return {
    get: (key) => client.get(key),
    setEx: (key, value, ttlSeconds) => client.set(key, value, { expiration: { type: "EX", value: ttlSeconds } }),
    del: (key) => client.del(key),
    eval: (script, keys, args) => client.eval(script, { keys, arguments: args }),
    lPush: (key, value) => client.lPush(key, value),
    ping: () => client.ping(),
  };
}

/** A REST call that did not return a result. `code` names the failure without the URL or token. */
export class RestCommandError extends Error {
  constructor(readonly code: string) {
    super(`redis rest ${code}`);
  }

  /** The endpoint rejected the credentials: retrying in a moment will not help. */
  get rejectedCredentials(): boolean {
    return this.code === "rest:401" || this.code === "rest:403";
  }
}

export type RestConfig = { url: string; token: string; timeoutMs: number; fetch?: typeof fetch };

/**
 * Upstash REST: `POST <url>` with the command as a JSON array and
 * `Authorization: Bearer <token>`; the reply is `{ "result": … }` or
 * `{ "error": "…" }`. No connection, so no AUTH or SELECT is billed, and no
 * I/O object is kept between requests. Bounded by `AbortSignal.timeout`.
 */
export function restCommands(config: RestConfig): RedisCommands {
  const base = config.url.replace(/\/+$/, "");
  const call = async (command: (string | number)[]): Promise<unknown> => {
    let response: Response;
    try {
      response = await (config.fetch ?? fetch)(base, {
        method: "POST",
        headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
        body: JSON.stringify(command),
        signal: AbortSignal.timeout(config.timeoutMs),
        cache: "no-store",
      });
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      throw new RestCommandError(timedOut ? "rest:timeout" : "rest:network");
    }
    let body: unknown;
    try { body = await response.json(); } catch { body = undefined; }
    if (!response.ok) throw new RestCommandError(`rest:${response.status}`);
    if (!body || typeof body !== "object") throw new RestCommandError("rest:malformed");
    if ("error" in body) throw new RestCommandError("rest:error");
    if (!("result" in body)) throw new RestCommandError("rest:malformed");
    return body.result;
  };
  const integer = async (command: (string | number)[]): Promise<number> => {
    const result = await call(command);
    if (typeof result !== "number") throw new RestCommandError("rest:malformed");
    return result;
  };
  return {
    get: async (key) => {
      const result = await call(["GET", key]);
      if (result !== null && typeof result !== "string") throw new RestCommandError("rest:malformed");
      return result;
    },
    setEx: (key, value, ttlSeconds) => call(["SET", key, value, "EX", ttlSeconds]),
    del: (key) => integer(["DEL", key]),
    eval: (script, keys, args) => call(["EVAL", script, keys.length, ...keys, ...args]),
    lPush: (key, value) => integer(["LPUSH", key, value]),
    ping: async () => String(await call(["PING"])),
  };
}
