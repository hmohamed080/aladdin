import { isMarketplacePreviewEnabled } from "@/lib/env";

/**
 * The scope class of the approved 2026 four-colour palette.
 *
 * `styles/installer-theme.css` is the scoped mirror of that palette (Deep Navy,
 * Warm Sand, Muted Terracotta, Soft Cream — light and dark) under
 * `.installer-surface`. It was written for the installer surfaces, but its
 * values ARE the 2026 palette, so the workspace preview reuses the same scope
 * rather than keeping a second copy of every token that could drift from it.
 * When the palette lands in the global tokens, both uses go away together.
 */
export const BRAND_2026_SCOPE_CLASS = "installer-surface";

/**
 * Request header the middleware sets for routes that render in the 2026 palette,
 * so the ROOT layout can put the scope on <body> in the very first byte of HTML.
 * Without it the body paints the old canvas until hydration and then fades to
 * the new one on every hard load. Any client-sent value is stripped first.
 */
export const BRAND_SURFACE_HEADER = "x-aladdin-brand-surface";

/** Whether this path renders in the 2026 palette (the workspace, behind the preview flag). */
export function isBrand2026Path(path: string): boolean {
  if (!isMarketplacePreviewEnabled()) return false;
  return path === "/b2b" || path.startsWith("/b2b/") || path === "/b2c/seller" || path.startsWith("/b2c/seller/");
}
