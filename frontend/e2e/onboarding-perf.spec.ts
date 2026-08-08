import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { messageIdsFor, readNewOtp } from "./helpers/auth";

/**
 * PRODUCTION performance for the shared-onboarding routes (Sprint 7.3, Section 12).
 * Skipped unless PERF=1, and MUST run against a PRODUCTION server (`next build` +
 * `next start`). Registers one fresh user via the real Email-OTP path, then walks
 * the steps, measuring each route: cold + median of 3 warm loads, request count,
 * transferred bytes, plus failed-request / console-error / page-error counts.
 */
const RUNS = 3;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

const VITALS = `
  window.__lcp = 0;
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = e.startTime; })
      .observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {}
`;

type Nav = { ttfb: number; load: number; lcp: number; reqs: number; kb: number };

async function measure(page: Page, path: string): Promise<Nav> {
  await page.addInitScript(VITALS);
  await page.goto(path, { waitUntil: "load" });
  await page.waitForTimeout(600);
  return page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    const res = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    const bytes = res.reduce((s, r) => s + (r.transferSize || 0), 0) + (nav.transferSize || 0);
    return {
      ttfb: Math.round(nav.responseStart),
      load: Math.round(nav.loadEventEnd),
      lcp: Math.round((window as unknown as { __lcp: number }).__lcp),
      reqs: res.length + 1,
      kb: Math.round(bytes / 1024),
    };
  });
}

async function register(page: Page, request: APIRequestContext): Promise<void> {
  const email = `perf+${Date.now()}@example.test`;
  const seen = await messageIdsFor(request, email);
  // The app is Arabic-first by default; pin English so the label selectors match.
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: "en", url: "http://127.0.0.1" }]);
  await page.goto("/auth/sign-up");
  await page.getByLabel(/email address/i).fill(email);
  await page.getByLabel(/terms of service/i).check();
  await page.getByLabel(/privacy policy/i).check();
  await page.getByLabel(/pilot release/i).check();
  await page.getByRole("button", { name: /create account/i }).click();
  await expect(page.getByText(/we sent a code/i)).toBeVisible();
  const code = await readNewOtp(request, email, seen);
  await page.getByLabel(/one-time code/i).fill(code);
  await page.getByRole("button", { name: /verify/i }).click();
  await page.waitForURL(/\/onboarding\/profile$/, { waitUntil: "commit" });
}

test("production performance — onboarding routes (cold + median of 3 warm)", async ({ page, request }) => {
  test.skip(process.env.PERF !== "1", "set PERF=1 to run against a production server");
  test.setTimeout(240_000);

  const FAVICON = /favicon\.ico/;
  const isFaviconConsole = (m: string) => /Failed to load resource.*404/i.test(m);
  const failed: string[] = [];
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const badResponses: string[] = [];
  page.on("requestfailed", (r) => {
    const err = r.failure()?.errorText ?? "";
    if (!err.includes("ERR_ABORTED")) failed.push(`${r.method()} ${r.url()} ${err}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 400 && !FAVICON.test(r.url())) badResponses.push(`${r.status()} ${r.url()}`);
  });
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => pageErrors.push(e.message));

  const rows: Record<string, { cold: Nav; warm: Nav }> = {};
  async function profile(path: string) {
    const cold = await measure(page, path);
    const runs: Nav[] = [];
    for (let i = 0; i < RUNS; i++) runs.push(await measure(page, path));
    rows[path] = {
      cold,
      warm: {
        ttfb: median(runs.map((r) => r.ttfb)), load: median(runs.map((r) => r.load)),
        lcp: median(runs.map((r) => r.lcp)), reqs: median(runs.map((r) => r.reqs)), kb: median(runs.map((r) => r.kb)),
      },
    };
  }

  // Fresh user at the profile step. Measure /onboarding (redirects to the current
  // step) and each step route, advancing the state between measurements.
  await register(page, request);
  await profile("/onboarding");
  await profile("/onboarding/profile");

  await page.locator("#displayName").fill("Perf User");
  await page.getByRole("button", { name: /^continue$/i }).click();
  await page.waitForURL(/\/onboarding\/contact$/, { waitUntil: "commit" });
  await profile("/onboarding/contact");

  await page.locator("#phone").fill("01012345678");
  await page.getByRole("button", { name: /^continue$/i }).click();
  await page.waitForURL(/\/onboarding\/account-type$/, { waitUntil: "commit" });
  await profile("/onboarding/account-type");

  const header = "route | cold-lcp | warm-lcp | warm-ttfb | warm-load | warm-reqs | warm-kb";
  const lines = Object.entries(rows).map(
    ([r, m]) => `PERF ${r} | ${m.cold.lcp} | ${m.warm.lcp} | ${m.warm.ttfb} | ${m.warm.load} | ${m.warm.reqs} | ${m.warm.kb}`,
  );
  console.log("PERF " + header + "\n" + lines.join("\n"));
  const otherConsole = consoleErrors.filter((m) => !isFaviconConsole(m));
  console.log(`PERF failed-requests=${failed.length} console-errors=${consoleErrors.length} (favicon-404=${consoleErrors.length - otherConsole.length}, other=${otherConsole.length}) page-errors=${pageErrors.length} bad-responses=${badResponses.length}`);
  if (failed.length) console.log("PERF failed:\n" + failed.join("\n"));
  if (otherConsole.length) console.log("PERF other-console-errors:\n" + otherConsole.slice(0, 10).join("\n"));
  if (badResponses.length) console.log("PERF bad-responses:\n" + badResponses.slice(0, 10).join("\n"));
  if (pageErrors.length) console.log("PERF page-errors:\n" + pageErrors.slice(0, 10).join("\n"));

  for (const [route, m] of Object.entries(rows)) {
    expect(m.warm.lcp, `${route} warm LCP`).toBeLessThanOrEqual(2500);
  }
  expect(failed, "no failed requests (excluding ERR_ABORTED)").toEqual([]);
  expect(pageErrors, "no page errors").toEqual([]);
  expect(badResponses, "no non-favicon 4xx/5xx responses").toEqual([]);
  expect(otherConsole, "no console error other than the known favicon 404").toEqual([]);
});
