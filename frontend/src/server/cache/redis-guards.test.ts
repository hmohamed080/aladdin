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
  "features/landing-brand/landing-brand-stats.server.ts": "the landing page's three platform counts (global, identical for everyone; a cache layer, the database stays the source)",
};
const ALLOWED_NAMESPACES = ["health", "jobs", "landing", "ref", "rl"];

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
      "features/landing-brand/landing-brand-stats.server.ts:setEx",
      "server/cache/rate-limit.ts:eval",
      "server/cache/reference.ts:setEx",
      "server/video/uploads.ts:lPush",
    ]);
  });
});

describe("Redis is on only where it was accepted", () => {
  it("ships disabled in .env.example and is enabled only for the production Worker", () => {
    expect(readFileSync(join(FRONTEND, ".env.example"), "utf8")).toMatch(/^REDIS_CACHE_ENABLED=false$/m);
    const wrangler = readFileSync(join(FRONTEND, "wrangler.jsonc"), "utf8");
    // Redis ran on the acceptance preview from 2026-10-24; on 2026-11-15 the owner moved it to production only
    // (key prefix `production`) so production gets the whole Free quota. Any other block keeps it off until its own approval.
    const preview = wrangler.indexOf('"preview": {');
    const production = wrangler.indexOf('"production": {');
    expect(preview).toBeGreaterThan(-1);
    expect(production).toBeGreaterThan(preview);
    const enabled = [...wrangler.matchAll(/"REDIS_CACHE_ENABLED"\s*:\s*"true"/g)].map((m) => m.index ?? 0);
    expect(enabled.length).toBe(1);
    expect(enabled[0]).toBeGreaterThan(production);
    expect(wrangler.slice(preview, production)).toMatch(/"REDIS_CACHE_ENABLED"\s*:\s*"false"/);
  });

  it("keeps the production key prefix and has no Redis address on the preview", () => {
    const wrangler = readFileSync(join(FRONTEND, "wrangler.jsonc"), "utf8");
    const production = wrangler.indexOf('"production": {');
    expect(wrangler.slice(0, production)).not.toMatch(/REDIS_REST_URL|REDIS_KEY_ENV/);
    expect(wrangler.slice(production)).toMatch(/"REDIS_KEY_ENV"\s*:\s*"production"/);
  });
});
