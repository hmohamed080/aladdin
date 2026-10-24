import { test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { OUT, admin, uiSignIn } from "./audit-helpers";

/**
 * Lab page performance against the LOCAL PRODUCTION build (`next start`).
 * Cold = browser cache disabled (CDP), cookies kept; Warm = reload with cache.
 * Mobile = Pixel-5 viewport + CDP throttling (≈Fast 4G: 150 ms RTT, 1.6 Mbps
 * down / 750 kbps up) + 4× CPU slowdown. LCP/FCP/CLS from PerformanceObserver
 * (buffered). Lab data, not field (CrUX) data. INP is not measured (no
 * scripted interaction is a valid INP sample).
 */
type Who = "anonymous" | "decore" | "admin";
const RUNS = { desktop: { cold: Number(process.env.DC ?? 5), warm: Number(process.env.DW ?? 5) }, mobile: { cold: Number(process.env.MC ?? 3), warm: Number(process.env.MW ?? 3) } };

async function targets() {
  const { data: pub } = await admin.from("marketplace_products").select("slug").eq("status", "published").limit(1).single();
  const { data: suz } = await admin.from("marketplace_products").select("id").eq("external_ref", "106-Suzuki-518").single();
  return [
    ["Homepage", "/", "anonymous"],
    ["Marketplace listing", "/marketplace", "anonymous"],
    ["Product detail", `/marketplace/products/${pub!.slug}`, "anonymous"],
    ["Sign In", "/auth/sign-in", "anonymous"],
    ["Showroom registration", "/showroom/sign-up", "anonymous"],
    ["B2B dashboard", "/b2b", "decore"],
    ["Seller product list (795)", "/b2c/seller/products", "decore"],
    ["Add product", "/b2c/seller/products/new", "decore"],
    ["Edit product (7 variants, 9 images)", `/b2c/seller/products/${suz!.id}/edit`, "decore"],
    ["Bulk import", "/b2c/seller/imports", "decore"],
    ["Admin dashboard", "/admin", "admin"],
    ["Admin seller management", "/admin/marketplace", "admin"],
    ["Admin media moderation", "/admin/marketplace/media", "admin"],
  ] as [string, string, Who][];
}

async function measure(page: Page) {
  return page.evaluate(async () => {
    const lcp = await new Promise<number>((resolve) => {
      let v = 0;
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) v = e.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
      setTimeout(() => resolve(v), 1500);
    });
    let cls = 0;
    new PerformanceObserver((l) => {
      for (const e of l.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) if (!e.hadRecentInput) cls += e.value;
    }).observe({ type: "layout-shift", buffered: true });
    await new Promise((r) => setTimeout(r, 200));
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0;
    const res = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    const js = res.filter((r) => r.initiatorType === "script" || r.name.endsWith(".js"));
    const imgs = res.filter((r) => r.initiatorType === "img");
    return {
      ttfb: nav.responseStart - nav.startTime,
      fcp,
      lcp,
      cls,
      load: nav.loadEventEnd - nav.startTime,
      docBytes: nav.transferSize,
      jsBytes: js.reduce((s, r) => s + (r.transferSize || 0), 0),
      jsDecoded: js.reduce((s, r) => s + (r.decodedBodySize || 0), 0),
      imgBytes: imgs.reduce((s, r) => s + (r.transferSize || 0), 0),
      totalBytes: nav.transferSize + res.reduce((s, r) => s + (r.transferSize || 0), 0),
      requests: res.length + 1,
    };
  });
}

async function context(browser: Browser, who: Who, mobile: boolean): Promise<BrowserContext> {
  const ctx = await browser.newContext(
    mobile
      ? { viewport: { width: 393, height: 851 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true, locale: "ar-EG" }
      : { viewport: { width: 1440, height: 900 }, locale: "ar-EG" },
  );
  if (who !== "anonymous") {
    const p = await ctx.newPage();
    await uiSignIn(p, who);
    await p.close();
  }
  return ctx;
}

test("page performance (lab)", async ({ browser }) => {
  test.setTimeout(1_800_000);
  const rows: Record<string, unknown>[] = [];
  const list = await targets();
  for (const profile of ["desktop", "mobile"] as const) {
    const ctxs: Partial<Record<Who, BrowserContext>> = {};
    for (const [name, url, who] of list) {
      ctxs[who] ??= await context(browser, who, profile === "mobile");
      const page = await ctxs[who]!.newPage();
      const cdp = await page.context().newCDPSession(page);
      if (profile === "mobile") {
        await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
      }
      let failed = 0;
      page.on("requestfailed", () => failed++);
      page.on("response", (r) => {
        if (r.status() >= 400) failed++;
      });
      for (const mode of ["cold", "warm"] as const) {
        await cdp.send("Network.setCacheDisabled", { cacheDisabled: mode === "cold" });
        for (let i = 0; i < RUNS[profile][mode]; i++) {
          failed = 0;
          try {
            await page.goto(url, { waitUntil: "load", timeout: 60_000 });
            const m = await measure(page);
            rows.push({ page: name, url: url.replace(/[0-9a-f-]{36}/, ":id"), role: who, profile, cache: mode, run: i + 1, ...m, failed });
          } catch (e) {
            rows.push({ page: name, url: url.replace(/[0-9a-f-]{36}/, ":id"), role: who, profile, cache: mode, run: i + 1, error: (e as Error).message.slice(0, 80) });
          }
        }
      }
      await page.close();
    }
    for (const c of Object.values(ctxs)) await c!.close();
  }
  writeFileSync(`${OUT}/traces/page-perf-raw.json`, JSON.stringify(rows, null, 2));
});

void readFileSync;
