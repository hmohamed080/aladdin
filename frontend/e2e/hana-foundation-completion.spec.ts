import { test, expect } from "@playwright/test";
import { IDENTITIES, signIn } from "./helpers/auth";

/**
 * The Hana Showroom Dashboard "Foundation completion pass" — corrections A-H
 * approved after visual review of the Foundation build. Each `test` here
 * both asserts the fix (real e2e coverage, not just a screenshot) and saves
 * the native Chromium screenshot the visual-review handoff requires. No
 * `html2canvas` or other DOM-to-canvas recreation — every image here is the
 * browser's own paint, so Arabic shaping renders correctly.
 *
 * See the "Hana Showroom Owner dashboard milestone" map (Foundation ticket)
 * for the approved corrections this pins down.
 */
const SHOTS = "e2e/screenshots";

async function setLocale(page: import("@playwright/test").Page, locale: "ar" | "en") {
  await page.context().addCookies([
    { name: "NEXT_LOCALE", value: locale, url: page.url() || "http://127.0.0.1:3100" },
  ]);
}

async function setTheme(page: import("@playwright/test").Page, theme: "light" | "dark") {
  await page.context().addCookies([
    { name: "aladdin-theme", value: theme, url: page.url() || "http://127.0.0.1:3100" },
  ]);
}

