#!/usr/bin/env node
/**
 * Builds the app for Cloudflare Workers (OpenNext) without changing the Vercel build.
 *
 * The one source difference between the two hosts is the middleware runtime:
 *   * Vercel Services cannot host Edge output, so `src/middleware.ts` declares
 *     `runtime = "nodejs"` (the Vercel build, `next build`, is untouched).
 *   * On Workers, Node.js middleware is experimental and unsupported by OpenNext
 *     and Cloudflare; Edge middleware is the supported path. The middleware only
 *     uses WebCrypto, fetch and cookies, so it is Edge-compatible as written.
 *
 * Next.js reads `runtime` statically, so this script rewrites that one line for
 * the duration of the build and always restores the file, even on failure.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const middleware = fileURLToPath(new URL("../src/middleware.ts", import.meta.url));
const NODE = 'export const runtime = "nodejs";';
// Next.js 15 spells the Edge runtime this way inside middleware ("edge" is rejected).
const EDGE = 'export const runtime = "experimental-edge";';

const original = readFileSync(middleware, "utf8");
if (original.split(NODE).length !== 2) {
  console.error(`build-cloudflare: expected exactly one \`${NODE}\` in src/middleware.ts`);
  process.exit(1);
}

let status = 1;
try {
  writeFileSync(middleware, original.replace(NODE, EDGE));
  const result = spawnSync("pnpm", ["exec", "opennextjs-cloudflare", "build", ...process.argv.slice(2)], { stdio: "inherit" });
  status = result.status ?? 1;
} finally {
  writeFileSync(middleware, original);
}
process.exit(status);
