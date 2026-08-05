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

  test("branch-limited rep — mobile + desktop, ar dark and en light", async ({ page, request }) => {
    test.setTimeout(180_000);
    await signIn(page, request, IDENTITIES.branchLimited);
    for (const vp of [VIEWPORTS[0]!, VIEWPORTS[3]!]) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const [locale, theme] of [["ar", "dark"], ["en", "light"]] as const) {
        await setPrefs(page, locale, theme);
        for (const route of ["/b2b", "/b2b/customers", "/b2b/leads", "/b2b/follow-ups"]) {
          await page.goto(route, { waitUntil: "networkidle" });
          await assertNoOverflow(page, `rep ${vp.name}/${locale}/${theme} ${route}`);
        }
        await page.screenshot({ path: `test-results/vqa/rep-${vp.name}-${locale}-${theme}.png` });
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
});
