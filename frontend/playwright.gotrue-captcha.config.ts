import { defineConfig } from "@playwright/test";

/**
 * Direct calls to Supabase Auth (/auth/v1), skipping the app: proves which tokens Supabase Auth's own CAPTCHA protection
 * accepts (ADR-0023). HTTP only - no browser, no app build, no global setup. Needs a local stack started with
 * scripts/ci/enable-gotrue-captcha.sh and E2E_GOTRUE_CAPTCHA set to the secret's mode (see the spec).
 */
export default defineConfig({
  testDir: "./e2e-gotrue-captcha",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 30_000,
  reporter: "list",
  outputDir: "../.artifacts/auth-captcha/gotrue-direct",
  use: { trace: "off" },
});
