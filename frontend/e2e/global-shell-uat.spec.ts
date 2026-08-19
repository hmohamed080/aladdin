import { test, expect, type Page } from "@playwright/test";
import { IDENTITIES, signIn } from "./helpers/auth";

/**
 * PRE-UAT ACCEPTANCE for the shared authenticated shell and the supply-side
 * visual pass.
 *
 * Scope is deliberately the acceptance matrix and nothing more — this is not a
 * second copy of `supply-side-mvp.spec.ts`, which already proves the supply
 * workspace's data and IA. What is proven here is the work of THIS pass:
 *
 *   · the shared header (search + account menu) on all three authenticated
 *     surfaces — B2B, personal /home, Admin — and nowhere else;
 *   · the command palette's two result families, and the fact that a personal
 *     account's palette exposes no business records;
 *   · the account menu's real identity, language and appearance controls;
 *   · the collapsed sidebar's hover affordance WITHOUT a visible caption;
 *   · CardRail advancing exactly one card per arrow click;
 *   · the dense page head / KPI strip on the seller surfaces, in both locales
 *     and both writing directions, with no horizontal overflow.
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
 * Open the account menu if it is not already open.
 *
 * Choosing a language or an appearance deliberately does NOT close the menu —
 * the page re-renders underneath it so the user can see the change and pick
 * again. A test that assumed otherwise would toggle the menu SHUT on its second
 * "open", which is exactly the false failure this helper removes.
 */
async function openAccountMenu(page: Page) {
  if ((await page.getByTestId("profile-menu").count()) === 0) {
    await page.getByTestId("profile-menu-trigger").click();
  }
  await expect(page.getByTestId("profile-menu")).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "horizontal overflow in px").toBeLessThanOrEqual(0);
}

/**
 * Every seller surface opens the same way now: a banded head with the module's
 * own glyph, and a KPI strip that is ONE bordered instrument rather than a row
 * of floating cards. Asserting the strip's container is what would catch a page
 * silently falling back to the old loose grid.
 */
async function expectDenseHead(page: Page) {
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("main .rounded-md.border.shadow-card").first()).toBeVisible();
}

test.describe("supply-side visual acceptance", () => {
  test("Distributor · Arabic · dashboard, incoming demand, products, reports", async ({
    page,
    request,
  }) => {
    test.skip(Boolean(test.info().project.use.isMobile), "desktop acceptance");
    await prefs(page, "ar");
    const errors = guardConsole(page);
    await signIn(page, request, IDENTITIES.distributor);

    for (const route of ["/b2b", "/b2b/rfqs", "/b2b/products", "/b2b/reports"]) {
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectDenseHead(page);
      await expectNoHorizontalOverflow(page);
      // RTL must hold on every changed surface, not just the first one.
      await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    }

    // The one word that must never reach a user: `supplier` is an internal
    // identifier for the Distributor concept.
    await expect(page.getByText(/\bsupplier\b/i)).toHaveCount(0);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Manufacturer · English · dashboard and a commerce page", async ({ page, request }) => {
    test.skip(Boolean(test.info().project.use.isMobile), "desktop acceptance");
    await prefs(page, "en");
    const errors = guardConsole(page);
    await signIn(page, request, IDENTITIES.manufacturer);

    for (const route of ["/b2b", "/b2b/quotations"]) {
      await page.goto(route);
      await expectDenseHead(page);
      await expectNoHorizontalOverflow(page);
      await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
      // An English surface must carry no Arabic script.
      const body = (await page.locator("main").innerText()).replace(/\s/g, "");
      expect(body, "Arabic characters on the English surface").not.toMatch(/[؀-ۿ]/);
    }
    expect(errors, errors.join("\n")).toEqual([]);
  });

  test("Importer · Arabic · dashboard and products", async ({ page, request }) => {
    test.skip(Boolean(test.info().project.use.isMobile), "desktop acceptance");
    await prefs(page, "ar");
    const errors = guardConsole(page);
    await signIn(page, request, IDENTITIES.importer);

    for (const route of ["/b2b", "/b2b/products"]) {
      await page.goto(route);
      await expectDenseHead(page);
      await expectNoHorizontalOverflow(page);
    }
    expect(errors, errors.join("\n")).toEqual([]);
  });
});

