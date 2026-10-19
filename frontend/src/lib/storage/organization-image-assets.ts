/**
 * The business profile image contract, split exactly like `avatar-assets.ts`: a fast, honest browser-side check
 * before anything uploads. It is not the authority - the bucket's own `allowed_mime_types`/`file_size_limit` and
 * the `organization_images` ownership rows (20261015090043) decide. Pure on purpose: no server-only, no client.
 */
export const ORGANIZATION_IMAGE_BUCKET = "organization-images";
/**
 * The bucket's own file_size_limit. It applies to the CROPPED 640 px object (guaranteed by `encodeCanvasWithin`),
 * never to the photo a person SELECTS, which is not refused for its size (owner rule, 2026-10-19).
 */
export const ORGANIZATION_IMAGE_MAX_BYTES = 3 * 1024 * 1024;
export const ORGANIZATION_IMAGE_OUTPUT_PX = 640;
export const ORGANIZATION_IMAGE_OUTPUT_TYPE = "image/jpeg";
export const ORGANIZATION_IMAGE_ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type OrganizationImageErrorCode =
  | "showroomSettings.image.errorType"
  | "showroomSettings.image.errorSize"
  | "showroomSettings.image.errorUpload";

export type OrganizationImageValidation = { ok: true } | { ok: false; code: OrganizationImageErrorCode };

export function validateOrganizationImageFile(file: { type: string; size: number }): OrganizationImageValidation {
  if (!(ORGANIZATION_IMAGE_ALLOWED_TYPES as readonly string[]).includes(file.type)) {
    return { ok: false, code: "showroomSettings.image.errorType" };
  }
  if (file.size <= 0) return { ok: false, code: "showroomSettings.image.errorSize" };
  return { ok: true };
}
