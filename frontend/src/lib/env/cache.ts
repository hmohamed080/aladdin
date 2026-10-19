import "server-only";
import { z } from "zod";

/**
 * Server-only Redis settings (server/cache). Redis is an optional accelerator:
 * with REDIS_CACHE_ENABLED=false (the default) every caller reads Postgres
 * directly and the rate limits are counted per instance in memory instead.
 * Nothing in Redis is ever an authorization input, so turning it off changes
 * speed, never access.
 */
const optional = z.preprocess((value) => value === "" ? undefined : value, z.string().min(1).optional());

export const cacheEnvSchema = z.object({
  REDIS_CACHE_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  // redis:// or rediss:// (TLS). Holds the password, so it is a secret.
  REDIS_URL: optional,
  // Separates environments that share one Redis database (preview vs staging).
  REDIS_KEY_ENV: z.preprocess((value) => value === "" ? undefined : value, z.string().regex(/^[a-z0-9-]{1,24}$/).optional()),
  // Monthly command allowance the usage warnings measure against (Upstash Free: 500,000).
  REDIS_MONTHLY_COMMAND_BUDGET: z.coerce.number().int().positive().default(500_000),
  APP_ENV: z.enum(["local", "staging", "production"]).default("local"),
}).superRefine((env, ctx) => {
  if (!env.REDIS_CACHE_ENABLED) return;
  if (!env.REDIS_URL) {
    ctx.addIssue({ code: "custom", path: ["REDIS_URL"], message: "Required when REDIS_CACHE_ENABLED=true" });
    return;
  }
  let url: URL;
  try { url = new URL(env.REDIS_URL); } catch {
    ctx.addIssue({ code: "custom", path: ["REDIS_URL"], message: "Must be a redis:// or rediss:// URL" });
    return;
  }
  if (url.protocol !== "redis:" && url.protocol !== "rediss:") {
    ctx.addIssue({ code: "custom", path: ["REDIS_URL"], message: "Must be a redis:// or rediss:// URL" });
  }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "::1";
  if (env.APP_ENV !== "local" && url.protocol !== "rediss:" && !loopback) {
    ctx.addIssue({ code: "custom", path: ["REDIS_URL"], message: "Hosted Redis must use TLS (rediss://)" });
  }
});

export type CacheEnv = z.infer<typeof cacheEnvSchema>;

export function readCacheEnv(): CacheEnv {
  return cacheEnvSchema.parse({
    REDIS_CACHE_ENABLED: process.env.REDIS_CACHE_ENABLED,
    REDIS_URL: process.env.REDIS_URL,
    REDIS_KEY_ENV: process.env.REDIS_KEY_ENV,
    REDIS_MONTHLY_COMMAND_BUDGET: process.env.REDIS_MONTHLY_COMMAND_BUDGET || undefined,
    APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
  });
}
