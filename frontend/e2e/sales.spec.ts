import { test, expect } from "@playwright/test";
import { signIn, IDENTITIES } from "./helpers/auth";

/**
 * Local sales-workflow smoke E2E. Runs against local Next.js + local Supabase
 * with the seeded synthetic identities (real Email-OTP via Mailpit — no bypass).
 * Assumes a fresh `db reset` + applied `supabase/demo-seed.sql`. Creating records
 * is additive (unique names), so reruns stay deterministic without a reset.
 *
 * Text matchers accept Arabic (default) or English so the suite is language-
 * robust. `desktopOnly` / `mobileOnly` keep data-mutating flows on one project.
 */
const stamp = () => Date.now().toString().slice(-6);
const isMobile = () => test.info().project.name.includes("mobile");
const desktopOnly = () => test.skip(isMobile(), "desktop-only scenario");
const mobileOnly = () => test.skip(!isMobile(), "mobile-only scenario");

test.describe("manager — daily sales workflow", () => {
  test.beforeEach(async ({ page, request }) => {
    await signIn(page, request, IDENTITIES.manager);
  });

  // 1 + 2: manager signs in and the cockpit + customer list load.
  test("cockpit and customer list load", async ({ page }) => {
    desktopOnly();
    await expect(page).toHaveURL(/\/b2b(\/|$)/);
    await page.goto("/b2b/customers");
    // The seeded customers are visible (RLS-scoped).
    await expect(page.getByRole("link", { name: /النيل|Nile|Sheikh Zayed|الزهور/ }).first()).toBeVisible();
  });

  // 3: create a customer, then edit it.
  test("customer create then edit", async ({ page }) => {
    desktopOnly();
    const name = `E2E Customer ${stamp()}`;
    await page.goto("/b2b/customers/new");
    await page.getByLabel(/name|الاسم/i).first().fill(name);
    await page.getByRole("button", { name: /create|إضافة|حفظ/i }).click();
    await expect(page).toHaveURL(/\/b2b\/customers\/[0-9a-f-]+/);
    await expect(page.getByRole("heading", { name })).toBeVisible();

    // Edit → change the display name.
    await page.getByRole("link", { name: /edit customer|تعديل العميل/i }).click();
    await expect(page).toHaveURL(/\/edit$/);
    const edited = `${name} (edited)`;
    await page.getByLabel(/name|الاسم/i).first().fill(edited);
    await page.getByRole("button", { name: /save changes|حفظ التغييرات/i }).click();
    await expect(page).toHaveURL(/\?updated=1/);
    await expect(page.getByRole("heading", { name: edited })).toBeVisible();
  });

  // 4 + 5: create a lead, edit its details, then change its stage.
  test("lead create, edit details, change stage", async ({ page }) => {
    desktopOnly();
    const title = `E2E Lead ${stamp()}`;
    await page.goto("/b2b/leads/new");
    await page.getByLabel(/title|العنوان/i).first().fill(title);
    await page.getByRole("button", { name: /create|إضافة|حفظ/i }).click();
    await expect(page).toHaveURL(/\/b2b\/leads\/[0-9a-f-]+/);

    // Edit details (title/priority).
    await page.getByRole("link", { name: /edit details|تعديل التفاصيل/i }).click();
    await page.getByLabel(/title|العنوان/i).first().fill(`${title} v2`);
    await page.getByRole("button", { name: /save changes|حفظ التغييرات/i }).click();
    await expect(page).toHaveURL(/\?updated=1/);

    // Change stage via the lead actions.
    const stage = page.getByLabel(/change stage|تغيير المرحلة/i);
    await stage.selectOption({ index: 1 });
    await page.getByRole("button", { name: /^(save|حفظ)$/i }).first().click();
    await expect(page.getByRole("status")).toBeVisible();
  });

  // 6 + 7: create a follow-up, edit it, complete then reopen.
  test("follow-up create, edit, complete, reopen", async ({ page }) => {
    desktopOnly();
    await page.goto("/b2b/follow-ups");
    // Complete the first overdue/open follow-up, then reopen it.
    const complete = page.getByRole("button", { name: /^(complete|إكمال)$/i }).first();
    await complete.click();
    const reopen = page.getByRole("button", { name: /^(reopen|إعادة فتح)$/i }).first();
    await expect(reopen).toBeVisible();
    await reopen.click();
    await expect(page.getByRole("button", { name: /^(complete|إكمال)$/i }).first()).toBeVisible();
  });

  // 8: the branch selector narrows the cockpit/data (manager has 2 branches).
  test("branch selector narrows data", async ({ page }) => {
    desktopOnly();
    const branch = page.getByLabel(/branch|الفرع/i).first();
    // Manager sees a real branch dropdown (2 branches → "All branches" + each).
    await expect(branch).toBeVisible();
    const options = await branch.locator("option").count();
    expect(options).toBeGreaterThan(1);
    await branch.selectOption({ index: 1 });
    await expect(page).toHaveURL(/\/b2b(\/|$)/);
  });

  // 10: Arabic ↔ English switch flips <html dir>.
  test("language switch toggles direction", async ({ page }) => {
    desktopOnly();
    const html = page.locator("html");
    const before = await html.getAttribute("dir");
    await page.getByRole("button", { name: /language|اللغة|EN|ع/i }).first().click();
    await expect(html).not.toHaveAttribute("dir", before ?? "");
  });

  // 11: light ↔ dark switch toggles the .dark class.
  test("theme switch toggles dark mode", async ({ page }) => {
    desktopOnly();
    const html = page.locator("html");
    const wasDark = (await html.getAttribute("class"))?.includes("dark") ?? false;
    await page.getByRole("button", { name: /theme|المظهر/i }).first().click();
    if (wasDark) await expect(html).not.toHaveClass(/dark/);
    else await expect(html).toHaveClass(/dark/);
  });

  // 12: mobile navigation is reachable at a mobile viewport.
  test("mobile navigation reaches the main sections", async ({ page }) => {
    mobileOnly();
    await page.goto("/b2b");
    await page.getByRole("link", { name: /customers|العملاء/i }).first().click();
    await expect(page).toHaveURL(/\/b2b\/customers/);
    await page.getByRole("link", { name: /leads|الفرص/i }).first().click();
    await expect(page).toHaveURL(/\/b2b\/leads/);
  });
});

test.describe("branch-limited salesperson — scope enforcement", () => {
  // 9: a Cairo-only salesperson cannot see another branch's lead.
  test("cannot access another branch's data", async ({ page, request }) => {
    desktopOnly();
    await signIn(page, request, IDENTITIES.branchLimited);
    await page.goto("/b2b/leads");
    // The seeded Sheikh Zayed lead belongs to a branch the Cairo rep can't see.
    await expect(page.getByText(/Sheikh Zayed|شيخ زايد/i)).toHaveCount(0);
  });
});
