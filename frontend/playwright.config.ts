import { defineConfig, devices } from "@playwright/test";

/**
 * Local E2E for the B2B sales workflow. Runs against a LOCAL Next.js dev server
 * and a LOCAL Supabase stack using the seeded synthetic identities — never
 * production credentials, and no auth bypass (the real Email-OTP path is used,
 * reading the one-time code from the local Mailpit inbox). See
 * docs/frontend/sprint-5-sales-ui-depth.md → "Local E2E".
 *
 * Prerequisites (documented): `supabase start` + `supabase db reset` + apply
 * `supabase/demo-seed.sql`, and `frontend/.env.local` with the local anon values.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;

// Optional: point at a specific Chromium binary (e.g. the full build when the
// headless-shell download is unavailable). Set PW_CHROMIUM to override.
const executablePath = process.env.PW_CHROMIUM || undefined;
const launchOptions = executablePath ? { executablePath } : undefined;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    locale: "en-US",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium-desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, launchOptions } },
    { name: "chromium-mobile", use: { ...devices["Pixel 5"], launchOptions } },
  ],
  webServer: {
    command: `pnpm exec next dev --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // Enable the test-safe Realtime lifecycle adapter (window.__salesRealtime) so
    // the scoped-realtime E2E can assert channel scope/teardown/refresh. This flag
    // is a dev/E2E concern only — a production build never sets it.
    env: { ...process.env, NEXT_PUBLIC_REALTIME_DEBUG: "1" },
  },
});
