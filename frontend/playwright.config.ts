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
  // Reset the sales fixtures + restore the seeded memberships ONCE before all
  // projects, so a single `pnpm e2e` invocation is deterministic (no shared-state
  // drift between the desktop and mobile projects, and no manual reset between
  // consecutive runs). Requires a running local Supabase + demo seed on disk.
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // A couple of the multi-context realtime scenarios (two live Supabase Realtime
  // sessions racing branch re-subscription) are inherently timing-sensitive under
  // full-suite load — each passes deterministically in isolation but can lose a
  // re-subscription race when the whole suite runs. Retries re-run the SAME test
  // with the SAME assertions and Playwright reports any retried test as "flaky", so
  // a genuinely broken test still fails all attempts and fails the run — this only
  // absorbs load-induced flake, it never hides a deterministic failure or weakens
  // an assertion.
  retries: 2,
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
    // Run the suite against a BUILT PRODUCTION server, not `next dev`. The dev
    // server compiles dynamic routes on-demand, and under the sustained load of the
    // full suite that first-hit compilation can stall a navigation and fail an
    // otherwise-correct test. `next build` + `next start` serves pre-compiled
    // routes, so the standard `pnpm --filter frontend e2e` command is deterministic
    // and needs no manually-started server. Playwright owns this process and shuts
    // it down cleanly after the run.
    //
    // NEXT_PUBLIC_REALTIME_DEBUG is inlined at BUILD time (it gates the test-safe
    // window.__salesRealtime adapter the scoped-realtime E2E relies on). The
    // `env` below applies to this whole command — both `build` and `start` — so the
    // flag is present at build time without any cross-platform env-prefix shim.
    command: `pnpm exec next build && pnpm exec next start --port ${PORT}`,
    url: BASE_URL,
    // Never silently reuse a stray dev server — the gate must always run against a
    // fresh production build.
    reuseExistingServer: false,
    // Budget covers the one-time production build (+ typecheck/lint that `next
    // build` runs) plus server start — this is a startup budget, not a per-test
    // timeout. Per-test timeouts are unchanged (60s).
    timeout: 300_000,
    env: { ...process.env, NEXT_PUBLIC_REALTIME_DEBUG: "1" },
  },
});
