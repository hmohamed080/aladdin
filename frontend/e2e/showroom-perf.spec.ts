import { test, expect, type Page } from "@playwright/test";
import { signIn, IDENTITIES } from "./helpers/auth";

/**
 * Sprint 14 Showroom route latency (acceptance measurement, not a gate).
 *
 * Skipped unless SHOWROOM_PERF=1. Run it twice — once against `next dev` and once
 * against `next build && next start` — to separate dev-only on-demand compilation
 * from real server-render cost. It reports, per route:
 *   - cold  : the FIRST visit in this process (dev = compile + render)
 *   - warm  : the MEDIAN of `RUNS` repeat visits (the real server-render cost)
 *   - soft  : in-app client navigation (App Router RSC fetch), median of `RUNS`
 * TTFB is the number that matters here: it is the time the server spent resolving
 * context + data before the first byte, which is exactly what a slow workspace
 * feels like.
 */
const RUNS = 5;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

const ROUTES = [
  "/b2b",
  "/b2b/rfqs",
  "/b2b/quotations",
  "/b2b/orders",
  "/b2b/catalog",
  "/b2b/saved",
  "/b2b/suppliers",
  "/b2b/technicians",
  "/b2b/projects",
  "/b2b/reports",
  "/b2b/settings",
] as const;

type Sample = { ttfb: number; load: number };

async function hardVisit(page: Page, path: string): Promise<Sample> {
  await page.goto(path, { waitUntil: "load" });
  return page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    return { ttfb: Math.round(nav.responseStart), load: Math.round(nav.loadEventEnd) };
  });
}

/**
 * The server cost of ONE in-app navigation. Clicking a workspace-nav link makes the
 * App Router fetch the target's RSC payload with the `RSC: 1` header; issuing that
 * exact request measures the server work a soft navigation triggers, without the
 * router's own scheduling or prefetch cache masking it. This is the number behind a
 * navigation that feels frozen.
 */
async function rscVisit(page: Page, to: string): Promise<number> {
  return page.evaluate(async (target) => {
    const started = performance.now();
    const res = await fetch(target, { headers: { RSC: "1" }, cache: "no-store" });
    await res.text();
    return Math.round(performance.now() - started);
  }, to);
}

test("showroom route latency — cold, warm and soft navigation", async ({ page, request }) => {
  test.skip(process.env.SHOWROOM_PERF !== "1", "set SHOWROOM_PERF=1 to measure");
  test.setTimeout(600_000);

  await signIn(page, request, IDENTITIES.manager);

  const rows: string[] = [];
  for (const route of ROUTES) {
    const cold = await hardVisit(page, route);
    const warm: Sample[] = [];
    for (let i = 0; i < RUNS; i++) warm.push(await hardVisit(page, route));
    const rsc: number[] = [];
    for (let i = 0; i < RUNS; i++) rsc.push(await rscVisit(page, route));
    rows.push(
      `SHOWROOM-PERF ${route} | cold-ttfb=${cold.ttfb} | warm-ttfb=${median(warm.map((w) => w.ttfb))} | warm-load=${median(warm.map((w) => w.load))} | rsc=${median(rsc)}`,
    );
    console.log(rows[rows.length - 1]!);
  }
  console.log("\n" + rows.join("\n"));
  expect(rows.length).toBe(ROUTES.length);
});
