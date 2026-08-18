import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { SidebarShell } from "./sidebar-shell";
import { ar } from "@/lib/i18n/messages/ar";
import { allowedNavKeys } from "@/lib/nav/modules";
import { SIDEBAR_MODE_COOKIE } from "@/lib/ui/sidebar-mode";

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

    it("keeps the label on a deliberately expanded sidebar", () => {
      shell("expanded");
      expect(screen.getByTestId("sidebar-control").textContent).toBe(ar.nav.sidebar.expanded);
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
