import { expect, type Page } from "@playwright/test";

/* The two settled spacer widths, in CSS px: the rail/expanded panel plus the
   shell gutter (`--shell-gutter-w`, 0.875rem = 14px). 56 + 14 and 240 + 14.
   Literals rather than a computed read, because the point is to wait for a
   KNOWN value — deriving them from the same element being measured would make
   the poll trivially true at any moment of the animation. */
export const SIDEBAR_SPACER = { rail: 70, expanded: 254 } as const;

export type SidebarWidth = keyof typeof SIDEBAR_SPACER;

/**
 * The shell's geometry, in LOGICAL terms, so one assertion covers both writing
 * directions.
 *
 * `workspaceStart` is the workspace's distance from the edge the sidebar is
 * attached to — its left in English, and its distance from the viewport's right
 * edge in Arabic. A push therefore INCREASES it in both directions and an
 * overlay leaves it alone in both, which is the whole reason it is measured this
 * way rather than as a raw `x`.
 */
export type ShellGeometry = {
  /** Width of the element that actually reserves layout space in the shell. */
  spacer: number;
  workspaceStart: number;
  workspaceWidth: number;
  rtl: boolean;
  /* THE STATE THAT EXPLAINS THE WIDTH, carried alongside it so a failure can be
     READ rather than reconstructed. A helper that reports only "expected 254,
     received 70" sends the next reader back to the component to guess which of
     mode, reveal and the animated variable disagreed — and the whole point of
     this file is that the sidebar's geometry has three inputs. */
  mode: string | null;
  open: string | null;
  navVar: string;
};

/**
 * One geometry reading, accepted ONLY if it survives two animation frames.
 *
 * WHY THIS IS NOT A `boundingBox()` CALL. The sidebar and its spacer travel on a
 * spring — `stiffness: 520, damping: 42, mass: 1`, which is a damping ratio of
 * about 0.92 and therefore UNDERDAMPED. It overshoots its target and comes back.
 * A single sample that equals the settled width can be caught on the way THROUGH
 * it, so "matches the expected value" and "has stopped moving" are two different
 * facts and both have to be established. This establishes the second.
 *
 * Returns `null` while the shell is still travelling, which is what lets the
 * caller poll on it: a poll whose predicate cannot be satisfied mid-flight
 * cannot be satisfied by a mid-flight coincidence either.
 *
 * The two reads are separated by real frames rather than by a sleep, so this
 * costs one frame once the shell is at rest and never a fixed millisecond
 * budget that a slower machine can miss.
 */
async function sampleSettled(page: Page, requireStable = true): Promise<ShellGeometry | null> {
  return page.evaluate<ShellGeometry | null, boolean>(
    (stable) =>
      new Promise((resolve) => {
        const read = (): ShellGeometry | null => {
          const spacer = document.querySelector("[data-shell-sidebar]");
          const workspace = document.querySelector("#main");
          if (!spacer || !workspace) return null;
          const s = spacer.getBoundingClientRect();
          const w = workspace.getBoundingClientRect();
          const rtl = getComputedStyle(document.documentElement).direction === "rtl";
          return {
            spacer: Math.round(s.width),
            workspaceStart: Math.round(rtl ? window.innerWidth - w.right : w.left),
            workspaceWidth: Math.round(w.width),
            rtl,
            mode: spacer.getAttribute("data-sidebar-mode"),
            open: spacer.getAttribute("data-sidebar-open"),
            navVar: getComputedStyle(spacer).getPropertyValue("--shell-nav-w").trim(),
          };
        };
        const first = read();
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const second = read();
            if (!stable) return resolve(second);
            resolve(
              first && second && JSON.stringify(first) === JSON.stringify(second) ? second : null,
            );
          }),
        );
      }),
    requireStable,
  );
}

/**
 * Wait until the shell has settled at `width`, then hand back the geometry it
 * settled at.
 *
 * Both conditions at once, and deliberately: the spacer has to READ the expected
 * width AND have held it across consecutive samples. Either alone is a timing
 * assumption — the first can be true mid-overshoot, and the second is true of
 * any resting state including a wrong one.
 */
export async function settledShell(page: Page, width: SidebarWidth): Promise<ShellGeometry> {
  let settled: ShellGeometry | null = null;
  try {
    await expect
      .poll(
        async () => {
          settled = await sampleSettled(page);
          return settled?.spacer ?? null;
        },
        { message: `the shell never settled at its ${width} width` },
      )
      .toBe(SIDEBAR_SPACER[width]);
  } catch (cause) {
    /* SAY WHAT THE SHELL ACTUALLY WAS. `expect.poll` can only report the number
       it kept seeing, and a bare "expected 254, received 70" is the same message
       for four different faults: the mode never changed, the reveal never fired,
       the animated variable stalled, or the panel is genuinely the wrong width.
       The live reading names which one — an unstable sample also shows up here,
       as the poll never having a settled value to report at all. */
    const live = await sampleSettled(page, false);
    throw new Error(
      `the shell never settled at its ${width} width (expected spacer ` +
        `${SIDEBAR_SPACER[width]}px). Live reading: ${JSON.stringify(live)}`,
      { cause },
    );
  }
  return settled!;
}

