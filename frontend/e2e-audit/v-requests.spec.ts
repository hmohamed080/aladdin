import { test } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { OUT, uiSignIn } from "./audit-helpers";

/**
 * Classifies the "failed" request counts seen in the page-perf run (requestfailed
 * events + HTTP >= 400) and lists the heaviest images per public page. Read-only.
 */
const PAGES: [string, string, "anonymous" | "decore"][] = [
  ["Homepage", "/", "anonymous"],
  ["Marketplace listing", "/marketplace", "anonymous"],
  ["Sign In", "/auth/sign-in", "anonymous"],
  ["Showroom registration", "/showroom/sign-up", "anonymous"],
  ["B2B dashboard", "/b2b", "decore"],
  ["Seller product list", "/b2c/seller/products", "decore"],
];

test("request failure classification + image weight", async ({ browser }) => {
  test.setTimeout(300_000);
  const out: Record<string, unknown>[] = [];
  for (const [name, url, who] of PAGES) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ar-EG" });
    if (who !== "anonymous") {
      const p = await ctx.newPage();
      await uiSignIn(p, who);
      await p.close();
    }
    const page = await ctx.newPage();
    const failed: { url: string; why: string; type: string; prefetch: boolean }[] = [];
    page.on("requestfailed", (r) => failed.push({ url: r.url().replace(/^https?:\/\/[^/]+/, "").slice(0, 100), why: r.failure()?.errorText ?? "", type: r.resourceType(), prefetch: !!r.headers()["next-router-prefetch"] || /_rsc=/.test(r.url()) }));
    page.on("response", (r) => {
      if (r.status() >= 400) failed.push({ url: r.url().replace(/^https?:\/\/[^/]+/, "").slice(0, 100), why: `HTTP ${r.status()}`, type: r.request().resourceType(), prefetch: /_rsc=/.test(r.url()) });
    });
    await page.goto(url, { waitUntil: "load" });
    await page.waitForTimeout(1500);
    const imgs = await page.evaluate(() =>
      (performance.getEntriesByType("resource") as PerformanceResourceTiming[])
        .filter((r) => r.initiatorType === "img" || /\.(png|jpe?g|webp|avif)/.test(r.name))
        .map((r) => ({ url: r.name.replace(/^https?:\/\/[^/]+/, "").slice(0, 110), kb: Math.round(r.encodedBodySize / 1024) }))
        .sort((a, b) => b.kb - a.kb)
        .slice(0, 8),
    );
    const rendered = await page.evaluate(() =>
      [...document.querySelectorAll("img")].filter((i) => i.complete && i.naturalWidth > 0).map((i) => ({ src: i.currentSrc.replace(/^https?:\/\/[^/]+/, "").slice(0, 110), natural: `${i.naturalWidth}x${i.naturalHeight}`, shown: `${Math.round(i.getBoundingClientRect().width)}x${Math.round(i.getBoundingClientRect().height)}` })).slice(0, 20),
    );
    out.push({ page: name, failed, heaviestImages: imgs, renderedImages: rendered });
    await ctx.close();
  }
  writeFileSync(`${OUT}/traces/request-classification.json`, JSON.stringify(out, null, 2));
});

test("axe detail: seller new/edit + seller list", async ({ browser }) => {
  test.setTimeout(180_000);
  const { admin } = await import("./audit-helpers");
  const { data: suz } = await admin.from("marketplace_products").select("id").eq("external_ref", "106-Suzuki-518").single();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "ar-EG" });
  const p0 = await ctx.newPage();
  await uiSignIn(p0, "decore");
  await p0.close();
  const out: Record<string, unknown> = {};
  for (const [name, url] of [["seller-new", "/b2c/seller/products/new"], ["seller-edit", `/b2c/seller/products/${suz!.id}/edit`], ["seller-list", "/b2c/seller/products"], ["marketplace", "/marketplace"]]) {
    const page = await ctx.newPage();
    await page.goto(url!, { waitUntil: "load" });
    await page.waitForTimeout(800);
    await page.addScriptTag({ path: process.env.AXE_PATH! });
    out[name!] = await page.evaluate(async () => {
      // @ts-expect-error injected
      const r = await window.axe.run(document, { resultTypes: ["violations"], runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } });
      return (r.violations as { id: string; nodes: { target: string[]; failureSummary: string; html: string }[] }[]).map((v) => ({ id: v.id, nodes: v.nodes.slice(0, 4).map((n) => ({ target: n.target.join(" "), html: n.html.slice(0, 140), why: n.failureSummary.slice(0, 160) })) }));
    });
    await page.close();
  }
  await ctx.close();
  writeFileSync(`${OUT}/traces/axe-detail.json`, JSON.stringify(out, null, 2));
});
