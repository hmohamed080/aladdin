/**
 * The avatar storage contract, mirroring `lib/storage/professional-assets.ts`'s
 * split exactly: this module gives the browser a fast, honest answer before
 * anything uploads; it is not the authority. The bucket's own
 * `allowed_mime_types`/`file_size_limit` and the `avatar_uploads` metadata-row
 * ownership model (`app.can_upload_avatar_object`,
 * 20260924090005_avatars_storage.sql) are what actually decide.
 *
 * PURE ON PURPOSE — no `server-only`, no Supabase client — so the crop/upload
 * client component can validate a file the instant it is chosen.
 */

export const AVATAR_BUCKET = "avatars";
/** The bucket's own file_size_limit — applies to the CROPPED object actually uploaded. */
export const AVATAR_MAX_BYTES = 3 * 1024 * 1024;
/**
 * The limit on the photo a person SELECTS. Larger than the bucket limit on
 * purpose: the crop step re-encodes to a small square JPEG (see
 * AVATAR_OUTPUT_PX), so a normal 12 MP phone photo is accepted and shrunk
 * rather than refused before it can be cropped.
 */
export const AVATAR_SOURCE_MAX_BYTES = 10 * 1024 * 1024;
/** Edge length of the square the crop step outputs. */
export const AVATAR_OUTPUT_PX = 512;
/** The content type the crop step always outputs, whatever the source format. */
export const AVATAR_OUTPUT_TYPE = "image/jpeg";
export const AVATAR_ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AvatarContentType = (typeof AVATAR_ALLOWED_TYPES)[number];

export type AvatarErrorCode =
  | "profileIdentity.avatar.errorType"
  | "profileIdentity.avatar.errorSize"
  | "profileIdentity.avatar.errorUpload";

export type AvatarValidation = { ok: true } | { ok: false; code: AvatarErrorCode };

export function isAvatarContentType(type: string): type is AvatarContentType {
  return (AVATAR_ALLOWED_TYPES as readonly string[]).includes(type);
}

/** Type + size of the SELECTED source photo, checked before the crop step opens. */
export function validateAvatarFile(file: { type: string; size: number }): AvatarValidation {
  if (!isAvatarContentType(file.type)) return { ok: false, code: "profileIdentity.avatar.errorType" };
  if (file.size <= 0 || file.size > AVATAR_SOURCE_MAX_BYTES) {
    return { ok: false, code: "profileIdentity.avatar.errorSize" };
  }
  return { ok: true };
}
