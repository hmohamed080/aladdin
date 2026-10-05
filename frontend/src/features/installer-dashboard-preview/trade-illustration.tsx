import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

/**
 * A GENERIC CATEGORY ILLUSTRATION FOR A JOB'S TRADE — never a photograph.
 *
 * An opening has no media of its own today (no column, no bucket — see
 * `jobs` in the schema), so a card with no real image draws the illustration
 * for its REAL trade key instead. The choice is a pure function of that key:
 * the same trade always gets the same drawing, nothing is random, and nothing
 * depends on where the card sits in a list. It is plainly a flat, two-tone
 * drawing, so it cannot be mistaken for a picture of the actual site.
 *
 * Colours are theme tokens only (navy ink, terracotta accent, a muted wash).
 * When jobs gain real media, a real image takes priority in the card and this
 * remains the fallback for openings that have none.
 */

export type IllustrationFamily =
  | "paint"
  | "plaster"
  | "flooring"
  | "wood"
  | "wallpaper"
  | "tile"
  | "electrical"
  | "plumbing"
  | "hvac"
  | "generic";

/** Every canonical `trades.key` the schema seeds, active or since retired. */
const FAMILY_BY_TRADE: Readonly<Record<string, IllustrationFamily>> = {
  painting: "paint",
  decorative_paints: "paint",
  spray_paint_and_foundation: "paint",
  gypsum_board_installation: "plaster",
  plastering_and_gypsum: "plaster",
  gypsum_paint: "plaster",
  astarji: "plaster",
  epoxy_flooring: "flooring",
  hdf_flooring_installation: "flooring",
  vinyl_flooring_installation: "flooring",
  wood_alternative_installation: "flooring",
  door_installation: "wood",
  kitchens_doors: "wood",
  foutek_installation: "wood",
  wallpaper_installation: "wallpaper",
  marble_alternative_installation: "tile",
  marble_granite: "tile",
  tiling: "tile",
  electrical: "electrical",
  plumbing: "plumbing",
  hvac: "hvac",
};

/** The drawing for a trade key; an unknown or missing key gets the neutral toolbox, never a guess. */
export function illustrationFamily(tradeKey: string | null | undefined): IllustrationFamily {
  return (tradeKey && FAMILY_BY_TRADE[tradeKey]) || "generic";
}

const INK = "text-primary";
const ACCENT = "text-accent-solid";
const WASH = "text-fg-muted";

function Ink({ children }: { children: ReactNode }) {
  return <g className={INK}>{children}</g>;
}
function Accent({ children }: { children: ReactNode }) {
  return <g className={ACCENT}>{children}</g>;
}
function Wash({ children }: { children: ReactNode }) {
  return <g className={cn(WASH, "opacity-30")}>{children}</g>;
}

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 4, strokeLinecap: "round", strokeLinejoin: "round" } as const;

