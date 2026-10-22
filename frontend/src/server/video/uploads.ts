import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { readPublicEnv } from "@/lib/env";
import { readStorageEnv } from "@/lib/env/storage";
import {
  VIDEO_PARTS_PER_REQUEST, VIDEO_STORAGE_MAX_BYTES, VIDEO_TITLE_MAX, VIDEO_TYPES,
  isVideoType, videoPartBytes, videoPartCount, videoPartLength, videoSignatureMatches,
} from "@/lib/media/video-policy";
import { readSessionIdentity } from "@/server/auth/session";
import { cacheKey, withRedis } from "@/server/cache/redis";
import { consumeRateLimit } from "@/server/cache/rate-limit";
import { privilegedStorageClient } from "@/server/storage/media";
import { videoUploadStore, type UploadTransport, type VideoUploadStore } from "./provider";
import { videoEnabled } from "./playback";

/**
 * Video upload orchestration. The browser sends bytes to R2 itself; this module
 * only (1) asks the database whether the caller may start, continue or finish an
 * upload, (2) signs exactly the parts it may send, and (3) completes the upload
 * from what R2 actually stored. Every database decision runs as the caller
 * (RLS-scoped RPCs); only the bookkeeping writes use the service role, after
 * the caller's own check has passed.
 */
export type VideoErrorCode = "not_allowed" | "invalid" | "limit" | "rate_limited" | "not_found" | "incomplete" | "unavailable";
export class VideoUploadError extends Error {
  constructor(readonly code: VideoErrorCode) { super(code); }
}

const UUID = z.string().uuid();
export const beginSchema = z.object({
  scope: z.enum(["portfolio", "product"]),
  productId: UUID.optional(),
  /** A portfolio project to put the video in (at most 6 photos and videos each). */
  projectId: UUID.optional(),
  title: z.string().trim().min(1).max(VIDEO_TITLE_MAX),
  contentType: z.enum(VIDEO_TYPES),
  // No product cap: only R2's own object limit.
  bytes: z.number().int().positive().max(VIDEO_STORAGE_MAX_BYTES),
}).refine((v) => (v.scope === "product") === (v.productId !== undefined), { message: "productId belongs to product scope" })
  .refine((v) => v.projectId === undefined || v.scope === "portfolio", { message: "projectId belongs to portfolio scope" });
export const partsSchema = z.object({ parts: z.array(z.number().int().min(1)).min(1).max(VIDEO_PARTS_PER_REQUEST) });

function fromDatabase(error: { code?: string } | null): VideoUploadError {
  switch (error?.code) {
    case "42501": return new VideoUploadError("not_allowed");
    case "22023": return new VideoUploadError("invalid");
    case "23514": return new VideoUploadError("limit");
    case "P0002": return new VideoUploadError("not_found");
    default: return new VideoUploadError("unavailable");
  }
}

function requireVideo() {
  if (!videoEnabled()) throw new VideoUploadError("unavailable");
  if (readPublicEnv().NEXT_PUBLIC_APP_ENV === "production" && !readStorageEnv().R2_PRODUCTION_WRITES_APPROVED) {
    throw new VideoUploadError("unavailable");
  }
}

type Resolved = { id: string; state: string; contentType: string; declaredBytes: number; uploadId: string | null; expired: boolean };
async function resolve(client: SupabaseClient, id: string): Promise<Resolved> {
  if (!UUID.safeParse(id).success) throw new VideoUploadError("not_found");
  const { data, error } = await client.rpc("video_upload_resolve", { p_id: id });
  if (error) throw fromDatabase(error);
  const r = data as Resolved;
  if (!isVideoType(r.contentType)) throw new VideoUploadError("invalid");
  return r;
}

export type UploadPlan = { id: string; transport: UploadTransport; partBytes: number; partCount: number; uploaded: number[] };

export async function beginVideoUpload(client: SupabaseClient, input: z.infer<typeof beginSchema>, uploads: VideoUploadStore = videoUploadStore()): Promise<UploadPlan> {
  requireVideo();
  // p_product_id is always sent: it has no SQL default, and PostgREST matches functions by argument names.
  const { data: id, error } = await client.rpc("video_upload_begin", { p_scope: input.scope, p_product_id: input.productId ?? null,
    p_title: input.title, p_content_type: input.contentType, p_bytes: input.bytes });
  if (error || typeof id !== "string") throw fromDatabase(error);
  if (input.projectId) {
    // Before any R2 work: a full project refuses the video and its row goes away.
    const attached = await client.rpc("portfolio_project_attach", { p_project_id: input.projectId, p_kind: "video", p_id: id });
    if (attached.error) {
      await client.rpc("video_delete", { p_id: id });
      throw fromDatabase(attached.error);
    }
  }
  const admin = privilegedStorageClient();
  try {
    const uploadId = await uploads.create(id, input.contentType);
    const attached = await admin.rpc("video_upload_attach", { p_id: id, p_upload_id: uploadId });
    if (attached.error) {
      await uploads.abort(id, uploadId).catch(() => undefined);
      throw new Error("attach failed");
    }
  } catch {
    // The row would otherwise hold one of the caller's unfinished-upload slots.
    await client.rpc("video_delete", { p_id: id });
    throw new VideoUploadError("unavailable");
  }
  return { id, transport: "r2-multipart", partBytes: videoPartBytes(input.bytes), partCount: videoPartCount(input.bytes), uploaded: [] };
}

