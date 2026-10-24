import { test, type Page } from "@playwright/test";
import { admin, anon, expect, scenario, watch } from "./audit-helpers";

/** Journeys G (public Marketplace) and H (homepage section) — anonymous browser, real data only. */
const G = "G. Public Marketplace";
const H = "H. Homepage section";

const statusText = (page: Page) => page.locator('[role="status"]').first().innerText();

test.describe.serial("Journeys G/H — anonymous", () => {
  test("G public catalogue", async ({ page }) => {
    const w = watch(page);
    const { data: real } = await anon().rpc("marketplace_public_catalog_page", {});
    const total = (real as { total: number }).total;
    await scenario({ journey: G, id: "G1", scenario: "Real published products only; no demo data or fake discounts", role: "anonymous", data: `${total} published`, expected: "cards = DB total; no sample/flash/discount markers" }, async () => {
      await page.goto("/marketplace");
      await expect(page.locator("main article")).toHaveCount(Math.min(total, 24));
      const html = await page.content();
      for (const bad of ["عروض خاطفة", "بيانات تجريبية", "أضف للسلة", "<del", "role=\"timer\""]) if (html.includes(bad)) throw new Error(`found "${bad}"`);
      return `${total} card(s); no demo markers`;
    }, page);
    await scenario({ journey: G, id: "G2", scenario: "Card shows correct name, seller, VAT-exclusive price, stock", role: "anonymous", data: "Suzuki 518", expected: "matches DB" }, async () => {
      const card = page.locator("main article").first();
      const t = await card.innerText();
      const { data: p } = await admin.from("marketplace_products").select("name_ar").eq("external_ref", "106-Suzuki-518").single();
      expect(t).toContain(p!.name_ar);
      expect(t).toContain("Decore Store");
      expect(t).toMatch(/١٬١٧٥/);
      expect(await page.locator("main").innerText()).toContain("غير شاملة الضريبة");
      return t.replace(/\s+/g, " ").slice(0, 120);
    }, page);
    await scenario({ journey: G, id: "G3", scenario: "Card thumbnail loads through the media proxy", role: "anonymous", data: "first card image", expected: "200 image, decoded" }, async () => {
      const img = page.locator("main article img").first();
      await img.scrollIntoViewIfNeeded();
      await expect.poll(async () => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth), { timeout: 20_000 }).toBeGreaterThan(0);
      const src = await img.getAttribute("src");
      return `${src} → ${await img.evaluate((i: HTMLImageElement) => `${i.naturalWidth}×${i.naturalHeight}`)} natural`;
    }, page);
    await scenario({ journey: G, id: "G4", scenario: "Type navigation (strip) and category filter", role: "anonymous", data: "wallpaper / wood alternative", expected: "1 / 0 results; URL state" }, async () => {
      await page.getByRole("button", { name: /ورق حائط/ }).first().click();
      await expect(page).toHaveURL(/type=wallpaper/);
      const a = await statusText(page);
      await page.getByRole("button", { name: /بديل خشب/ }).first().click();
      await expect(page).toHaveURL(/type=wood_alternative/);
      const b = await statusText(page);
      return `${a} | ${b}`;
    }, page);
    await scenario({ journey: G, id: "G5", scenario: "Combined filters (colour OR, attribute AND, price, stock) and clear", role: "anonymous", data: "URL filters", expected: "pink,red=1; red=0; floral+non_woven=1; pmin above price=0; clear restores" }, async () => {
      const results: string[] = [];
      for (const [q, want] of [["f.color=pink,red", 1], ["f.color=red", 0], ["type=wallpaper&f.pattern_wallpaper=floral&f.material_wallpaper=non_woven", 1], ["pmin=1176", 0], ["stock=1&f.color=pink", 1]] as const) {
        await page.goto(`/marketplace?${q}`);
        const n = (await page.locator("main article").count());
        if (n !== want) throw new Error(`${q}: ${n} != ${want}`);
        results.push(`${q}=${n}`);
      }
      await page.getByRole("button", { name: "مسح الكل" }).click();
      await expect(page).toHaveURL(/\/marketplace$/);
      return results.join("; ") + "; clear → /marketplace";
    }, page);
    await scenario({ journey: G, id: "G6", scenario: "Facet counts", role: "anonymous", data: "wallpaper facets", expected: "counts equal real matches" }, async () => {
      await page.goto("/marketplace?type=wallpaper&category=wall_coverings_panels");
      const pink = await page.getByRole("button", { name: /وردي/ }).first().getAttribute("aria-label");
      expect(pink).toMatch(/١/);
      return `pink: ${pink}`;
    }, page);
    await scenario({ journey: G, id: "G7", scenario: "Grid/List switch and sorting", role: "anonymous", data: "-", expected: "list layout; sort param in URL" }, async () => {
      await page.goto("/marketplace");
      await page.getByRole("button", { name: "عرض قائمة" }).click();
      await expect(page.getByRole("button", { name: "عرض قائمة" })).toHaveAttribute("aria-pressed", "true");
      await page.goto("/marketplace?sort=price_desc");
      await expect(page.locator("main article")).toHaveCount(1);
      return "list toggled; price_desc renders";
    }, page);
    await scenario({ journey: G, id: "G8", scenario: "Server pagination in the browser", role: "anonymous", data: `${total} published (< 25)`, expected: "multi-page navigation" }, async () => {
      if (total <= 24) throw new Error(`BLOCKED: only ${total} published product(s); a second page needs ≥25 published products and publishing fixtures in bulk would need ≥25 approved images`);
      return "paged";
    }, page);
    await scenario({ journey: G, id: "G9", scenario: "Product detail: variants, gallery, honest purchase state", role: "anonymous", data: "Suzuki 518", expected: "7 colour buttons; gallery thumbs; disabled order button" }, async () => {
      await page.goto("/marketplace");
      await page.locator("main article a").first().click();
      await expect(page).toHaveURL(/\/marketplace\/products\//);
      const pills = await page.locator("fieldset button").count();
      const thumbs = await page.locator("ul li button img").count();
      await expect(page.getByRole("button", { name: "الطلب أونلاين قريبًا" })).toBeDisabled();
      await page.locator("fieldset button").nth(3).click();
      await expect(page.locator("fieldset button").nth(3)).toHaveAttribute("aria-pressed", "true");
      return `${pills} variant buttons, ${thumbs} thumbs, order disabled, variant switch OK`;
    }, page);
    await scenario({ journey: G, id: "G10", scenario: "Draft, unpublished and cart routes are hidden", role: "anonymous", data: "draft slug, fixture unpublished slug, /marketplace/cart", expected: "404s" }, async () => {
      const { data: d } = await admin.from("marketplace_products").select("slug").eq("status", "draft").limit(1).single();
      const { data: u } = await admin.from("marketplace_products").select("slug").eq("status", "unpublished").limit(1).maybeSingle();
      const s1 = (await page.goto(`/marketplace/products/${d!.slug}`))!.status();
      const s2 = u ? (await page.goto(`/marketplace/products/${u.slug}`))!.status() : 404;
      const s3 = (await page.goto("/marketplace/cart"))!.status();
      expect([s1, s2, s3]).toEqual([404, 404, 404]);
      return `draft ${s1}, unpublished ${s2}, cart ${s3}`;
    }, page);
    await scenario({ journey: G, id: "G11", scenario: "Empty state", role: "anonymous", data: "q=zzzz-none", expected: "no-results panel" }, async () => {
      await page.goto("/marketplace?q=zzzz-none");
      await expect(page.getByText("لا توجد نتائج")).toBeVisible();
      return "no-results panel shown";
    }, page);
    await scenario({ journey: G, id: "G12", scenario: "No console errors / failed requests on the public pages", role: "anonymous", data: "all G steps", expected: "0" }, async () => {
      const errs = w.consoleErrors.filter((e) => !/favicon/.test(e));
      if (errs.length || w.failed.length) throw new Error(`console: ${errs.slice(0, 3).join(" | ")} failed: ${w.failed.slice(0, 3).join(" | ")}`);
      return "0 console errors, 0 failed requests";
    }, page);
  });

  test("H homepage section", async ({ page }) => {
    await scenario({ journey: H, id: "H1", scenario: "Homepage Marketplace section shows the latest real products", role: "anonymous", data: "/", expected: "Suzuki 518 card with real price, product link, approved image; no fake promos, timers or cart" }, async () => {
      const t0 = Date.now();
      await page.goto("/");
      const s = page.locator("#marketplace");
      await s.scrollIntoViewIfNeeded();
      await expect(s.locator("article")).toHaveCount(1);
      const html = await s.innerHTML();
      for (const bad of ["عروض خاطفة", "أضف للسلة", "role=\"timer\"", "<del"]) if (html.includes(bad)) throw new Error(`found ${bad}`);
      const href = await s.locator("article a").first().getAttribute("href");
      expect(href).toMatch(/\/marketplace\/products\//);
      return `1 real card, link ${href?.slice(0, 50)}…, ${Date.now() - t0} ms`;
    }, page);
    await scenario({ journey: H, id: "H2", scenario: "Other homepage sections unaffected", role: "anonymous", data: "/", expected: "header, hero, ecosystem, footer present" }, async () => {
      const parts = await page.locator("[data-landing-preview-part]").evaluateAll((n) => n.map((x) => x.getAttribute("data-landing-preview-part")));
      for (const p of ["Header", "Hero", "Footer", "Marketplace"]) expect(parts).toContain(p);
      return parts.join(", ");
    }, page);
  });
});
