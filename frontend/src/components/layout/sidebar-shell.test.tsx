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
      /* The shell now draws the lockup and the workspace card itself, so these
         three are required rather than optional. They are fixtures, not
         assertions — nothing below reads them; they exist so the component can
         render the panel it actually renders in the product. */
      appName="Aladdin"
      orgName="Cairo Sanitary Ware Trading"
      branchName="Obour City warehouse"
    />,
  );
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
        /* Same self-scoped CONTRACT as NAV_ICON_SELF_HOVER_CLASS — the pointer
           must be over the 36px tile, never anywhere along the label-less
           full-width row — but painted in shell tokens, because that constant's
           `bg-surface-2` is a Quartz-tuned content colour and is invisible on
           navy. The `group-hover:` assertion below is the one that actually
           guards the defect, and it is unchanged. */
        expect(icon.className).toContain("hover:bg-shell-2");
        expect(icon.className).toContain("group-focus-visible:bg-shell-2");
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
