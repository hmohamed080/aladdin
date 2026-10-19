import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StorageProvider, UploadGrant } from "@/lib/storage/provider-types";
import { readBoundedBody } from "./validation";

/** Upload uses caller INSERT authority. Backend reads/deletes require prior resolver authorization. */
export class SupabaseStorageProvider implements StorageProvider {
  constructor(private readonly client: SupabaseClient, private readonly bucket: string) {}
  async createUploadUrl(key: string): Promise<UploadGrant> {
    const { data, error } = await this.client.storage.from(this.bucket).createSignedUploadUrl(key);
    if (error) throw error;
    if (!data) throw new Error("upload authorization failed");
    return { provider: "supabase", bucket: this.bucket, key, token: data.token };
  }
  async getReadAccess(key: string, expiresIn: number) {
    const { data, error } = await this.client.storage.from(this.bucket).createSignedUrl(key, expiresIn);
    if (error || !data?.signedUrl) throw new Error("object unavailable");
    return data.signedUrl;
  }
  async readObject(key: string, maxBytes: number) {
    const url = await this.getReadAccess(key, 30);
    return readBoundedBody(await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(30_000) }), maxBytes);
  }
  async deleteObject(key: string) {
    const bucket = this.client.storage.from(this.bucket);
    const { data, error } = await bucket.remove([key]);
    if (error && !("code" in error && error.code === "NoSuchKey")) throw error;
    if (data?.some((object) => object.name === key)) return;
    // An empty removal response is not proof of deletion. Check metadata using
    // backend Storage authority; never a cached byte GET. Absence makes retries safe.
    const separator = key.lastIndexOf("/");
    const parent = separator < 0 ? "" : key.slice(0, separator);
    const name = key.slice(separator + 1);
    const remaining = await bucket.list(parent, { search: name, limit: 1 });
    if (remaining.error || !remaining.data || remaining.data.some((object) => object.name === name)) {
      throw new Error("object cleanup unconfirmed");
    }
  }
  async commitVerifiedObject(): Promise<void> {
    // Existing Supabase keys are immutable (no UPDATE / upsert policy).
  }
}
