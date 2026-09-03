import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { createTranslator } from "@/lib/i18n/translate";
import { PublicPortfolio } from "./public-portfolio";
import type { PublicPortfolioItem } from "@/server/queries/portfolio";

const t = createTranslator("en");

const items: PublicPortfolioItem[] = [
  { id: "a", title: "Marble staircase", description: "Fifth Settlement" },
  { id: "b", title: "Kitchen cladding", description: null },
];

describe("PublicPortfolio", () => {
  /**
   * §12's hardest requirement, and the one easiest to get wrong by being helpful.
   * An empty section would tell a visitor that this professional HAS work and is
   * keeping it private — a distinction the whole public surface refuses to draw,
   * for the same reason `loadPublicProfile` collapses its three not-found cases.
   */
  it("renders NOTHING when there is nothing published", () => {
    const { container } = renderWithI18n(<PublicPortfolio items={[]} t={t} />, "en");
    expect(container.innerHTML).toBe("");
  });

  it("renders the section only once there is something to show", () => {
    renderWithI18n(<PublicPortfolio items={items} t={t} />, "en");
    expect(screen.getByRole("heading", { name: "Recent work" })).toBeTruthy();
  });

  it("keeps the order it was given, which is the owner's order", () => {
    renderWithI18n(<PublicPortfolio items={items} t={t} />, "en");
    const titles = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(titles).toEqual(["Marble staircase", "Kitchen cladding"]);
  });

  it("fetches every image through the public media route and nothing else", () => {
    const { container } = renderWithI18n(<PublicPortfolio items={items} t={t} />, "en");
    const sources = [...container.querySelectorAll("img")].map((i) => i.getAttribute("src"));
    expect(sources).toEqual(["/p/media/a", "/p/media/b"]);
  });

  /**
   * The projection carries no owner id, no storage key, no visibility and no
   * state — so this component could not leak one if it tried. Asserted anyway,
   * because the cheapest way for that to change is somebody widening the view.
   */
  it("shows no owner, no storage key and no visibility state", () => {
    const { container } = renderWithI18n(<PublicPortfolio items={items} t={t} />, "en");
    const text = container.textContent ?? "";
    for (const word of ["Private", "Published", "Unpublish", "Delete"]) {
      expect(text).not.toContain(word);
    }
    expect(container.querySelector('[src*="professional-portfolio"]')).toBeNull();
  });

  it("omits a description that is absent rather than rendering an empty line", () => {
    const { container } = renderWithI18n(<PublicPortfolio items={items} t={t} />, "en");
    expect(container.querySelectorAll("p.line-clamp-3")).toHaveLength(1);
  });

  it("lets a visitor-facing title resolve its own direction on an Arabic profile", () => {
    const { container } = renderWithI18n(<PublicPortfolio items={items} t={t} />, "ar");
    for (const heading of container.querySelectorAll("h3")) {
      expect(heading.getAttribute("dir")).toBe("auto");
    }
  });

  it("gives every image its title as alt text", () => {
    renderWithI18n(<PublicPortfolio items={items} t={t} />, "en");
    expect(screen.getByAltText("Marble staircase")).toBeTruthy();
    expect(screen.getByAltText("Kitchen cladding")).toBeTruthy();
  });
});
