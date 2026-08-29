import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { SidebarShell } from "./sidebar-shell";
import { ar } from "@/lib/i18n/messages/ar";
import { allowedNavKeys } from "@/lib/nav/modules";
import { SIDEBAR_MODE_COOKIE } from "@/lib/ui/sidebar-mode";
import { NAV_ICON_HOVER_CLASS, NAV_ICON_SELF_HOVER_CLASS } from "@/lib/ui/nav-geometry";

vi.mock("next/navigation", () => ({ usePathname: () => "/b2b/catalog" }));

// A showroom owner — the manual-UAT account's shape, so the assertions below are
// about the rail a real acceptance user actually sees.
const CAPS = ["org.manage"];
const MODULE_COUNT = allowedNavKeys(CAPS).length;

function shell(mode: "expanded" | "collapsed" | "hover" = "expanded") {
  return renderWithI18n(
    <SidebarShell
      allowed={CAPS}
      mode={mode}
      /* The shell draws the lockup itself, so this is required rather than
         optional. A fixture, not an assertion — nothing below reads it; it
         exists so the component renders the panel it renders in the product.

         `orgName`/`branchName` USED TO BE HERE and are gone with the workspace
         card they fed: the fixed Settings/Upgrade block replaced it, and the
         header's own workspace switcher already carries both facts. */
      appName="Aladdin"
    />,
  );
}

beforeEach(() => {
  document.cookie = `${SIDEBAR_MODE_COOKIE}=; max-age=0; path=/`;
});

/**
 * OPEN THE MODE MENU THE WAY THE CONTROL ACTUALLY OPENS IT.
 *
 * A CLICK no longer opens this menu — it is a binary expanded↔collapsed toggle,
 * which is the single choice a reader makes most often. The MENU (all three
 * modes, "Expand on hover" included) is the rarer, deliberate choice and opens
 * on hover or on keyboard focus.
 *
 * `focus` rather than `mouseEnter`, because hover-open is debounced behind a
 * 350ms timer and focus-open is immediate — and asserting through the keyboard
 * path also keeps these tests honest about the control being reachable without a
 * pointer at all.
 */
function openModeMenu() {
  fireEvent.focus(screen.getByTestId("sidebar-control"));
}

