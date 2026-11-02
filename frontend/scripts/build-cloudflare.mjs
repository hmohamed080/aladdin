#!/usr/bin/env node
/**
 * Builds the app for Cloudflare Workers (OpenNext) without changing the plain `next build`.
 *
 * The one source difference between the two builds is the middleware runtime:
 *   * `src/middleware.ts` declares `runtime = "nodejs"` for the plain
 *     `next build --webpack` (CI and local), which stays untouched.
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
// Next.js 15 and 16 spell the Edge runtime this way inside middleware ("edge" is rejected).
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

// Static-asset headers (Workers Static Assets `_headers`). Hashed build files never
// change, so browsers and the edge may keep them for a year.
if (status === 0) {
  writeFileSync(fileURLToPath(new URL("../.open-next/assets/_headers", import.meta.url)), [
    "/_next/static/*",
    "  Cache-Control: public, max-age=31536000, immutable",
    "",
  ].join("\n"));
}
process.exit(status);
