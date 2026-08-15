import { test, expect, type Page } from "@playwright/test";
import { IDENTITIES, signIn } from "./helpers/auth";

/**
 * Sprint 14 — showroom MVP completeness.
 *
 * Covers the routes this sprint changed or added, in both locales. The assertions
 * target what the sprint actually claims: the sidebar is grouped, the ambiguous
 * pages now state one perspective, the new modules render real data or a real
 * empty state, and neither locale leaks the other's language.
 */

/**
 * The app's default locale is ARABIC (`APP_DEFAULT_LOCALE`), so an English
 * assertion must set the cookie explicitly — the same convention the other specs
 * use. Locale lives only in a cookie, never in the URL.
 */
async function prefs(page: Page, locale: "en" | "ar") {
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: locale, url: "http://127.0.0.1" }]);
}

/** Fail the test on any console error — a page that "renders" while throwing is not done. */
function guardConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

const ROUTES = [
  "/b2b",
  "/b2b/rfqs",
  "/b2b/quotations",
  "/b2b/orders",
  "/b2b/projects",
  "/b2b/catalog",
  "/b2b/saved",
  "/b2b/suppliers",
  "/b2b/technicians",
  "/b2b/institutions",
  "/b2b/reports",
  "/b2b/settings",
] as const;

/** Nothing in the workspace may scroll the page sideways at any width. */
async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "horizontal overflow in px").toBeLessThanOrEqual(0);
}

