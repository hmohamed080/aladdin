import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { MobileNav } from "./workspace-nav";
import { ar } from "@/lib/i18n/messages/ar";

vi.mock("next/navigation", () => ({ usePathname: () => "/b2b/catalog" }));

const CAPS = ["org.manage"];

/**
 * The mobile "More" sheet is the ONE place `NavLink` renders on a light ground.
 *
 * Everywhere else it draws on the navy shell, so it reaches for shell tokens by
 * default. The sheet is `bg-surface`, and the two palettes are not
 * interchangeable: `shell-fg-secondary` is a pale blue picked to sit on navy and
 * measures roughly 1.5:1 on the sheet's white — a menu of invisible labels. The
 * defect is invisible in review (the classes look plausible either way) and
 * invisible on desktop (the sheet is `tablet:hidden`), which is exactly why it
 * needs a test rather than a screenshot.
 */
describe("MobileNav — the More sheet renders on a LIGHT ground", () => {
  const openSheet = () => {
    renderWithI18n(<MobileNav allowed={CAPS} />);
    // The only `aria-expanded` control this component renders is the More toggle.
    const toggle = document.querySelector("button[aria-expanded]") as HTMLElement;
    expect(toggle).toBeTruthy();
    fireEvent.click(toggle);
    const sheet = screen.getByRole("navigation", { name: ar.nav.more });
    return [...sheet.querySelectorAll("a")] as HTMLElement[];
  };

  it("paints its rows with CONTENT tokens, never the navy shell's", () => {
    const links = openSheet();
    expect(links.length).toBeGreaterThan(0);

    for (const a of links) {
      // The whole point: no shell colour may reach this surface.
      expect(a.className).not.toMatch(/text-shell-|bg-shell-/);
      const icon = a.querySelector("[data-nav-icon]") as HTMLElement;
      expect(icon.className).not.toMatch(/text-shell-|bg-shell-/);
    }
  });

  it("keeps the light-ground active and hover treatments it always had", () => {
    const links = openSheet();
    const active = links.find((a) => a.getAttribute("data-nav-active") === "true");
    const inactive = links.find((a) => a.getAttribute("data-nav-active") !== "true");

    if (active) {
      expect(active.className).toContain("bg-surface-2");
      expect((active.querySelector("[data-nav-icon]") as HTMLElement).className).toContain("text-accent");
    }
    expect(inactive).toBeTruthy();
    expect(inactive!.className).toContain("hover:bg-surface-hover");
    expect(inactive!.className).toContain("text-fg-secondary");
  });

  it("offsets its focus ring against the sheet, not against the shell", () => {
    for (const a of openSheet()) {
      expect(a.className).toContain("focus-visible:ring-offset-surface");
      expect(a.className).not.toContain("focus-visible:ring-offset-shell");
    }
  });
});
