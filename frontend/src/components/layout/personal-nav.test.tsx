import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { PersonalSidebar, PersonalMobileNav } from "./personal-nav";
import { NAV_ICON_SIZE } from "@/lib/ui/nav-geometry";

const pathname = vi.fn(() => "/home");
vi.mock("next/navigation", () => ({ usePathname: () => pathname() }));

/* The carve renders nothing in jsdom — it measures the active row and bails when
   the box is empty — so the fact under test is that it is MOUNTED AND WIRED, not
   what it paints. */
const carveProps = vi.fn();
vi.mock("@/components/layout/nav-carve", () => ({
  ActiveCarve: (props: { container: unknown; narrow?: boolean }) => {
    carveProps(props);
    return null;
  },
}));

const KEYS = ["home", "profile", "points", "addBusiness"] as const;

/**
 * The personal navigation, after it stopped being its own visual system.
 *
 * What replaced the horizontal rail is not a new component so much as a
 * different LIST passed to the row the workspace already draws. So the
 * assertions worth making are about that: the destinations and active state are
 * unchanged (the behaviour the rail was already correct about), and the rendering
 * now comes from the shared family (the part that was wrong).
 */
describe("PersonalSidebar", () => {
  it("draws every destination it is given, labelled, in English", () => {
    pathname.mockReturnValue("/home");
    renderWithI18n(<PersonalSidebar keys={KEYS} />, "en");
    expect(screen.getByRole("link", { name: "Home" }).getAttribute("href")).toBe("/home");
    expect(screen.getByRole("link", { name: "My profile" }).getAttribute("href")).toBe("/home/profile");
    expect(screen.getByRole("link", { name: "Points" }).getAttribute("href")).toBe("/home/points");
  });

  it("labels them in Arabic, the default locale, with no key leak", () => {
    pathname.mockReturnValue("/home");
    const { container } = renderWithI18n(<PersonalSidebar keys={KEYS} />, "ar");
    expect(screen.getByRole("link", { name: "النقاط" })).toBeTruthy();
    expect(container.textContent).not.toMatch(/personalNav\./);
  });

  it("marks the current route, and only it", () => {
    pathname.mockReturnValue("/home/points");
    const { unmount } = renderWithI18n(<PersonalSidebar keys={KEYS} />, "en");
    expect(screen.getByRole("link", { name: "Points" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Home" }).getAttribute("aria-current")).toBeNull();
    unmount();

    // A sub-route stays on its parent entry — /home must not swallow it.
    pathname.mockReturnValue("/home/profile/edit");
    renderWithI18n(<PersonalSidebar keys={KEYS} />, "en");
    expect(screen.getByRole("link", { name: "My profile" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Home" }).getAttribute("aria-current")).toBeNull();
  });

  it("uses the SHARED navigation row, not a personal one", () => {
    // The whole point of the migration. `data-nav-icon` and the icon size are
    // `nav-item.tsx`'s, so their presence here is proof this renders the same
    // component the B2B rail renders rather than a look-alike.
    pathname.mockReturnValue("/home");
    const { container } = renderWithI18n(<PersonalSidebar keys={KEYS} />, "en");
    const tiles = container.querySelectorAll("[data-nav-icon='true']");
    expect(tiles.length).toBe(KEYS.length);
    expect(container.querySelector("svg")?.getAttribute("width")).toBe(String(NAV_ICON_SIZE));
  });

  it("draws no destination it was not given", () => {
    // A consumer's navigation. The rail must not invent a profile or Points
    // entry — that derivation belongs to `personalNavKeys`.
    pathname.mockReturnValue("/home");
    renderWithI18n(<PersonalSidebar keys={["home", "addBusiness"]} />, "en");
    expect(screen.queryByRole("link", { name: "Points" })).toBeNull();
    expect(screen.queryByRole("link", { name: "My profile" })).toBeNull();
  });

  it("carries no direction-specific class — RTL is the mirror, not a variant", () => {
    // Every inset here is logical (`px`, `gap`, `mx`, `start`), which is what
    // makes Arabic work with no Arabic-only rule.
    pathname.mockReturnValue("/home");
    const { container } = renderWithI18n(<PersonalSidebar keys={KEYS} />, "en");
    const html = container.innerHTML;
    expect(html).not.toMatch(/\b(ml|mr|pl|pr)-\d/);
    expect(html).not.toMatch(/\b(left|right)-\d/);
  });

  it("MOUNTS THE CARVE — the active surface, which the browser found missing", () => {
    /* THE REGRESSION THIS EXISTS FOR. `carved` is true from the shell, which
       tells `NavLink` to suppress its own 2px active marker BECAUSE a carve is
       drawing the active surface. The first cut of this component never rendered
       one, so the active row had no background, no shadow and no marker — the
       only cue left was a slightly brighter glyph. Every test passed (the rows
       were right), the build passed, and only a real browser showed it. */
    carveProps.mockClear();
    pathname.mockReturnValue("/home");
    renderWithI18n(<PersonalSidebar keys={KEYS} carved />, "en");
    expect(carveProps).toHaveBeenCalled();
    /* THE CONTAINER ARRIVES, and that is the assertion rather than a call count.
       The carve is rendered once with `container: null` and again after the
       callback ref stores the node — the extra render IS the mechanism that
       makes the first measurement possible (see `ActiveCarve`), so counting
       calls would pin an implementation detail. What must hold is that the last
       render hands it a real element; a ref object here is the documented way to
       make the carve silently never paint. */
    const last = carveProps.mock.calls.at(-1)?.[0];
    expect(last?.container).toBeInstanceOf(HTMLElement);
  });

  it("draws no carve when the ground has none", () => {
    carveProps.mockClear();
    pathname.mockReturnValue("/home");
    renderWithI18n(<PersonalSidebar keys={KEYS} carved={false} />, "en");
    expect(carveProps).not.toHaveBeenCalled();
  });

  it("links nowhere into /b2b — every destination is personal", () => {
    /* The second thing the browser found. The shell's fixed footer hardcoded
       Settings and "Upgrade your plan", both at `/b2b/settings` — a route an
       organization-less installer is redirected straight out of, plus a billing
       concept that does not apply to a person. The footer is a slot now and the
       personal surface asks for none. */
    pathname.mockReturnValue("/home");
    const { container } = renderWithI18n(<PersonalSidebar keys={KEYS} />, "en");
    const hrefs = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? "");
    expect(hrefs.filter((h) => h.startsWith("/b2b"))).toEqual([]);
    expect(hrefs.every((h) => h.startsWith("/home") || h.startsWith("/business"))).toBe(true);
  });
});

describe("PersonalMobileNav", () => {
  it("renders every destination as a bottom-bar target at 390px", () => {
    pathname.mockReturnValue("/home");
    renderWithI18n(<PersonalMobileNav keys={KEYS} />, "en");
    const bar = screen.getByTestId("personal-mobile-nav");
    // Hidden from `tablet` up: this is the phone's primary navigation, and the
    // desktop panel is never squeezed into the viewport.
    expect(bar.className).toContain("tablet:hidden");
    expect(bar.querySelectorAll("a").length).toBe(KEYS.length);
  });

  it("keeps the active state the desktop rail has", () => {
    pathname.mockReturnValue("/home/points");
    renderWithI18n(<PersonalMobileNav keys={KEYS} />, "en");
    expect(screen.getByRole("link", { name: /Points/ }).getAttribute("aria-current")).toBe("page");
  });

  it("localizes in Arabic", () => {
    pathname.mockReturnValue("/home");
    const { container } = renderWithI18n(<PersonalMobileNav keys={KEYS} />, "ar");
    expect(screen.getByRole("link", { name: /النقاط/ })).toBeTruthy();
    expect(container.textContent).not.toMatch(/personalNav\./);
  });

  it("renders nothing when there is only one destination", () => {
    // A bar with one target is chrome, not navigation.
    pathname.mockReturnValue("/home");
    const { container } = renderWithI18n(<PersonalMobileNav keys={["home"]} />, "en");
    expect(container.querySelector("[data-testid='personal-mobile-nav']")).toBeNull();
  });
});
