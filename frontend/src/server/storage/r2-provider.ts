import "server-only";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { StorageProvider, UploadGrant } from "@/lib/storage/provider-types";
import { readStorageEnv } from "@/lib/env/storage";
import { readBoundedBody } from "./validation";
import { MEDIA_VARIANTS, variantStorageKey, type MediaVariant } from "@/lib/media/image-variants";

/** The one S3 client configuration for R2 (images here, video in r2-multipart.ts). */
export function createR2Client(): S3Client {
  const env = readStorageEnv();
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) throw new Error("R2 credentials are not configured");
  return new S3Client({ region: "auto", forcePathStyle: true, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
    endpoint: env.R2_LOCAL_S3_ENDPOINT ?? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
    maxAttempts: 3, requestHandler: { requestTimeout: 30_000, connectionTimeout: 5_000 } });
}

export class CloudflareR2StorageProvider implements StorageProvider {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly uploadBucket: string;
  private readonly publicBaseUrl: string | undefined;
  constructor(private readonly namespace: string, private readonly visibility: "private" | "public" = "private") {
    const env = readStorageEnv();
    if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_PRIVATE_BUCKET) {
      throw new Error("R2 credentials are not configured");
    }
    if (visibility === "public" && ["avatar", "portfolio", "certificate", "product", "organization"].includes(namespace)) {
      throw new Error("Revocable media cannot use a public bucket");
    }
    if (visibility === "public" && (!env.R2_PUBLIC_BUCKET || !env.R2_PUBLIC_BASE_URL)) {
      throw new Error("Public media settings are not configured");
    }
    this.uploadBucket = env.R2_PRIVATE_BUCKET;
    this.bucket = visibility === "public" ? env.R2_PUBLIC_BUCKET! : env.R2_PRIVATE_BUCKET;
    this.publicBaseUrl = env.R2_PUBLIC_BASE_URL;
    this.client = createR2Client();
  }
  private finalKey(key: string) { return `${this.namespace}/${key}`; }
  private pendingKey(key: string) { return `pending/${this.namespace}/${key}`; }
  async createUploadUrl(key: string, contentType: string, expectedBytes?: number): Promise<UploadGrant> {
    if (!expectedBytes || expectedBytes <= 0 || !Number.isSafeInteger(expectedBytes)) throw new Error("upload size is required");
    const url = await getSignedUrl(this.client, new PutObjectCommand({ Bucket: this.uploadBucket,
      Key: this.pendingKey(key), ContentType: contentType, ContentLength: expectedBytes }), { expiresIn: 120, signableHeaders: new Set(["content-type", "content-length"]) });
    return { provider: "r2", url, headers: { "content-type": contentType }, expiresIn: 120 };
  }
  async getReadAccess(key: string, expiresIn: number) {
    if (this.visibility === "public") return `${this.publicBaseUrl!.replace(/\/$/, "")}/${this.finalKey(key).split("/").map(encodeURIComponent).join("/")}`;
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: this.finalKey(key) }), { expiresIn });
  }
  async readObject(key: string, maxBytes: number) {
    const url = await getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.uploadBucket, Key: this.pendingKey(key) }), { expiresIn: 30 });
    return readBoundedBody(await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(30_000) }), maxBytes);
  }
  async commitVerifiedObject(key: string, bytes: Uint8Array, contentType: string) {
    // Write the inspected bytes, not CopyObject: the presigned pending key can change concurrently.
    try {
      await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: this.finalKey(key), Body: bytes,
        ContentType: contentType, CacheControl: this.visibility === "public" ? "public, max-age=31536000, immutable" : "private, no-store", IfNoneMatch: "*" }));
    } catch (error) {
      // A retry may find the immutable final object already written. Verify equality before proceeding.
      if (!(error instanceof Error) || !("$metadata" in error) ||
        (error.$metadata as { httpStatusCode?: number }).httpStatusCode !== 412) throw error;
      const url = await this.getReadAccess(key, 30);
      const stored = await readBoundedBody(await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(30_000) }), bytes.length);
      if (!Buffer.from(stored).equals(Buffer.from(bytes))) throw new Error("immutable object conflict");
    }
    // Temporary bytes are retained until receipt/finalization succeeds; lifecycle expires them.
  }
  /**
   * A variant is a deterministic derivative of an immutable verified original, so
   * an existing object (412 on retry or backfill) is already the right bytes.
   * Same bucket and Cache-Control as the original: it inherits its privacy.
   */
  async putVariant(key: string, variant: MediaVariant, bytes: Uint8Array) {
    try {
      await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: variantStorageKey(this.namespace, key, variant),
        Body: bytes, ContentType: "image/webp", IfNoneMatch: "*",
        CacheControl: this.visibility === "public" ? "public, max-age=31536000, immutable" : "private, no-store" }));
    } catch (error) {
      if (!(error instanceof Error) || !("$metadata" in error) ||
        (error.$metadata as { httpStatusCode?: number }).httpStatusCode !== 412) throw error;
    }
  }
  async deleteObject(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.finalKey(key) }));
    await this.client.send(new DeleteObjectCommand({ Bucket: this.uploadBucket, Key: this.pendingKey(key) }));
    // Derivatives go with the original; deleting an absent key is a no-op in S3/R2.
    for (const variant of MEDIA_VARIANTS) {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: variantStorageKey(this.namespace, key, variant) }));
    }
  }
}
