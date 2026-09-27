/**
 * REPLACEABLE ASSET SLOTS for the temporary craftsman auth pages.
 *
 * The approved designs use a worksite background photo, a craftsman photo
 * (desktop) and a craftsman illustration (mobile). None of them exist in the
 * repository yet, and they are deliberately NOT cropped out of the mockup
 * screenshots. Until the approved files arrive each slot renders a token-only
 * placeholder composition.
 *
 * To drop an asset in: add the file under `public/temporary/craftsman/` and
 * set its path here — nothing else changes. `null` = use the placeholder.
 */
export type CraftsmanAssetSlot = { src: string; width: number; height: number } | null;

export const CRAFTSMAN_AUTH_ASSETS: {
  /** Full-bleed desktop/tablet background (worksite + sky). */
  worksiteBackground: CraftsmanAssetSlot;
  /** Desktop craftsman photo, transparent background, standing between the headline and the card. */
  craftsmanPhoto: CraftsmanAssetSlot;
  /** Mobile craftsman illustration above the form heading. */
  craftsmanIllustration: CraftsmanAssetSlot;
} = {
  worksiteBackground: null,
  craftsmanPhoto: null,
  craftsmanIllustration: null,
};
