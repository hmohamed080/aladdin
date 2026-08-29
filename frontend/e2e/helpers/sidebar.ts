import { expect, type Page } from "@playwright/test";

/* The two settled spacer widths, in CSS px: the rail/expanded panel plus the
   shell gutter (`--shell-gutter-w`, 0.875rem = 14px). 56 + 14 and 240 + 14.
   Literals rather than a computed read, because the point is to wait for a
   KNOWN value — deriving them from the same element being measured would make
   the poll trivially true at any moment of the animation. */
const RAIL_SPACER_PX = 70;
const EXPANDED_SPACER_PX = 254;

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
  /* BLUR FIRST, AND THIS IS NOT DEFENSIVE TIDYING.
     The menu opens on the control's `focus` EVENT, and an event only fires on a
     TRANSITION. Calling `focus()` on the element that already has focus is a
     silent no-op — no event, no menu — so a second call in the same test hung
     for the full timeout waiting for a menu item that was never going to appear.
     That is exactly what happened to the "offers exactly three modes" test,
     which opens the menu once to read it and then calls this helper to switch
     mode. Dropping focus first makes every call start from the same state. */
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.getByTestId("sidebar-control").focus();
  await page.getByTestId(`sidebar-mode-${mode}`).click();
  await expect(page.locator("[data-sidebar-mode]")).toHaveAttribute("data-sidebar-mode", mode);
  /* AND WAIT FOR THE WIDTH TO SETTLE. The attribute flips immediately; the rail
     is still travelling. `hover` is excluded: its settled width depends on
     where the pointer happens to be, which is the caller's business, not this
     helper's. The sidebar PUSHES now, so the spacer animates on a
     spring alongside the panel — a width read straight after this returned a
     mid-flight value (72.56 rather than 70) and made two tests intermittently
     fail on a number that was correct a frame later. Polled to a stable pair of
     samples rather than slept on, so it costs nothing once settled. */
  if (mode !== "hover") {
    await expect
      .poll(async () => {
        const box = await page.locator("[data-sidebar-mode]").boundingBox();
        return Math.round(box!.width);
      })
      .toBe(mode === "expanded" ? EXPANDED_SPACER_PX : RAIL_SPACER_PX);
  }
}
