/**
 * The cover photo of each Marketplace product type, shipped with the frontend (public/preview/landing/marketplace).
 * The storefront's type strip and hero art read ONLY this table — never the database and never the sample
 * catalogue — so they look the same with or without a database connection. Keys are the database
 * product-type keys. Photos are square webp (≈20–110 KB).
 */
const BASE = "/preview/landing/marketplace";

const COVERS: Record<string, string> = {
  wallpaper: `${BASE}/type-wallpaper.webp`,
  wood_alternative: `${BASE}/type-wood-alternative.webp`,
  marble_alternative: `${BASE}/type-marble-alternative.webp`,
  sheeboard: `${BASE}/type-sheeboard.webp`,
  cornice: `${BASE}/type-cornice.webp`,
  corner_trim: `${BASE}/type-corner-trim.webp`,
  wall_panel: `${BASE}/type-panels.webp`,
  skirting: `${BASE}/type-skirting.webp`,
  interior_door: `${BASE}/type-interior-doors.webp`,
  armored_door: `${BASE}/type-armored-doors.webp`,
  vinyl_flooring: `${BASE}/type-vinyl-flooring.webp`,
  spc_flooring: `${BASE}/type-spc-flooring.webp`,
  // no HDF photo has been approved yet: a wood-look floor shot stands in until one is supplied
  hdf_flooring: `${BASE}/type-spc-flooring.webp`,
  curtain: `${BASE}/type-curtains.webp`,
  poster: `${BASE}/type-posters.webp`,
  paint: `${BASE}/type-paints.webp`,
};

/** The cover of a product type, or null for a type this build has no photo for (the strip then shows an icon). */
export const typeCover = (key: string): string | null => COVERS[key] ?? null;

/** Every product-type key that has a cover. */
export const COVERED_TYPE_KEYS = Object.keys(COVERS);

/** The four photos of the "All products" tile. */
export const ALL_PRODUCTS_TYPES = ["wallpaper", "marble_alternative", "wall_panel", "curtain"] as const;

/** The three photos of the hero banner. */
export const HERO_TYPES = ["wood_alternative", "marble_alternative", "cornice"] as const;
