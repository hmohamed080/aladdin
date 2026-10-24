import { test, type Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { OUT, admin, expect, fixtureSession, perf } from "./audit-helpers";

/**
 * User-action timings (perceived): from the user's input to the moment the
 * new state is rendered (URL updated AND the results status text changed /
 * target element visible). Desktop, warm. N runs each; p50/p95 computed later.
 */
const N = Number(process.env.N ?? 5);
const res: Record<string, number[]> = {};
const add = (k: string, ms: number) => ((res[k] ??= []).push(ms), perf({ kind: "user-action", action: k, ms }));

async function timed(page: Page, label: string, act: () => Promise<unknown>, until: () => Promise<unknown>) {
  const t0 = Date.now();
  await act();
  await until();
  add(label, Date.now() - t0);
}

test("public marketplace actions", async ({ page }) => {
  test.setTimeout(600_000);
  const status = page.locator('[role="status"]').first();
  for (let i = 0; i < N; i++) {
    await page.goto("/marketplace");
    await expect(page.locator("main article").first()).toBeVisible();
    await timed(page, "Change product type (strip → wallpaper)", () => page.getByRole("button", { name: /ورق حائط/ }).first().click(), () => page.waitForURL(/type=wallpaper/).then(() => expect(page.getByRole("heading", { name: "ورق حائط", exact: true })).toBeVisible()));
    await timed(page, "Apply colour filter", () => page.getByRole("button", { name: /وردي/ }).first().click(), () => page.waitForURL(/f\.color=pink/).then(() => expect(page.getByRole("button", { name: /اللون: وردي/ })).toBeVisible()));
    const before = await status.innerText();
    // With a single published product the price range is min = max and the inputs are disabled: not measurable.
    if (await page.locator('input[aria-label="إلى"]').isEnabled()) await timed(page, "Apply price filter (max 1000, Enter)", async () => {
      await page.locator('input[aria-label="إلى"]').fill("1000");
      await page.locator('input[aria-label="إلى"]').press("Enter");
    }, () => page.waitForURL(/pmax=1000/).then(() => expect(status).not.toHaveText(before)));
    await timed(page, "Clear all filters", () => page.getByRole("button", { name: "مسح الكل" }).click(), () => page.waitForURL(/\/marketplace$/).then(() => expect(page.locator("main article").first()).toBeVisible()));
    await timed(page, "Change sorting (price high→low)", async () => {
      await page.getByLabel("الترتيب").first().click({ force: true }).catch(() => undefined);
      await page.getByRole("option", { name: "السعر: من الأعلى" }).click();
    }, () => page.waitForURL(/sort=price_desc/).then(() => expect(page.locator("main article").first()).toBeVisible()));
    await timed(page, "Open product details from card", () => page.locator("main article a").first().click(), () => page.waitForURL(/\/marketplace\/products\//).then(() => expect(page.locator("fieldset button").first()).toBeVisible()));
    await timed(page, "Switch variant", () => page.locator("fieldset button").nth(2).click(), () => expect(page.locator("fieldset button").nth(2)).toHaveAttribute("aria-pressed", "true"));
  }
  writeFileSync(`${OUT}/traces/actions-public.json`, JSON.stringify(res, null, 2));
});

test("import 50 rows (fixture org)", async ({ page }) => {
  test.setTimeout(600_000);
  const fx = JSON.parse(readFileSync(`${OUT}/traces/fixtures.json`, "utf8"));
  await fixtureSession(page.context(), fx.showroomUserId);
  const csv = `${OUT}/scripts/import-fixture/audit-50-products.csv`;
  const load = async () => {
    await page.goto("/b2c/seller/imports");
    await page.locator('input[type="file"][accept=".xlsx,.csv"]').setInputFiles(csv);
    await page.locator("#fixed-attributes").fill("material_wallpaper=non_woven\nroll_width=530\nroll_length=10050");
  };
  await load();
  await timed(page, "Import dry run, 50 rows (UI end-to-end)", () => page.getByRole("button", { name: "تجربة بدون حفظ" }).click(), () => expect(page.getByText(/^النتيجة —/)).toBeVisible({ timeout: 120_000 }));
  const before = (await admin.from("marketplace_products").select("id", { count: "exact", head: true }).eq("seller_organization_id", fx.fixtureOrgId)).count ?? 0;
  await load();
  await timed(page, "Import apply, 50 rows → drafts (UI end-to-end)", () => page.getByRole("button", { name: /ارفع .* صف كمسودات/ }).click(), () => expect(page.getByText(/^النتيجة —/)).toBeVisible({ timeout: 180_000 }));
  const after = (await admin.from("marketplace_products").select("id", { count: "exact", head: true }).eq("seller_organization_id", fx.fixtureOrgId)).count ?? 0;
  writeFileSync(`${OUT}/traces/actions-import50.json`, JSON.stringify({ ...res, productsCreated: after - before }, null, 2));
});
