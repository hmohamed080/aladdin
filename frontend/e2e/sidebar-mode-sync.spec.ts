import { test, expect, type Page } from "@playwright/test";
import { signIn, IDENTITIES } from "./helpers/auth";
import {
  SIDEBAR_SPACER,
  hoverSidebar,
  leaveSidebar,
  setSidebarMode,
  settledShell,
  type ShellGeometry,
} from "./helpers/sidebar";

/**
 * THE SIDEBAR'S STATE AND ITS GEOMETRY MUST NEVER DISAGREE.
 *
 * This spec exists because they once did, in production: the shell reported
 * `data-sidebar-mode="expanded"` and `data-sidebar-open="true"` while
 * `--shell-nav-w` still read `3.5rem` and the spacer sat at the rail width — a
 * control announcing a state the sidebar was not in, with no self-correction.
 * The cause was two owners writing one custom property on two different
 * schedules (see `sidebar-shell.tsx`); the fix gave it exactly one.
 *
 * WHAT IS ASSERTED, AND WHY IT IS ASSERTED THIS WAY. Every check reads all four
 * facts together — the mode attribute, the open attribute, the ANIMATED VALUE
 * itself, and the resulting spacer width — because the defect was precisely a
 * disagreement BETWEEN them. Any assertion that read only one would have passed
 * happily while the bug was live: the attributes were correct the whole time.
 *
 * The geometry is only ever read once it has settled (`settledShell` requires
 * the expected value AND stability across consecutive samples), so nothing here
 * waits on a duration and nothing here can pass on a mid-flight coincidence.
 */

/** The animated custom property, per mode. The values the design system owns. */
const NAV_VAR = { rail: "3.5rem", expanded: "15rem" } as const;

async function prefs(page: Page, locale: "en" | "ar") {
  await page.context().addCookies([{ name: "NEXT_LOCALE", value: locale, url: "http://127.0.0.1" }]);
}

/**
 * The full contract for one resting state: state, animated value and geometry
 * agreeing at once.
 */
function expectInSync(g: ShellGeometry, width: "rail" | "expanded", open: boolean, label: string) {
  expect(g.spacer, `${label}: spacer width`).toBe(SIDEBAR_SPACER[width]);
  expect(g.navVar, `${label}: --shell-nav-w agrees with the spacer`).toBe(NAV_VAR[width]);
  expect(g.open, `${label}: open attribute`).toBe(open ? "true" : "false");
}

