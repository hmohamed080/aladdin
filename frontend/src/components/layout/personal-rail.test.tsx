import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { PersonalRail } from "./personal-rail";

const pathname = vi.fn(() => "/home");
vi.mock("next/navigation", () => ({ usePathname: () => pathname() }));

/**
 * The personal rail, and specifically that Points is a real, labelled, localized
 * destination on it — the door an organization-less installer previously did not
 * have, since `/b2b/points` was the only Points route and `/b2b/layout.tsx`
 * redirects an org-less caller away before any navigation is drawn.
 */
describe("PersonalRail", () => {
  it("labels every entry in English, Points included", () => {
    pathname.mockReturnValue("/home");
    renderWithI18n(<PersonalRail keys={["home", "profile", "points", "addBusiness"]} />, "en");
    const points = screen.getByRole("link", { name: "Points" });
    expect(points.getAttribute("href")).toBe("/home/points");
    expect(screen.getByRole("link", { name: "My profile" })).toBeTruthy();
  });

  it("labels Points in Arabic under the default locale", () => {
    pathname.mockReturnValue("/home");
    renderWithI18n(<PersonalRail keys={["home", "profile", "points", "addBusiness"]} />, "ar");
    const points = screen.getByRole("link", { name: "النقاط" });
    expect(points.getAttribute("href")).toBe("/home/points");
    // No untranslated key path reaches the rail.
    expect(screen.queryByText(/personalNav\./)).toBeNull();
  });

  it("marks Points current while on it, and only then", () => {
    pathname.mockReturnValue("/home/points");
    const { unmount } = renderWithI18n(<PersonalRail keys={["home", "profile", "points"]} />, "en");
    expect(screen.getByRole("link", { name: "Points" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Home" }).getAttribute("aria-current")).toBeNull();
    unmount();

    pathname.mockReturnValue("/home");
    renderWithI18n(<PersonalRail keys={["home", "profile", "points"]} />, "en");
    expect(screen.getByRole("link", { name: "Points" }).getAttribute("aria-current")).toBeNull();
  });

  it("draws only the entries it was given — it derives nothing itself", () => {
    // A consumer's rail. The rail must not invent Points for an account the
    // derivation excluded; that decision belongs to `personalNavKeys`.
    pathname.mockReturnValue("/home");
    renderWithI18n(<PersonalRail keys={["home", "addBusiness"]} />, "en");
    expect(screen.queryByRole("link", { name: "Points" })).toBeNull();
    expect(screen.queryByRole("link", { name: "My profile" })).toBeNull();
  });
});
