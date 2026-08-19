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
  return renderWithI18n(<SidebarShell appName="علاء الدين" allowed={CAPS} mode={mode} />);
}

beforeEach(() => {
  document.cookie = `${SIDEBAR_MODE_COOKIE}=; max-age=0; path=/`;
});

describe("SidebarShell display modes", () => {
  it("offers exactly the three documented modes, localized", () => {
    shell();
    fireEvent.click(screen.getByTestId("sidebar-control"));
    const items = screen.getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual([
      ar.nav.sidebar.expanded,
      ar.nav.sidebar.collapsed,
      ar.nav.sidebar.hover,
    ]);
  });

  it("keeps every capability-derived module reachable when collapsed", () => {
    shell("collapsed");
    // The collapsed rail is a different PRESENTATION, never a shorter menu.
    expect(screen.getAllByRole("link")).toHaveLength(MODULE_COUNT);
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
      fireEvent.click(screen.getByTestId("sidebar-control"));
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
     * Icon-only must not become icon-CENTRED. An expanded panel is 15rem wide, so
     * a control that centres its glyph lands ~120px away from the navigation icons
     * above it — trading a 4px misalignment for a far worse one. The row keeps its
     * start inset and simply has nothing after the icon.
     */
    it("keeps the expanded control's icon at the start inset, not centred", () => {
      shell("expanded");
      const control = screen.getByTestId("sidebar-control");
      expect(control.className).not.toContain("justify-center");
      expect(control.className).toContain("px-3");
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
    // The first span in a nav row is the active marker; the icon is the second.
    const iconOf = (row: HTMLElement) => row.querySelectorAll("span")[1] ?? row.querySelector("span");

    it("highlights a wide nav item as a whole row, with no tile inside it", () => {
      shell("expanded");
      // A module that is NOT the current route — an active item paints regardless.
      const row = screen.getByRole("link", { name: ar.nav.reports });
      expect(row.className).toContain("hover:bg-surface-hover");
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
      expect(revealed.className).toContain("hover:bg-surface-hover");
      expect((iconOf(revealed) as HTMLElement).className).not.toMatch(/group-hover:bg-/);
    });

    it("keeps the current page stronger than an ordinary hover", () => {
      shell("expanded");
      // Active is the full surface; hover is the same surface at 60%. Plus the
      // accent marker and accent glyph, which a hovered row never gets.
      const active = screen.getByRole("link", { name: ar.nav.catalog });
      expect(active).toHaveAttribute("aria-current", "page");
      expect(active.className).toContain("bg-surface-2");
      expect(active.className).not.toMatch(/hover:bg-/);
      expect((iconOf(active) as HTMLElement).className).toContain("text-accent");
    });

    /**
     * The mode control gets the same PAINT, armed by the tile instead of the row.
     * Its button is `w-full` so the click target matches a nav row, but it has no
     * label — so a row-driven tile lit from anywhere along the footer, including
     * the ~200px of empty space beside a 36px icon. `group-hover:` on this span
     * is the defect itself; these assert it cannot come back.
     */
    it("arms the mode control's tile from the tile, not the footer row", () => {
      for (const mode of ["expanded", "collapsed", "hover"] as const) {
        const { unmount } = shell(mode);
        const icon = screen.getByTestId("sidebar-control").querySelector("span") as HTMLElement;
        expect(icon.className).toContain(NAV_ICON_SELF_HOVER_CLASS);
        expect(icon.className).not.toMatch(/group-hover:/);
        unmount();
      }
    });

    /**
     * The row the control sits in has NO hover state of its own. It is `w-full`
     * for the click target only; the pointer can be 200px from the icon, over
     * nothing, and a row tint there announces a control that is not under it.
     * Every visible hover cue belongs to the tile. Focus is exempt — the ring is
     * a keyboard affordance and lands on the button because the button is what
     * takes focus.
     */
    it("gives the control's row no hover styling at all, in any mode", () => {
      for (const mode of ["expanded", "collapsed", "hover"] as const) {
        const { unmount } = shell(mode);
        const control = screen.getByTestId("sidebar-control");
        expect(control.className).not.toMatch(/(^|\s)(group-)?hover:/);
        expect(control.className).toContain("focus-visible:ring-2");
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
    fireEvent.click(screen.getByTestId("sidebar-control"));
    fireEvent.click(screen.getByTestId("sidebar-mode-hover"));
    expect(document.cookie).toContain(`${SIDEBAR_MODE_COOKIE}=hover`);
    const spacer = document.querySelector("[data-sidebar-mode]") as HTMLElement;
    expect(spacer).toHaveAttribute("data-sidebar-mode", "hover");
  });
});
