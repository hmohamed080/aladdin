"use client";

import { UploadFailure as VideoUploadFailure, uploadVideo } from "@/features/video/upload-engine";
import { partitionUploadBatch, type UploadRejection } from "@/lib/media/upload-limits";
import { imageHintBytes, loadMediaLimitHints, videoHintBytes } from "@/lib/media/limits-client";
import { uploadWithGrant } from "@/lib/storage/browser-upload";
import { MARKETPLACE_IMAGE_ALLOWED_TYPES } from "@/lib/storage/marketplace-images";
import {
  confirmImageUploadAction,
  removeImageAction,
  requestImageReplacementAction,
  requestImageUploadAction,
} from "@/server/actions/marketplace-seller";

/** The image formats and size the `marketplace` media namespace accepts (Migration 13). */
export const ACCEPTED_IMAGE_TYPES: readonly string[] = MARKETPLACE_IMAGE_ALLOWED_TYPES;
/**
 * A product holds up to 5 media slots: 5 images, or 1 video and 4 images (PR 7). The database enforces the same limit
 * on live images. The video path itself stays off (see MARKETPLACE_VIDEO_UPLOADS_ENABLED).
 */
export const MAX_MEDIA_SLOTS = 5;
export const MAX_IMAGES_PER_BATCH = MAX_MEDIA_SLOTS;

export type UploadFailure = { name: string; code: string };

/**
 * Client-side pre-check; the media verifier and the confirm RPC check again. The size bound is the stored limit as the
 * browser knows it (a hint loaded from /api/media-limits, the compiled default until then), never a fixed constant.
 */
export function imageFileProblem(file: File, maxBytes: number = imageHintBytes("marketplace")): string | null {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) return "image_type_invalid";
  if (file.size > maxBytes) return "file_too_large";
  return null;
}

/**
 * Uploads images of ONE product the trusted way: an upload ticket from the
 * database plus an R2 upload grant from the server (`requestImageUploadAction`),
 * the bytes straight to that grant, then the confirm step (server-side byte
 * verification). Every image starts `pending` — customers see it only after admin
 * moderation. Returns the files that did not make it, with a reason code.
 */
export async function uploadProductImages(
  productId: string,
  files: File[],
  onProgress?: (name: string | null) => void,
): Promise<UploadFailure[]> {
  const failures: UploadFailure[] = [];
  await loadMediaLimitHints();
  const maxBytes = imageHintBytes("marketplace");
  for (const [index, file] of files.entries()) {
    const problem = imageFileProblem(file, maxBytes);
    if (problem) {
      failures.push({ name: file.name, code: problem });
      continue;
    }
    onProgress?.(file.name);
    const ticket = await requestImageUploadAction(productId, file.type, file.size);
    if (!ticket.ok) {
      // a ticket refusal (limit reached, not permitted) applies to the rest too
      for (const rest of files.slice(index)) failures.push({ name: rest.name, code: ticket.code });
      break;
    }
    try {
      await uploadWithGrant(ticket.grant, file);
    } catch {
      failures.push({ name: file.name, code: "upload_failed" });
      await removeImageAction(ticket.imageId);
      continue;
    }
    const confirmed = await confirmImageUploadAction(ticket.imageId);
    if (!confirmed.ok) failures.push({ name: file.name, code: confirmed.code });
  }
  onProgress?.(null);
  return failures;
}

/**
 * Replaces ONE approved image with a new file. The new image waits for review like any upload; the old one stays live
 * until the new one is approved (then the old one is deleted). Resolves to a failure code, or null on success.
 */
export async function replaceProductImage(imageId: string, file: File): Promise<string | null> {
  await loadMediaLimitHints();
  const problem = imageFileProblem(file, imageHintBytes("marketplace"));
  if (problem) return problem;
  const ticket = await requestImageReplacementAction(imageId, file.type, file.size);
  if (!ticket.ok) return ticket.code;
  try {
    await uploadWithGrant(ticket.grant, file);
  } catch {
    await removeImageAction(ticket.imageId);
    return "upload_failed";
  }
  const confirmed = await confirmImageUploadAction(ticket.imageId);
  return confirmed.ok ? null : confirmed.code;
}

const REJECTION_CODE: Record<UploadRejection, string> = {
  type_invalid: "file_type_invalid",
  empty: "file_type_invalid",
  image_too_large: "file_too_large",
  video_too_large: "video_too_large",
};

/** One product video through the resumable R2 upload; resolves to a failure code, or null on success. */
export async function uploadProductVideo(productId: string, file: File): Promise<string | null> {
  try {
    await uploadVideo({ file, title: file.name.slice(0, 120), scope: "product", productId, onProgress: () => undefined, signal: new AbortController().signal });
    return null;
  } catch (error) {
    return error instanceof VideoUploadFailure && error.code === "limit" ? "too_many_images" : "video_upload_failed";
  }
}

/**
 * Marketplace products live in marketplace_products, but the resumable video API authorizes against the catalog table
 * public.products, so a Marketplace video would be refused. The option stays off until a Marketplace-aware video path
 * exists (PR 7: product form with 1 video + 4 images); the panel offers and accepts images only.
 */
export const MARKETPLACE_VIDEO_UPLOADS_ENABLED = false;

export type MediaBatchDeps = {
  images: typeof uploadProductImages;
  video: typeof uploadProductVideo;
  /** Defaults to MARKETPLACE_VIDEO_UPLOADS_ENABLED. */
  videoEnabled?: boolean;
};

/**
 * A dropped or picked batch of images AND videos, uploaded together. Every file is judged on its
 * own: an oversize or unsupported file is reported and skipped, the rest still upload. Images go
 * through the trusted ticket workflow one after another; each video runs beside them.
 */
export async function uploadMediaBatch(
  productId: string,
  files: File[],
  onProgress?: (name: string | null) => void,
  deps: MediaBatchDeps = { images: uploadProductImages, video: uploadProductVideo },
): Promise<UploadFailure[]> {
  await loadMediaLimitHints(); // the stored limits are the authority; this only lets the page answer without a round trip
  const { accepted: all, rejected } = partitionUploadBatch(files, { image: imageHintBytes("marketplace"), video: videoHintBytes("product") });
  const videoEnabled = deps.videoEnabled ?? MARKETPLACE_VIDEO_UPLOADS_ENABLED;
  // A video is refused as an unsupported file while the Marketplace has no video path; the images still upload.
  const accepted = videoEnabled ? all : all.filter((a) => a.kind === "image");
  if (!videoEnabled) for (const a of all) if (a.kind === "video") rejected.push({ file: a.file, reason: "type_invalid" });
  const failures: UploadFailure[] = rejected.map(({ file, reason }) => ({ name: file.name, code: REJECTION_CODE[reason] }));
  const images = accepted.filter((a) => a.kind === "image").map((a) => a.file);
  const videos = accepted.filter((a) => a.kind === "video").map((a) => a.file);
  const results = await Promise.all([
    images.length > 0 ? deps.images(productId, images, onProgress) : Promise.resolve<UploadFailure[]>([]),
    ...videos.map(async (file) => {
      const code = await deps.video(productId, file);
      return code ? [{ name: file.name, code }] : [];
    }),
  ]);
  return [...failures, ...results.flat()];
}