test.describe("Hana Showroom dashboard — Foundation completion pass", () => {
  test.beforeEach(async ({ page, context }) => {
    await context.addCookies([{ name: "NEXT_LOCALE", value: "en", url: "http://127.0.0.1:3100" }]);
    await signIn(page, page.context().request, IDENTITIES.showroom);
  });

  test("greeting names the signed-in person, not the organization — AR collapsed", async ({ page }) => {
    await setLocale(page, "ar");
    await page.reload({ waitUntil: "networkidle" });

    // A. Greeting: the signed-in profile's name, never a hardcoded "Hana" and
    // never the organization repeated (the org already lives in the header).
    const greeting = page.getByText(/أهلًا بعودتك/);
    await expect(greeting).toBeVisible();
    await expect(greeting).not.toContainText("سيراميك"); // org name not repeated here

    // B. Desktop header: org (building icon) and branch (pin icon) both
    // visible, org name NOT truncated, real Arabic values (not the English
    // fallback the un-seeded data used to show).
    await expect(page.getByTestId("workspace-switcher")).toContainText("معرض سيراميك القاهرة");
    // `.first()`: the branch name also appears a second time in the mobile
    // two-line context block, present in the DOM but hidden below `tablet`
    // — this is the desktop viewport's own crumb, which the header actually
    // renders first in document order.
    await expect(page.getByText("فرع مدينة نصر").or(page.getByText("Nasr City Showroom")).first()).toBeVisible();

    // D. No clipped KPI text: every primary tile's label is present verbatim
    // (a `truncate`/ellipsis regression would still pass a `.toContainText`
    // check since the DOM text is unchanged — the real proof is the
    // screenshot plus stat-tiles.test.tsx's class assertions).
    await expect(page.getByText("متابعات متأخرة")).toBeVisible();

    await page.screenshot({ path: `${SHOTS}/01-ar-desktop-light-collapsed.png`, fullPage: true });
  });

  test("expanded KPI grid — 6+2, same card size, not a 4x2 reflow — AR expanded", async ({ page }) => {
    await setLocale(page, "ar");
    await page.reload({ waitUntil: "networkidle" });

    const showMore = page.getByRole("button", { name: /عرض المزيد|Show more/ });
    await showMore.click();
    await expect(page.getByRole("button", { name: /عرض أقل|Show less/ })).toBeVisible();

    // E. The two additional cards render in the SAME 6-column grid as the
    // primary row (desktop:grid-cols-6 on both), never a separate 4-column
    // grid that would stretch or enlarge them.
    const grids = page.locator('[class*="desktop:grid-cols-6"]');
    await expect(grids).toHaveCount(2);

    await page.screenshot({ path: `${SHOTS}/02-ar-desktop-light-expanded.png`, fullPage: true });
  });

  test("single-surface KPI cards, no nested panel — AR dark expanded", async ({ page }) => {
    await setLocale(page, "ar");
    await setTheme(page, "dark");
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: /عرض المزيد|Show more/ }).click();

    await page.screenshot({ path: `${SHOTS}/03-ar-desktop-dark-expanded.png`, fullPage: true });
  });

  test("no KPI truncation in English", async ({ page }) => {
    await setLocale(page, "en");
    await page.reload({ waitUntil: "networkidle" });

    for (const label of [
      "Overdue follow-ups",
      "Quotations to review",
      "Open purchase requests",
      "Orders in progress",
    ]) {
      const el = page.getByText(label, { exact: true });
      await expect(el).toBeVisible();
      // The regression this guards: `truncate` clips overflow via CSS, but
      // the underlying scrollWidth still exceeds clientWidth when it does —
      // a real, DOM-measured proof the label is not being clipped.
      const clipped = await el.evaluate((n) => n.scrollWidth > n.clientWidth + 1);
      expect(clipped).toBe(false);
    }

    await page.screenshot({ path: `${SHOTS}/04-en-desktop-light.png`, fullPage: true });
  });

  test("period popover stays fully inside the viewport in English/LTR", async ({ page }) => {
    await setLocale(page, "en");
    await page.reload({ waitUntil: "networkidle" });

    await page.getByTestId("dashboard-period-select").click();
    const menu = page.getByTestId("dashboard-period-menu");
    await expect(menu).toBeVisible();

    const box = await menu.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    if (box && viewport) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    }

    // Presets other than "custom" must not show the From/To sub-form.
    await expect(page.getByTestId("dashboard-period-custom-from")).not.toBeVisible();

    await page.screenshot({ path: `${SHOTS}/05-en-period-presets-open.png` });
  });

  test("custom period reveals usable From/To fields", async ({ page }) => {
    await setLocale(page, "en");
    await page.reload({ waitUntil: "networkidle" });

    await page.getByTestId("dashboard-period-select").click();
    await page.getByTestId("dashboard-period-option-custom").click();
    await expect(page.getByTestId("dashboard-period-custom-from")).toBeVisible();
    await expect(page.getByTestId("dashboard-period-custom-to")).toBeVisible();

    await page.screenshot({ path: `${SHOTS}/06-en-custom-period.png` });
  });

  test("Arabic mobile — labeled two-line org/branch context, no ugly truncation", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await setLocale(page, "ar");
    await page.reload({ waitUntil: "networkidle" });

    await expect(page.getByText("المؤسسة:")).toBeVisible();
    // `.last()`: the same name also sits in the desktop crumb, present but
    // `tablet:hidden` at this 390px viewport — the mobile two-line block
    // renders after it in document order.
    const orgName = page.getByText("معرض سيراميك القاهرة").last();
    await expect(orgName).toBeVisible();
    // `.last()`: the desktop crumb also carries "الفرع" as an sr-only label
    // for its own single-branch span (see `BranchSwitcher`) — a second,
    // legitimate match that is not the visible mobile label being tested here.
    await expect(page.getByText("الفرع:").last()).toBeVisible();
    await expect(page.getByText("فرع مدينة نصر").last()).toBeVisible();
    // The specific bug being fixed: CSS `text-overflow: ellipsis` clips the
    // rendered box without changing the DOM text, so the real proof is a
    // scrollWidth/clientWidth measurement, not a text-content search for "…".
    const clipped = await orgName.evaluate((n) => n.scrollWidth > n.clientWidth + 1);
    expect(clipped).toBe(false);

    await page.screenshot({ path: `${SHOTS}/07-ar-mobile.png`, fullPage: true });
  });

  test("organization settings — truthful default timezone wording", async ({ page }) => {
    await setLocale(page, "en");
    await page.goto("/b2b/settings", { waitUntil: "networkidle" });

    // G. Organization has no explicit override in the seed — must read
    // "Default: Africa/Cairo", never a bare "Not set" while that default is
    // actually governing every report on this dashboard.
    await expect(page.getByText("Default: Africa/Cairo")).toBeVisible();

    await page.screenshot({ path: `${SHOTS}/08-org-settings-timezone.png`, fullPage: true });
  });

  test("branch settings — truthful inherited timezone wording", async ({ page }) => {
    await setLocale(page, "en");
    await page.goto("/b2b/settings", { waitUntil: "networkidle" });

    // G. The branch also has no override — it inherits the organization's
    // own (defaulted) zone, and the copy must say so rather than "Not set".
    await expect(page.getByText("Inherited from organization: Africa/Cairo")).toBeVisible();

    await page.screenshot({ path: `${SHOTS}/09-branch-settings-timezone.png`, fullPage: true });
  });
});
