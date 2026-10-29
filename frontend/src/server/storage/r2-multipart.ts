import "server-only";
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  UploadPartCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { readStorageEnv } from "@/lib/env/storage";
import { videoPartCount, videoPartLength } from "@/lib/media/video-policy";
import { createR2Client } from "./r2-provider";

/**
 * Multipart uploads of video originals straight from the browser to the PRIVATE
 * R2 bucket. The server only signs: no video byte passes through the web app.
 *
 * Each part URL is signed for one part number and its exact length, valid for
 * ten minutes. Completion never trusts client ETags: the server lists the parts R2
 * actually holds and completes with those, then checks the stored size.
 */
export const VIDEO_PART_URL_SECONDS = 600;

export function videoOriginalKey(videoId: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(videoId)) throw new Error("invalid video id");
  return `video/${videoId}/original`;
}

export type StoredPart = { partNumber: number; size: number; etag: string };

export class R2VideoUploads {
  private readonly bucket: string;
  constructor(private readonly client: S3Client = createR2Client()) {
    const env = readStorageEnv();
    if (!env.R2_PRIVATE_BUCKET) throw new Error("R2 private bucket is not configured");
    this.bucket = env.R2_PRIVATE_BUCKET;
  }

  async create(videoId: string, contentType: string): Promise<string> {
    const out = await this.client.send(new CreateMultipartUploadCommand({ Bucket: this.bucket, Key: videoOriginalKey(videoId),
      ContentType: contentType, CacheControl: "private, no-store" }));
    if (!out.UploadId) throw new Error("multipart upload was not created");
    return out.UploadId;
  }

  async signParts(videoId: string, uploadId: string, totalBytes: number, partNumbers: number[]): Promise<Record<number, string>> {
    const urls: Record<number, string> = {};
    for (const n of partNumbers) {
      const length = videoPartLength(totalBytes, n);
      urls[n] = await getSignedUrl(this.client, new UploadPartCommand({ Bucket: this.bucket, Key: videoOriginalKey(videoId),
        UploadId: uploadId, PartNumber: n, ContentLength: length }),
        { expiresIn: VIDEO_PART_URL_SECONDS, signableHeaders: new Set(["content-length"]) });
    }
    return urls;
  }

  async listParts(videoId: string, uploadId: string): Promise<StoredPart[]> {
    const parts: StoredPart[] = [];
    let marker: string | undefined;
    for (let page = 0; page < 20; page += 1) {
      const out = await this.client.send(new ListPartsCommand({ Bucket: this.bucket, Key: videoOriginalKey(videoId),
        UploadId: uploadId, PartNumberMarker: marker, MaxParts: 1000 }));
      for (const p of out.Parts ?? []) {
        if (p.PartNumber && p.ETag && typeof p.Size === "number") parts.push({ partNumber: p.PartNumber, size: p.Size, etag: p.ETag });
      }
      if (!out.IsTruncated) break;
      marker = out.NextPartNumberMarker;
    }
    return parts.sort((a, b) => a.partNumber - b.partNumber);
  }

  /**
   * Completes only when R2 holds exactly parts 1..N with the expected lengths.
   * Returns the stored size, or null when parts are missing or wrong.
   */
  async complete(videoId: string, uploadId: string, totalBytes: number): Promise<number | null> {
    const parts = await this.listParts(videoId, uploadId);
    const count = videoPartCount(totalBytes);
    if (parts.length !== count) return null;
    for (const [i, p] of parts.entries()) {
      if (p.partNumber !== i + 1 || p.size !== videoPartLength(totalBytes, i + 1)) return null;
    }
    await this.client.send(new CompleteMultipartUploadCommand({ Bucket: this.bucket, Key: videoOriginalKey(videoId), UploadId: uploadId,
      MultipartUpload: { Parts: parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) } }));
    const head = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: videoOriginalKey(videoId) }));
    return typeof head.ContentLength === "number" ? head.ContentLength : null;
  }

  /** The first bytes of the completed original, for the container signature check. */
  async readHead(videoId: string, length = 16): Promise<Uint8Array> {
    const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: videoOriginalKey(videoId), Range: `bytes=0-${length - 1}` }));
    return out.Body ? new Uint8Array(await out.Body.transformToByteArray()) : new Uint8Array();
  }

  async abort(videoId: string, uploadId: string): Promise<void> {
    await this.client.send(new AbortMultipartUploadCommand({ Bucket: this.bucket, Key: videoOriginalKey(videoId), UploadId: uploadId }));
  }
}

