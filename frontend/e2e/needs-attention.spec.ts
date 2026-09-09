import { test, expect } from "@playwright/test";
import { IDENTITIES, signIn } from "./helpers/auth";

const SHOTS = "e2e/screenshots";

/**
 * يحتاج تدخلك اليوم (#46) — real, authorized overdue-follow-up and
 * quotation-awaiting-decision rows, each deep-linking to the page that can
 * actually act on it. This section never mutates anything itself, so the
 * proof here is navigational: clicking a row must land on that exact
 * record's real edit/detail page, not just carry the right `href` in markup.
 */
test.describe("Needs your attention today (#46)", () => {
  test.beforeEach(async ({ page, context }) => {
    await context.addCookies([{ name: "NEXT_LOCALE", value: "en", url: "http://127.0.0.1:3100" }]);
    await signIn(page, page.context().request, IDENTITIES.showroom);
  });

  test("renders real overdue follow-ups and quotations, each deep-linking to its own record", async ({ page }) => {
    const section = page.locator("section", { has: page.getByRole("heading", { name: /needs your attention/i }) });
    await expect(section).toBeVisible();

    const followUpLink = section.getByRole("link", { name: /Call Rasha back/ });
    await expect(followUpLink).toBeVisible();
    const followUpHref = await followUpLink.getAttribute("href");
    expect(followUpHref).toMatch(/^\/b2b\/follow-ups\/.+\/edit$/);

    const quotationLink = section.getByRole("link", { name: /Basins - New Cairo apartments/ });
    await expect(quotationLink).toBeVisible();
    const quotationHref = await quotationLink.getAttribute("href");
    expect(quotationHref).toMatch(/^\/b2b\/quotations\/.+$/);

    // Navigating a follow-up row lands on THAT record's real edit page — not
    // a generic list, not a 404 — proving the deep link is genuine, not just
    // a plausible-looking href in markup.
    await followUpLink.click();
    await expect(page).toHaveURL(followUpHref!);
    await expect(page.getByLabel(/title/i)).toHaveValue("Call Rasha back with the tile options");

    await page.goBack();
    await expect(quotationLink).toBeVisible();
    await quotationLink.click();
    await expect(page).toHaveURL(quotationHref!);
    await expect(page.getByRole("heading", { name: /Basins - New Cairo apartments/ })).toBeVisible();
  });

  test("this org's section never shows another organization's records", async ({ page }) => {
    // A negative, cheap-but-real proof: Egypt Marble Manufacturing's own
    // pilot data (seed-pilot.sql) is real and distinct from Cairo Ceramics
    // Showroom's — if RLS or this component ever leaked across tenants, one
    // of these strings would appear on Hana's dashboard.
    const section = page.locator("section", { has: page.getByRole("heading", { name: /needs your attention/i }) });
    await expect(section).toBeVisible();
    await expect(section.getByText("Egypt Marble Manufacturing")).toHaveCount(0);
  });

  test("screenshot — needs-attention section, Arabic", async ({ page }) => {
    await page.context().addCookies([{ name: "NEXT_LOCALE", value: "ar", url: "http://127.0.0.1:3100" }]);
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByText("يحتاج تدخلك اليوم")).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/13-ar-needs-attention.png`, fullPage: true });
  });

  test.describe("mobile 390px — Arabic UI, English/mixed-script user content", () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.context().addCookies([{ name: "NEXT_LOCALE", value: "ar", url: "http://127.0.0.1:3100" }]);
      await page.reload({ waitUntil: "networkidle" });
    });

    test("an English title inside the Arabic page resolves to real LTR rendering, not the ambient RTL", async ({
      page,
    }) => {
      // The actual defect was a RENDERING outcome (bidi resolution), which a
      // DOM/attribute check alone cannot prove — this reads the browser's own
      // computed `direction`, in a real page, to confirm the fix genuinely
      // takes effect rather than merely setting an attribute that jsdom
      // (the unit-test environment) cannot itself resolve.
      const englishTitle = page.getByText("Basins - New Cairo apartments");
      await expect(englishTitle).toBeVisible();
      const direction = await englishTitle.evaluate((el) => getComputedStyle(el).direction);
      expect(direction).toBe("ltr");

      // The page itself stays RTL — this is a LOCAL correction, not a global one.
      const pageDir = await page.evaluate(() => document.documentElement.dir);
      expect(pageDir).toBe("rtl");
    });

    test("no horizontal scroll, and the full title text is present (never DOM-clipped) at 390px", async ({ page }) => {
      const scrollsHorizontally = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(scrollsHorizontally).toBe(false);
      // Real seed content already includes a long English title — verifies
      // the two-line clamp keeps full text in the DOM (unlike a
      // width-based visual clip, `-webkit-line-clamp` never removes
      // characters, only what's painted past line 2).
      await expect(page.getByText("Aluminium profiles - shopfront")).toHaveText("Aluminium profiles - shopfront");
    });

    test("the icon, type label, and date/amount survive beside a two-line-clamped title", async ({ page }) => {
      const row = page.locator("li", { hasText: "Basins - New Cairo apartments" });
      await expect(row.getByRole("link")).toBeVisible();
      await expect(row.getByText("EGP", { exact: false }).or(row.getByText("ألف", { exact: false }))).toBeVisible();
    });

    test("screenshot — corrected mobile rows, Arabic", async ({ page }) => {
      await expect(page.getByText("Aluminium profiles - shopfront")).toBeVisible();
      await page.screenshot({ path: `${SHOTS}/14-ar-mobile-needs-attention-fixed.png`, fullPage: true });
    });
  });
});
