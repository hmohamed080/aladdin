import { test, expect, type Page } from "@playwright/test";
import { IDENTITIES, signIn } from "./helpers/auth";
import { setSidebarMode } from "./helpers/sidebar";

/**
 * Sprint 15 — the shared SUPPLY-SIDE B2B workspace.
 *
 * Signed in as each of the three acceptance organizations in manual-priority
 * order: Distributor (Suez Paints), Manufacturer (Alexandria Glass), Importer
 * (Cairo Sanitary Ware).
 *
 * WHAT THESE ASSERT
 * The sprint's central claim is that the three are ONE workspace read from the
 * selling seat — not three applications, and not the showroom's workspace with a
 * different title. So the assertions come in two halves:
 *
 *   IDENTITY   all three reach the same routes, the same shared sidebar with its
 *              three display modes, the same CardRail, the same tables.
 *   DIFFERENCE the commerce trio leads from the supplier side, the modules carry
 *              seller-seat names, and the dashboard answers the seller's
 *              questions with the seller's real records.
 *
 * Plus the two rules that outrank both: `Supplier` never reaches user-facing
 * copy, and nothing renders a number the database did not produce.
 */

/** The app's default locale is ARABIC, so an English assertion sets the cookie. */
async function prefs(page: Page, locale: "en" | "ar") {
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: locale, url: "http://127.0.0.1" }]);
}

/** Fail on any console error — a page that "renders" while throwing is not done. */
function guardConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
}

/**
 * The VISIBLE instance of some text. `DataTable` and `StatTiles` render rows
 * twice — a semantic table from `tablet` up and stacked cards below — with one
 * copy `display:none`, so a plain `.first()` can land on the hidden one.
 */
function visibleText(page: Page, text: string | RegExp) {
  return page.getByText(text).filter({ visible: true }).first();
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "horizontal overflow in px").toBeLessThanOrEqual(0);
}

/** Every module a supply-side workspace can reach. */
const ROUTES = [
  "/b2b",
  "/b2b/rfqs",
  "/b2b/quotations",
  "/b2b/orders",
  "/b2b/products",
  "/b2b/buyers",
  "/b2b/projects",
  "/b2b/catalog",
  "/b2b/suppliers",
  "/b2b/institutions",
  "/b2b/organization",
  "/b2b/reports",
  "/b2b/settings",
] as const;

/* Each account carries the two things that actually prove the dashboard is
   showing THIS organization's records rather than a shell:

     `voice`      the one line on the page that differs between a Distributor, a
                  Manufacturer and an Importer — derived from the org's own
                  `org_type`, so it cannot be right by accident.
     `signature`  a product that exists only in this organization's seeded
                  catalogue, so seeing it means the page reached that org's rows.

   `org` (the organization's NAME) is still here because the header's workspace
   switcher carries it — but it is deliberately no longer asserted inside
   <main>. The supply dashboard has never rendered the org's own name in the
   page body: it opens on "Your supply at a glance" and states the org's SEAT in
   the subtitle instead. The old assertion looked for a UI element that does not
   exist and never did, so it failed identically on the pre-globalization
   checkpoint. */
const ACCOUNTS = [
  {
    name: "Distributor",
    email: IDENTITIES.distributor,
    org: "Suez Paints & Coatings",
    voice: "Demand from showrooms and businesses",
    signature: "Interior Emulsion - Matte White",
  },
  {
    name: "Manufacturer",
    email: IDENTITIES.manufacturer,
    org: "Alexandria Glass & Aluminium",
    voice: "Demand for what you manufacture",
    signature: "Tempered Glass Partition 10mm",
  },
  {
    name: "Importer",
    email: IDENTITIES.importer,
    org: "Cairo Sanitary Ware Trading",
    voice: "Demand for what you import",
    signature: "Ceramic Wash Basin",
  },
] as const;

