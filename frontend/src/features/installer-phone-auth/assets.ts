/**
 * APPROVED ASSETS for the installer phone + password auth pages (supplied by the
 * product owner, 2026-09-27). Kept as data so any of them can be replaced
 * without touching the composition in `craftsman-auth.module.css`.
 *
 *   worksiteHero       desktop/tablet backdrop — worksite, craftsman and the
 *                      lapis/lumen bands are part of the artwork
 *   craftsmanSignUp    mobile header artwork, sign-up (arms crossed)
 *   craftsmanSignIn    mobile header artwork, sign-in (holding a phone)
 *   icons.*            benefit tiles — briefcase/bell/people split losslessly
 *                      from the supplied three-tile sheet, chart cropped from its
 *                      own supplied file at the same framing (no redraw)
 */
export type CraftsmanAsset = { src: string; width: number; height: number };

export const CRAFTSMAN_AUTH_ASSETS: {
  worksiteHero: CraftsmanAsset;
  craftsmanSignUp: CraftsmanAsset;
  craftsmanSignIn: CraftsmanAsset;
  icons: {
    briefcase: CraftsmanAsset;
    bell: CraftsmanAsset;
    people: CraftsmanAsset;
    chart: CraftsmanAsset;
  };
} = {
  worksiteHero: { src: "/installer-auth/worksite-hero.webp", width: 1672, height: 941 },
  craftsmanSignUp: { src: "/installer-auth/craftsman-sign-up.webp", width: 1416, height: 1111 },
  craftsmanSignIn: { src: "/installer-auth/craftsman-sign-in.webp", width: 1536, height: 1024 },
  icons: {
    briefcase: { src: "/installer-auth/icon-briefcase.png", width: 520, height: 520 },
    bell: { src: "/installer-auth/icon-bell.png", width: 520, height: 520 },
    people: { src: "/installer-auth/icon-people.png", width: 520, height: 520 },
    chart: { src: "/installer-auth/icon-chart.png", width: 520, height: 520 },
  },
};
