import { test, expect, type Page } from "@playwright/test";
import { IDENTITIES, signIn } from "./helpers/auth";

/**
 * The Showroom sidebar must stay MOUNTED while a link moves between the two route trees it points into
 * (`/showroom/*` and `/b2b/*`). See ADR-0025.
 *
 * Before the `(workspace)` route group, each tree owned its own layout, so a link that crossed from one to the
 * other tore the whole shell down and built it again: the sidebar's scroll position reset and every shell query
 * ran again. The check is made on the DOM itself rather than on a screenshot: a property set on the <nav> element
 * survives only if React kept that very element, and the nav's scrollTop survives only if it was not rebuilt.
 *
 * Needs the seeded Showroom owner (Cairo Ceramics, a `showroom_dealer`) and a viewport short enough that the
 * navigation scrolls.
 */
const NAV = "[data-preview-sidebar] nav";

async function markNav(page: Page) {
  await page.evaluate((selector) => {
    const nav = document.querySelector(selector) as (HTMLElement & { __kept?: string }) | null;
    if (!nav) throw new Error("the Showroom navigation is not on the page");
    nav.__kept = "same-element";
    nav.scrollTop = nav.scrollHeight;
  }, NAV);
}

async function readNav(page: Page) {
  return page.evaluate((selector) => {
    const nav = document.querySelector(selector) as (HTMLElement & { __kept?: string }) | null;
    return { kept: nav?.__kept ?? null, scrollTop: nav ? Math.round(nav.scrollTop) : null, scrollable: nav ? nav.scrollHeight > nav.clientHeight : false };
  }, NAV);
}

/** A client-side navigation through the sidebar link itself, without letting the test scroll the list for us. */
async function followSidebarLink(page: Page, href: string) {
  await page.locator(`[data-preview-sidebar] a[href="${href}"]`).first().evaluate((link: HTMLElement) => link.click());
}

test.describe("Showroom shell persists across /showroom and /b2b", () => {
  test("the same sidebar element and scroll position survive crossing from one tree to the other and back", async ({ page, request }) => {
    await page.setViewportSize({ width: 1440, height: 520 });
    await signIn(page, request, IDENTITIES.showroom);
    await page.goto("/showroom/home");
    await expect(page.locator(NAV)).toBeVisible();

    await markNav(page);
    const before = await readNav(page);
    expect(before.scrollable, "the navigation must overflow at this height for the scroll check to mean anything").toBe(true);
    expect(before.scrollTop).toBeGreaterThan(0);

    // /showroom/* -> /b2b/*
    await followSidebarLink(page, "/b2b/rfqs");
    await page.waitForURL(/\/b2b\/rfqs/);
    await expect(page.locator("main#top")).toBeVisible();
    expect(await readNav(page)).toEqual({ kept: "same-element", scrollTop: before.scrollTop, scrollable: true });

    // /b2b/* -> /showroom/*
    await followSidebarLink(page, "/showroom/catalog");
    await page.waitForURL(/\/showroom\/catalog/);
    expect(await readNav(page)).toEqual({ kept: "same-element", scrollTop: before.scrollTop, scrollable: true });
  });

  test("only one shell is ever drawn for a dealer", async ({ page, request }) => {
    await signIn(page, request, IDENTITIES.showroom);
    for (const path of ["/b2b/rfqs", "/showroom/home"]) {
      await page.goto(path);
      await expect(page.locator("[data-preview-sidebar]")).toHaveCount(1);
      await expect(page.locator("main#top")).toHaveCount(1);
    }
  });
});
