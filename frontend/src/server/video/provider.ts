import "server-only";
import { R2VideoUploads, type StoredPart } from "@/server/storage/r2-multipart";

/**
 * The seam between video features and whoever stores and streams the bytes
 * (ADR-0020 Revision 2). Upload sessions, ordering, permissions and the UI are
 * provider-neutral: they keep a `media_videos` row and its `provider` column.
 *
 * Only `r2_hls` is implemented: browser → R2 multipart, ffmpeg worker → HLS in
 * R2, media Worker → per-request database decision. A later Cloudflare Stream
 * provider would add, behind this same interface:
 *   * `upload.transport = "tus"`: Stream's direct creator upload URL instead of
 *     signed parts (the browser engine picks its transport from the plan);
 *   * a webhook that marks the row ready (instead of `video_job_finish`);
 *   * `playback` returning Stream's HLS manifest with a short-lived signed token.
 * Nothing else changes. Stream's signed URLs stay valid until they expire, so
 * revocation there is bounded by the token lifetime rather than immediate
 * (see the ADR's comparison).
 */
export type VideoProviderName = "r2_hls" | "cloudflare_stream";

export type UploadTransport = "r2-multipart";

/** The multipart operations the upload orchestration needs from a provider. */
export interface VideoUploadStore {
  readonly transport: UploadTransport;
  create(videoId: string, contentType: string): Promise<string>;
  signParts(videoId: string, uploadId: string, totalBytes: number, partNumbers: number[]): Promise<Record<number, string>>;
  listParts(videoId: string, uploadId: string): Promise<StoredPart[]>;
  complete(videoId: string, uploadId: string, totalBytes: number): Promise<number | null>;
  readHead(videoId: string, length?: number): Promise<Uint8Array>;
  abort(videoId: string, uploadId: string): Promise<void>;
}

export class ProviderUnavailable extends Error {
  constructor(readonly provider: string) { super(`video provider ${provider} is not available`); }
}

/** New uploads always use the active provider; existing rows keep theirs. */
export const ACTIVE_VIDEO_PROVIDER: VideoProviderName = "r2_hls";

export function videoUploadStore(provider: VideoProviderName = ACTIVE_VIDEO_PROVIDER): VideoUploadStore {
  if (provider === "r2_hls") return Object.assign(new R2VideoUploads(), { transport: "r2-multipart" as const });
  throw new ProviderUnavailable(provider);
}