// ---------------------------------------------------------------------------
// One shared workspace: everything below runs identically for all three types.
// ---------------------------------------------------------------------------
for (const account of ACCOUNTS) {
  test.describe(`${account.name} workspace`, () => {
    test("every supply-side route renders without console errors or sideways scroll", async ({
      page,
      request,
    }) => {
      const errors = guardConsole(page);
      await prefs(page, "en");
      await signIn(page, request, account.email);

      for (const route of ROUTES) {
        await page.goto(route);
        await expect(page.locator("main h1").first(), `${route} has a page title`).toBeVisible();
        await expectNoHorizontalOverflow(page);
      }

      expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
    });

    test("the workspace leads from the SELLING seat", async ({ page, request }) => {
      await prefs(page, "en");
      await signIn(page, request, account.email);

      // Incoming demand, not purchase requests: the same route, the other seat.
      await page.goto("/b2b/rfqs");
      await expect(page.locator("main h1")).toHaveText("Incoming demand");

      // Quotations we SENT, not offers we received.
      await page.goto("/b2b/quotations");
      await expect(page.locator("main h1")).toHaveText("Quotations");

      // Orders placed WITH us.
      await page.goto("/b2b/orders");
      await expect(page.locator("main h1")).toHaveText("Orders");
    });

    test("the buying side stays reachable — a distributor buys too", async ({ page, request }) => {
      await prefs(page, "en");
      await signIn(page, request, account.email);

      // The demoted perspective is a TAB, never a removed module: the workspace
      // reorders itself, it does not amputate half of itself.
      await page.goto("/b2b/rfqs");
      const tabs = page.getByRole("navigation", { name: "Purchase requests" });
      await expect(tabs.getByRole("link", { name: /We asked for/ })).toHaveAttribute(
        "href",
        "/b2b/rfqs?view=sent",
      );

      await page.goto("/b2b/rfqs?view=sent");
      await expect(
        page
          .getByRole("navigation", { name: "Purchase requests" })
          .getByRole("link", { name: /We asked for/ }),
      ).toHaveAttribute("aria-current", "page");
    });

    test("the dashboard shows this organization's REAL supply data", async ({ page, request }) => {
      await prefs(page, "en");
      await signIn(page, request, account.email);
      await page.goto("/b2b");

      await expect(page.locator("main h1")).toHaveText("Your supply at a glance");

      /* THIS ORGANIZATION'S DASHBOARD, not a shell and not another org's.
         Two independent facts, because either alone is weak: the SEAT (a line
         derived from the org's own classification, so a Manufacturer's page
         cannot read as an Importer's) and a PRODUCT that exists only in this
         org's seeded catalogue (so the page reached that org's rows). */
      await expect(page.locator("main")).toContainText(account.voice);
      await expect(page.locator("main")).toContainText(account.signature);

      /* And the header names the organization the workspace is scoped to.
         `.first()` because the header DECLARES the context block once and PLACES
         it twice (see `AppHeader`) — the bar and card layouts each get a copy,
         and only one is visible at a given width. Either copy names the same
         organization, so the first is the right one to read. */
      await expect(page.getByTestId("workspace-switcher").first()).toContainText(account.org);

      // The leading tile: requests nobody has priced. The seed guarantees a
      // non-zero queue for all three, so this asserts live data, not a shell.
      await expect(visibleText(page, "Requests to answer")).toBeVisible();
      await expect(page.locator("main")).toContainText("EGP");

      /* Each chart is an accessible image with its own name, so this asserts the
         chart EXISTS rather than that some <svg> is on the page.

         THE NAME CHANGED BECAUSE THE OLD ONE WAS NEVER ON THIS PAGE. This asked
         for "Order value won, by month" (`supply.chart.valueTrend`), which is
         drawn by `features/reports/supply-report.tsx` — the REPORTS page. The
         dashboard's own chart is the pipeline board's `DonutSplit`, named after
         `supply.pipeline.orders`. Same class of staleness as the organization-
         name assertion above, and pre-existing for the same reason: it was
         simply never reached, because that assertion failed first. */
      await expect(
        page.locator("main").getByRole("img", { name: "Orders", exact: true }),
      ).toBeVisible();
      await expect(visibleText(page, "Your top products")).toBeVisible();
      await expect(visibleText(page, "Your top customers")).toBeVisible();
    });

    test("products management exposes both publication states with real counts", async ({
      page,
      request,
    }) => {
      await prefs(page, "en");
      await signIn(page, request, account.email);
      await page.goto("/b2b/products");

      await expect(page.locator("main h1")).toHaveText("Your products");

      const tabs = page.getByRole("navigation", { name: "Your products" });
      await expect(tabs.getByRole("link", { name: /^All/ })).toBeVisible();
      await expect(tabs.getByRole("link", { name: /^Published/ })).toBeVisible();
      await expect(tabs.getByRole("link", { name: /^Drafts/ })).toBeVisible();

      // Every one of the three has a seeded draft, so the draft tab is real.
      await page.goto("/b2b/products?status=draft");
      await expect(visibleText(page, /Drafts are private/)).toBeVisible();

      // Tabs and the toolbar share one query string: switching tab must CARRY
      // the search rather than silently dropping it.
      await page.goto("/b2b/products?q=coat&status=published");
      const keep = page
        .getByRole("navigation", { name: "Your products" })
        .getByRole("link", { name: /^Drafts/ });
      await expect(keep).toHaveAttribute("href", "/b2b/products?q=coat&status=draft");
    });

    test("the customer network shows relationships, not a public directory", async ({
      page,
      request,
    }) => {
      await prefs(page, "en");
      await signIn(page, request, account.email);
      await page.goto("/b2b/buyers");

      await expect(page.locator("main h1")).toHaveText("Customers & showrooms");
      // Seeded: each supply-side org now trades with more than one business.
      await expect(visibleText(page, "Customers")).toBeVisible();
      await expect(page.locator("main")).toContainText("EGP");
      // The privacy boundary is stated on the page, not just in the query.
      await expect(visibleText(page, /Nothing private about the other business/)).toBeVisible();
    });

    test("reports lead with supply-side analytics and keep the purchasing report", async ({
      page,
      request,
    }) => {
      await prefs(page, "en");
      await signIn(page, request, account.email);
      await page.goto("/b2b/reports");

      await expect(page.locator("main h1")).toHaveText("Reports & analytics");
      await expect(page.getByRole("img", { name: "Order value won, by month" })).toBeVisible();
      await expect(page.getByRole("img", { name: "Your top products" })).toBeVisible();

      // The buying half is still there, below — asserted by its SECTION, not by
      // its trend chart. None of the three acceptance organizations has bought
      // anything yet, and `TrendLine` renders an honest "no purchase value in
      // this period" panel rather than a flat line through zero. Demanding the
      // chart here would be demanding that the page draw something the database
      // has no data for, which is the exact failure mode this sprint refuses.
      await expect(
        page.getByRole("heading", { name: "Purchasing", exact: true }),
      ).toBeVisible();
      await expect(visibleText(page, /No committed spend/i)).toBeVisible();
    });

    test("the word Supplier never reaches user-facing copy", async ({ page, request }) => {
      await prefs(page, "en");
      await signIn(page, request, account.email);

      // Terminology is a COPY rule: `supplier` survives in URLs, query params and
      // DOM ids, which is why this reads rendered text, not markup.
      for (const route of ["/b2b", "/b2b/rfqs", "/b2b/quotations", "/b2b/products", "/b2b/buyers", "/b2b/reports"]) {
        await page.goto(route);
        const text = await page.locator("main").innerText();
        expect(text, `"Supplier" leaked on ${route}`).not.toMatch(/\bSupplier/i);
      }
    });

    test("Arabic renders the supply workspace with no English leaking through", async ({
      page,
      request,
    }) => {
      await prefs(page, "ar");
      await signIn(page, request, account.email);

      await page.goto("/b2b");
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      await expect(page.locator("main h1")).toHaveText("نظرة عامة على التوريد");

      await page.goto("/b2b/rfqs");
      await expect(page.locator("main h1")).toHaveText("الطلبات الواردة");

      await page.goto("/b2b/buyers");
      await expect(page.locator("main h1")).toHaveText("العملاء والمعارض");

      await page.goto("/b2b/products");
      await expect(page.locator("main h1")).toHaveText("منتجاتك");
      await expectNoHorizontalOverflow(page);
    });
  });
}

