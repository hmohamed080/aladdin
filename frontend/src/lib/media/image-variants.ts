/**
 * The derived-image contract, shared by the server that writes variants and the
 * components that render them. PURE: no `server-only`, no React, no env.
 *
 * Three WebP widths, generated once from the VERIFIED original during
 * `verifyPendingMedia`. The original stays the retained reference; a variant is a
 * disposable derivative that can always be rebuilt from it.
 *
 *   thumb  320  rows, small cards, list thumbnails
 *   card   768  grid cards (a 3-column desktop grid cell is ~330 CSS px; 768
 *               covers it at 2x DPR, and a 1-column phone cell at ~2x)
 *   full  1600  detail / lightbox views only; never in a grid `srcset`
 */
export const MEDIA_VARIANTS = ["thumb", "card", "full"] as const;
export type MediaVariant = (typeof MEDIA_VARIANTS)[number];

export const MEDIA_VARIANT_WIDTH: Readonly<Record<MediaVariant, number>> = {
  thumb: 320,
  card: 768,
  full: 1600,
};

/**
 * Where a variant lives in the private bucket, next to — never instead of — the
 * original, from the original's physical R2 key. Deterministic, so a retry, the
 * backfill and the edge Worker all name the same object. It inherits the original's
 * authorization: nothing resolves a variant without resolving the original first.
 * Ids-only keys (u/… or o/…, from 2026-10-29) keep variants in the original's folder:
 * `u/<user>/portfolio/<id>/original.png` → `u/<user>/portfolio/<id>/v/card.webp`.
 * Legacy keys (`<namespace>/<key>`) keep `v/<namespace>/<key>/<variant>.webp`.
 */
export function variantObjectKey(objectKey: string, variant: MediaVariant): string {
  return /^[uo]\//.test(objectKey) ? objectKey.replace(/\/original\.[a-z0-9]+$/, `/v/${variant}.webp`)
    : `v/${objectKey}/${variant}.webp`;
}

/** URLs per variant, filled by the URL issuer (WP4). Any subset may be present. */
export type MediaVariantUrls = Partial<Record<MediaVariant, string>>;

/**
 * One renderable image: the original URL (always valid) plus optional variant URLs.
 * When `variants` is absent — legacy rows, Supabase-provider rows, variants not yet
 * backfilled — components fall back to `src` exactly as before.
 */
export type MediaSource = { src: string; variants?: MediaVariantUrls | null };

/** Grid/card rendering uses thumb+card; detail views use card+full. */
export type MediaUse = "grid" | "detail";

const USE_VARIANTS: Readonly<Record<MediaUse, readonly MediaVariant[]>> = {
  grid: ["thumb", "card"],
  detail: ["card", "full"],
};

/** `srcset` from whichever variants exist, or undefined so the attribute is omitted. */
export function variantSrcSet(variants: MediaVariantUrls | null | undefined, use: MediaUse): string | undefined {
  if (!variants) return undefined;
  const entries = USE_VARIANTS[use]
    .filter((variant) => variants[variant])
    .map((variant) => `${variants[variant]} ${MEDIA_VARIANT_WIDTH[variant]}w`);
  return entries.length > 0 ? entries.join(", ") : undefined;
}

/** The `src` to fall back on: the largest variant this use allows, else the original. */
export function variantSrc(source: MediaSource, use: MediaUse): string {
  const preferred = [...USE_VARIANTS[use]].reverse().find((variant) => source.variants?.[variant]);
  return preferred ? source.variants![preferred]! : source.src;
}

/**
 * `sizes` for the standard 1 / 2 / 3-column card grid (tablet 768px, desktop
 * 1024px — design/tokens/breakpoints.json). Overstating slightly is harmless; it
 * only steers which candidate the browser picks.
 */
export const GRID_IMAGE_SIZES = "(min-width: 1024px) 33vw, (min-width: 768px) 50vw, 100vw";
