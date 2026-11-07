/**
 * The one place that names static website assets.
 *
 * Static assets (brand, landing artwork, icons, illustrations, demo product
 * art) ship with the app from `public/`; they are NOT media and never go to
 * R2. User, organization and admin-managed site media are served by the media
 * pipeline instead. Reference an asset through this registry so a file lives
 * in exactly one place and a move is a one-line change.
 *
 * Layout: `public/assets/shared/*` is reused across pages; `public/assets/pages/<page>/*`
 * belongs to one surface. `public/brand` and `public/demo` keep their long-standing URLs.
 */
export const BRAND = {
  logo: "/brand/aladdin-logo.png",
  mark: "/brand/aladdin-mark.png",
} as const;

export const LANDING = {
  heroBackground: "/assets/pages/landing/hero/background-2-new-trimmed.png",
  finalCtaScene: "/assets/pages/landing/sections/final-cta-scene.png",
  footerTexture: "/assets/pages/landing/sections/footer-texture.png",
  productsScene: "/assets/pages/landing/sections/products-scene.png",
  valueBand: "/assets/pages/landing/sections/value-band.png",
} as const;

/** Old public URLs that still resolve, via permanent redirects in next.config. */
export const MOVED_ASSET_REDIRECTS: ReadonlyArray<{ source: string; destination: string }> = [
  ...Object.entries({
    "hero/background-2-new-trimmed.png": LANDING.heroBackground,
    "sections/final-cta-scene.png": LANDING.finalCtaScene,
    "sections/footer-texture.png": LANDING.footerTexture,
    "sections/products-scene.png": LANDING.productsScene,
    "sections/value-band.png": LANDING.valueBand,
  }).flatMap(([file, destination]) => [
    { source: `/landing-v2/${file}`, destination },
    { source: `/preview/landing/${file}`, destination },
  ]),
  { source: "/preview/landing/aladdin-logo.png", destination: BRAND.logo },
];
