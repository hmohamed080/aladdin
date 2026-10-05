import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TradeIllustration, illustrationFamily, type IllustrationFamily } from "./trade-illustration";

/** Every `trades.key` seeded by the schema (active and retired). */
const SEEDED_TRADE_KEYS = [
  "astarji", "decorative_paints", "door_installation", "electrical", "epoxy_flooring", "foutek_installation",
  "gypsum_board_installation", "gypsum_paint", "hdf_flooring_installation", "hvac", "kitchens_doors",
  "marble_alternative_installation", "marble_granite", "painting", "plastering_and_gypsum", "plumbing", "tiling",
  "spray_paint_and_foundation", "vinyl_flooring_installation", "wallpaper_installation", "wood_alternative_installation",
] as const;

describe("illustrationFamily — a pure function of the real trade key", () => {
  it("maps every seeded trade to a specific drawing, not the fallback", () => {
    for (const key of SEEDED_TRADE_KEYS) expect(illustrationFamily(key), key).not.toBe("generic");
  });

  it("groups the trades the way a reader would", () => {
    const expected: Record<string, IllustrationFamily> = {
      painting: "paint", decorative_paints: "paint", spray_paint_and_foundation: "paint",
      gypsum_board_installation: "plaster", plastering_and_gypsum: "plaster", astarji: "plaster",
      epoxy_flooring: "flooring", hdf_flooring_installation: "flooring", vinyl_flooring_installation: "flooring", wood_alternative_installation: "flooring",
      door_installation: "wood", kitchens_doors: "wood", foutek_installation: "wood",
      wallpaper_installation: "wallpaper",
      marble_alternative_installation: "tile", marble_granite: "tile", tiling: "tile",
      electrical: "electrical", plumbing: "plumbing", hvac: "hvac",
    };
    for (const [key, family] of Object.entries(expected)) expect(illustrationFamily(key), key).toBe(family);
  });

  it("gives the neutral toolbox to an unknown, empty or missing key instead of guessing", () => {
    for (const key of ["", "unknown_trade", null, undefined]) expect(illustrationFamily(key)).toBe("generic");
  });

  it("is deterministic", () => {
    expect(illustrationFamily("painting")).toBe(illustrationFamily("painting"));
  });
});

describe("TradeIllustration", () => {
  it("is decorative: hidden from assistive tech, tagged with its family, and not an <img>", () => {
    const { container } = render(<TradeIllustration tradeKey="plumbing" />);
    const svg = container.querySelector("svg")!;
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("data-illustration")).toBe("plumbing");
    expect(container.querySelector("img")).toBeNull();
  });

  it("draws something for every family (no empty drawing)", () => {
    for (const key of [...SEEDED_TRADE_KEYS, null]) {
      const { container, unmount } = render(<TradeIllustration tradeKey={key} />);
      expect(container.querySelectorAll("svg *").length, String(key)).toBeGreaterThan(2);
      unmount();
    }
  });

  it("uses theme tokens only — no hard-coded colour", () => {
    const { container } = render(<TradeIllustration tradeKey="painting" />);
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i);
  });
});
