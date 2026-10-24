import { defineConfig, devices } from "@playwright/test";

/**
 * AUDIT harness (2026-10-15 full-system audit) — NOT the regular E2E suite.
 *
 * - Targets an already-running LOCAL production build (`next start`, default
 *   port 3200) against the isolated local Supabase stack `aladdin-marketplace`.
 * - NO globalSetup: it never truncates, resets or re-seeds anything. Every
 *   state-changing scenario creates its own `audit-` prefixed fixtures and the
 *   cleanup step records what it removed and what append-only history remains.
 * - Credentials come from gitignored local files and are never printed.
 */
const BASE_URL = process.env.AUDIT_BASE_URL ?? "http://localhost:3200";
const OUT = process.env.AUDIT_OUT ?? "../docs/qa/audits/2026-10-15-full-audit";

export default defineConfig({
  testDir: "./e2e-audit",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  outputDir: `${OUT}/traces/playwright`,
  reporter: [["list"], ["json", { outputFile: `${OUT}/traces/playwright-results.json` }]],
  use: {
    baseURL: BASE_URL,
    locale: "ar-EG",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
});
