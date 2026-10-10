import { defineConfig, devices } from "@playwright/test";

/**
 * Post-deploy SMOKE for shared staging (run by .github/workflows/deploy-staging.yml). Deliberately separate from the
 * local E2E config (`playwright.config.ts`): that one boots a local server and a global setup that talks to a local
 * database, none of which exists - or may ever be reached - from here.
 *
 * - Target: SMOKE_BASE_URL, an https URL, set explicitly. There is NO default, so it can never silently point at a
 *   local server or at the wrong environment.
 * - Credentials: SMOKE_* environment variables from the GitHub `staging` Environment. Nothing is read from a file.
 * - trace / video / screenshot are OFF on purpose: they would record the sign-in form values and authenticated
 *   pages, and this suite uploads no artifacts. A failure is reported as text (URL, status, message) only.
 * - One worker, no parallelism: each persona signs in once and its session is reused for its pages.
 * - One retry, to absorb a cold start right after promotion; a genuinely broken page fails both attempts.
 */
const baseURL = process.env.SMOKE_BASE_URL;
// https anywhere, or http only on loopback (so the spec itself can be verified against a local build).
if (!baseURL || !/^(https:\/\/|http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$))/.test(baseURL)) {
  throw new Error("SMOKE_BASE_URL must be set to the https:// URL of the staging deployment (no default).");
}

export default defineConfig({
  testDir: "./e2e-staging",
  testMatch: /staging-smoke\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 1,
  forbidOnly: true,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    locale: "en-US",
    trace: "off",
    video: "off",
    screenshot: "off",
  },
});
