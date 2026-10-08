import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Select } from "./controls";
import { menuItemClass, menuSurfaceClass } from "./menu";

/**
 * EVERY DROPDOWN / MENU / POPOVER FOLLOWS THE DESIGN LANGUAGE — through the shared primitives, not page by page.
 *
 *   - custom surfaces we draw (menus, listboxes, popovers) are ONE recipe: `menuSurfaceClass`
 *     (rounded `md`, the strong hairline, the themed ground, the overlay shadow, clipped, capped to the viewport),
 *     drawn by ONE component, `FloatingMenu` — a portal positioned by Floating UI — so no page positions its own;
 *   - every owned <select> is the shared `Select`: a button + a `listbox` on that same FloatingMenu, with a hidden native
 *     <select> only as the form-value carrier, so no browser's own un-themeable picker is ever what the person sees.
 *     (Native date / time pickers stay native.)
 */

const SRC = path.resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(path.join(SRC, rel), "utf8");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx$/.test(name) && !/\.test\.tsx$/.test(name) ? [full] : [];
  });
}

describe("the shared menu surface", () => {
  it("is rounded, bordered, themed and elevated — with no sharp corner", () => {
    for (const token of ["rounded-md", "border", "border-strong", "bg-surface", "shadow-lg", "overflow-hidden"]) {
      expect(menuSurfaceClass.split(/\s+/)).toContain(token);
    }
    expect(menuSurfaceClass).not.toMatch(/rounded-none|rounded-(sm|xs)\b/);
  });

  it("stays inside the viewport in both directions (RTL-safe: no physical left/right)", () => {
    expect(menuSurfaceClass).toContain("max-w-[calc(100vw-1.5rem)]");
    expect(menuSurfaceClass).not.toMatch(/\b(left|right)-/);
  });

  it("rows align to the start edge, so Arabic reads from the right", () => {
    expect(menuItemClass(false)).toContain("text-start");
    expect(menuItemClass(false)).not.toMatch(/text-(left|right)/);
  });

  it("a selected row is its own statement, a hovered row another", () => {
    expect(menuItemClass(true)).toContain("bg-accent-solid/10");
    expect(menuItemClass(false)).toContain("hover:bg-surface-hover");
    expect(menuItemClass(true)).not.toContain("hover:bg-surface-hover");
  });
});

