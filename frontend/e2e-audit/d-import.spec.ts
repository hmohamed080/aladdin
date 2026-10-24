import { test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { OUT, admin, expect, fixtureSession, perf, scenario } from "./audit-helpers";

/** Journey D — bulk import through /b2c/seller/imports (fixture org only). */
const J = "D. Bulk import";
const fx = JSON.parse(readFileSync(`${OUT}/traces/fixtures.json`, "utf8"));
const DIR = `${OUT}/scripts/import-fixture`;
const sheetInput = (page: Page) => page.locator('input[type="file"][accept=".xlsx,.csv"]');
const imageInput = (page: Page) => page.locator('input[type="file"][accept*=".zip"]');
const productCount = async () => (await admin.from("marketplace_products").select("id", { count: "exact", head: true }).eq("seller_organization_id", fx.fixtureOrgId)).count ?? 0;

async function prepare(page: Page) {
  await page.goto("/b2c/seller/imports");
  await sheetInput(page).setInputFiles(`${DIR}/audit-5-products.csv`);
  await expect(page.getByText(/صف بيانات/)).toBeVisible();
  await page.locator("#fixed-attributes").fill("material_wallpaper=non_woven\nroll_width=530\nroll_length=10050");
  // individual files (the ZIP path is broken — see D11z)
  const fsm = await import("node:fs");
  await imageInput(page).setInputFiles(fsm.readdirSync(`${DIR}/imgs`).map((n) => `${DIR}/imgs/${n}`));
  await expect(page.getByText(/ملف ·/)).toBeVisible();
}

test.describe.serial("Journey D — bulk import", () => {
  test("D1-D3 file validation", async ({ page }) => {
    await fixtureSession(page.context(), fx.showroomUserId);
    await page.goto("/b2c/seller/imports");
    await scenario({ journey: J, id: "D1", scenario: "Invalid file type refused", role: "fixture seller", data: "not-a-sheet.txt", expected: "format error, nothing parsed" }, async () => {
      await sheetInput(page).setInputFiles(`${DIR}/not-a-sheet.txt`);
      const msg = (await page.locator('[role="alert"]').allInnerTexts()).filter(Boolean).join(" ");
      expect(msg).toMatch(/إكسل|CSV/);
      return `"${msg.slice(0, 80)}"`;
    }, page);
    await scenario({ journey: J, id: "D2", scenario: "Missing mandatory price column", role: "fixture seller", data: "missing-price.csv", expected: "every row refused; import disabled" }, async () => {
      await sheetInput(page).setInputFiles(`${DIR}/missing-price.csv`);
      await expect(page.getByText(/صف لن يُرفع/)).toBeVisible();
      await expect(page.getByRole("button", { name: /ارفع .* صف كمسودات/ })).toBeDisabled();
      return "all rows refused (price missing); import button disabled";
    }, page);
  });

  test("D4-D12 preview, dry run, import, report, idempotency", async ({ page }) => {
    await fixtureSession(page.context(), fx.showroomUserId);
    await prepare(page);
    await scenario({ journey: J, id: "D4-D9", scenario: "Preview: Arabic digits, SKU normalisation, grouping, refusals, image matching", role: "fixture seller", data: "9 data rows (7 codes, 1 duplicate) + 7 image files", expected: "4 products / 6 variant rows; 3 refused (0, abc, x); AUD IMP:2→AUD-IMP-2; images matched 6, unmatched 1" }, async () => {
      const body = await page.locator("main").innerText();
      const rejected = /(\d+|[٠-٩]+) صف لن يُرفع/.exec(body)?.[0] ?? "?";
      const images = /[^\n]*ملف ·[^\n]*/.exec(body)?.[0] ?? "?";
      const sku = await page.locator("tbody td", { hasText: "AUD-IMP-2" }).count();
      if (!sku) throw new Error("normalised SKU AUD-IMP-2 not in preview");
      return `${rejected}; ${images.trim()}; normalised SKU AUD-IMP-2 shown`;
    }, page);
    const before = await productCount();
    await scenario({ journey: J, id: "D10", scenario: "Dry run writes nothing and reports server findings", role: "fixture seller", data: "-", expected: "result card; product count unchanged" }, async () => {
      const t0 = Date.now();
      await page.getByRole("button", { name: "تجربة بدون حفظ" }).click();
      await expect(page.getByText(/^النتيجة —/)).toBeVisible({ timeout: 60_000 });
      const ms = Date.now() - t0;
      perf({ kind: "action", action: "import dry run (6 rows) end-to-end UI", ms });
      expect(await productCount()).toBe(before);
      const card = (await page.locator("text=/^النتيجة —/").locator("..").innerText()).replace(/\s+/g, " ");
      return `${ms} ms; ${card.slice(0, 160)}`;
    }, page);
    await scenario({ journey: J, id: "D11", scenario: "Import as drafts with images; progress shown; error report", role: "fixture seller", data: "-", expected: "drafts created; images pending; report download offered" }, async () => {
      await prepare(page);
      const t0 = Date.now();
      await page.getByRole("button", { name: /ارفع .* صف كمسودات/ }).click();
      const sawProgress = await page.getByRole("progressbar").first().isVisible({ timeout: 10_000 }).catch(() => false);
      await expect(page.getByText(/^النتيجة —/)).toBeVisible({ timeout: 120_000 });
      const ms = Date.now() - t0;
      perf({ kind: "action", action: "import apply (6 rows + 6 images) end-to-end UI", ms });
      const after = await productCount();
      const { data: imgs } = await admin.from("marketplace_product_images").select("status").in("product_id", (await admin.from("marketplace_products").select("id").eq("seller_organization_id", fx.fixtureOrgId).like("external_ref", "AUD-IMP%")).data!.map((x) => x.id));
      const report = await page.getByRole("button", { name: /تنزيل تقرير الأخطاء/ }).count();
      return `${ms} ms; progress bar ${sawProgress ? "shown" : "not observed"}; products +${after - before}; images ${imgs?.length} (${[...new Set(imgs?.map((i) => i.status))].join(",")}); report button ${report ? "present" : "absent"}`;
    }, page);
    await scenario({ journey: J, id: "D12", scenario: "Re-import of the same file is idempotent (no duplicates)", role: "fixture seller", data: "same file + same mapping", expected: "product count unchanged" }, async () => {
      const mid = await productCount();
      await prepare(page);
      await page.getByRole("button", { name: /ارفع .* صف كمسودات/ }).click();
      await page.waitForTimeout(5_000);
      const msg = (await page.locator('[role="alert"]').allInnerTexts()).filter(Boolean).join(" ");
      expect(await productCount()).toBe(mid);
      return `count stays ${mid}; ${msg ? `message: "${msg.slice(0, 90)}"` : "re-run completed without changes"}`;
    }, page);
    await scenario({ journey: J, id: "D13", scenario: "Imported products are drafts with stock and attributes", role: "service read", data: "AUD-IMP-*", expected: "status draft; variants; stock from file" }, async () => {
      const { data } = await admin.from("marketplace_products").select("external_ref, status, name_ar").eq("seller_organization_id", fx.fixtureOrgId).like("external_ref", "AUD-IMP%");
      expect(data!.every((p) => p.status === "draft")).toBe(true);
      const { count: vcount } = await admin.from("marketplace_product_variants").select("id", { count: "exact", head: true }).like("sku", "AUD-IMP%");
      return `${data!.length} products (${data!.map((p) => p.external_ref).join(", ")}), ${vcount} variants, all draft`;
    });
  });
});
