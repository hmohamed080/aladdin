/**
 * Video upload rules shared by the browser, the server (signing) and, as CHECK
 * constraints, the database (20261021090015_media_videos.sql).
 *
 * There is NO product cap on size or length (ADR-0020 Revision 2). What remains
 * are storage-provider limits, stated rather than hidden:
 *   * one R2 object is at most 5 TiB;
 *   * a multipart upload has at most 10,000 parts, each at least 5 MiB except the
 *     last and at most 5 GiB, so the part size grows with the file;
 *   * R2 aborts an unfinished multipart upload after seven days, so an upload
 *     expires after a day without activity or six days in all.
 */
export const VIDEO_STORAGE_MAX_BYTES = 5 * 1024 ** 4;
export const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm"] as const;
export type VideoContentType = (typeof VIDEO_TYPES)[number];
export const VIDEO_TITLE_MAX = 120;

const MIB = 1024 * 1024;
/** Smallest part size; R2 needs at least 5 MiB for every part but the last. */
export const VIDEO_MIN_PART_BYTES = 8 * MIB;
/** R2/S3 limit on parts per multipart upload. */
export const VIDEO_MAX_PARTS = 10_000;
/** How many part URLs one signing request may ask for. */
export const VIDEO_PARTS_PER_REQUEST = 8;
/** Parallel part uploads in the browser. */
export const VIDEO_UPLOAD_CONCURRENCY = 3;

export type VideoScope = "portfolio" | "product";
export type VideoState = "uploading" | "processing" | "ready" | "failed" | "deleted";

export function isVideoType(value: unknown): value is VideoContentType {
  return typeof value === "string" && (VIDEO_TYPES as readonly string[]).includes(value);
}

/**
 * Part size for an upload of `bytes`: 8 MiB, or the whole MiB that keeps the
 * upload within 10,000 parts (about 78 GiB and above). A pure function of the
 * size, so the browser, the signer and the resume check always agree.
 */
export function videoPartBytes(bytes: number): number {
  return Math.max(VIDEO_MIN_PART_BYTES, Math.ceil(bytes / VIDEO_MAX_PARTS / MIB) * MIB);
}

export function videoPartCount(bytes: number): number {
  return Math.max(1, Math.ceil(bytes / videoPartBytes(bytes)));
}

/** Byte length of part `n` (1-based) of an upload of `bytes`. */
export function videoPartLength(bytes: number, n: number): number {
  const count = videoPartCount(bytes);
  const size = videoPartBytes(bytes);
  if (!Number.isInteger(n) || n < 1 || n > count) throw new Error("part out of range");
  return n < count ? size : bytes - size * (count - 1);
}

/**
 * The container signature of the first bytes: ISO-BMFF (`ftyp` at offset 4) for
 * MP4 and QuickTime, EBML for WebM. The worker's ffprobe is the real check.
 */
export function videoSignatureMatches(contentType: VideoContentType, head: Uint8Array): boolean {
  if (contentType === "video/webm") {
    return head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;
  }
  return head.length >= 8 && head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70;
}
