import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/**
 * The same E2E suite as playwright.config.ts, served by the Cloudflare Workers
 * build (OpenNext) in the real Workers runtime (workerd, `wrangler dev`)
 * instead of `next start` (ADR-0021). Isolated: the local Supabase stack only.
 *
 *   pnpm exec playwright test -c playwright.workers.config.ts [spec...]
 *
 * E2E_REUSE_SERVER=1 reuses a `wrangler dev` already serving E2E_PORT.
 */
const PORT = Number(process.env.E2E_PORT ?? 3300);
const status = Object.fromEntries(
  execFileSync("npx", ["supabase", "status", "-o", "env"], { cwd: "..", encoding: "utf8" })
    .split("\n").map((line) => /^([A-Z_]+)="?(.*?)"?$/.exec(line)).filter((m): m is RegExpExecArray => !!m).map((m) => [m[1], m[2]]),
);
if (!/^http:\/\/127\.0\.0\.1:/.test(status.API_URL ?? "")) throw new Error("The Workers E2E runs only against a local Supabase stack");

const env: Record<string, string> = {
  NEXT_PUBLIC_APP_ENV: "local",
  NEXT_PUBLIC_SUPABASE_URL: status.API_URL!,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY!,
  NEXT_PUBLIC_REALTIME_DEBUG: "1",
  SUPABASE_URL: status.API_URL!,
  SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY!,
};
// The specs read these in the test process: challenges.cloudflare.com is stubbed offline.
process.env.E2E_STUB_TURNSTILE ??= "1";
process.env.E2E_TURNSTILE_STUB ??= "1";
// Runtime variables for workerd. NEXT_PUBLIC_* are also inlined at build time from `env` below.
writeFileSync(".dev.vars", Object.entries(env).map(([key, value]) => `${key}=${value}`).join("\n") + "\n");

export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: `http://127.0.0.1:${PORT}` },
  webServer: {
    command: `pnpm cf:build && pnpm exec wrangler dev --port ${PORT} --ip 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: process.env.E2E_REUSE_SERVER === "1",
    timeout: 900_000,
    env: { ...process.env, ...env } as Record<string, string>,
  },
});
