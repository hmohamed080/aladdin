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

const files = sources(SRC).map((path) => ({ path: relative(SRC, path), text: readFileSync(path, "utf8") }));

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

describe("Redis stays off until accepted", () => {
  it("ships disabled in .env.example and in every Workers environment", () => {
    expect(readFileSync(join(FRONTEND, ".env.example"), "utf8")).toMatch(/^REDIS_CACHE_ENABLED=false$/m);
    const wrangler = readFileSync(join(FRONTEND, "wrangler.jsonc"), "utf8");
    expect(wrangler).not.toMatch(/"REDIS_CACHE_ENABLED"\s*:\s*"true"/);
  });
});
