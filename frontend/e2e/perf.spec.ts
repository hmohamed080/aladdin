import { test, expect, type Page } from "@playwright/test";
import { signIn, IDENTITIES } from "./helpers/auth";

/**
 * PRODUCTION performance measurement (Sprint 6, Section 12). Skipped unless
 * PERF=1, and MUST be run against a PRODUCTION server (`next build` + `next start`,
 * never `next dev`) — point E2E_PORT at it. Captures Navigation Timing + LCP/CLS +
 * resource count/transfer for the key routes, three runs each, and prints the
 * MEDIAN. Authenticated routes use the real Email-OTP session (no bypass). TBT is
 * a Lighthouse-only metric and is reported separately if a Lighthouse run is
 * available; here we report the field-style metrics Playwright can measure.
 */
const RUNS = 3;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

const VITALS = `
  window.__lcp = 0; window.__cls = 0;
  try {
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = e.startTime; })
      .observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) { if (!e.hadRecentInput) window.__cls += e.value; } })
      .observe({ type: 'layout-shift', buffered: true });
  } catch {}
`;

type M = { ttfb: number; dcl: number; load: number; lcp: number; cls: number; reqs: number; kb: number };

async function measure(page: Page, path: string): Promise<M> {
  await page.addInitScript(VITALS);
  await page.goto(path, { waitUntil: "load" });
  await page.waitForTimeout(600); // let LCP/CLS settle
  return page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    const res = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    const bytes = res.reduce((s, r) => s + (r.transferSize || 0), 0);
    return {
      ttfb: Math.round(nav.responseStart),
      dcl: Math.round(nav.domContentLoadedEventEnd),
      load: Math.round(nav.loadEventEnd),
      lcp: Math.round((window as unknown as { __lcp: number }).__lcp),
      cls: Number((window as unknown as { __cls: number }).__cls.toFixed(3)),
      reqs: res.length + 1,
      kb: Math.round(bytes / 1024),
    };
  });
}

async function profile(page: Page, path: string): Promise<M> {
  await measure(page, path); // warm
  const runs: M[] = [];
  for (let i = 0; i < RUNS; i++) runs.push(await measure(page, path));
  return {
    ttfb: median(runs.map((r) => r.ttfb)),
    dcl: median(runs.map((r) => r.dcl)),
    load: median(runs.map((r) => r.load)),
    lcp: median(runs.map((r) => r.lcp)),
    cls: median(runs.map((r) => r.cls)),
    reqs: median(runs.map((r) => r.reqs)),
    kb: median(runs.map((r) => r.kb)),
  };
}

test("production performance — key sales routes (median of 3)", async ({ page, request }) => {
  test.skip(process.env.PERF !== "1", "set PERF=1 to run against a production server");
  test.setTimeout(180_000);

  const rows: Record<string, M> = {};
  rows["/auth/sign-in"] = await profile(page, "/auth/sign-in");

  await signIn(page, request, IDENTITIES.manager);
  for (const route of ["/b2b", "/b2b/customers", "/b2b/leads", "/b2b/follow-ups"]) {
    rows[route] = await profile(page, route);
  }

  // Emit a compact, greppable table for the report.
  const header = "route | ttfb | dcl | load | lcp | cls | reqs | kb";
  const lines = Object.entries(rows).map(
    ([r, m]) => `PERF ${r} | ${m.ttfb} | ${m.dcl} | ${m.load} | ${m.lcp} | ${m.cls} | ${m.reqs} | ${m.kb}`,
  );
  console.log("PERF " + header + "\n" + lines.join("\n"));

  // Guardrails (production, warm): LCP <= 2.5s and CLS <= 0.1 on every route.
  for (const [route, m] of Object.entries(rows)) {
    expect(m.lcp, `${route} LCP`).toBeLessThanOrEqual(2500);
    expect(m.cls, `${route} CLS`).toBeLessThanOrEqual(0.1);
  }
});
