/**
 * REPLACEABLE ASSET SLOTS for the temporary craftsman auth pages.
 *
 * The approved composition uses a worksite background photo and a craftsman
 * photo (desktop) / illustration (mobile). Those approved files are not in the
 * repository and are deliberately NOT cropped out of the mockup screenshots.
 * Until they arrive, both slots point at ORIGINAL interim artwork drawn for
 * these pages in the Aladdin palette (`public/temporary/craftsman/*.svg`).
 *
 * To swap in an approved asset: add the file under `public/temporary/craftsman/`
 * and change its entry here — the composition (position, scale, bottom
 * anchoring, crop) is driven by `craftsman-auth.module.css` and does not change.
 */
export type CraftsmanAsset = { src: string; width: number; height: number };

export const CRAFTSMAN_AUTH_ASSETS: {
  /** Full-bleed worksite backdrop (sky, skyline, crane, ground). Rendered with object-fit: cover. */
  worksiteBackground: CraftsmanAsset;
  /** The craftsman figure: transparent background, waist-up, bottom edge is the cut line. */
  craftsman: CraftsmanAsset;
} = {
  worksiteBackground: { src: "/temporary/craftsman/worksite.svg", width: 1600, height: 900 },
  craftsman: { src: "/temporary/craftsman/craftsman.svg", width: 480, height: 600 },
};
