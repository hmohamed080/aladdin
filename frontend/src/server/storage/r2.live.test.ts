import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { CloudflareR2StorageProvider } from "./r2-provider";
import { readStorageEnv } from "@/lib/env/storage";

const live = process.env.MEDIA_ACCEPTANCE_LIVE === "true" && process.env.R2_STORAGE_ENABLED === "true";
describe.skipIf(!live)("real disposable R2 transport", () => {
  function provider() {
    const env = readStorageEnv();
    if (process.env.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:60321"
      || process.env.NEXT_PUBLIC_APP_ENV !== "local" || env.R2_PRODUCTION_WRITES_APPROVED
      || env.R2_PRIVATE_BUCKET !== "aladdin-r2-acceptance-20261011-private"
      || env.R2_PUBLIC_BUCKET !== "aladdin-r2-acceptance-20261011-public") throw new Error("Disposable environment required");
    return new CloudflareR2StorageProvider("portfolio");
  }
  it("real CORS, length/type binding and temporary-key replay cannot replace final bytes", async () => {
    const storage = provider(); const key = `${randomUUID()}.png`;
    const original = new Uint8Array([1, 2, 3]); const replacement = new Uint8Array([3, 2, 1]);
    try {
      const grant = await storage.createUploadUrl(key, "image/png", 3);
      if (grant.provider !== "r2") throw new Error("R2 required");
      const cors = await fetch(grant.url, { method: "OPTIONS", headers: {
        Origin: "http://127.0.0.1:3187", "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type",
      } });
      expect(cors.ok).toBe(true);
      expect(cors.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:3187");
      expect((await fetch(grant.url, { method: "PUT", headers: { "content-type": "image/jpeg" }, body: original })).ok).toBe(false);
      expect((await fetch(grant.url, { method: "PUT", headers: grant.headers, body: new Uint8Array([1,2]) })).ok).toBe(false);
      expect((await fetch(grant.url, { method: "PUT", headers: grant.headers, body: original })).ok).toBe(true);
      expect(await storage.readObject(key, 3)).toEqual(original);
      await storage.commitVerifiedObject(key, original, "image/png");
      expect((await fetch(grant.url, { method: "PUT", headers: grant.headers, body: replacement })).ok).toBe(true);
      const read = await storage.getReadAccess(key, 30);
      expect(new Uint8Array(await (await fetch(read)).arrayBuffer())).toEqual(original);
      await expect(storage.commitVerifiedObject(key, original, "image/png")).resolves.toBeUndefined();
      await expect(storage.commitVerifiedObject(key, replacement, "image/png")).rejects.toThrow("conflict");
    } finally { await storage.deleteObject(key); }
  }, 30_000);
  it("an actually expired presigned PUT is rejected by R2", async () => {
    const storage = provider(); const key = `${randomUUID()}.png`;
    const grant = await storage.createUploadUrl(key, "image/png", 3);
    if (grant.provider !== "r2") throw new Error("R2 required");
    await new Promise((resolve) => setTimeout(resolve, 125_000));
    const response = await fetch(grant.url, { method: "PUT", headers: grant.headers, body: new Uint8Array([1,2,3]) });
    expect(response.status).toBe(403);
  }, 150_000);
});
