import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatTiles, type Tile } from "./stat-tiles";
import { AlertIcon } from "./icons";

const TILES: Tile[] = Array.from({ length: 6 }, (_, i) => ({
  label: `KPI ${i + 1}`,
  value: i,
  Icon: AlertIcon,
}));

describe("StatTiles — grid layout with a columns override", () => {
  it("renders a plain grid, not the horizontally-scrolling rail, for six KPI tiles", () => {
    const { container } = render(<StatTiles locale="en" tiles={TILES} layout="grid" columns={6} />);
    // The rail variant renders a scroll region with role="region" and an
    // aria-label (CardRail) — its absence is the structural proof this is
    // the plain grid path, not the carousel.
    expect(screen.queryByRole("region")).toBeNull();
    // Every tile is present and reachable without any horizontal-scroll
    // affordance (no left/right arrow buttons, which CardRail renders).
    for (const t of TILES) expect(screen.getByText(t.label)).toBeInTheDocument();
    expect(screen.queryByLabelText(/scroll (left|right)/i)).toBeNull();
    // The 6-column desktop class from the lookup table is applied.
    expect(container.firstElementChild?.className).toContain("desktop:grid-cols-6");
  });

  it("falls back to the default 2/3/4 responsive grid when no columns override is given", () => {
    const { container } = render(<StatTiles locale="en" tiles={TILES.slice(0, 3)} layout="grid" />);
    expect(container.firstElementChild?.className).toContain("desktop:grid-cols-4");
  });

  it("every tile carries min-w-0 so a long value can shrink instead of forcing overflow", () => {
    const { container } = render(<StatTiles locale="en" tiles={TILES} layout="grid" columns={6} />);
    expect(container.firstElementChild?.className).toContain("[&>*]:min-w-0");
  });
});