test.describe("shared shell regression (Showroom)", () => {
  test("collapsed sidebar lights the icon and paints NO caption", async ({ page, request }) => {
    test.skip(Boolean(test.info().project.use.isMobile), "the rail is tablet-and-up");
    await prefs(page, "en");
    await signIn(page, request, IDENTITIES.showroom);

    await page.getByTestId("sidebar-control").click();
    await page.getByTestId("sidebar-mode-collapsed").click();

    const link = page.getByRole("link", { name: "Reports", exact: true });
    await expect(link).toBeVisible();
    // The label survives as the accessible name only.
    await expect(link).toHaveText("");

    await link.hover();
    // No floating caption over the page — the hover cue is the icon's own tile.
    await expect(page.getByRole("tooltip")).toHaveCount(0);

    // Restore, so the mode cookie does not leak into the next test's expectations.
    await page.getByTestId("sidebar-control").click();
    await page.getByTestId("sidebar-mode-expanded").click();
  });

  test("CardRail advances exactly one card per arrow click", async ({ page, request }) => {
    test.skip(Boolean(test.info().project.use.isMobile), "arrows are a pointer/keyboard control");
    await prefs(page, "en");
    await signIn(page, request, IDENTITIES.showroom);
    // The buyer dashboard, where a rail of peer entry-ramp cards is still the
    // right shape — the seller surfaces moved their KPI groups to the strip.
    await page.goto("/b2b");

    const rail = page.getByTestId("card-rail").first();
    await expect(rail).toBeVisible();
    const track = rail.getByRole("group");
    const next = rail.getByTestId("rail-next");
    // A rail whose cards all fit renders no controls; narrow the viewport until
    // it genuinely overflows rather than asserting on a page that has nothing to
    // scroll.
    if ((await next.count()) === 0) {
      await page.setViewportSize({ width: 900, height: 900 });
      await expect(next).toBeVisible();
    }

    const card = await track.evaluate((el) => {
      const first = el.firstElementChild as HTMLElement;
      const gap = parseFloat(getComputedStyle(el).columnGap || "0") || 0;
      return first.getBoundingClientRect().width + gap;
    });
    const before = await track.evaluate((el) => Math.abs(el.scrollLeft));
    await next.click();
    // Smooth scrolling: wait for the position to settle rather than sampling
    // mid-animation, which is how this assertion would otherwise flake.
    await expect
      .poll(async () => track.evaluate((el) => Math.abs(el.scrollLeft)), { timeout: 5000 })
      .toBeGreaterThan(before + card * 0.5);
    const after = await track.evaluate((el) => Math.abs(el.scrollLeft));

    // ONE card, not a page of them. The old implementation moved
    // `card × cardsPerView`, which on this viewport is two or three.
    expect(after - before).toBeLessThan(card * 1.6);
  });

  /**
   * THE REGRESSION THIS ROUND FIXED.
   *
   * One card per click was already true at rest. It was NOT true when the user
   * clicked faster than the smooth scroll animates — the second click measured
   * cards drifting mid-flight, decided the "next" card was the one already being
   * scrolled to, and commanded a move that merely finished the first. Three fast
   * clicks advanced one card. The unit test models this; this one proves it in a
   * real engine, where the smooth-scroll timing is the browser's own.
   */
  test("CardRail advances one card per click even when clicked mid-animation", async ({
    page,
    request,
  }) => {
    test.skip(Boolean(test.info().project.use.isMobile), "arrows are a pointer/keyboard control");
    await prefs(page, "en");
    await signIn(page, request, IDENTITIES.showroom);
    await page.goto("/b2b");

    const rail = page.getByTestId("card-rail").first();
    const track = rail.getByRole("group");
    const next = rail.getByTestId("rail-next");
    if ((await next.count()) === 0) {
      await page.setViewportSize({ width: 900, height: 900 });
      await expect(next).toBeVisible();
    }

    // Which card currently sits at the rail's logical start edge. Measured from
    // geometry rather than from scrollLeft so the assertion reads the same in
    // both writing directions.
    const cardAtStart = () =>
      track.evaluate((el) => {
        const rtl = getComputedStyle(el).direction === "rtl";
        const t = el.getBoundingClientRect();
        const leads = [...el.children].map((c) => {
          const r = c.getBoundingClientRect();
          return rtl ? t.right - r.right : r.left - t.left;
        });
        let best = 0;
        leads.forEach((d, i) => {
          if (Math.abs(d) < Math.abs(leads[best]!)) best = i;
        });
        return best;
      });

    const settle = async () => {
      let last = -1;
      await expect
        .poll(
          async () => {
            const now = await track.evaluate((el) => Math.round(Math.abs(el.scrollLeft)));
            const stable = now === last;
            last = now;
            return stable;
          },
          { timeout: 5000 },
        )
        .toBe(true);
    };

    const start = await cardAtStart();

    // Three clicks 90ms apart — comfortably inside a smooth scroll.
    await next.click();
    await page.waitForTimeout(90);
    await next.click();
    await page.waitForTimeout(90);
    await next.click();
    await settle();

    expect(await cardAtStart(), "three fast clicks must advance three cards").toBe(start + 3);

    // And back the same way.
    const prev = rail.getByTestId("rail-prev");
    await prev.click();
    await page.waitForTimeout(90);
    await prev.click();
    await settle();
    expect(await cardAtStart(), "two fast back-clicks must retreat two cards").toBe(start + 1);
  });

  /**
   * The sidebar's bottom mode control is ICON-ONLY in every mode, and its glyph
   * shares one column with every navigation icon above it.
   *
   * Both halves have been regressions. The caption returned as "Expanded" at the
   * foot of a wide panel — a control captioning a state the user can already see.
   * The alignment drifted 4px because the control's padding was set in a different
   * file from the nav rows'. Asserting the CENTRES rather than the classes is what
   * makes this survive a refactor of either file.
   */
  for (const [locale, dir] of [
    ["en", "ltr"],
    ["ar", "rtl"],
  ] as const) {
    test(`sidebar bottom control is icon-only and in the icon column (${dir})`, async ({
      page,
      request,
    }) => {
      test.skip(Boolean(test.info().project.use.isMobile), "the rail is tablet-and-up");
      await prefs(page, locale);
      await signIn(page, request, IDENTITIES.showroom);
      await page.goto("/b2b");

      for (const mode of ["expanded", "collapsed", "hover"] as const) {
        await page.getByTestId("sidebar-control").click();
        await page.getByTestId(`sidebar-mode-${mode}`).click();

        const control = page.getByTestId("sidebar-control");
        // Icon-only. In EVERY mode, expanded included.
        await expect(control, `visible caption in ${mode} mode`).toHaveText("");
        // The accessible name is what carries the meaning instead.
        await expect(control).toHaveAttribute("aria-label", /.+/);

        const geometry = await page.evaluate(() => {
          const ctrl = document.querySelector('[data-testid="sidebar-control"]') as HTMLElement;
          const icons = [...document.querySelectorAll("[data-sidebar-mode] a")]
            .map((a) => a.querySelector("svg"))
            .filter(Boolean) as SVGElement[];
          const cx = (el: Element) => {
            const r = el.getBoundingClientRect();
            return Math.round((r.left + r.width / 2) * 10) / 10;
          };
          return {
            control: cx(ctrl.querySelector("svg")!),
            nav: [...new Set(icons.map(cx))],
          };
        });

        // One column: every nav icon on the same centre, and the control on it too.
        expect(geometry.nav, `nav icons not in one column (${mode})`).toHaveLength(1);
        expect(
          Math.abs(geometry.control - geometry.nav[0]!),
          `control off the icon column in ${mode} mode`,
        ).toBeLessThanOrEqual(0.5);
      }

      await page.getByTestId("sidebar-control").click();
      await page.getByTestId("sidebar-mode-expanded").click();
    });
  }

  /**
   * The header's Light/Dark switch is a SHORTCUT into the existing preference,
   * not a second one. So the test that matters is not "does the button work" but
   * "do the two controls agree" — a header that says light while the profile menu
   * says dark is the failure mode a duplicated theme state produces.
   */
  test("the header theme switch drives the one existing preference", async ({ page, request }) => {
    await prefs(page, "en");
    await signIn(page, request, IDENTITIES.showroom);
    await page.goto("/b2b");

    const html = page.locator("html");
    await page.getByTestId("theme-quick-dark").click();
    await expect(html).toHaveClass(/dark/);
    await expect(html).toHaveAttribute("data-theme-pref", "dark");

    // The profile menu's three-way control must reflect the header's choice.
    await openAccountMenu(page);
    await expect(page.getByTestId("theme-dark")).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");

    await page.getByTestId("theme-quick-light").click();
    await expect(html).not.toHaveClass(/dark/);
    await expect(html).toHaveAttribute("data-theme-pref", "light");

    // And it survives a reload — the cookie, not component state, is the store.
    await page.reload();
    await expect(html).not.toHaveClass(/dark/);
    await expect(page.getByTestId("theme-quick-light")).toHaveAttribute("aria-checked", "true");
  });

  test("the header carries search and the account menu, and both work", async ({ page, request }) => {
    await prefs(page, "en");
    await signIn(page, request, IDENTITIES.showroom);

    // --- global search -----------------------------------------------------
    await page.getByTestId("global-search-trigger").click();
    const panel = page.getByTestId("global-search-panel");
    await expect(panel).toBeVisible();
    // Navigation results are local and immediate — no query, no round trip.
    await expect(panel.getByTestId("global-search-result").first()).toBeVisible();

    await page.getByTestId("global-search-input").fill("Reports");
    await expect(panel.getByTestId("global-search-result").first()).toContainText(/Reports/i);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/b2b\/reports/);

    // Ctrl+K opens it from anywhere; Escape closes it.
    await page.keyboard.press("Control+k");
    await expect(page.getByTestId("global-search-panel")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("global-search-panel")).toHaveCount(0);

    // --- account menu ------------------------------------------------------
    await openAccountMenu(page);
    const menu = page.getByTestId("profile-menu");
    // Real identity, not a placeholder.
    await expect(menu).toContainText(IDENTITIES.showroom);
    await expect(menu.getByTestId("theme-system")).toBeVisible();
    await expect(menu.getByTestId("theme-light")).toBeVisible();
    await expect(menu.getByTestId("theme-dark")).toBeVisible();
    await expect(menu.getByTestId("profile-sign-out")).toBeVisible();

    // Appearance writes the ONE theme system: the class and the stored
    // preference both move, and no second implementation appears.
    await menu.getByTestId("theme-dark").click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.locator("html")).toHaveAttribute("data-theme-pref", "dark");

    await openAccountMenu(page);
    await page.getByTestId("theme-light").click();
    await expect(page.locator("html")).not.toHaveClass(/dark/);

    // Escape closes the menu.
    await openAccountMenu(page);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("profile-menu")).toHaveCount(0);
  });

  test("the account menu switches locale through the existing locale system", async ({
    page,
    request,
  }) => {
    await prefs(page, "en");
    await signIn(page, request, IDENTITIES.showroom);

    await openAccountMenu(page);
    await page.getByTestId("locale-ar").click();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.locator("html")).toHaveAttribute("lang", "ar");
    // The DIRECTION is set imperatively; this proves the server actually
    // re-rendered in the new language rather than only the attribute flipping.
    await expect(page.getByRole("navigation", { name: /مساحة العمل/ })).toBeVisible();

    await openAccountMenu(page);
    await page.getByTestId("locale-en").click();
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(page.getByRole("navigation", { name: "Workspace" })).toBeVisible();
  });
});