// ---------------------------------------------------------------------------
// The shared chrome. Asserted once — the point is that it is NOT per-org-type.
// ---------------------------------------------------------------------------
test.describe("shared B2B chrome on a supply-side workspace", () => {
  test("the sidebar is the same shared rail, grouped for the selling seat", async ({
    page,
    request,
  }, testInfo) => {
    test.skip(testInfo.project.name === "chromium-mobile", "grouped rail is tablet-and-up chrome");
    await prefs(page, "en");
    await signIn(page, request, IDENTITIES.distributor);
    await page.goto("/b2b");

    const nav = page.getByRole("navigation", { name: "Workspace" }).first();

    /* THE APPROVED IA IS QUICK ACCESS + COLLAPSIBLE GROUPS, and this assertion
       was written against the older flat rail where every section was a static
       <h2> and every module was on screen at once.

       What the rail does now:
         - the seller's daily modules (Supply) are UNGROUPED and always visible,
           with no heading at all — a caption over the five rows a user opens
           every day is a label nobody reads;
         - Network / Selling / Sourcing / Business are collapsible GROUPS, so
           their toggles are <button>s (not headings) and their children are
           `inert` until opened. */
    for (const label of ["Incoming demand", "Quotations", "Orders", "My products"]) {
      await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
    }

    for (const group of ["Network", "Selling", "Sourcing", "Business"]) {
      await expect(nav.getByRole("button", { name: group, exact: true })).toBeVisible();
    }

    // Opening a group reveals its own children — the modules are filed, not lost.
    await nav.getByRole("button", { name: "Network", exact: true }).click();
    await expect(
      nav.getByRole("link", { name: "Customers & showrooms", exact: true }),
    ).toBeVisible();
    await expect(nav.getByRole("link", { name: "Distributors", exact: true })).toBeVisible();

    /* SETTINGS IS NOT IN THE NAV LIST, AND EXACTLY ONCE ON THE RAIL. It is the
       fixed bottom action beneath the scrolling list — a sibling of <nav>, not a
       child — so it keeps the same position no matter which groups are open. It
       used to appear here too, under Business, which put it on screen twice. */
    await expect(nav.getByRole("link", { name: "Settings", exact: true })).toHaveCount(0);
    const rail = page.locator("[data-sidebar-mode]");
    await expect(rail.getByRole("link", { name: "Settings", exact: true })).toHaveCount(1);

    // Same hrefs as the showroom's — one module set, two orderings.
    await expect(nav.getByRole("link", { name: "Incoming demand", exact: true })).toHaveAttribute(
      "href",
      "/b2b/rfqs",
    );
  });

  test("all three sidebar display modes work here, and the choice persists", async ({
    page,
    request,
  }, testInfo) => {
    test.skip(testInfo.project.name === "chromium-mobile", "display modes are tablet-and-up chrome");
    await prefs(page, "en");
    await signIn(page, request, IDENTITIES.distributor);
    await page.goto("/b2b");

    const shell = page.locator("[data-sidebar-mode]");
    await expect(shell).toHaveAttribute("data-sidebar-mode", "expanded");

    // Collapse, then confirm the choice SURVIVES a full document load — the mode
    // is a cookie read on the server so the first paint is already correct.
    await setSidebarMode(page, "collapsed");
    await expect(shell).toHaveAttribute("data-sidebar-mode", "collapsed");
    await page.reload();
    await expect(page.locator("[data-sidebar-mode]")).toHaveAttribute(
      "data-sidebar-mode",
      "collapsed",
    );

    // A collapsed rail still exposes every module, by its localized name.
    const nav = page.getByRole("navigation", { name: "Workspace" }).first();
    await expect(nav.getByRole("link", { name: "Incoming demand", exact: true })).toBeVisible();

    // Hover mode reveals without reflowing the document.
    await setSidebarMode(page, "hover");
    await expect(shell).toHaveAttribute("data-sidebar-mode", "hover");
    await expect(shell).toHaveAttribute("data-sidebar-open", "false");
    await nav.hover();
    await expect(shell).toHaveAttribute("data-sidebar-open", "true");
    await expectNoHorizontalOverflow(page);

    // Leave the workspace as we found it, so the mode does not leak into the
    // next test in this serial suite.
    await setSidebarMode(page, "expanded");
  });

  test("the dashboard KPI group is the shared strip, and the shared rail still exists", async ({
    page,
    request,
  }) => {
    await prefs(page, "en");
    await signIn(page, request, IDENTITIES.distributor);
    await page.goto("/b2b");

    // The KPI group is no longer a rail. The supply-side visual pass replaced
    // nine railed tiles with FIVE cells in one bordered instrument strip — a
    // rail of nine numbers is a data dump you have to scroll, and an instrument
    // panel is something you read at a glance. What must not change is that it
    // is the SHARED component: `StatTiles layout="strip"`, the same primitive
    // any module can ask for, not a supply-only KPI widget.
    const strip = page.locator("main .grid.grid-cols-2").first();
    await expect(strip).toBeVisible();
    await expect(strip.locator("> *")).toHaveCount(5);

    await expectNoHorizontalOverflow(page);
  });

  test("the mobile bottom bar leads with the seller's own modules", async ({
    page,
    request,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium-mobile", "mobile chrome only");
    await prefs(page, "en");
    await signIn(page, request, IDENTITIES.distributor);
    await page.goto("/b2b");

    // The PATTERN is unchanged (four modules plus a More sheet); the stance only
    // decides which four earn a slot.
    const bar = page.getByRole("navigation", { name: "Workspace" }).last();
    await expect(bar.getByRole("link", { name: /Incoming demand/ })).toBeVisible();
    await expect(bar.getByRole("button", { name: /More/ })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});

// ---------------------------------------------------------------------------
// The showroom must be unaffected: this sprint reordered a workspace, it did not
// change the one that was already shipping.
// ---------------------------------------------------------------------------
test.describe("the buyer seat is unchanged", () => {
  test("a showroom still leads with purchasing and sees no seller-seat labels", async ({
    page,
    request,
  }) => {
    await prefs(page, "en");
    await signIn(page, request, IDENTITIES.showroom);

    await page.goto("/b2b");
    await expect(page.locator("main h1")).toHaveText("Your day at a glance");

    await page.goto("/b2b/rfqs");
    await expect(page.locator("main h1")).toHaveText("Purchase requests");

    await page.goto("/b2b/quotations");
    await expect(page.locator("main h1")).toHaveText("Incoming offers");

    // The customer-network module belongs to the seller layout only — a showroom
    // already has its CRM and must not get a second door to the same idea.
    const nav = page.getByRole("navigation", { name: "Workspace" }).first();
    await expect(nav.getByRole("link", { name: "Customers & showrooms", exact: true })).toHaveCount(
      0,
    );
  });
});
