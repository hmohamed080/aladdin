import { defineConfig } from "@playwright/test";

/**
 * The DESIGN FIDELITY harness — not a gate.
 *
 * It exists to answer one question repeatedly and cheaply: does the rendered
 * page look like `UI-UX/references/styleUpdate/dashboard.png`? That makes it the
 * opposite of `playwright.config.ts` in the two ways that matter. It points at
 * the running DEV server rather than building a production bundle, because the
 * loop here is "edit a class, look again" and a 90-second build between looks
 * turns a twenty-iteration afternoon into a two-iteration one. And it never
 * starts a server of its own — if nothing is listening on the port, that is a
 * fact worth failing on, not something to paper over with a build.
 *
 * Nothing in this file asserts anything. It captures evidence; the eye is the
 * assertion. The real E2E gate is unchanged and still runs against a production
 * build.
 */
const PORT = Number(process.env.SHOT_PORT ?? 3000);

export default defineConfig({
  testDir: ".",
  testMatch: /(shots|probe|reduced-motion).spec.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 180_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: "en-US",
    // The canonical fidelity target. Deliberately NOT the 1440x900 the E2E gate
    // uses: the reference concept is composed at 1024 tall, and the vertical
    // rhythm of the KPI strip against the panels below it is only readable at
    // the height it was composed for.
    viewport: { width: 1440, height: 1024 },
    // A device pixel ratio of 2 so the captures are legible when placed beside
    // the reference, which is itself a 2x render. At 1x the type in a 1440-wide
    // shot is too soft to judge weight or tracking against it.
    deviceScaleFactor: 2,
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : undefined,
  },
});