/**
 * A point 20px inside the sidebar's LEADING edge, at mid-height.
 *
 * That corner is the only part of the rail the panel is guaranteed to keep
 * covering as it widens: the panel grows outward from the viewport edge it is
 * pinned to, so a point measured inward from that edge stays inside the element
 * the pointer just entered. Hovering the nav's own CENTRE — which is what
 * `locator.hover()` does — aims at a box that is about to move, which is the
 * timing assumption this exists to remove.
 */
async function railPoint(page: Page): Promise<{ x: number; y: number }> {
  const point = await page.evaluate(() => {
    const el = document.querySelector("[data-shell-sidebar]");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const rtl = getComputedStyle(document.documentElement).direction === "rtl";
    return {
      x: Math.round(rtl ? r.right - 20 : r.left + 20),
      y: Math.round(r.top + r.height / 2),
    };
  });
  expect(point, "the shell sidebar is on the page").not.toBeNull();
  return point!;
}

/**
 * Put the pointer on the sidebar and wait for the reveal to be REAL — open, and
 * settled at its expanded width.
 *
 * `page.mouse.move` with steps rather than `locator.hover()`, for two reasons.
 * The obvious one is the moving target above. The subtler one is that a move to
 * coordinates the pointer already occupies dispatches no boundary event at all,
 * so a second reveal in the same test would silently assert against the first
 * one's state; stepping in from wherever the pointer actually is guarantees the
 * transition that fires `mouseenter`.
 */
export async function hoverSidebar(page: Page): Promise<ShellGeometry> {
  const { x, y } = await railPoint(page);
  await page.mouse.move(x, y, { steps: 8 });
  await expect(page.locator("[data-sidebar-mode]")).toHaveAttribute("data-sidebar-open", "true");
  return settledShell(page, "expanded");
}

/**
 * Take the pointer off the sidebar and wait for the shell to come back to rest.
 *
 * The destination is the far side of the viewport FROM THE SIDEBAR, computed per
 * direction — a hardcoded `(1000, 600)` is off the panel in English and on it in
 * Arabic, where the sidebar hugs the right edge.
 */
export async function leaveSidebar(page: Page, resting: SidebarWidth = "rail"): Promise<ShellGeometry> {
  const point = await page.evaluate(() => {
    const rtl = getComputedStyle(document.documentElement).direction === "rtl";
    return {
      x: Math.round(rtl ? 40 : window.innerWidth - 40),
      y: Math.round(window.innerHeight / 2),
    };
  });
  await page.mouse.move(point.x, point.y, { steps: 8 });
  await expect(page.locator("[data-sidebar-mode]")).toHaveAttribute("data-sidebar-open", "false");
  return settledShell(page, resting);
}

/**
 * A PROVEN PRODUCTION DEFECT THIS FILE DOES NOT WORK AROUND — read before
 * "fixing" a failure that names it.
 *
 * Switching from `hover` to `expanded` THROUGH THE MENU intermittently leaves
 * the sidebar latched at the rail width. React state is correct and the DOM says
 * so; only the animated custom property disagrees. Caught by `settledShell`,
 * whose failure prints the live reading:
 *
 *   {"spacer":70,"workspaceStart":70,"rtl":true,
 *    "mode":"expanded","open":"true","navVar":"3.5rem"}
 *
 * `mode="expanded"` and `open="true"` mean the component computed
 * `visual = SIDEBAR_WIDTH.expanded` ("15rem"), but `--shell-nav-w` is still
 * `SIDEBAR_WIDTH.rail` ("3.5rem") and stays there — Motion never wrote the new
 * target, and because it drives that variable imperatively it also masks the
 * inline `style` fallback that would otherwise have been correct. Measured at
 * roughly 2 in 37 runs in Arabic; not observed in 25 English runs. It does NOT
 * reproduce under `prefers-reduced-motion`, where the transition is
 * `{ duration: 0 }` and the value is written synchronously — which is what
 * points at the animation rather than at the state.
 *
 * That is a user-visible fault: the control reports "Expanded" while the
 * sidebar is a 56px rail, and it does not correct itself.
 *
 * It is NOT what this file's hardening was for and it is not fixed here — the
 * fix belongs in `sidebar-shell.tsx` and was left for review rather than folded
 * into a test-only change. The helpers below are written so that it surfaces as
 * a legible failure if it happens, rather than as a mystery width.
 */

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
     is still travelling, and the spring overshoots — see `sampleSettled`.

     `hover` is excluded from the WIDTH check because its settled width depends
     on where the pointer happens to be, which is the caller's business. But it
     is not excluded from having a defined pointer state, and that omission was
     the real defect here: `.click()` leaves the physical pointer parked on the
     menu item it just pressed, and that item belongs to a portal anchored to the
     rail. Whether the panel then counts the pointer as having entered it depends
     on whether Chromium re-runs its hit test after the portal unmounts under a
     STATIONARY cursor — which is a browser implementation detail, not a
     contract, and it is exactly the coin-flip that made the caller's
     `data-sidebar-open="false"` assertion flaky.

     So the helper now leaves hover mode in a KNOWN pointer state: pointer off
     the sidebar, panel closed, rail settled. Every caller that follows this with
     a hover is then measuring its own gesture rather than the leftovers of this
     one. */
  if (mode === "hover") {
    await leaveSidebar(page, "rail");
    return;
  }
  await settledShell(page, mode === "expanded" ? "expanded" : "rail");
}