describe("SidebarShell display modes", () => {
  it("offers exactly the three documented modes, localized", () => {
    shell();
    openModeMenu();
    const items = screen.getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual([
      ar.nav.sidebar.expanded,
      ar.nav.sidebar.collapsed,
      ar.nav.sidebar.hover,
    ]);
  });

  it("keeps every capability-derived module reachable when collapsed", () => {
    shell("collapsed");
    /* The collapsed rail is a different PRESENTATION, never a shorter menu —
       but "how many links" is no longer the same number as "how many modules",
       and the difference is structural rather than slack:
         −1  Settings leaves the capability-derived LIST. It would otherwise
             appear twice: once grouped under Business, once as a fixed action.
         +3  each secondary group (Network, Selling, Business) draws ONE
             representative icon on the rail, whose click reveals its children
             rather than navigating.
         +2  the fixed bottom block: Settings back exactly once, plus Upgrade.
       The properties actually worth asserting are named below rather than left
       implied by an arithmetic total. */
    expect(screen.getAllByRole("link")).toHaveLength(MODULE_COUNT + 4);
    // Settings appears exactly ONCE, and it is the fixed bottom one.
    expect(screen.getAllByRole("link", { name: ar.nav.settings })).toHaveLength(1);
  });

  it("names each collapsed item so the label survives the loss of visible text", () => {
    shell("collapsed");
    // Labels move into aria-label only — no visible tooltip is painted — so the
    // module must still be findable by its accessible name.
    expect(screen.getByRole("link", { name: ar.nav.catalog })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: ar.nav.reports })).toBeInTheDocument();
  });

  it("paints no visible label beside a hovered collapsed icon", () => {
    shell("collapsed");
    const link = screen.getByRole("link", { name: ar.nav.catalog });
    fireEvent.mouseEnter(link);
    // The hover cue is a surface on the icon, never a floating caption over the
    // page — and never the module name rendered twice in hover-reveal mode.
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(link.textContent).toBe("");
  });

  it("marks the active route in the collapsed rail", () => {
    shell("collapsed");
    expect(screen.getByRole("link", { name: ar.nav.catalog })).toHaveAttribute("aria-current", "page");
  });

  it("rests collapsed in hover mode and reveals on pointer entry", () => {
    const { container } = shell("hover");
    const spacer = container.querySelector("[data-sidebar-mode]") as HTMLElement;
    expect(spacer).toHaveAttribute("data-sidebar-open", "false");

    fireEvent.mouseEnter(spacer.firstElementChild as HTMLElement);
    expect(spacer).toHaveAttribute("data-sidebar-open", "true");

    fireEvent.mouseLeave(spacer.firstElementChild as HTMLElement);
    expect(spacer).toHaveAttribute("data-sidebar-open", "false");
  });

  it("reveals on keyboard focus so the rail is usable without a pointer", () => {
    const { container } = shell("hover");
    const spacer = container.querySelector("[data-sidebar-mode]") as HTMLElement;
    fireEvent.focus(screen.getByRole("link", { name: ar.nav.catalog }), { bubbles: true });
    expect(spacer).toHaveAttribute("data-sidebar-open", "true");
  });

  it("does not react to hover in collapsed mode — the two modes stay distinct", () => {
    const { container } = shell("collapsed");
    const spacer = container.querySelector("[data-sidebar-mode]") as HTMLElement;
    fireEvent.mouseEnter(spacer.firstElementChild as HTMLElement);
    expect(spacer).toHaveAttribute("data-sidebar-open", "false");
  });

  /**
   * The compact rail's contract, in one place: NOTHING beside an icon is painted.
   * That covers the nav items (already the case) and — the UAT finding — the
   * sidebar-mode control at the foot, which used to print the name of the mode
   * you were already in the moment a hover reveal widened the panel.
   */
  describe("compact rail is icon-only, including its own mode control", () => {
    const modeNames = [ar.nav.sidebar.expanded, ar.nav.sidebar.collapsed, ar.nav.sidebar.hover];

    it("paints no mode name on the closed control when collapsed", () => {
      shell("collapsed");
      expect(screen.getByTestId("sidebar-control").textContent).toBe("");
    });

    it("paints no mode name on the closed control in expand-on-hover, before OR during the reveal", () => {
      const { container } = shell("hover");
      const spacer = container.querySelector("[data-sidebar-mode]") as HTMLElement;
      const control = screen.getByTestId("sidebar-control");

      expect(control.textContent).toBe("");

      // The reveal is exactly when the old code leaked "التوسيع عند المرور".
      fireEvent.mouseEnter(spacer.firstElementChild as HTMLElement);
      expect(spacer).toHaveAttribute("data-sidebar-open", "true");
      expect(control.textContent).toBe("");
    });

    it("renders no mode name anywhere on a collapsed rail while its menu is shut", () => {
      const { container } = shell("collapsed");
      for (const name of modeNames) expect(container.textContent).not.toContain(name);
    });

    it("keeps the control's accessible name — and names the active mode in it", () => {
      shell("collapsed");
      // Visible text is what goes; the accessible name gains the mode, so a
      // screen-reader user is told strictly more than the sighted user sees.
      expect(
        screen.getByRole("button", {
          name: `${ar.nav.sidebar.control}: ${ar.nav.sidebar.collapsed}`,
        }),
      ).toBeInTheDocument();
    });

    it("still offers the mode names inside the menu the control opens", () => {
      shell("collapsed");
      openModeMenu();
      // Removing the caption must not remove the ability to CHANGE the mode.
      expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual(modeNames);
    });

    /**
     * The control is icon-only in EVERY mode, expanded included.
     *
     * This assertion used to say the opposite — an expanded sidebar kept the
     * mode name beside the icon. It reads harmless and it is not: what it put at
     * the foot of an expanded panel was the permanent caption "موسّع", a control
     * announcing a state the user can plainly see, on the one surface whose job
     * is to stay quiet. The names belong in the menu, where they are a choice
     * rather than a label.
     */
    it("stays icon-only on a deliberately expanded sidebar too", () => {
      shell("expanded");
      expect(screen.getByTestId("sidebar-control").textContent).toBe("");
    });

    it("renders no mode name anywhere in ANY mode while the menu is shut", () => {
      for (const mode of ["expanded", "collapsed", "hover"] as const) {
        const { container, unmount } = shell(mode);
        for (const name of modeNames) expect(container.textContent).not.toContain(name);
        unmount();
      }
    });

    /**
     * THE CONTROL IS A TILE IN THE HEADER ROW, NOT A FULL-WIDTH FOOTER ROW.
     *
     * This assertion used to require the opposite — a `px-3` start inset and no
     * centring — because the control lived at the FOOT of the panel, inside the
     * navigation's own column, where a centred glyph would have landed ~120px
     * away from the icons above it.
     *
     * It has moved. Expanded, it sits at the trailing edge of the brand row
     * (spread there by that row's `justify-between`, beside the wordmark);
     * collapsed, it is the row's only occupant and centres. Either way it is a
     * 36px icon tile with the geometry every nav icon uses — so what is worth
     * asserting now is that it IS that tile, not where a footer row would have
     * inset it.
     */
    it("draws the control as the shared 36px icon tile in both widths", () => {
      for (const mode of ["expanded", "collapsed"] as const) {
        const { unmount } = shell(mode);
        const control = screen.getByTestId("sidebar-control");
        // `navIconClass()` — the same square the navigation icons above it use.
        expect(control.className).toContain("h-9");
        expect(control.className).toContain("w-9");
        unmount();
      }
    });

    it("shows the mark beside the control when expanded, and the control alone when collapsed", () => {
      const expanded = shell("expanded");
      expect(expanded.container.textContent).toContain("Aladdin");
      expanded.unmount();

      // Collapsed the control REPLACES the mark rather than sitting beside a
      // shrunken copy of it — one centred control, not a logo plus an icon.
      const collapsed = shell("collapsed");
      expect(collapsed.container.textContent).not.toContain("Aladdin");
    });
  });

  /**
   * ONE HOVER STATE, THREE MODES.
   *
   * The lit icon tile was written for the collapsed rail and lived behind a
   * `narrow &&` guard, so an expanded panel answered a pointer differently from
   * the rail it is the same sidebar as — and expand-on-hover answered BOTH ways
   * inside a single gesture, since the panel flips from 3.5rem to 15rem under a
   * cursor that never moved off the icon.
   *
   * The rule the paint follows now: a WIDE navigation row highlights as a ROW —
   * one subtle surface behind icon and label together — and a COLLAPSED one
   * lights its tile, because there the 40px row IS the tile. Never both: a tile
   * inside an already-highlighted row draws a second box around the icon and
   * splits one target in two. The mode control at the foot is the exception and
   * has its own cases below.
   */
  describe("nav row hover vs icon tile", () => {
    // Queried by its own hook, not by position: the active marker that used to
    // sit before it is now rail-only, so "the second span" is not the icon in
    // every mode.
    const iconOf = (row: HTMLElement) => row.querySelector("[data-nav-icon]") as HTMLElement;

    it("highlights a wide nav item as a whole row, with no tile inside it", () => {
      shell("expanded");
      // A module that is NOT the current route — an active item paints regardless.
      const row = screen.getByRole("link", { name: ar.nav.reports });
      // A SHELL token, not a content one — these rows sit on navy now.
      expect(row.className).toContain("hover:bg-shell-2");
      // The icon must not light separately inside that highlight.
      expect((iconOf(row) as HTMLElement).className).not.toMatch(/group-hover:bg-/);
    });

    it("lights the tile on the collapsed rail, where the tile IS the row", () => {
      shell("collapsed");
      const row = screen.getByRole("link", { name: ar.nav.reports });
      expect((iconOf(row) as HTMLElement).className).toContain(NAV_ICON_HOVER_CLASS);
      // Nothing wider to paint at 3.5rem, so the row carries no surface of its own.
      expect(row.className).not.toMatch(/hover:bg-/);
    });

    it("hands the highlight from tile to row across an expand-on-hover reveal", () => {
      const { container } = shell("hover");
      const spacer = container.querySelector("[data-sidebar-mode]") as HTMLElement;
      const resting = screen.getByRole("link", { name: ar.nav.reports });
      expect((iconOf(resting) as HTMLElement).className).toContain(NAV_ICON_HOVER_CLASS);

      // Revealed, it is a wide row and must behave like one — one surface, not two.
      fireEvent.mouseEnter(spacer.firstElementChild as HTMLElement);
      const revealed = screen.getByRole("link", { name: ar.nav.reports });
      expect(revealed.className).toContain("hover:bg-shell-2");
      expect((iconOf(revealed) as HTMLElement).className).not.toMatch(/group-hover:bg-/);
    });

    it("keeps the current page stronger than an ordinary hover", () => {
      shell("expanded");
      /* The invariant is unchanged — the current page must read stronger than a
         hovered one — but WHERE it is expressed moved. The active row no longer
         paints a background of its own: the carve does, as one element behind
         the whole list that survives navigation (see nav-carve.tsx). So the row
         is asserted to be CLEAN of both, the carve is asserted to exist, and the
         active glyph is asserted to take the carve's ink rather than the shell's.
         A background back on this row would mean two stacked active surfaces. */
      const active = screen.getByRole("link", { name: ar.nav.catalog });
      expect(active).toHaveAttribute("aria-current", "page");
      expect(active).toHaveAttribute("data-nav-active", "true");
      expect(active.className).not.toMatch(/hover:bg-/);
      expect(active.className).not.toMatch(/bg-/);
      expect(screen.getByTestId("nav-carve")).toBeInTheDocument();
      expect(iconOf(active).className).toContain("text-shell-active-fg");
    });

    /**
     * ONE CARVE, EVERY MODE — AND THIS TEST IS THE INVERSE OF THE ONE IT
     * REPLACED.
     *
     * The old rule was that only the docked expanded panel carved: a rail had no
     * room, and a hover reveal would appear to merge into a page 15rem away and
     * behind it. That produced three different active mechanics — a carved band,
     * an accent tile with a marker bar, and a translucent accent wash — so the
     * sidebar stopped being one object the moment it changed width, which is
     * exactly what a reviewer sees first.
     *
     * The rule now is that there is ONE surface and it MORPHS. So the assertion
     * is not "present here, absent there" but "present everywhere, in a
     * different shape": `--carve-p` is the shape parameter (0 = the icon's own
     * tile, 1 = the band flush with the trailing edge), and it is the single
     * value the reveal animates. Asserting on it rather than on rendered
     * geometry is deliberate — jsdom has no layout, so every measured number
     * here is 0 and a test that read one would be asserting on the absence of a
     * layout engine.
     */
    const carve = () => screen.getByTestId("nav-carve") as HTMLElement;
    /** The animated shape parameter, as motion has actually written it. */
    const carveP = () => carve().style.getPropertyValue("--carve-p");
    /** The same fact as a plain attribute — see below for why both exist. */
    const carveNarrow = () => carve().getAttribute("data-carve-narrow");

    it("carves in every display mode, as a tile on the rail and a band when open", () => {
      const expanded = shell("expanded");
      expect(carveP()).toBe("1");
      expect(carveNarrow()).toBeNull();
      expanded.unmount();

      const collapsed = shell("collapsed");
      // Still one carve — at tile scale, with the fillets off because there is
      // no trailing edge for them to close around at 3.5rem.
      expect(carveP()).toBe("0");
      expect(carveNarrow()).toBe("true");
      collapsed.unmount();

      const { container } = shell("hover");
      expect(carveNarrow()).toBe("true");
      // Revealed, it is the SAME element in the band shape — not a second
      // treatment swapped in for a floating panel.
      //
      // ASSERTED ON THE ATTRIBUTE, NOT ON `--carve-p`, and the difference is
      // about what jsdom can honestly report. `--carve-p` is written by motion:
      // on MOUNT it lands immediately (`initial={false}` makes the first render
      // a position rather than a movement), which is why the two cases above can
      // read it — but a mid-session change is an ANIMATION, and jsdom drives no
      // frames, so the property still holds its old value one tick after the
      // pointer arrives. Reading it here would assert that motion has finished
      // animating in an environment where motion cannot start. The attribute is
      // ordinary React state and flips synchronously, so it is the honest
      // witness that the SHAPE changed; the shot at design-lab-shots/pass is
      // what shows it arriving smoothly.
      fireEvent.mouseEnter(
        (container.querySelector("[data-sidebar-mode]") as HTMLElement).firstElementChild as HTMLElement,
      );
      expect(carveNarrow()).toBeNull();
    });

    /* The rail's active item used to paint its own accent-tinted tile, which was
       its stand-in for a carve back when it had none. It has one now — sitting
       in exactly that spot — so a tint here would be a second surface inside the
       first. Same invariant the expanded row has always been held to, extended
       to the width that used to be exempt. */
    it("paints no second active surface on the rail, where the carve now sits", () => {
      shell("collapsed");
      const active = screen.getByRole("link", { name: ar.nav.catalog });
      const icon = active.querySelector("[data-nav-icon]") as HTMLElement;
      expect(active).toHaveAttribute("data-nav-active", "true");
      expect(icon.className).not.toMatch(/bg-accent/);
      // And it takes the carve's ink, because that is the ground it stands on —
      // the same foreground the expanded band gives it.
      expect(icon.className).toContain("text-shell-active-fg");
    });

    /**
     * THE CONTROL'S HOVER TARGET IS THE CONTROL, WHICH IS NOW THE WHOLE STORY.
     *
     * These two assertions used to guard a real defect on the OLD footer
     * control: that button was `w-full` with no label, so a row-driven hover
     * tint lit the tile from ~200px of empty space beside it — the bottom of the
     * sidebar reacting to a pointer nowhere near the icon. The fix then was to
     * arm an inner `<span>` and forbid `group-hover:` on it.
     *
     * The control is no longer a label-less full-width row. It is a 36px tile
     * and nothing else, so the button's own box IS the 36px the pointer has to
     * be over — the defect is structurally unreachable rather than guarded
     * against. What survives from the old contract is the half that still means
     * something: the paint is scoped to the element under the pointer, and no
     * `group-hover:` reaches it from an ancestor.
     */
    it("arms the mode control from the tile itself, never from an ancestor row", () => {
      for (const mode of ["expanded", "collapsed", "hover"] as const) {
        const { unmount } = shell(mode);
        const control = screen.getByTestId("sidebar-control");
        expect(control.className).toContain("hover:bg-shell-2");
        expect(control.className).toContain("focus-visible:bg-shell-2");
        // The defect this replaced: a tile lit by a hover on something larger.
        expect(control.className).not.toMatch(/group-hover:/);
        unmount();
      }
    });

    it("keeps a visible focus ring on the control in every mode", () => {
      for (const mode of ["expanded", "collapsed", "hover"] as const) {
        const { unmount } = shell(mode);
        expect(screen.getByTestId("sidebar-control").className).toContain("focus-visible:ring-2");
        unmount();
      }
    });

    it("keeps the control's tile identical in appearance to a nav icon's", () => {
      // Same declarations, different trigger — one paint, never two.
      const paint = (c: string) => c.replace(/(^|\s)(group-)?hover:/g, "$1").split(/\s+/).sort();
      expect(paint(NAV_ICON_SELF_HOVER_CLASS)).toEqual(paint(NAV_ICON_HOVER_CLASS));
    });
  });

  it("persists the chosen mode to this browser only, with no server round trip", () => {
    shell();
    openModeMenu();
    fireEvent.click(screen.getByTestId("sidebar-mode-hover"));
    expect(document.cookie).toContain(`${SIDEBAR_MODE_COOKIE}=hover`);
    const spacer = document.querySelector("[data-sidebar-mode]") as HTMLElement;
    expect(spacer).toHaveAttribute("data-sidebar-mode", "hover");
  });

  /**
   * CLIPPED IS NOT HIDDEN, AND THAT DISTINCTION IS THE WHOLE TEST.
   *
   * The collapse is built on a `grid-template-rows: 0fr` track plus
   * `overflow: hidden`, which removes the rows VISUALLY and does nothing else:
   * the links stay in the tab order and in the accessibility tree. On a rail
   * with four closed groups that is roughly a dozen links a keyboard user walks
   * through and cannot see, and a screen reader reads out a navigation the
   * sighted user has deliberately collapsed.
   *
   * `inert` removes both at once. It is asserted rather than trusted because it
   * is invisible by construction — nothing about the rendered page looks
   * different when it regresses, which is exactly how it got shipped the first
   * time.
   */
  describe("a collapsed group is inert, not merely clipped", () => {
    const closedGroupWrappers = (container: HTMLElement) =>
      Array.from(container.querySelectorAll<HTMLElement>(".overflow-hidden")).filter((el) =>
        el.querySelector("a"),
      );

    it("marks every closed group's children inert on the expanded rail", () => {
      const { container } = shell("expanded");
      const wrappers = closedGroupWrappers(container);
      expect(wrappers.length, "expected at least one collapsible group").toBeGreaterThan(0);
      // Groups start CLOSED except quick access and whichever holds the route,
      // so at least one wrapper must be carrying the attribute.
      // Every group starts closed here: the mocked route (`/b2b/catalog`) is in
      // QUICK ACCESS for this stance, so no group is forced open.
      expect(wrappers.every((el) => el.hasAttribute("inert"))).toBe(true);
    });

    /* The assertion above cannot tell "inert tracks the open state" from "inert
       is painted on everything" — both satisfy it, and the second would hide a
       group the reader has deliberately opened. So open one and watch it clear. */
    it("clears inert on a group the reader opens", () => {
      const { container } = shell("expanded");
      /* NOT `getAllByRole("button", { expanded: false })[0]` — `aria-expanded`
         is shared by a disclosure and a popup trigger, and the sidebar's own
         mode control renders first, so "the first collapsed button" silently
         selected the wrong control and clicking it opened a menu instead of a
         group. Select the group heading by what it IS. */
      const heading = screen
        .getAllByRole("button")
        .find((b) => b.getAttribute("aria-expanded") === "false" && b.dataset.testid !== "sidebar-control")!;
      expect(heading, "expected a closed group heading to click").toBeTruthy();
      expect(closedGroupWrappers(container).every((el) => el.hasAttribute("inert"))).toBe(true);
      fireEvent.click(heading);
      expect(closedGroupWrappers(container).some((el) => !el.hasAttribute("inert"))).toBe(true);
    });

    it("marks the unrevealed groups' children inert on the compact rail", () => {
      const { container } = shell("collapsed");
      const wrappers = closedGroupWrappers(container);
      expect(wrappers.length).toBeGreaterThan(0);
      expect(wrappers.some((el) => el.hasAttribute("inert"))).toBe(true);
    });
  });

  /**
   * THE FIXED BOTTOM ACTIONS, WHICH ARE ICON-ONLY WHEN COMPACT.
   *
   * Both rows point at the same href today, so without an accessible name a
   * screen reader announces two identical unnamed links at the foot of the rail
   * — which is what it did until this was fixed. Every nav row above already
   * names itself when narrow; these two were the pair that did not.
   */
  describe("fixed bottom actions", () => {
    it("names Settings and Upgrade on the compact rail, where nothing is painted", () => {
      shell("collapsed");
      expect(screen.getByRole("link", { name: ar.nav.settings })).toBeInTheDocument();
      expect(screen.getByRole("link", { name: ar.nav.upgrade })).toBeInTheDocument();
    });

    it("carries exactly one Settings entry in every mode", () => {
      for (const mode of ["expanded", "collapsed", "hover"] as const) {
        const { unmount } = shell(mode);
        expect(screen.getAllByRole("link", { name: ar.nav.settings })).toHaveLength(1);
        unmount();
      }
    });

    it("takes the Upgrade label from the message catalogue, not an inline locale ternary", () => {
      // The catalogue is the only thing the AR/EN parity suite can see. This
      // asserts the AR string specifically, because `renderWithI18n` runs the
      // Arabic locale — an inline `locale === "ar" ? …` would satisfy that too,
      // so the real guard is the parity test in `lib/i18n`; this one keeps the
      // key wired to the component.
      shell("expanded");
      expect(screen.getByRole("link", { name: ar.nav.upgrade })).toBeInTheDocument();
    });
  });
});
