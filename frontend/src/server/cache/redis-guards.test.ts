import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static guards for ADR-0019's "what Redis must never hold": Redis is reachable
 * only through `withRedis`, so every caller and namespace is listed here. A new
 * one fails this test until it is reviewed against the ADR (no authorization
 * decision, no media bytes, no per-tenant data without a `t-` scope).
 */
const SRC = join(__dirname, "..", "..");
const FRONTEND = join(SRC, "..");

// File -> what it may keep in Redis.
const ALLOWED_CALLERS: Record<string, string> = {
  "server/cache/reference.ts": "reference vocabularies (identical for every signed-in caller)",
  "server/cache/rate-limit.ts": "per-user rate-limit counters",
  "server/video/uploads.ts": "video job ids pushed to the transcode wake-up list",
  "app/api/health/route.ts": "PING only",
};
const ALLOWED_NAMESPACES = ["health", "jobs", "ref", "rl"];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const files = sources(SRC).map((path) => ({ path: relative(SRC, path).split("\\").join("/"), text: readFileSync(path, "utf8") }));

describe("Redis use stays inside ADR-0019", () => {
  it("is reached only from the reviewed callers", () => {
    const callers = files
      .filter((file) => file.path !== "server/cache/redis.ts" && /\bwithRedis\s*\(/.test(file.text))
      .map((file) => file.path)
      .sort();
    expect(callers).toEqual(Object.keys(ALLOWED_CALLERS).sort());
  });

  it("uses only the reviewed namespaces", () => {
    const namespaces = new Set<string>();
    for (const file of files) {
      for (const match of file.text.matchAll(/\b(?:withRedis|cacheKey)\(\s*"([^"]+)"/g)) namespaces.add(match[1] ?? "");
    }
    expect([...namespaces].sort()).toEqual(ALLOWED_NAMESPACES);
  });

  it("is never imported by authorization, session or media-access code", () => {
    const sensitive = files.filter((file) => /^(server\/auth|server\/authorization|lib\/auth|lib\/permissions|middleware|proxy)/.test(file.path));
    for (const file of sensitive) expect(file.text, file.path).not.toMatch(/server\/cache\/(redis|reference)/);
  });

  it("never writes bytes: the only writes are JSON vocabularies, counters and job ids", () => {
    const writes = files.flatMap((file) =>
      [...file.text.matchAll(/redis\.(setEx|lPush|eval)\(/g)].map((match) => `${file.path}:${match[1] ?? ""}`));
    expect(writes.sort()).toEqual([
      "server/cache/rate-limit.ts:eval",
      "server/cache/reference.ts:setEx",
      "server/video/uploads.ts:lPush",
    ]);
  });
});

describe("Redis is on only where the owner accepted it", () => {
  it("ships disabled in .env.example and is on only in the preview and (owner-approved 2026-11-15) production environments", () => {
    expect(readFileSync(join(FRONTEND, ".env.example"), "utf8")).toMatch(/^REDIS_CACHE_ENABLED=false$/m);
    const wrangler = readFileSync(join(FRONTEND, "wrangler.jsonc"), "utf8");
    // Accepted for the acceptance preview (2026-10-24, cf-preview key prefix) and for Production (2026-11-15, ADR-0019
    // Revision 3). The top-level (default) Worker and anything outside those two environments keep it off.
    const enabled = [...wrangler.matchAll(/"REDIS_CACHE_ENABLED"\s*:\s*"true"/g)].map((m) => m.index ?? 0);
    const preview = wrangler.indexOf('"preview": {');
    const production = wrangler.indexOf('"production": {');
    expect(preview).toBeGreaterThan(-1);
    expect(production).toBeGreaterThan(preview);
    expect(enabled.length).toBe(2);
    expect(enabled.every((at) => at > preview)).toBe(true);
    // Production needs its own namespace and the REST token as a required secret (also enforced by check-cloudflare-production).
    const productionBlock = wrangler.slice(production);
    expect(productionBlock).toMatch(/"REDIS_KEY_ENV"\s*:\s*"production"/);
    expect(productionBlock).toMatch(/"required":\s*\[[^\]]*"REDIS_REST_TOKEN"/);
  });
});
