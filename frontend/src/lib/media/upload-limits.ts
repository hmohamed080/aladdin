/**
 * The site-wide media upload policy (owner decision 2026-11-19, PR 2 of the marketplace plan).
 * PURE: no `server-only`, no React, no env, so the browser, the server actions and the tests all
 * read the same numbers.
 *
 * - Caps are PER FILE: one oversize file is refused on its own and the rest of a batch still uploads.
 * - The cap applies to the file the person picked. The browser no longer shrinks a photo to fit
 *   (that was the old 5 MB rule); the server keeps a re-encoded original instead
 *   (`server/storage/image-processing`).
 * - The browser check is a fast, honest answer. The authority is the storage layer: the namespace
 *   ceilings in `media-policy.ts`, the verification receipt in SQL, and the video database checks.
 */
export const MIB = 1024 * 1024;

/** Largest image a person may upload, in every namespace that keeps site content (not avatars or verification documents). */
export const IMAGE_MAX_BYTES = 10 * MIB;
/** Largest video a person may upload. */
export const VIDEO_MAX_BYTES = 100 * MIB;

/** The stored original is re-encoded to at most this long edge (never upscaled) at this quality. */
export const ORIGINAL_MAX_EDGE = 2560;
export const ORIGINAL_QUALITY = 90;

export const UPLOAD_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const UPLOAD_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"] as const;

export type UploadKind = "image" | "video";
export type UploadRejection = "type_invalid" | "empty" | "image_too_large" | "video_too_large";

export type UploadFileLike = { name: string; size: number; type: string };

/** What a picked file is, or null when it is neither an accepted image nor an accepted video. */
export function uploadKind(file: Pick<UploadFileLike, "type">): UploadKind | null {
  if ((UPLOAD_IMAGE_TYPES as readonly string[]).includes(file.type)) return "image";
  if ((UPLOAD_VIDEO_TYPES as readonly string[]).includes(file.type)) return "video";
  return null;
}

/** The reason one file is refused, or null when it may upload. Looks at that file only. */
export function uploadRejection(file: UploadFileLike): UploadRejection | null {
  const kind = uploadKind(file);
  if (!kind) return "type_invalid";
  if (file.size <= 0) return "empty";
  if (kind === "image" && file.size > IMAGE_MAX_BYTES) return "image_too_large";
  if (kind === "video" && file.size > VIDEO_MAX_BYTES) return "video_too_large";
  return null;
}

export type UploadBatch<T extends UploadFileLike> = {
  accepted: { file: T; kind: UploadKind }[];
  rejected: { file: T; reason: UploadRejection }[];
};

/**
 * Splits a dropped or picked batch (images and videos together) file by file. A refusal never
 * stops the others: only the offending file lands in `rejected`.
 */
export function partitionUploadBatch<T extends UploadFileLike>(files: readonly T[]): UploadBatch<T> {
  const batch: UploadBatch<T> = { accepted: [], rejected: [] };
  for (const file of files) {
    const reason = uploadRejection(file);
    const kind = uploadKind(file);
    if (reason || !kind) batch.rejected.push({ file, reason: reason ?? "type_invalid" });
    else batch.accepted.push({ file, kind });
  }
  return batch;
}