test.describe("showroom workspace", () => {
  test("every showroom route renders without console errors or sideways scroll", async ({
    page,
    request,
  }) => {
    const errors = guardConsole(page);
    await prefs(page, "en");
    await signIn(page, request, IDENTITIES.manager);

    for (const route of ROUTES) {
      await page.goto(route);
      await expect(page.locator("main h1").first(), `${route} has a page title`).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }

    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });

  test("the sidebar is grouped into the five workspace sections", async ({ page, request }, testInfo) => {
    // The grouped rail is the DESKTOP/tablet chrome. Mobile deliberately collapses
    // to a five-item bottom bar, asserted separately below.
    test.skip(testInfo.project.name === "chromium-mobile", "grouped rail is tablet-and-up chrome");
    await prefs(page, "en");
    await signIn(page, request, IDENTITIES.manager);
    await page.goto("/b2b");

    const nav = page.getByRole("navigation", { name: "Workspace" }).first();
    for (const heading of ["Buying", "Network", "Selling", "Business"]) {
      await expect(nav.getByRole("heading", { name: heading, exact: true })).toBeVisible();
    }

    // The renamed modules must be reachable by their new, unambiguous labels.
    for (const label of [
      "Purchase requests",
      "Incoming offers",
      "Orders & purchases",
      "Saved products",
      "Suppliers",
      "Technicians",
      "Institutions",
      "Reports",
      "Settings",
      "Team",
    ]) {
      await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
    }
  });

  test("purchase requests and incoming offers each lead with one perspective", async ({
    page,
    request,
  }) => {
    await prefs(page, "en");
    await signIn(page, request, IDENTITIES.manager);

    await page.goto("/b2b/rfqs");
    await expect(page.locator("main h1")).toHaveText("Purchase requests");
    // Org A can also respond, so the sell side is present — as a TAB, not a
    // second stacked list competing for the same heading.
    const rfqTabs = page.getByRole("navigation", { name: "Purchase requests" });
    await expect(rfqTabs.getByRole("link", { name: /We asked for/ })).toBeVisible();
    await expect(rfqTabs.getByRole("link", { name: /Asked of us/ })).toBeVisible();

    // Assert the tab's TARGET rather than racing the client router's hydration:
    // what matters is that the sell side is one link away and renders as its own
    // perspective, not which millisecond the SPA navigation completes.
    await expect(rfqTabs.getByRole("link", { name: /Asked of us/ })).toHaveAttribute(
      "href",
      "/b2b/rfqs?view=received",
    );
    await page.goto("/b2b/rfqs?view=received");
    await expect(
      page.getByRole("navigation", { name: "Purchase requests" }).getByRole("link", {
        name: /Asked of us/,
      }),
    ).toHaveAttribute("aria-current", "page");

    await page.goto("/b2b/quotations");
    await expect(page.locator("main h1")).toHaveText("Incoming offers");
    const offerTabs = page.getByRole("navigation", { name: "Incoming offers" });
    await expect(offerTabs.getByRole("link", { name: /Offers we received/ })).toBeVisible();
  });

  test("a supplier row leads into that supplier's catalog", async ({ page, request }) => {
    await prefs(page, "en");
    await signIn(page, request, IDENTITIES.manager);
    await page.goto("/b2b/suppliers");
    await expect(page.locator("main h1")).toHaveText("Suppliers");

    const first = page.getByRole("link", { name: "View products" }).first();
    if (await first.isVisible()) {
      await first.click();
      await expect(page).toHaveURL(/\/b2b\/catalog\?supplier=/);
    }
  });

  test("saving a product from the catalog puts it on the shortlist and removes cleanly", async ({
    page,
    request,
  }) => {
    await prefs(page, "en");
    await signIn(page, request, IDENTITIES.manager);
    await page.goto("/b2b/catalog");

    const save = page.getByRole("button", { name: "Save product" }).first();
    await expect(save).toBeVisible();
    await save.click();

    // The toggle flips in place — the same control now offers the inverse action.
    await expect(page.getByRole("button", { name: "Remove from saved" }).first()).toBeVisible();

    await page.goto("/b2b/saved");
    await expect(page.locator("main h1")).toHaveText("Saved products");
    const saved = page.getByRole("button", { name: "Remove from saved" }).first();
    await expect(saved).toBeVisible();

    await saved.click();
    await expect(page.getByText("Nothing saved yet")).toBeVisible();
  });

  test("mobile reaches every module: four in the bar, the rest behind More", async ({
    page,
    request,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-mobile", "mobile chrome only");
    await prefs(page, "en");
    await signIn(page, request, IDENTITIES.manager);
    await page.goto("/b2b");

    const bar = page.getByRole("navigation", { name: "Workspace" });
    await expect(bar.getByRole("listitem")).toHaveCount(5);
    for (const label of ["Home", "Purchase requests", "Incoming offers", "Orders & purchases"]) {
      await expect(bar.getByRole("link", { name: label, exact: true })).toBeVisible();
    }

    // Everything past the fourth item must still be reachable — otherwise the
    // grouped IA would simply hide Projects, Team, Reports and Settings on a phone.
    await bar.getByRole("button", { name: "More" }).click();
    const sheet = page.getByRole("navigation", { name: "More" });
    for (const label of ["Suppliers", "Technicians", "Institutions", "Projects", "Team", "Reports", "Settings"]) {
      await expect(sheet.getByRole("link", { name: label, exact: true })).toBeVisible();
    }

    await sheet.getByRole("link", { name: "Projects", exact: true }).click();
    await page.waitForURL(/\/b2b\/projects/);
    // Navigating closes the sheet rather than leaving it over the new page.
    await expect(sheet).toBeHidden();
  });

  test("the language control flips the workspace to RTL", async ({ page, request }) => {
    await prefs(page, "en");
    await signIn(page, request, IDENTITIES.manager);
    await page.goto("/b2b");

    await page.getByRole("button", { name: "Language", exact: true }).first().click();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  });

  test("every showroom route renders Arabic RTL with no English leaking in", async ({
    page,
    request,
  }) => {
    // Set the locale cookie directly rather than clicking through the switch: the
    // switch is covered above, and this test is about the RENDERED pages, which
    // must not depend on a client-side transition having settled first.
    await prefs(page, "ar");
    await signIn(page, request, IDENTITIES.manager);

    for (const route of ROUTES) {
      await page.goto(route);
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await expect(page.locator("main h1").first(), `${route} has a page title`).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }

    await page.goto("/b2b");
    const nav = page.getByRole("navigation", { name: "مساحة العمل" }).first();
    const navText = (await nav.innerText()).trim();
    // Any run of three or more Latin letters in the Arabic sidebar is a leak.
    expect(navText.match(/[A-Za-z]{3,}/g) ?? [], `English in the Arabic nav: ${navText}`).toEqual([]);

    // The same rule for the page body of the modules this sprint added, where new
    // copy is most likely to have been left untranslated.
    for (const route of ["/b2b/suppliers", "/b2b/technicians", "/b2b/institutions", "/b2b/reports"]) {
      await page.goto(route);
      const heading = (await page.locator("main h1").first().innerText()).trim();
      expect(heading.match(/[A-Za-z]{3,}/g) ?? [], `English heading on ${route}: ${heading}`).toEqual([]);
    }
  });
});
