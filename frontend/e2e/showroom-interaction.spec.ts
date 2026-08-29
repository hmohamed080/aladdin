import { test, expect, type Page } from "@playwright/test";
import { IDENTITIES, signIn } from "./helpers/auth";
import { setSidebarMode } from "./helpers/sidebar";

/**
 * Sprint 14 refinement — workspace sidebar modes and horizontal card rails.
 *
 * Signed in as the Showroom/Dealer acceptance account (Cairo Ceramics, hana@),
 * because these two patterns only earn their keep against a workspace that is
 * actually dense: the showroom owner reaches every nav section and every
 * dashboard tile, so a collapsed rail that silently dropped a module, or a rail
 * whose arrows never settled, would show up here and nowhere else.
 *
 * What is asserted is BEHAVIOUR, not pixels: which modules survive a collapse,
 * which direction a reveal grows, whether the preference outlives a reload, and
 * whether any of it lets the page scroll sideways.
 */

/** The app's default locale is ARABIC, so English needs the cookie set explicitly. */
async function prefs(page: Page, locale: "en" | "ar") {
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: locale, url: "http://127.0.0.1" }]);
}

const sidebar = (page: Page) => page.locator("[data-sidebar-mode]");
const control = (page: Page) => page.getByTestId("sidebar-control");

/* Delegates to the shared helper. A click on the control is a binary toggle and
   no longer opens the menu — see `helpers/sidebar.ts`. Kept as a local alias so
   the call sites below read the same as they always did. */
const setMode = (page: Page, mode: "expanded" | "collapsed" | "hover") =>
  setSidebarMode(page, mode);

/** Width of the element that actually RESERVES layout space in the shell. */
async function restingWidth(page: Page): Promise<number> {
  return (await sidebar(page).boundingBox())!.width;
}

/** Width of the visible panel. The sidebar PUSHES, so this tracks the spacer. */
async function panelWidth(page: Page): Promise<number> {
  return (await sidebar(page).locator("> div").first().boundingBox())!.width;
}

/** The page itself must never scroll sideways, at any viewport, in any locale. */
async function expectNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const d = document.documentElement;
    return d.scrollWidth - d.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);
}