/** Resume: which parts R2 already holds, so the browser sends only the rest. */
export async function videoUploadStatus(client: SupabaseClient, id: string, uploads: VideoUploadStore = videoUploadStore()): Promise<UploadPlan & { state: string }> {
  requireVideo();
  const r = await resolve(client, id);
  if (r.state !== "uploading" || !r.uploadId || r.expired) {
    return { id, state: r.expired ? "expired" : r.state, transport: "r2-multipart", partBytes: videoPartBytes(r.declaredBytes), partCount: videoPartCount(r.declaredBytes), uploaded: [] };
  }
  const parts = await uploads.listParts(id, r.uploadId);
  const uploaded = parts.filter((p) => p.partNumber <= videoPartCount(r.declaredBytes)
    && p.size === videoPartLength(r.declaredBytes, p.partNumber)).map((p) => p.partNumber);
  return { id, state: r.state, transport: "r2-multipart", partBytes: videoPartBytes(r.declaredBytes), partCount: videoPartCount(r.declaredBytes), uploaded };
}

export async function signVideoParts(client: SupabaseClient, id: string, parts: number[], uploads: VideoUploadStore = videoUploadStore()): Promise<Record<number, string>> {
  requireVideo();
  const identity = await readSessionIdentity(client);
  if (!identity) throw new VideoUploadError("not_allowed");
  if ((await consumeRateLimit("video-part", identity.id)).outcome === "limited") throw new VideoUploadError("rate_limited");
  const r = await resolve(client, id);
  if (r.state !== "uploading" || !r.uploadId || r.expired) throw new VideoUploadError("not_found");
  const count = videoPartCount(r.declaredBytes);
  if (parts.some((n) => n > count) || new Set(parts).size !== parts.length) throw new VideoUploadError("invalid");
  return uploads.signParts(id, r.uploadId, r.declaredBytes, parts);
}

export async function completeVideoUpload(client: SupabaseClient, id: string, uploads: VideoUploadStore = videoUploadStore()): Promise<{ state: "processing" }> {
  requireVideo();
  const r = await resolve(client, id);
  if (r.state === "processing") return { state: "processing" };
  if (r.state !== "uploading" || !r.uploadId || r.expired) throw new VideoUploadError("not_found");
  const size = await uploads.complete(id, r.uploadId, r.declaredBytes);
  if (size === null) throw new VideoUploadError("incomplete");
  const admin = privilegedStorageClient();
  if (size !== r.declaredBytes || !videoSignatureMatches(r.contentType as (typeof VIDEO_TYPES)[number], await uploads.readHead(id))) {
    // Wrong bytes: retire the row now; the purge removes the object.
    await client.rpc("video_delete", { p_id: id });
    throw new VideoUploadError("invalid");
  }
  const { error } = await admin.rpc("video_upload_complete", { p_id: id, p_size: size });
  if (error) throw fromDatabase(error);
  // Wake a waiting transcode worker. Without Redis the worker finds it on its next poll.
  await withRedis("jobs", (redis) => redis.lPush(cacheKey("jobs", "global", "video"), id));
  return { state: "processing" };
}

export async function deleteVideo(client: SupabaseClient, id: string, uploads: VideoUploadStore = videoUploadStore()): Promise<void> {
  if (!UUID.safeParse(id).success) throw new VideoUploadError("not_found");
  const { data: uploadId, error } = await client.rpc("video_delete", { p_id: id });
  if (error) throw fromDatabase(error);
  // Revocation already happened in the database. Stopping the multipart upload
  // is cleanup; the purge job retries anything this misses.
  if (typeof uploadId === "string" && uploadId) await uploads.abort(id, uploadId).catch(() => undefined);
}

export async function updateVideo(client: SupabaseClient, id: string, change: { title?: string; isPublic?: boolean }): Promise<void> {
  if (!UUID.safeParse(id).success) throw new VideoUploadError("not_found");
  if (change.title !== undefined) {
    const title = change.title.trim();
    if (!title || title.length > VIDEO_TITLE_MAX) throw new VideoUploadError("invalid");
    const { error } = await client.rpc("video_update", { p_id: id, p_title: title });
    if (error) throw fromDatabase(error);
  }
  if (change.isPublic !== undefined) {
    const { error } = await client.rpc("video_set_visibility", { p_id: id, p_public: change.isPublic });
    if (error) throw fromDatabase(error);
  }
}