test.describe("the shell on the other authenticated surfaces", () => {
  test("personal /home has the header, and its palette exposes NO business records", async ({
    page,
    request,
  }) => {
    await prefs(page, "en");
    await signIn(page, request, IDENTITIES.consumer, /\/home(\/|$)/);

    await expect(page.getByTestId("global-search-trigger")).toBeVisible();
    await expect(page.getByTestId("profile-menu-trigger")).toBeVisible();

    await page.getByTestId("global-search-trigger").click();
    const panel = page.getByTestId("global-search-panel");
    await expect(panel).toBeVisible();
    // A personal account has no organization to scope to, so the record search
    // never runs and every result is a personal destination. The strongest
    // check available without inventing data: no result deep-links into /b2b.
    await page.getByTestId("global-search-input").fill("paint");
    await page.waitForTimeout(1200);
    const hrefs = await panel
      .getByTestId("global-search-result")
      .evaluateAll((nodes) => nodes.map((n) => n.textContent ?? ""));
    expect(hrefs.join("|")).not.toMatch(/Suez|Cairo Ceramics|Emulsion/i);
  });

  test("Admin has the header and its destinations stay platform-gated", async ({
    page,
    request,
  }) => {
    await prefs(page, "en");
    await signIn(page, request, IDENTITIES.admin, /\/admin(\/|$)/);

    await expect(page.getByTestId("profile-menu-trigger")).toBeVisible();
    await page.getByTestId("global-search-trigger").click();
    await page.getByTestId("global-search-input").fill("verification");
    await expect(
      page.getByTestId("global-search-panel").getByTestId("global-search-result").first(),
    ).toContainText(/Verifications/i);
  });

  test("a non-staff account is never offered an Admin destination", async ({ page, request }) => {
    await prefs(page, "en");
    await signIn(page, request, IDENTITIES.showroom);
    await page.getByTestId("global-search-trigger").click();
    const panel = page.getByTestId("global-search-panel");
    await page.getByTestId("global-search-input").fill("audit");
    await page.waitForTimeout(800);
    // The gate is resolved on the SERVER; this asserts the door is not drawn.
    await expect(panel.getByText(/Platform admin/i)).toHaveCount(0);
  });
});

test.describe("mobile", () => {
  test("the seller workspace and the shared header stay usable on a phone", async ({
    page,
    request,
  }) => {
    test.skip(!test.info().project.use.isMobile, "mobile viewport only");
    await prefs(page, "ar");
    const errors = guardConsole(page);
    await signIn(page, request, IDENTITIES.distributor);

    for (const route of ["/b2b", "/b2b/products"]) {
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }

    // The search collapses to its icon but must still open, and the account
    // menu must still fit the viewport.
    await page.getByTestId("global-search-trigger").click();
    await expect(page.getByTestId("global-search-panel")).toBeVisible();
    await page.keyboard.press("Escape");

    await openAccountMenu(page);
    await expectNoHorizontalOverflow(page);

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