const ART: Record<IllustrationFamily, ReactNode> = {
  // A paint roller on a stripe of fresh paint.
  paint: (
    <>
      <Wash><rect x="26" y="66" width="108" height="10" rx="5" fill="currentColor" /></Wash>
      <Accent><rect x="40" y="20" width="76" height="22" rx="6" fill="currentColor" /></Accent>
      <Ink>
        <path d="M116 31h10a6 6 0 0 1 6 6v8a6 6 0 0 1-6 6H80v10" {...stroke} />
        <rect x="73" y="56" width="14" height="30" rx="4" fill="currentColor" />
      </Ink>
    </>
  ),
  // A plasterer's trowel over a smoothed wall.
  plaster: (
    <>
      <Wash><rect x="22" y="62" width="116" height="16" rx="3" fill="currentColor" /></Wash>
      <Accent><path d="M44 54 L108 30 L120 46 L56 70 Z" fill="currentColor" /></Accent>
      <Ink>
        <path d="M112 38 L132 22" {...stroke} />
        <rect x="126" y="12" width="12" height="16" rx="4" transform="rotate(35 132 20)" fill="currentColor" />
      </Ink>
    </>
  ),
  // Floor boards laid in perspective.
  flooring: (
    <>
      <Wash><path d="M18 78 L142 78" {...stroke} /></Wash>
      <Accent><path d="M30 70 L62 36 H96 L64 70 Z" fill="currentColor" /></Accent>
      <Ink>
        <path d="M70 70 L102 36 H130 L98 70 Z" fill="currentColor" opacity="0.85" />
        <path d="M104 70 L136 36" {...stroke} strokeWidth={3} />
      </Ink>
    </>
  ),
  // A plank with grain and a hammer.
  wood: (
    <>
      <Accent>
        <rect x="22" y="52" width="92" height="24" rx="4" fill="currentColor" />
      </Accent>
      <Wash><path d="M32 64 c14 -8 22 8 38 0 s22 -6 36 0" {...stroke} strokeWidth={3} /></Wash>
      <Ink>
        <path d="M118 74 L136 34" {...stroke} />
        <rect x="112" y="22" width="34" height="14" rx="4" transform="rotate(24 129 29)" fill="currentColor" />
      </Ink>
    </>
  ),
  // A roll of wallpaper unrolling.
  wallpaper: (
    <>
      <Wash><rect x="62" y="62" width="76" height="16" rx="3" fill="currentColor" /></Wash>
      <Accent><rect x="36" y="22" width="34" height="56" rx="8" fill="currentColor" /></Accent>
      <Ink>
        <path d="M53 22 H120 a8 8 0 0 1 8 8 V54 H70 V30" {...stroke} strokeWidth={3} />
        <circle cx="95" cy="38" r="4" fill="currentColor" />
        <circle cx="111" cy="46" r="4" fill="currentColor" />
      </Ink>
    </>
  ),
  // A grid of tiles with one set slightly apart.
  tile: (
    <>
      <Accent>
        <rect x="26" y="46" width="30" height="30" rx="3" fill="currentColor" />
        <rect x="90" y="46" width="30" height="30" rx="3" fill="currentColor" />
      </Accent>
      <Ink>
        <rect x="58" y="46" width="30" height="30" rx="3" fill="currentColor" />
        <rect x="122" y="46" width="14" height="30" rx="3" fill="currentColor" opacity="0.85" />
      </Ink>
      <Wash><rect x="40" y="14" width="30" height="26" rx="3" fill="currentColor" transform="rotate(-8 55 27)" /></Wash>
    </>
  ),
  // A lightning bolt in a socket plate.
  electrical: (
    <>
      <Wash><rect x="44" y="14" width="72" height="68" rx="12" fill="currentColor" /></Wash>
      <Accent><path d="M88 22 L62 54 H80 L72 76 L100 42 H82 Z" fill="currentColor" /></Accent>
      <Ink><rect x="44" y="14" width="72" height="68" rx="12" {...stroke} strokeWidth={3} /></Ink>
    </>
  ),
  // A pipe elbow and a drop.
  plumbing: (
    <>
      <Ink><path d="M28 30 H92 a14 14 0 0 1 14 14 V80" {...stroke} strokeWidth={12} /></Ink>
      <Accent><path d="M120 50 C112 62 108 68 108 74 a12 12 0 0 0 24 0 c0 -6 -4 -12 -12 -24 Z" fill="currentColor" /></Accent>
      <Wash><rect x="22" y="22" width="12" height="16" rx="3" fill="currentColor" /></Wash>
    </>
  ),
  // A fan: ventilation / air.
  hvac: (
    <>
      <Wash><circle cx="80" cy="48" r="38" fill="currentColor" /></Wash>
      <Accent>
        <path d="M80 48 C80 28 98 22 106 32 C96 34 90 40 80 48 Z" fill="currentColor" />
        <path d="M80 48 C98 56 98 76 86 80 C86 70 84 60 80 48 Z" fill="currentColor" />
        <path d="M80 48 C64 38 46 44 48 56 C58 52 68 52 80 48 Z" fill="currentColor" />
      </Accent>
      <Ink><circle cx="80" cy="48" r="6" fill="currentColor" /></Ink>
    </>
  ),
  // A neutral toolbox, for a trade the catalogue does not draw.
  generic: (
    <>
      <Wash><rect x="26" y="68" width="108" height="8" rx="4" fill="currentColor" /></Wash>
      <Accent><rect x="34" y="34" width="92" height="34" rx="8" fill="currentColor" /></Accent>
      <Ink>
        <path d="M62 34 V28 a6 6 0 0 1 6 -6 h24 a6 6 0 0 1 6 6 V34" {...stroke} strokeWidth={4} />
        <rect x="72" y="46" width="16" height="12" rx="3" fill="currentColor" />
      </Ink>
    </>
  ),
};

export function TradeIllustration({ tradeKey, className }: { tradeKey: string | null | undefined; className?: string }) {
  const family = illustrationFamily(tradeKey);
  return (
    <svg
      viewBox="0 0 160 96"
      aria-hidden="true"
      focusable="false"
      data-illustration={family}
      className={cn("pointer-events-none", className)}
    >
      {ART[family]}
    </svg>
  );
}