test.describe("Workspace sidebar display modes", () => {
  test.skip(({ isMobile }) => !!isMobile, "Desktop modes do not apply to the mobile shell.");

  test("offers exactly three modes and keeps every module reachable in each", async ({
    page,
    request,
  }) => {
    await prefs(page, "en");
    await signIn(page, request, IDENTITIES.showroom);
    await page.goto("/b2b");

    /* REACHABILITY IS A SET OF ROUTES, NOT A COUNT OF ANCHORS.
       This used to compare `links.count()` across the three modes, which was a
       fair proxy while every mode drew the same flat list. The approved rail
       breaks that proxy honestly: a COLLAPSED secondary group draws one extra
       representative icon standing for the group itself, so the rail has three
       MORE anchors than the expanded panel while offering exactly the same
       modules. A count comparison reads that as a regression; it is the design.

       So the property asserted is the one that actually matters — every route
       reachable when expanded is still reachable in the other two modes. */
    const hrefsIn = async () =>
      new Set(
        (await sidebar(page).getByRole("link").evaluateAll((els) =>
          els.map((e) => (e as HTMLAnchorElement).getAttribute("href")),
        )).filter(Boolean) as string[],
      );

    const links = sidebar(page).getByRole("link");
    const expanded = await links.count();
    expect(expanded).toBeGreaterThan(10); // A showroom owner reaches the full IA.
    const expandedHrefs = await hrefsIn();

    /* FOCUS, NOT CLICK. A click on this control is a binary Expanded ↔
       Collapsed toggle; the three-mode menu is the rarer, deliberate choice and
       opens on hover or keyboard focus. See `helpers/sidebar.ts`. */
    await control(page).focus();
    await expect(page.getByRole("menuitem")).toHaveText([
      "Expanded",
      "Collapsed",
      "Expand on hover",
    ]);
    await page.keyboard.press("Escape");

    // Collapsing is a change of PRESENTATION. Losing a route here would mean a
    // user could not reach a module they have the capability for.
    await setMode(page, "collapsed");
    for (const href of expandedHrefs) {
      expect([...(await hrefsIn())], `"${href}" unreachable on the collapsed rail`).toContain(href);
    }
    await setMode(page, "hover");
    for (const href of expandedHrefs) {
      expect([...(await hrefsIn())], `"${href}" unreachable in expand-on-hover`).toContain(href);
    }
  });

  test("collapsed is a narrow rail that still names its items and marks the active route", async ({
    page,
    request,
  }) => {
    await prefs(page, "en");
    await signIn(page, request, IDENTITIES.showroom);
    await page.goto("/b2b/catalog");

    const wide = await restingWidth(page);
    await setMode(page, "collapsed");
    const narrow = await restingWidth(page);
    expect(narrow).toBeLessThan(wide / 2);

    // The label is gone from the screen but must survive as the accessible name.
    const catalog = sidebar(page).getByRole("link", { name: "Browse products" });
    await expect(catalog).toBeVisible();
    await expect(catalog).toHaveAttribute("aria-current", "page");

    // Hovering must NOT bring the word back as a floating caption.
    //
    // It used to. Two problems, and neither was cosmetic: the caption rendered
    // outside the rail, over page content, so running the pointer down the icons
    // flashed a box in and out over the workspace; and in expand-on-hover mode
    // the rail was already opening to show that exact word, so the same label
    // appeared twice in two places. The hover cue is now the icon's own tile.
    // The accessible name above is what carries the label.
    await catalog.hover();
    await expect(sidebar(page).locator('[role="tooltip"]')).toHaveCount(0);
    await expect(catalog).toHaveText("");
  });

  test("expand-on-hover pushes the workspace rather than floating over it", async ({
    page,
    request,
  }) => {
    await prefs(page, "en");
    await signIn(page, request, IDENTITIES.showroom);
    await page.goto("/b2b");
    await setMode(page, "hover");
    // Park the pointer off the panel; choosing the mode left it hovering there,
    // which is a real reveal and would make the assertion below vacuous.
    await page.mouse.move(1000, 600);
    await expect(sidebar(page)).toHaveAttribute("data-sidebar-open", "false");

    const restingBefore = await restingWidth(page);
    const mainBefore = (await page.locator("#main").boundingBox())!;

    await sidebar(page).locator("> div").first().hover();
    await expect(sidebar(page)).toHaveAttribute("data-sidebar-open", "true");
    await expect.poll(() => panelWidth(page)).toBeGreaterThan(restingBefore * 2);

    /* THE APPROVED BEHAVIOUR IS A PUSH, AND THIS ASSERTION IS THE INVERSE OF
       WHAT IT USED TO BE. The reveal used to float the panel OVER the page: the
       spacer held its resting width and `#main` never moved. The approved
       direction makes the sidebar widening the application's own width changing,
       so the spacer animates with the panel and the workspace gives up the room.

       Polled rather than read once — the spacer animates on a spring, so the
       instant after `data-sidebar-open` flips it is still mid-travel. */
    await expect.poll(() => restingWidth(page)).toBeGreaterThan(restingBefore * 2);
    await expect
      .poll(async () => (await page.locator("#main").boundingBox())!.width)
      .toBeLessThan(mainBefore.width);

    // The document must not gain a sideways scrollbar while doing it.
    await expectNoPageOverflow(page);

    await page.locator("#main").hover();
    await expect(sidebar(page)).toHaveAttribute("data-sidebar-open", "false");
  });

  test("a keyboard alone can reveal and use the hover sidebar", async ({ page, request }) => {
    await prefs(page, "en");
    await signIn(page, request, IDENTITIES.showroom);
    await page.goto("/b2b");
    await setMode(page, "hover");
    // Choosing the mode leaves the pointer sitting on the panel, and in hover
    // mode that is a legitimate reveal — park the pointer over the page first so
    // what follows tests the KEYBOARD and not a leftover hover.
    await page.mouse.move(1000, 600);
    await expect(sidebar(page)).toHaveAttribute("data-sidebar-open", "false");

    // Focus alone must open it — otherwise the rail is pointer-only.
    await sidebar(page).getByRole("link", { name: "Home" }).focus();
    await expect(sidebar(page)).toHaveAttribute("data-sidebar-open", "true");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/b2b$/);
  });

  test("the preference survives a reload without a flash of the wrong width", async ({
    page,
    request,
  }) => {
    await prefs(page, "en");
    await signIn(page, request, IDENTITIES.showroom);
    await page.goto("/b2b");
    await setMode(page, "collapsed");
    const narrow = await restingWidth(page);

    await page.reload();
    await expect(sidebar(page)).toHaveAttribute("data-sidebar-mode", "collapsed");
    expect(await restingWidth(page)).toBe(narrow);

    // The width is server-rendered, so it is correct in the FIRST HTML response —
    // this is what rules out the post-hydration snap.
    const html = await (await page.request.get("/b2b")).text();
    expect(html).toContain('data-sidebar-mode="collapsed"');

    // And it carries across a navigation, not just a refresh.
    await page.goto("/b2b/reports");
    expect(await restingWidth(page)).toBe(narrow);
  });

  test("Arabic reveals inward from the correct edge", async ({ page, request }) => {
    await prefs(page, "ar");
    await signIn(page, request, IDENTITIES.showroom);
    await page.goto("/b2b");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

    // RTL puts the sidebar on the RIGHT: its right edge hugs the viewport.
    const viewport = page.viewportSize()!;
    const box = (await sidebar(page).boundingBox())!;
    expect(Math.round(box.x + box.width)).toBe(viewport.width);

    await setMode(page, "hover");
    await page.mouse.move(400, 600);
    await expect(sidebar(page)).toHaveAttribute("data-sidebar-open", "false");
    const railLeft = (await sidebar(page).boundingBox())!.x;
    await sidebar(page).locator("> div").first().hover();
    await expect(sidebar(page)).toHaveAttribute("data-sidebar-open", "true");

    // Growing INWARD in RTL means the panel's left edge moves further left while
    // its right edge stays pinned. A direction bug would push it off-screen right.
    const panel = (await sidebar(page).locator("> div").first().boundingBox())!;
    expect(panel.x).toBeLessThan(railLeft);
    expect(Math.round(panel.x + panel.width)).toBe(viewport.width);
    await expectNoPageOverflow(page);
  });
});

