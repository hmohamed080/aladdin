import { test, expect, type Page } from "@playwright/test";
import { IDENTITIES, signIn } from "./helpers/auth";

/**
 * Sprint 14 — showroom MVP completeness.
 *
 * Signed in as the SHOWROOM/DEALER organization (Cairo Ceramics), not as Org A.
 * Org A is a supplier and Org B a design office; neither has the buying history,
 * the shortlist or the delivery work that the buyer-first showroom IA exists to
 * show, so testing the showroom experience through them proved only that the
 * pages render empty.
 *
 * The assertions target what the sprint claims: the sidebar is grouped, the
 * ambiguous pages state one perspective, every module renders REAL data, no raw
 * capability key or fixture label reaches the client, and neither locale leaks
 * the other's language.
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
  "/b2b/organization",
  "/b2b/reports",
  "/b2b/settings",
] as const;

/**
 * The VISIBLE instance of some text.
 *
 * `DataTable` renders every row twice — a semantic table from `tablet` up and a
 * stacked card list below it — with one of the two `display:none` at any given
 * width. A plain `.first()` therefore lands on the hidden copy on mobile and
 * fails a visibility assertion that is actually satisfied on screen.
 */
function visibleText(page: Page, text: string | RegExp) {
  return page.getByText(text).filter({ visible: true }).first();
}

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
    await signIn(page, request, IDENTITIES.showroom);

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
    await signIn(page, request, IDENTITIES.showroom);
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
      "Distributors",
      "Technicians",
      "Institutions",
      "Reports",
      "Settings",
      "Team",
    ]) {
      await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
    }
  });

  test("the word Supplier no longer appears in the showroom's own surfaces", async ({
    page,
    request,
  }) => {
    await prefs(page, "en");
    await signIn(page, request, IDENTITIES.showroom);

    // The terminology decision is user-facing only: `supplier` survives in URLs,
    // query parameters and DOM ids, which is why this reads TEXT, not markup.
    for (const route of ["/b2b", "/b2b/suppliers", "/b2b/saved", "/b2b/reports", "/b2b/catalog"]) {
      await page.goto(route);
      const text = await page.locator("main").innerText();
      expect(text, `"Supplier" leaked on ${route}`).not.toMatch(/\bSupplier/i);
    }
  });

  test("the dashboard shows real purchasing data, not an empty shell", async ({ page, request }) => {
    await prefs(page, "en");
    await signIn(page, request, IDENTITIES.showroom);
    await page.goto("/b2b");

    // Committed spend is an aggregate of seeded orders — a live figure, never a
    // constant in a component.
    await expect(visibleText(page, "Committed spend")).toBeVisible();
    await expect(page.locator("main")).toContainText("EGP");

    // Each chart is an accessible image with its own name, so this asserts the
    // chart EXISTS rather than that some <svg> is on the page.
    await expect(page.getByRole("img", { name: "What you have committed, by month" })).toBeVisible();
    await expect(page.getByRole("img", { name: "Shortlist by category" })).toBeVisible();
    await expect(visibleText(page, "Who you buy from most")).toBeVisible();
  });

  test("reports filters narrow the report and stay in the URL", async ({ page, request }) => {
    await prefs(page, "en");
    await signIn(page, request, IDENTITIES.showroom);
    await page.goto("/b2b/reports");

    await expect(page.locator("main h1")).toHaveText("Reports & analytics");
    await expect(page.getByRole("img", { name: "Purchase value over time" })).toBeVisible();
    await expect(page.getByRole("img", { name: "Spend by category" })).toBeVisible();

    // A filtered report must be a shareable URL, and the page must survive being
    // loaded straight from that URL rather than only through the control.
    await page.goto("/b2b/reports?category=finishing");
    await expect(page.locator("main h1")).toHaveText("Reports & analytics");
    await expect(page.getByRole("img", { name: "Spend by category" })).toBeVisible();

    // An unknown filter value is ignored rather than passed to the database.
    await page.goto("/b2b/reports?category=not-a-category&period=forever");
    await expect(page.locator("main h1")).toHaveText("Reports & analytics");
  });

  test("purchase requests and incoming offers each lead with one perspective", async ({
    page,
    request,
  }) => {
    await prefs(page, "en");
    await signIn(page, request, IDENTITIES.showroom);

    await page.goto("/b2b/rfqs");
    await expect(page.locator("main h1")).toHaveText("Purchase requests");
    // The showroom both buys and sells, so the sell side is present — as a TAB,
    // not a second stacked list competing for the same heading.
    const rfqTabs = page.getByRole("navigation", { name: "Purchase requests" });
    await expect(rfqTabs.getByRole("link", { name: /We asked for/ })).toBeVisible();
    await expect(rfqTabs.getByRole("link", { name: /Asked of us/ })).toBeVisible();

    // Assert the tab's TARGET rather than racing the client router's hydration.
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

  test("the distributor directory lists what each business sells", async ({ page, request }) => {
    await prefs(page, "en");
    await signIn(page, request, IDENTITIES.showroom);
    await page.goto("/b2b/suppliers");
    await expect(page.locator("main h1")).toHaveText("Distributors");

    // The seeded distributors are verified businesses, so the directory must have
    // rows — an empty directory here was the Sprint 14 gap.
    await expect(visibleText(page, "Alexandria Glass & Aluminium")).toBeVisible();
    // The label is deliberately reused as a KPI tile, a column header and a
    // mobile card row, so this targets the tile — the one that proves the
    // directory counted real published products.
    await expect(page.getByRole("link", { name: /Products you can browse/ })).toBeVisible();
    // Category coverage is what turns the directory into a sourcing module. The
    // column header only exists in the tablet-and-up table; on mobile the same
    // data renders as a labelled card row, so this asserts the LABEL either way.
    await expect(visibleText(page, "Sells")).toBeVisible();

    const first = page.getByRole("link", { name: "View products" }).first();
    await expect(first).toBeVisible();
    await first.click();
    await expect(page).toHaveURL(/\/b2b\/catalog\?supplier=/);
  });

  test("technicians leads with trades and consultants stay a secondary view", async ({
    page,
    request,
  }) => {
    await prefs(page, "en");
    await signIn(page, request, IDENTITIES.showroom);
    await page.goto("/b2b/technicians");

    await expect(page.locator("main h1")).toHaveText("Technicians");
    await expect(visibleText(page, "Installers and on-site trades you can bring onto a job.")).toBeVisible();

    // The default tab is trades, and it has real listed people behind it.
    const tabs = page.getByRole("navigation", { name: "Technicians" });
    await expect(tabs.getByRole("link", { name: /Trades/ })).toHaveAttribute("aria-current", "page");
    await expect(visibleText(page, "Ceramic and porcelain tiling")).toBeVisible();

    await page.goto("/b2b/technicians?group=consultants");
    await expect(visibleText(page, "Engineers, designers and contractors you can consult on a job.")).toBeVisible();
  });

  test("institutions shows the network the showroom has actually worked with", async ({
    page,
    request,
  }) => {
    await prefs(page, "en");
    await signIn(page, request, IDENTITIES.showroom);
    await page.goto("/b2b/institutions");

    await expect(page.locator("main h1")).toHaveText("Institutions");
    await expect(visibleText(page, "You have worked with")).toBeVisible();
    // New Cairo Design Studio has two orders with the showroom in the seed.
    await expect(visibleText(page, "New Cairo Design Studio")).toBeVisible();
    await expect(visibleText(page, /\d+ orders/)).toBeVisible();
  });

  test("projects shows value, site and dates for real delivery work", async ({ page, request }) => {
    await prefs(page, "en");
    await signIn(page, request, IDENTITIES.showroom);
    await page.goto("/b2b/projects");

    await expect(page.locator("main h1")).toHaveText("Projects");
    await expect(visibleText(page, "Maadi apartment finishing")).toBeVisible();
    // Value comes from the order the project delivers, so it must be a real figure.
    await expect(page.locator("main")).toContainText("EGP");
  });

  test("the team screen never shows a raw capability key", async ({ page, request }) => {
    await prefs(page, "en");
    await signIn(page, request, IDENTITIES.showroom);
    await page.goto("/b2b/organization");

    await expect(page.locator("main h1")).toHaveText("Team");
    const text = await page.locator("main").innerText();
    // The exact identifiers the sprint brief called out, plus the general shape.
    for (const key of ["org.manage", "org.members.manage", "sales.read", "sales.write", "catalog.publish"]) {
      expect(text, `raw capability key "${key}" is on screen`).not.toContain(key);
    }
    // Their human replacements are.
    await expect(visibleText(page, "Full business management")).toBeVisible();
  });

  test("settings covers the business, the workspace and the account", async ({ page, request }) => {
    await prefs(page, "en");
    await signIn(page, request, IDENTITIES.showroom);
    await page.goto("/b2b/settings");

    for (const heading of ["Business", "Workspace", "Account & access"]) {
      await expect(visibleText(page, heading)).toBeVisible();
    }
    await expect(visibleText(page, "Verification")).toBeVisible();
    await expect(visibleText(page, "Sign-in & security")).toBeVisible();
    await expect(page.getByRole("link", { name: "Contact support" })).toBeVisible();
    // No invented billing/notification systems.
    const text = await page.locator("main").innerText();
    for (const absent of ["Billing", "Subscription", "Integrations"]) {
      expect(text, `${absent} is not a system this product has`).not.toContain(absent);
    }
  });

  test("catalog and shortlist cards carry product imagery", async ({ page, request }) => {
    await prefs(page, "en");
    await signIn(page, request, IDENTITIES.showroom);

    await page.goto("/b2b/catalog");
    const image = page.locator("main img").first();
    await expect(image).toBeVisible();
    // The alt text is the product, never "product image".
    await expect(image).not.toHaveAttribute("alt", "");

    await page.goto("/b2b/saved");
    await expect(page.locator("main h1")).toHaveText("Saved products");
    await expect(page.locator("main img").first()).toBeVisible();
  });

  test("saving a product from the catalog puts it on the shortlist and removes cleanly", async ({
    page,
    request,
  }) => {
    await prefs(page, "en");
    await signIn(page, request, IDENTITIES.showroom);
    await page.goto("/b2b/catalog");

    const save = page.getByRole("button", { name: "Save product" }).first();
    await expect(save).toBeVisible();
    await save.click();

    // The toggle flips in place — the same control now offers the inverse action.
    await expect(page.getByRole("button", { name: "Remove from saved" }).first()).toBeVisible();

    // Undo, so the shortlist the rest of the suite reads is left as seeded.
    await page.getByRole("button", { name: "Remove from saved" }).first().click();
    await expect(page.getByRole("button", { name: "Save product" }).first()).toBeVisible();
  });

  test("mobile reaches every module: four in the bar, the rest behind More", async ({
    page,
    request,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-mobile", "mobile chrome only");
    await prefs(page, "en");
    await signIn(page, request, IDENTITIES.showroom);
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
    for (const label of ["Distributors", "Technicians", "Institutions", "Projects", "Team", "Reports", "Settings"]) {
      await expect(sheet.getByRole("link", { name: label, exact: true })).toBeVisible();
    }

    await sheet.getByRole("link", { name: "Projects", exact: true }).click();
    await page.waitForURL(/\/b2b\/projects/);
    // Navigating closes the sheet rather than leaving it over the new page.
    await expect(sheet).toBeHidden();
  });

  test("the language control flips the workspace to RTL", async ({ page, request }) => {
    await prefs(page, "en");
    await signIn(page, request, IDENTITIES.showroom);
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
    await signIn(page, request, IDENTITIES.showroom);

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

    // The same rule for the headings of every module this sprint touched, where
    // new copy is most likely to have been left untranslated.
    for (const route of [
      "/b2b/suppliers",
      "/b2b/technicians",
      "/b2b/institutions",
      "/b2b/reports",
      "/b2b/settings",
      "/b2b/projects",
    ]) {
      await page.goto(route);
      const heading = (await page.locator("main h1").first().innerText()).trim();
      expect(heading.match(/[A-Za-z]{3,}/g) ?? [], `English heading on ${route}: ${heading}`).toEqual([]);
    }

    // Arabic terminology: الموزّع replaced المورّد everywhere user-facing.
    await page.goto("/b2b/suppliers");
    await expect(page.locator("main h1")).toHaveText("الموزّعون");
    const body = await page.locator("main").innerText();
    expect(body, "المورّد still appears in Arabic").not.toMatch(/مورّد|الموردين|الموردون/);
  });
});