/** The page itself must never scroll sideways, in any mode or direction. */
async function expectNoOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${label} horizontal overflow (px)`).toBeLessThanOrEqual(1);
}

for (const locale of ["en", "ar"] as const) {
  test(`sidebar mode and animated width stay in sync (${locale})`, async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name === "chromium-mobile", "display modes are tablet-and-up chrome");
    test.setTimeout(180_000);

    await prefs(page, locale);
    await signIn(page, request, IDENTITIES.distributor, /\/(b2b|home|onboarding)(\/|$)/);
    await page.goto("/b2b");
    if (locale === "ar") await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

    const shell = page.locator("[data-sidebar-mode]");

    // ---- EXPANDED (the seeded default) -------------------------------------
    const expanded = await settledShell(page, "expanded");
    expectInSync(expanded, "expanded", true, "initial expanded");
    expect(expanded.rtl, "geometry is read in this locale's own terms").toBe(locale === "ar");

    // ---- EXPANDED -> COLLAPSED ---------------------------------------------
    await setSidebarMode(page, "collapsed");
    await expect(shell).toHaveAttribute("data-sidebar-mode", "collapsed");
    const collapsed = await settledShell(page, "rail");
    expectInSync(collapsed, "rail", false, "expanded -> collapsed");
    /* And the workspace took the room back. A collapse that narrowed the panel
       without reflowing the page would leave a strip of empty frame, which the
       attributes alone cannot tell apart from a real reflow. */
    expect(collapsed.workspaceStart, "workspace follows the rail in").toBeLessThan(
      expanded.workspaceStart,
    );
    expect(collapsed.workspaceWidth).toBeGreaterThan(expanded.workspaceWidth);

    // ---- COLLAPSED -> EXPANDED ---------------------------------------------
    await setSidebarMode(page, "expanded");
    expectInSync(await settledShell(page, "expanded"), "expanded", true, "collapsed -> expanded");

    // ---- EXPANDED -> HOVER (rests at the rail) ------------------------------
    await setSidebarMode(page, "hover");
    await expect(shell).toHaveAttribute("data-sidebar-mode", "hover");
    const resting = await settledShell(page, "rail");
    expectInSync(resting, "rail", false, "hover resting");

    // ---- HOVER: reveal pushes, leaving restores ----------------------------
    const revealed = await hoverSidebar(page);
    expectInSync(revealed, "expanded", true, "hover revealed");
    const gained = SIDEBAR_SPACER.expanded - SIDEBAR_SPACER.rail;
    expect(revealed.workspaceStart - resting.workspaceStart, "revealed: pushed, not overlaid").toBe(
      gained,
    );
    expect(resting.workspaceWidth - revealed.workspaceWidth, "by exactly the room taken").toBe(
      gained,
    );
    await expectNoOverflow(page, `${locale}/revealed`);

    const rested = await leaveSidebar(page, "rail");
    expectInSync(rested, "rail", false, "hover left");
    expect(rested.workspaceStart, "workspace comes back with it").toBe(resting.workspaceStart);

    /* ---- HOVER -> EXPANDED, THE TRANSITION THIS SPEC EXISTS FOR ------------
       `open` is true on both sides of this switch, so the resolved width does
       NOT change across the render that changes the mode. That is exactly the
       case where a second writer had nothing to correct and left the property
       stranded at the rail. It must settle expanded, every time. */
    await setSidebarMode(page, "expanded");
    await expect(shell).toHaveAttribute("data-sidebar-mode", "expanded");
    expectInSync(await settledShell(page, "expanded"), "expanded", true, "hover -> expanded");

    // ---- HOVER -> COLLAPSED ------------------------------------------------
    await setSidebarMode(page, "hover");
    await settledShell(page, "rail");
    await setSidebarMode(page, "collapsed");
    await expect(shell).toHaveAttribute("data-sidebar-mode", "collapsed");
    expectInSync(await settledShell(page, "rail"), "rail", false, "hover -> collapsed");

    // ---- A ROUTE CHANGE KEEPS BOTH THE MODE AND ITS GEOMETRY ---------------
    await page.goto("/b2b/rfqs");
    await expect(shell).toHaveAttribute("data-sidebar-mode", "collapsed");
    expectInSync(await settledShell(page, "rail"), "rail", false, "collapsed across a route change");
    await expectNoOverflow(page, `${locale}/collapsed/rfqs`);

    await setSidebarMode(page, "expanded");
    await page.goto("/b2b/quotations");
    await expect(shell).toHaveAttribute("data-sidebar-mode", "expanded");
    expectInSync(
      await settledShell(page, "expanded"),
      "expanded",
      true,
      "expanded across a route change",
    );
    await expectNoOverflow(page, `${locale}/expanded/quotations`);
  });
}

test("the mode and its width stay in sync under reduced motion", async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name === "chromium-mobile", "display modes are tablet-and-up chrome");
  test.setTimeout(180_000);

  /* The spring is the half of this the synchronisation has to survive, so the
     same transitions run with it switched off: `useReducedMotion` collapses the
     animation to `{ duration: 0 }`, which writes the value in one step instead
     of over a spring. A fix that only held at one of those two speeds would be
     tuned to a duration rather than to the state. */
  await page.emulateMedia({ reducedMotion: "reduce" });
  await prefs(page, "en");
  await signIn(page, request, IDENTITIES.distributor, /\/(b2b|home|onboarding)(\/|$)/);
  await page.goto("/b2b");

  expectInSync(await settledShell(page, "expanded"), "expanded", true, "reduced: initial");

  await setSidebarMode(page, "hover");
  const resting = await settledShell(page, "rail");
  expectInSync(resting, "rail", false, "reduced: hover resting");

  const revealed = await hoverSidebar(page);
  expectInSync(revealed, "expanded", true, "reduced: hover revealed");
  expect(revealed.workspaceStart - resting.workspaceStart, "reduced: still a push").toBe(
    SIDEBAR_SPACER.expanded - SIDEBAR_SPACER.rail,
  );

  await leaveSidebar(page, "rail");
  await setSidebarMode(page, "expanded");
  expectInSync(await settledShell(page, "expanded"), "expanded", true, "reduced: hover -> expanded");

  await setSidebarMode(page, "collapsed");
  expectInSync(await settledShell(page, "rail"), "rail", false, "reduced: expanded -> collapsed");
  await expectNoOverflow(page, "reduced/collapsed");
});
