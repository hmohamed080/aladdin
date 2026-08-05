import { test, expect, type Page } from "@playwright/test";
import { signIn, IDENTITIES } from "./helpers/auth";

/**
 * PRODUCTION performance measurement (Sprint 6 / 6.1, Section 6/12). Skipped unless
 * PERF=1, and MUST run against a PRODUCTION server (`next build` + `next start`,
 * never `next dev`) — point E2E_PORT at it. For the Realtime channel/duplicate
 * counts it reads the test-safe adapter, so build that server with
 * NEXT_PUBLIC_REALTIME_DEBUG=1. Captures Navigation Timing + LCP/CLS, a COLD run
 * and the MEDIAN of three warm runs, the slowest ACTUAL network request (not
 * TTFB), failed-request/console-error/page-error counts, request count and
 * transferred bytes, and the active/duplicate Realtime channel counts.
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

type Nav = { ttfb: number; dcl: number; load: number; lcp: number; cls: number; reqs: number; kb: number };

async function measure(page: Page, path: string): Promise<Nav> {
  await page.addInitScript(VITALS);
  await page.goto(path, { waitUntil: "load" });
  await page.waitForTimeout(700);
  return page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    const res = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    const bytes = res.reduce((s, r) => s + (r.transferSize || 0), 0) + (nav.transferSize || 0);
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

test("production performance — key sales routes (cold + median of 3 warm)", async ({ page, request }) => {
  test.skip(process.env.PERF !== "1", "set PERF=1 to run against a production server");
  test.setTimeout(240_000);

  // Instrument the page: failed requests, console errors, page errors, and the
  // slowest ACTUAL network request (by response duration — never TTFB).
  const failed: string[] = [];
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  let slowest = { url: "", ms: 0 };
  page.on("requestfailed", (r) => {
    // ERR_ABORTED is a navigation-cancelled in-flight request (we re-goto the same
    // route 4× per profile) — a measurement artifact, not an app failure.
    const err = r.failure()?.errorText ?? "";
    if (!err.includes("ERR_ABORTED")) failed.push(`${r.method()} ${r.url()} ${err}`);
  });
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("requestfinished", async (r) => {
    const t = r.timing();
    const dur = t.responseEnd - t.requestStart; // full request→response, not TTFB
    if (dur > slowest.ms && !r.url().startsWith("data:")) slowest = { url: r.url(), ms: Math.round(dur) };
  });

  const rows: Record<string, { cold: Nav; warm: Nav }> = {};
  async function profile(path: string) {
    const cold = await measure(page, path);
    const runs: Nav[] = [];
    for (let i = 0; i < RUNS; i++) runs.push(await measure(page, path));
    const warm: Nav = {
      ttfb: median(runs.map((r) => r.ttfb)), dcl: median(runs.map((r) => r.dcl)), load: median(runs.map((r) => r.load)),
      lcp: median(runs.map((r) => r.lcp)), cls: median(runs.map((r) => r.cls)), reqs: median(runs.map((r) => r.reqs)), kb: median(runs.map((r) => r.kb)),
    };
    rows[path] = { cold, warm };
  }

  await profile("/auth/sign-in");
  await signIn(page, request, IDENTITIES.manager);
  for (const route of ["/b2b", "/b2b/customers", "/b2b/leads", "/b2b/follow-ups"]) await profile(route);

  // Active Realtime channels + duplicates from the test-safe adapter (requires the
  // server to be built with NEXT_PUBLIC_REALTIME_DEBUG=1).
  await page.goto("/b2b", { waitUntil: "load" });
  await page.waitForTimeout(1500);
  const rtInfo = await page.evaluate(() => {
    const s = (window as unknown as { __salesRealtime?: { channels: string[]; channelCount: number } }).__salesRealtime;
    if (!s) return { present: false, channelCount: 0, duplicates: 0, channels: [] as string[] };
    const dup = s.channels.length - new Set(s.channels).size;
    return { present: true, channelCount: s.channelCount, duplicates: dup, channels: s.channels };
  });

  // Emit a compact, greppable report.
  const header = "route | cold-lcp | warm-lcp | warm-cls | warm-ttfb | warm-load | warm-reqs | warm-kb";
  const lines = Object.entries(rows).map(
    ([r, m]) => `PERF ${r} | ${m.cold.lcp} | ${m.warm.lcp} | ${m.warm.cls} | ${m.warm.ttfb} | ${m.warm.load} | ${m.warm.reqs} | ${m.warm.kb}`,
  );
  console.log("PERF " + header + "\n" + lines.join("\n"));
  console.log(`PERF slowest-request | ${slowest.ms}ms | ${slowest.url}`);
  console.log(`PERF failed-requests=${failed.length} console-errors=${consoleErrors.length} page-errors=${pageErrors.length}`);
  if (failed.length) console.log("PERF failed:\n" + failed.join("\n"));
  if (consoleErrors.length) console.log("PERF console-errors:\n" + consoleErrors.slice(0, 10).join("\n"));
  if (pageErrors.length) console.log("PERF page-errors:\n" + pageErrors.slice(0, 10).join("\n"));
  console.log(`PERF realtime channels=${rtInfo.channelCount} duplicates=${rtInfo.duplicates} adapter=${rtInfo.present} [${rtInfo.channels.join(",")}]`);

  // Guardrails (production, warm): LCP <= 2.5s, CLS <= 0.1, one channel, no dup, clean console.
  for (const [route, m] of Object.entries(rows)) {
    expect(m.warm.lcp, `${route} warm LCP`).toBeLessThanOrEqual(2500);
    expect(m.warm.cls, `${route} warm CLS`).toBeLessThanOrEqual(0.1);
  }
  expect(pageErrors, "no page errors").toEqual([]);
  if (rtInfo.present) {
    expect(rtInfo.channelCount, "exactly one active Realtime channel").toBe(1);
    expect(rtInfo.duplicates, "no duplicate Realtime channel").toBe(0);
  }
});