test.describe("Horizontal card rails", () => {
  test("dashboard rails scroll, settle their arrows, and never widen the page", async ({
    page,
    request,
  }) => {
    await prefs(page, "en");
    await signIn(page, request, IDENTITIES.showroom);
    await page.goto("/b2b");

    // Scope to ONE rail: the dashboard has two (tiles and the action ramp), and
    // an unscoped `rail-next` could pair one rail's scroller with the other's arrow.
    const root = page.getByTestId("card-rail").first();
    const rail = root.getByRole("group", { name: "Your day at a glance" });
    await expect(rail).toBeVisible();
    await expectNoPageOverflow(page);

    const next = root.getByTestId("rail-next");
    const prev = root.getByTestId("rail-prev");

    // Arrows appear only on real overflow, and overflow is measured in an effect
    // AFTER mount — so this waits rather than sampling. A bare `isVisible()` here
    // raced that effect and silently SKIPPED the whole test, which is worse than
    // a failure: the run stays green while nothing is checked. The showroom's
    // eight tiles overflow at every viewport this suite runs, so if this ever
    // stops being true it should fail loudly and be re-thought, not skipped.
    await expect(next).toBeVisible();

    await expect(prev).toBeDisabled();
    await expect(next).toBeEnabled();

    const start = await rail.evaluate((el) => Math.abs(el.scrollLeft));
    await next.click();
    await expect.poll(() => rail.evaluate((el) => Math.abs(el.scrollLeft))).toBeGreaterThan(start);
    await expect(prev).toBeEnabled();

    // Walk to the end; `next` must disable itself exactly there.
    //
    // Settling is not a courtesy wait, and a fixed delay is not enough. Chrome's
    // smooth-scroll duration scales with distance, so an enabled-check taken
    // mid-animation describes where the rail WAS. If the animation then finishes
    // and the arrow disables, `disabled:pointer-events-none` makes the click fall
    // through to the card underneath and Playwright waits out the whole test
    // timeout on a button that will never re-enable. So: wait until scrollLeft
    // actually stops moving, then decide.
    const settle = async () => {
      let last = -1;
      for (let i = 0; i < 40; i++) {
        const now = await rail.evaluate((el) => Math.abs(el.scrollLeft));
        if (now === last) return;
        last = now;
        await page.waitForTimeout(100);
      }
    };

    const walk = async (button: typeof next) => {
      for (let i = 0; i < 8; i++) {
        await settle();
        if (!(await button.isEnabled())) break;
        await button.click();
      }
      await settle();
    };

    await walk(next);
    await expect(next).toBeDisabled();
    await expectNoPageOverflow(page);

    // And back, symmetrically.
    await walk(prev);
    await expect(prev).toBeDisabled();
    await expect(next).toBeEnabled();
  });

  test("the Arabic rail travels the other way and still bounds its arrows", async ({
    page,
    request,
  }) => {
    await prefs(page, "ar");
    await signIn(page, request, IDENTITIES.showroom);
    await page.goto("/b2b");

    const root = page.getByTestId("card-rail").first();
    const rail = root.getByRole("group");
    await expect(rail).toBeVisible();
    const next = root.getByTestId("rail-next");
    const prev = root.getByTestId("rail-prev");
    await expect(next).toBeVisible();

    await expect(prev).toBeDisabled();
    // RTL scrollLeft goes NEGATIVE; the component reads the distance travelled,
    // so "moved" means the absolute value grew regardless of sign.
    await next.click();
    await expect.poll(() => rail.evaluate((el) => Math.abs(el.scrollLeft))).toBeGreaterThan(0);
    await expect(prev).toBeEnabled();
    await expectNoPageOverflow(page);
  });

  test("Reports keeps its money figures whole", async ({ page, request }) => {
    await prefs(page, "en");
    await signIn(page, request, IDENTITIES.showroom);
    await page.goto("/b2b/reports");

    // The rail this used to assert has been replaced by the shared KPI strip,
    // but the DEFECT it was written for is the one that matters and is still
    // guarded here: a committed-spend figure clipped mid-string does not look
    // clipped, it looks like a smaller number. Two things now prevent it — the
    // value is formatted compact, and the strip wraps instead of truncating —
    // so the check is that the rendered figure is COMPLETE, not that a
    // particular container is on the page.
    const value = page
      .locator("main")
      .getByText(/^EGP\s?[\d.,]+[KM]?$/)
      .first();
    await expect(value).toBeVisible();
    const clipped = await value.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(clipped, "the money figure is clipped by its cell").toBe(false);
    await expectNoPageOverflow(page);
  });
});

test.describe("Responsive shell", () => {
  test("mobile keeps its own navigation and never shows the desktop rail", async ({
    page,
    request,
    isMobile,
  }) => {
    test.skip(!isMobile, "Mobile-only assertion.");
    await prefs(page, "en");
    await signIn(page, request, IDENTITIES.showroom);
    await page.goto("/b2b");

    // The three desktop modes must not leak onto the phone.
    await expect(sidebar(page)).toBeHidden();
    await expect(control(page)).toBeHidden();
    await expect(page.getByRole("navigation", { name: "Workspace" }).last()).toBeVisible();
    await expectNoPageOverflow(page);
  });

  test("tablet shows the sidebar and the rails stay contained", async ({ page, request }) => {
    await page.setViewportSize({ width: 820, height: 1000 });
    await prefs(page, "en");
    await signIn(page, request, IDENTITIES.showroom);
    await page.goto("/b2b");

    await expect(sidebar(page)).toBeVisible();
    await expectNoPageOverflow(page);
    await setMode(page, "collapsed");
    await expectNoPageOverflow(page);
  });
});
