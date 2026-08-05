import { test, expect, type Page } from "@playwright/test";
import { signIn, IDENTITIES } from "./helpers/auth";

/**
 * Executed real-browser VISUAL QA (Sprint 6, Section 11). Skipped unless VQA=1.
 * Drives the matrix 4 viewports × {en,ar} × {light,dark} across the key sales
 * routes, asserting (a) no horizontal overflow of the document, (b) the <html>
 * dir matches the locale (rtl for ar), and (c) the dark class matches the theme —
 * and captures a screenshot per cell as evidence. A branch-limited pass and the
 * unauthenticated sign-in screen are covered too. This EXECUTES the QA; it does
 * not merely type-check.
 */
const VIEWPORTS = [
  { name: "mobile-360", width: 360, height: 800 },
  { name: "mobile-390", width: 390, height: 844 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1440", width: 1440, height: 900 },
];
const LOCALES = ["en", "ar"] as const;
const THEMES = ["light", "dark"] as const;

const SEED_LEAD = "1ead0001-0000-4000-8000-000000000001";
const SEED_CUST = "d0000001-0000-4000-8000-000000000001";
const SEED_SZ_LEAD = "1ead0003-0000-4000-8000-000000000003"; // Sheikh-Zayed lead (out of Cairo-rep scope)
const AUTHED_ROUTES = [
  "/b2b",
  "/b2b/customers",
  "/b2b/leads",
  `/b2b/leads/${SEED_LEAD}`,
  "/b2b/follow-ups",
  `/b2b/customers/${SEED_CUST}/edit`,
];

async function setPrefs(page: Page, locale: string, theme: string) {
  await page.context().addCookies([
    { name: "NEXT_LOCALE", value: locale, url: "http://127.0.0.1" },
    { name: "aladdin-theme", value: theme, url: "http://127.0.0.1" },
  ]);
}

async function assertNoOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${label} horizontal overflow (px)`).toBeLessThanOrEqual(1);
}

test.describe("visual QA matrix", () => {
  test.skip(process.env.VQA !== "1", "set VQA=1 to run the executed visual-QA matrix");

  test("authenticated manager — 4 viewports × en/ar × light/dark", async ({ page, request }) => {
    test.setTimeout(600_000);
    await signIn(page, request, IDENTITIES.manager);

    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const locale of LOCALES) {
        for (const theme of THEMES) {
          await setPrefs(page, locale, theme);
          for (const route of AUTHED_ROUTES) {
            await page.goto(route, { waitUntil: "networkidle" });
            const html = page.locator("html");
            await expect(html).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
            if (theme === "dark") await expect(html).toHaveClass(/dark/);
            else await expect(html).not.toHaveClass(/dark/);
            await assertNoOverflow(page, `${vp.name}/${locale}/${theme} ${route}`);
          }
          // One evidence screenshot per matrix cell (the cockpit).
          await page.goto("/b2b", { waitUntil: "networkidle" });
          await page.screenshot({
            path: `test-results/vqa/cockpit-${vp.name}-${locale}-${theme}.png`,
            fullPage: false,
          });
        }
      }
    }
  });

  test("branch-limited rep — 4 viewports × en/ar × light/dark", async ({ page, request }) => {
    test.setTimeout(600_000);
    await signIn(page, request, IDENTITIES.branchLimited);
    // The rep can create/edit within Cairo but not reassign; the seeded Cairo
    // customer/lead detail + edit are in scope.
    const repRoutes = [
      "/b2b",
      "/b2b/customers",
      `/b2b/customers/${SEED_CUST}`,
      `/b2b/customers/${SEED_CUST}/edit`,
      "/b2b/leads",
      "/b2b/follow-ups",
    ];
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const locale of LOCALES) {
        for (const theme of THEMES) {
          await setPrefs(page, locale, theme);
          for (const route of repRoutes) {
            await page.goto(route, { waitUntil: "networkidle" });
            const html = page.locator("html");
            await expect(html).toHaveAttribute("dir", locale === "ar" ? "rtl" : "ltr");
            // Assert the theme exactly as the manager matrix does.
            if (theme === "dark") await expect(html).toHaveClass(/dark/);
            else await expect(html).not.toHaveClass(/dark/);
            await assertNoOverflow(page, `rep ${vp.name}/${locale}/${theme} ${route}`);
          }
          // Out-of-scope direct URL: the Cairo rep opening a Sheikh-Zayed record
          // must get the not-found/permission state (no leaked data).
          await page.goto(`/b2b/leads/${SEED_SZ_LEAD}`, { waitUntil: "networkidle" });
          await expect(page.getByText(/not found|permission|غير موجود|صلاحية/i).first()).toBeVisible();
          await assertNoOverflow(page, `rep out-of-scope ${vp.name}/${locale}/${theme}`);
          await page.goto("/b2b", { waitUntil: "networkidle" });
          await page.screenshot({ path: `test-results/vqa/rep-cockpit-${vp.name}-${locale}-${theme}.png` });
        }
      }
    }
  });

  test("unauthenticated sign-in — 4 viewports × light/dark", async ({ page }) => {
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const theme of THEMES) {
        await setPrefs(page, "en", theme);
        await page.goto("/auth/sign-in", { waitUntil: "networkidle" });
        await assertNoOverflow(page, `sign-in ${vp.name}/${theme}`);
        await page.screenshot({ path: `test-results/vqa/signin-${vp.name}-${theme}.png` });
      }
    }
  });

  // Dialogs + edge states across mobile (360) and desktop (1440), en-light & ar-dark.
  test("dialogs and state surfaces — mobile + desktop, en/light and ar/dark", async ({ page, request }) => {
    test.setTimeout(300_000);
    await signIn(page, request, IDENTITIES.manager);

    async function dialogFits(name: string) {
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      const box = await dialog.boundingBox();
      const vh = page.viewportSize()!.height;
      expect(box, `${name} dialog box`).not.toBeNull();
      // Dialog must not exceed the viewport height (it scrolls internally instead).
      expect(box!.height, `${name} dialog height <= viewport`).toBeLessThanOrEqual(vh + 1);
      // The confirm/submit control is reachable inside the dialog.
      await expect(dialog.getByRole("button", { name: /save changes|حفظ التغييرات/i })).toBeVisible();
      await assertNoOverflow(page, `${name} (dialog open)`);
    }

    for (const vp of [VIEWPORTS[0]!, VIEWPORTS[3]!]) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const [locale, theme] of [["en", "light"], ["ar", "dark"]] as const) {
        await setPrefs(page, locale, theme);
        const tag = `${vp.name}-${locale}-${theme}`;

        // Customer ownership confirmation dialog + focus management.
        await page.goto(`/b2b/customers/${SEED_CUST}/edit`, { waitUntil: "networkidle" });
        const ownTrigger = page.getByRole("button", { name: /branch & salesperson|الفرع ومندوب/i });
        await ownTrigger.click();
        await dialogFits("customer-ownership");
        await page.screenshot({ path: `test-results/vqa/dialog-customer-ownership-${tag}.png` });
        const inDialog = () => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
        await expect.poll(inDialog, { message: "focus starts inside the dialog" }).toBe(true);
        await page.keyboard.press("Tab");
        await page.keyboard.press("Tab");
        await page.keyboard.press("Tab");
        expect(await inDialog(), "Tab stays trapped inside the dialog").toBe(true);
        await page.keyboard.press("Escape");
        await expect(page.getByRole("dialog")).toBeHidden(); // Escape closes
        await expect(ownTrigger).toBeFocused(); // focus returns to the trigger

        // Lead source/branch confirmation dialog.
        await page.goto(`/b2b/leads/${SEED_LEAD}/edit`, { waitUntil: "networkidle" });
        await page.getByRole("button", { name: /source & branch|المصدر والفرع/i }).click();
        await dialogFits("lead-source-branch");
        await page.screenshot({ path: `test-results/vqa/dialog-lead-source-branch-${tag}.png` });
        await page.keyboard.press("Escape");

        // Follow-up edit + reassign form (reach via the board's first Edit link).
        await page.goto("/b2b/follow-ups", { waitUntil: "networkidle" });
        await page.getByRole("link", { name: /^(edit|تعديل)$/i }).first().click();
        await page.waitForURL(/\/b2b\/follow-ups\/[0-9a-f-]{36}\/edit/);
        await assertNoOverflow(page, `follow-up-edit ${tag}`);
        await page.screenshot({ path: `test-results/vqa/followup-edit-${tag}.png` });

        // Validation error state (submit the new-customer form with no name).
        await page.goto("/b2b/customers/new", { waitUntil: "networkidle" });
        await page.getByRole("button", { name: /create|إضافة|حفظ/i }).click();
        await expect(page.getByRole("alert").first()).toBeVisible();
        await assertNoOverflow(page, `validation-error ${tag}`);
        await page.screenshot({ path: `test-results/vqa/state-validation-${tag}.png` });

        // Not-found state.
        await page.goto("/b2b/customers/00000000-0000-4000-8000-000000000000", { waitUntil: "networkidle" });
        await expect(page.getByText(/not found|غير موجود/i).first()).toBeVisible();
        await assertNoOverflow(page, `not-found ${tag}`);
        await page.screenshot({ path: `test-results/vqa/state-not-found-${tag}.png` });

        // Empty state (search that matches nothing).
        await page.goto("/b2b/customers?search=zzq-no-match-xyz", { waitUntil: "networkidle" });
        await assertNoOverflow(page, `empty ${tag}`);
        await page.screenshot({ path: `test-results/vqa/state-empty-${tag}.png` });
      }
    }
  });
});
