import { expect, type Page } from "@playwright/test";

/**
 * Drive the sidebar's display-mode control the way the control actually works.
 *
 * A CLICK on it is a binary Expanded ↔ Collapsed toggle — the one choice a
 * reader makes most often. It does NOT open a menu. The three-mode menu
 * ("Expand on hover" included) is the rarer, deliberate choice and opens on
 * **hover or keyboard focus**.
 *
 * Every spec used to do `control.click()` then `sidebar-mode-X.click()`, which
 * was correct while the control lived in the sidebar's footer and a click opened
 * the same menu every time. Three copies of that sequence existed; this is one,
 * so the next change to the gesture is one edit rather than three.
 *
 * `focus()` rather than `hover()` on purpose: hover-open is debounced behind a
 * ~350ms timer and focus-open is immediate, so this is both faster and free of a
 * race. It also means every mode switch in the E2E suite is exercised through
 * the KEYBOARD path, which is the one more likely to rot unnoticed.
 */
export async function setSidebarMode(
  page: Page,
  mode: "expanded" | "collapsed" | "hover",
): Promise<void> {
  await page.getByTestId("sidebar-control").focus();
  await page.getByTestId(`sidebar-mode-${mode}`).click();
  await expect(page.locator("[data-sidebar-mode]")).toHaveAttribute("data-sidebar-mode", mode);
}
