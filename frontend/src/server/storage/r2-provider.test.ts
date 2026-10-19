import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env/storage", () => ({ readStorageEnv: () => ({
  R2_ACCOUNT_ID: "a".repeat(32), R2_ACCESS_KEY_ID: "test-key", R2_SECRET_ACCESS_KEY: "test-secret", R2_PRIVATE_BUCKET: "isolated-private", R2_PUBLIC_BUCKET: "isolated-public", R2_PUBLIC_BASE_URL: "https://media.example.test",
}) }));
const send = vi.hoisted(() => vi.fn());
vi.mock("@aws-sdk/client-s3", async (original) => {
  const sdk = await original<typeof import("@aws-sdk/client-s3")>();
  return { ...sdk, S3Client: class extends sdk.S3Client { send = send; } };  it("stores variants beside the original in the same private bucket, idempotently", async () => {
    const provider = new CloudflareR2StorageProvider("portfolio");
    await provider.putVariant("image.png", "card", new Uint8Array([9]));
    expect(send.mock.calls[0]?.[0].input).toMatchObject({ Bucket: "isolated-private", Key: "v/portfolio/image.png/card.webp",
      ContentType: "image/webp", IfNoneMatch: "*", CacheControl: "private, no-store" });
    send.mockRejectedValueOnce(Object.assign(new Error("exists"), { $metadata: { httpStatusCode: 412 } }));
    await expect(provider.putVariant("image.png", "card", new Uint8Array([9]))).resolves.toBeUndefined();
    send.mockRejectedValueOnce(new Error("service unavailable"));
    await expect(provider.putVariant("image.png", "thumb", new Uint8Array([9]))).rejects.toThrow("unavailable");
  });
  it("deletes every variant together with the original", async () => {
    await new CloudflareR2StorageProvider("product").deleteObject("o/p/i.webp");
    const keys = send.mock.calls.map((call) => call[0].input.Key);
    expect(keys).toEqual(["product/o/p/i.webp", "pending/product/o/p/i.webp",
      "v/product/o/p/i.webp/thumb.webp", "v/product/o/p/i.webp/card.webp", "v/product/o/p/i.webp/full.webp"]);
  });
});
import { CloudflareR2StorageProvider } from "./r2-provider";
beforeEach(() => { vi.clearAllMocks(); send.mockResolvedValue({}); });
describe("R2 immutable promotion", () => {
  it("signs only a temporary key for 120 seconds, with a bound content type", async () => {
    const provider = new CloudflareR2StorageProvider("portfolio");
    const grant = await provider.createUploadUrl("image.png", "image/png", 93);
    expect(grant.provider).toBe("r2");
    if (grant.provider !== "r2") throw new Error("wrong grant");
    const url = new URL(grant.url);
    expect(url.pathname).toContain("pending/portfolio/image.png");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("120");
    expect(url.searchParams.has("x-amz-checksum-crc32")).toBe(false);
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("content-type");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("content-length");
    expect(grant.headers).toEqual({ "content-type": "image/png" });
  });
  it("writes the verified snapshot to a different immutable final key", async () => {
    const provider = new CloudflareR2StorageProvider("portfolio");
    await provider.commitVerifiedObject("image.png", new Uint8Array([1,2,3]), "image/png");
    expect(send.mock.calls[0]?.[0].input).toMatchObject({ Key: "portfolio/image.png", IfNoneMatch: "*", Body: new Uint8Array([1,2,3]) });
    const read = new URL(await provider.getReadAccess("image.png", 30));
    expect(read.pathname).not.toContain("pending/");
    expect(read.searchParams.get("X-Amz-Expires")).toBe("30");
  });
  it("accepts a same-byte retry, but refuses a conflicting final object", async () => {
    send.mockRejectedValue(Object.assign(new Error("exists"), { $metadata: { httpStatusCode: 412 } }));
    const provider = new CloudflareR2StorageProvider("portfolio");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1,2,3]))));
    await expect(provider.commitVerifiedObject("image.png", new Uint8Array([1,2,3]), "image/png")).resolves.toBeUndefined();
    await expect(provider.commitVerifiedObject("image.png", new Uint8Array([3,2,1]), "image/png")).rejects.toThrow("conflict");
  });
  it("does not suppress R2 service failures", async () => {
    send.mockRejectedValue(new Error("service unavailable"));
    await expect(new CloudflareR2StorageProvider("avatar").deleteObject("x.jpg")).rejects.toThrow("unavailable");
  });
  it("rejects public buckets for every revocable category", () => {
    for (const namespace of ["avatar", "portfolio", "certificate", "product", "organization"]) {
      expect(() => new CloudflareR2StorageProvider(namespace, "public")).toThrow("Revocable");
    }
  });
  it("uploads public assets through private staging and publishes immutable final bytes", async () => {
    const provider = new CloudflareR2StorageProvider("explicit-public-asset", "public");
    const grant = await provider.createUploadUrl("image.png", "image/png", 93);
    expect(grant.provider === "r2" && grant.url).toContain("isolated-private/pending/explicit-public-asset/");
    await provider.commitVerifiedObject("image.png", new Uint8Array([1]), "image/png");
    expect(send.mock.calls[0]?.[0].input).toMatchObject({ Bucket: "isolated-public", Key: "explicit-public-asset/image.png", CacheControl: "public, max-age=31536000, immutable" });
    expect(await provider.getReadAccess("image.png", 30)).toBe("https://media.example.test/explicit-public-asset/image.png");
  });
  it("stores variants beside the original in the same private bucket, idempotently", async () => {
    const provider = new CloudflareR2StorageProvider("portfolio");
    await provider.putVariant("image.png", "card", new Uint8Array([9]));
    expect(send.mock.calls[0]?.[0].input).toMatchObject({ Bucket: "isolated-private", Key: "v/portfolio/image.png/card.webp",
      ContentType: "image/webp", IfNoneMatch: "*", CacheControl: "private, no-store" });
    send.mockRejectedValueOnce(Object.assign(new Error("exists"), { $metadata: { httpStatusCode: 412 } }));
    await expect(provider.putVariant("image.png", "card", new Uint8Array([9]))).resolves.toBeUndefined();
    send.mockRejectedValueOnce(new Error("service unavailable"));
    await expect(provider.putVariant("image.png", "thumb", new Uint8Array([9]))).rejects.toThrow("unavailable");
  });
  it("deletes every variant together with the original", async () => {
    await new CloudflareR2StorageProvider("product").deleteObject("o/p/i.webp");
    const keys = send.mock.calls.map((call) => call[0].input.Key);
    expect(keys).toEqual(["product/o/p/i.webp", "pending/product/o/p/i.webp",
      "v/product/o/p/i.webp/thumb.webp", "v/product/o/p/i.webp/card.webp", "v/product/o/p/i.webp/full.webp"]);
  });
});
