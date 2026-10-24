import { test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { OUT, admin, uiSignIn } from "./audit-helpers";

/**
 * UI / responsive / accessibility sweep. axe-core 4.10.2 (audit tooling only,
 * injected from a local copy — not a project dependency). Widths 390 / 768 /
 * 1440, light + dark (prefers-color-scheme). Read-only page loads.
 */
const AXE = process.env.AXE_PATH!;
type Who = "anonymous" | "decore" | "admin";

async function pages(): Promise<[string, string, Who][]> {
  const { data: pub } = await admin.from("marketplace_products").select("slug").eq("status", "published").limit(1).single();
  const { data: suz } = await admin.from("marketplace_products").select("id").eq("external_ref", "106-Suzuki-518").single();
  return [
    ["home", "/", "anonymous"],
    ["marketplace", "/marketplace", "anonymous"],
    ["product", `/marketplace/products/${pub!.slug}`, "anonymous"],
    ["sign-in", "/auth/sign-in", "anonymous"],
    ["showroom-sign-up", "/showroom/sign-up", "anonymous"],
    ["b2b", "/b2b", "decore"],
    ["seller-list", "/b2c/seller/products", "decore"],
    ["seller-new", "/b2c/seller/products/new", "decore"],
    ["seller-edit", `/b2c/seller/products/${suz!.id}/edit`, "decore"],
    ["imports", "/b2c/seller/imports", "decore"],
    ["admin-sellers", "/admin/marketplace", "admin"],
    ["admin-media", "/admin/marketplace/media", "admin"],
  ];
}

async function inspect(page: Page) {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async () => {
    // @ts-expect-error axe is injected
    const r = await window.axe.run(document, { resultTypes: ["violations"], runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } });
    const violations = (r.violations as { id: string; impact: string; nodes: unknown[] }[]).map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }));
    const overflowX = document.documentElement.scrollWidth - window.innerWidth;
    const small = [...document.querySelectorAll<HTMLElement>("a[href], button, input:not([type=hidden]), select, [role=button]")].filter((e) => {
      const b = e.getBoundingClientRect();
      const visible = b.width > 0 && b.height > 0 && getComputedStyle(e).visibility !== "hidden";
      return visible && (b.width < 24 || b.height < 24);
    }).length;
    const imgsNoAlt = [...document.querySelectorAll("img")].filter((i) => !i.hasAttribute("alt")).length;
    const dir = document.documentElement.dir;
    return { violations, overflowX, smallTargets: small, imgsNoAlt, dir };
  });
}

async function ctxFor(browser: Browser, who: Who, width: number, scheme: "light" | "dark"): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 }, colorScheme: scheme, locale: "ar-EG", isMobile: width < 500, hasTouch: width < 1000 });
  if (who !== "anonymous") {
    const p = await ctx.newPage();
    await uiSignIn(p, who);
    await p.close();
  }
  return ctx;
}

test("UI / a11y sweep", async ({ browser }) => {
  test.setTimeout(1_500_000);
  const rows: Record<string, unknown>[] = [];
  const list = await pages();
  for (const width of [390, 768, 1440]) {
    for (const scheme of ["light", "dark"] as const) {
      const ctxs: Partial<Record<Who, BrowserContext>> = {};
      for (const [name, url, who] of list) {
        ctxs[who] ??= await ctxFor(browser, who, width, scheme);
        const page = await ctxs[who]!.newPage();
        const hydration: string[] = [];
        page.on("console", (m) => {
          if (/hydrat|did not match|Warning:/i.test(m.text())) hydration.push(m.text().slice(0, 120));
        });
        await page.goto(url, { waitUntil: "load" });
        await page.waitForTimeout(800);
        const r = await inspect(page);
        if (scheme === "light" && width !== 768) await page.screenshot({ path: `${OUT}/screenshots/ui-${name}-${width}.png`, fullPage: width === 390 });
        rows.push({ page: name, width, scheme, ...r, hydration: hydration.length, hydrationSample: hydration[0] ?? "" });
        await page.close();
      }
      for (const c of Object.values(ctxs)) await c!.close();
    }
  }
  writeFileSync(`${OUT}/traces/ui-a11y.json`, JSON.stringify(rows, null, 2));
});
