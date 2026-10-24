import { defineConfig, devices } from "@playwright/test";

/**
 * Image upload through the Cloudflare Workers build (OpenNext) under `wrangler dev`,
 * with the local Images binding and the local S3 stand-in for R2. Start the server
 * first (docs/architecture/cloudflare-workers-runtime-notes.md, "Reproduce"):
 *
 *   pnpm exec opennextjs-cloudflare build && pnpm exec wrangler dev --port 3320
 *
 * Nothing reaches Cloudflare, R2 or a hosted Supabase project.
 */
const PORT = Number(process.env.E2E_WORKERS_PORT ?? 3320);
const launchOptions = process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : undefined;

export default defineConfig({
  testDir: "./e2e/workers",
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 240_000,
  expect: { timeout: 15_000 },
  use: { baseURL: `http://127.0.0.1:${PORT}`, locale: "en-US", trace: "retain-on-failure" },
  projects: [{ name: "chromium-desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, launchOptions } }],
});
