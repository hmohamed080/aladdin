import type { MediaVariant } from "@/lib/media/image-variants";

export type StorageProviderName = "supabase" | "r2";
export type MediaNamespace = "avatar" | "portfolio" | "certificate" | "product" | "organization";

export type UploadGrant =
  | { provider: "supabase"; bucket: string; key: string; token: string }
  | { provider: "r2"; url: string; headers: Record<string, string>; expiresIn: number };

export interface StorageProvider {
  createUploadUrl(key: string, contentType: string, expectedBytes?: number): Promise<UploadGrant>;
  readObject(key: string, maxBytes: number): Promise<Uint8Array>;
  getReadAccess(key: string, expiresIn: number): Promise<string>;
  deleteObject(key: string): Promise<void>;
  /** R2 promotes a verified snapshot, never a mutable upload key. */
  commitVerifiedObject(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /**
   * Stores one derived WebP variant beside the verified original, same bucket and
   * namespace. Optional: providers without it simply serve the original.
   */
  putVariant?(key: string, variant: MediaVariant, bytes: Uint8Array): Promise<void>;
}
