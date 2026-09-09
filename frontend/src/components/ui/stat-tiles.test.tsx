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

describe("StatTiles — single-surface card (no nested/double surface)", () => {
  it("a tile is one bg-surface with no Tailwind border utility stacked on top", () => {
    // Regression for the "card inside a card" defect: `bg-surface` already
    // gets its border-color and elevation from the shared workspace-body
    // rule; also requesting Tailwind's own `border` utility here is what
    // stacked a visible edge on top of that shadow and read as a picture
    // frame around a 90px-tall tile.
    const { container } = render(<StatTiles locale="en" tiles={TILES} layout="grid" columns={6} />);
    const tile = container.querySelector("[class*='bg-surface']");
    expect(tile).not.toBeNull();
    expect(tile!.className).toMatch(/(?:^|\s)bg-surface(?:\s|$)/);
    expect(tile!.className).not.toMatch(/(?:^|\s)border(?:\s|$)/);
    expect(tile!.className).not.toContain("shadow-card");
  });

  it("does not clip a long label — no truncate/ellipsis, wrapping is allowed", () => {
    const longLabel: Tile[] = [
      { label: "Open purchase requests awaiting your decision", value: 4, Icon: AlertIcon },
    ];
    render(<StatTiles locale="en" tiles={longLabel} layout="grid" columns={6} />);
    const label = screen.getByText(longLabel[0]!.label);
    expect(label.className).not.toContain("truncate");
    expect(label.className).toContain("break-words");
  });

  it("gives a wrapping label real inter-line breathing room, not the tighter default", () => {
    // Regression for two wrapped Arabic lines (e.g. "طلبات قيد التنفيذ")
    // reading as visually merged at `leading-snug` (1.375) — `leading-normal`
    // (1.5) and a `min-h-10` reservation (up from `min-h-9`) replace it so a
    // wrapped label has real room without breaking the shared-row equal-height
    // reservation the tile above `it` documents.
    render(<StatTiles locale="en" tiles={TILES} layout="grid" columns={6} />);
    const label = screen.getByText(TILES[0]!.label);
    expect(label.className).toContain("leading-normal");
    expect(label.className).not.toContain("leading-snug");
    expect(label.className).toContain("min-h-10");
  });
});
