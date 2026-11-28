/**
 * The profile cover-photo storage contract — the avatar contract's twin
 * (`avatar-assets.ts`). Gives the browser a fast, honest answer before anything
 * uploads; it is NOT the authority. The `covers` bucket's own
 * `allowed_mime_types`/`file_size_limit` and the `cover_uploads` metadata-row
 * ownership model (20261031100000_profile_cover_photo.sql) decide.
 *
 * PURE ON PURPOSE — no `server-only`, no Supabase client — so the crop/upload
 * client component can validate a file the instant it is chosen.
 */

export const COVER_BUCKET = "covers";
/** The bucket's own file_size_limit — applies to the CROPPED object actually uploaded. */
export const COVER_MAX_BYTES = 5 * 1024 * 1024;
/** The limit on the photo a person SELECTS; the crop step re-encodes it smaller. */
export const COVER_SOURCE_MAX_BYTES = 12 * 1024 * 1024;
/** Cropped output: a 4:1 banner. */
export const COVER_ASPECT = 4;
export const COVER_OUTPUT_WIDTH_PX = 1600;
export const COVER_OUTPUT_HEIGHT_PX = COVER_OUTPUT_WIDTH_PX / COVER_ASPECT;
export const COVER_OUTPUT_TYPE = "image/jpeg";
export const COVER_ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type CoverErrorCode =
  | "profileIdentity.cover.errorType"
  | "profileIdentity.cover.errorSize"
  | "profileIdentity.cover.errorUpload";

export type CoverValidation = { ok: true } | { ok: false; code: CoverErrorCode };

export function isCoverContentType(type: string): boolean {
  return (COVER_ALLOWED_TYPES as readonly string[]).includes(type);
}

/** Type + size of the SELECTED source photo, checked before the crop step opens. */
export function validateCoverFile(file: { type: string; size: number }): CoverValidation {
  if (!isCoverContentType(file.type)) return { ok: false, code: "profileIdentity.cover.errorType" };
  if (file.size <= 0 || file.size > COVER_SOURCE_MAX_BYTES) {
    return { ok: false, code: "profileIdentity.cover.errorSize" };
  }
  return { ok: true };
}