describe("no page hand-rolls a floating surface any more", () => {
  const files = sourceFiles(SRC);

  it("every floating menu / listbox / popover uses menuSurfaceClass instead of its own radius-border-shadow recipe", () => {
    const offenders = files.filter((file) => {
      const text = readFileSync(file, "utf8");
      // The hand-rolled recipe: a popover layer that spells out its own rounded + bordered + shadowed surface.
      return /className="[^"]*z-popover[^"]*"/.test(text) && /className="[^"]*(z-popover)[^"]*rounded-(md|lg|sm)[^"]*shadow-lg[^"]*"|className="[^"]*rounded-(md|lg|sm)[^"]*(z-popover)[^"]*shadow-lg[^"]*"|className="[^"]*z-popover[^"]*shadow-lg[^"]*rounded-(md|lg|sm)[^"]*"/.test(text);
    });
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });

  it("no floating menu is drawn with sharp corners", () => {
    const sharp = files.filter((file) => /role="(menu|listbox)"[^>]*className="[^"]*rounded-none/.test(readFileSync(file, "utf8")));
    expect(sharp).toEqual([]);
  });

  it("the installer menus that used to repeat the recipe now use the shared one (the surface, or the floating component that carries it)", () => {
    for (const rel of [
      "features/installer-dashboard-preview/installer-sidebar.tsx",
      "features/installer-dashboard-preview/installer-topbar-core.tsx",
      "features/installer-job-opportunities-preview/opportunity-filters.tsx",
      "features/installer-my-work-preview/installer-my-work-view.tsx",
      "features/installer-reviews-preview/installer-reviews-preview.tsx",
      "features/installer-network-preview/installer-network-preview.tsx",
    ]) {
      expect(read(rel), rel).toMatch(/menuSurfaceClass|FloatingMenu|ListboxSelect/);
    }
  });

  it("NO menu positions itself: every `absolute … z-popover` hand-rolled dropdown is gone (a clipping ancestor cannot cut what is not inside it)", () => {
    // The only `z-popover` left in a page file is the hover-driven sidebar-mode menu, which is already a portal
    // with fixed positioning, and the date-range modal backdrop (a dialog, not a dropdown).
    const allowed = new Set(["features/installer-dashboard-preview/installer-sidebar.tsx", "components/ui/date-range-filter.tsx", "components/ui/floating-menu.tsx"]);
    const offenders = files
      .filter((file) => !allowed.has(path.relative(SRC, file).split(path.sep).join("/")))
      .filter((file) => /className=[^\n]*\babsolute\b[^\n]*\bz-popover\b|className=[^\n]*\bz-popover\b[^\n]*\babsolute\b/.test(readFileSync(file, "utf8")))
      .map((f) => path.relative(SRC, f));
    expect(offenders).toEqual([]);
  });

  it("the sidebar's mode menu, which keeps its own hover logic, is still a portal with fixed positioning — never an in-flow absolute box", () => {
    const text = read("features/installer-dashboard-preview/installer-sidebar.tsx");
    expect(text).toMatch(/createPortal\(/);
    expect(text).toMatch(/"fixed z-popover/);
  });

  it("uses Floating UI for positioning: flip, shift, size and autoUpdate are configured once, in the shared component", () => {
    const text = read("components/ui/floating-menu.tsx");
    for (const needle of ["flip(", "shift(", "size(", "autoUpdate", 'strategy: "fixed"', "OVERLAY_VIEWPORT_PADDING = 12", "createPortal("]) expect(text).toContain(needle);
    // and no page re-implements the maths
    // (The sidebar's hover-driven mode menu positions itself from its trigger because it is opened by hover/focus timers.)
    const reimplemented = files.filter((file) => !file.endsWith(path.join("components", "ui", "floating-menu.tsx")) && !file.endsWith("installer-sidebar.tsx") && /getBoundingClientRect\(\)[\s\S]{0,200}window\.innerWidth/.test(readFileSync(file, "utf8")));
    expect(reimplemented.map((f) => path.relative(SRC, f))).toEqual([]);
  });
});

describe("the shared Select — every owned dropdown is drawn in the design system", () => {
  it("is the shared floating listbox, with a real native <select> kept only as the hidden form-value carrier", () => {
    const { container } = render(
      <Select aria-label="Country" defaultValue="eg">
        <option value="eg">Egypt</option>
        <option value="sa">Saudi Arabia</option>
      </Select>,
    );
    expect(screen.getByRole("button", { name: /^Country/ })).toHaveAttribute("aria-haspopup", "listbox");
    const native = container.querySelector("select");
    expect(native).toHaveAttribute("data-ui-select-native");
    expect(native).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("combobox")).toBeNull(); // the visible control is not a native combobox
  });

  it("there is no <select> element anywhere in the product but the shared Select's own form-value carrier", () => {
    const raw = sourceFiles(SRC).filter((file) => /<select[\s>]/.test(readFileSync(file, "utf8")) && !file.endsWith(path.join("components", "ui", "controls.tsx")));
    // Comments that mention a <select> are fine; an element is not.
    const elements = raw.filter((file) => readFileSync(file, "utf8").split("\n").some((line) => /<select[\s>]/.test(line) && !/^\s*(\*|\/\/|\{\/\*)/.test(line)));
    expect(elements.map((f) => path.relative(SRC, f))).toEqual([]);
  });

  it("no page imports a native-picker workaround: the base-select stylesheet hack is gone", () => {
    expect(read("app/globals.css")).not.toMatch(/data-ui-select|appearance:\s*base-select/);
  });

  it("every call site goes through the shared Select (no one re-implements a dropdown on a raw <select> or <datalist>)", () => {
    const offenders = sourceFiles(SRC).filter((file) => /<datalist[\s>]/.test(readFileSync(file, "utf8")));
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });
});
