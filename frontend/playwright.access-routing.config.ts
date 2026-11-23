import { defineConfig, devices } from "@playwright/test";

/**
 * Local, offline, real-Chromium regression test for the Cloudflare Access credential scoping used by the hosted Acceptance E2E
 * (e2e-access-routing/). It starts its own throwaway servers on 127.0.0.1, needs no secret and touches no hosted system.
 * trace / video / screenshot are off.
 */
export default defineConfig({
  testDir: "./e2e-access-routing",
  testMatch: /\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 60_000,
  reporter: [["list"]],
  use: { ...devices["Desktop Chrome"], trace: "off", video: "off", screenshot: "off" },
});
