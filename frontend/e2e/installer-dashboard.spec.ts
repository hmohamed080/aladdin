import { expect, test } from "@playwright/test";
import { IDENTITIES, signIn } from "./helpers/auth";

const INSTALLER = "hossam@example.test";

test.describe("installer dashboard", () => {
  test("renders the approved shell with caller-scoped production data", async ({ page, request }) => {
    const pageErrors: string[] = [];
    const failedAssets: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 400 && /\/(?:_next|assets)\//.test(response.url())) {
        failedAssets.push(`${response.status()} ${response.url()}`);
      }
    });

    await signIn(page, request, INSTALLER, /\/home$/);

    await expect(page.getByTestId("installer-home")).toBeVisible();
    // The caller's own name in the greeting heading: visible at every width. (The
    // topbar's name label is desktop-only, so `getByText(...).first()` resolved to
    // a hidden element on phones.)
    await expect(page.getByRole("heading", { level: 1, name: /Hossam|حسام/i })).toBeVisible();
    // Navigation lives in the sidebar on desktop and in an off-canvas drawer on
    // phones, closed by default: open it where the menu button is shown, then
    // assert that a VISIBLE link to each destination exists (the other layout's
    // copy of the nav is in the DOM but hidden, so `.first()` alone is not enough).
    const menuButton = page.getByRole("button", { name: /open menu|فتح القائمة/i });
    if (await menuButton.isVisible()) await menuButton.click();
    await expect(page.locator('a[href="/home/jobs"]:visible').first()).toBeVisible();
    await expect(page.locator('a[href="/home/work"]:visible').first()).toBeVisible();
    await expect(page.locator('a[href="/home/points"]:visible').first()).toBeVisible();
    await expect(page.locator('a[href="/home/reviews"]:visible').first()).toBeVisible();

    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/96%|4\.2\s*km|Modern Floors|Marble Pro/i);
    // Batch 1A: the dashboard states only what the data proves. The seeded
    // installer has no catalogue location, so "near you" must not appear; no
    // opening is ever called "new" (nothing records what has been seen); and no
    // stock photo or zero budget may stand in for what a poster never supplied.
    expect(body).not.toMatch(/near you|بالقرب منك/i);
    expect(await page.getByTestId("installer-home").innerText()).not.toMatch(/new work opportunit|فرص عمل جديدة/i);
    expect(body).not.toMatch(/EGP\s?0(?![\d٠-٩])|(?<![\d٠-٩٬,.])0\s?EGP|(?<![\d٠-٩٬,.])٠\s?ج\.م/i);
    await expect(page.locator('img[src*="/assets/installer-dashboard/jobs/"]')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
    expect(failedAssets).toEqual([]);
  });

  test("scopes the approved Installer palette to the installer shell and carries the mobile controls", async ({ page, request }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, request, INSTALLER, /\/home$/);

    await expect(page.locator(".installer-surface")).toHaveCount(1);
    await expect(page.getByTestId("installer-search-trigger")).toBeVisible();
    // The theme and language switches are reachable on a phone, not desktop-only.
    await expect(page.getByRole("button", { name: /dark|light|theme|الوضع|المظهر/i }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /language|اللغة/i }).first()).toBeVisible();
    // The notification bell stays out of production until it has a real source.
    await expect(page.getByRole("button", { name: /^notifications$|^الإشعارات$/i })).toHaveCount(0);
  });

  test("does not leak the Installer theme scope onto another persona's home", async ({ page, request }) => {
    await signIn(page, request, IDENTITIES.consumer, /\/home(\/|$|\?)/);
    await expect(page.locator(".installer-surface")).toHaveCount(0);
  });
});
