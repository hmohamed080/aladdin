import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
vi.mock("server-only", () => ({}));
const adminRpc = vi.hoisted(() => vi.fn());
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc: adminRpc, storage: { from: () => ({ createSignedUrl: sign, remove }) } }) }));
vi.mock("@/lib/env", () => ({ readPublicEnv: () => ({ NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co" }) }));
const settings = vi.hoisted(() => ({ R2_STORAGE_ENABLED: false, SUPABASE_SERVICE_ROLE_KEY: "test-only-key" }));
vi.mock("@/lib/env/storage", () => ({ readStorageEnv: () => settings }));
const limiter = vi.hoisted(() => ({ consume: vi.fn(), identity: vi.fn() }));
vi.mock("@/server/cache/rate-limit", () => ({ consumeRateLimit: limiter.consume }));
vi.mock("@/server/auth/session", () => ({ readSessionIdentity: limiter.identity }));
const r2Upload = vi.hoisted(() => vi.fn());
const r2 = vi.hoisted(() => ({ readObject: vi.fn(), commitVerifiedObject: vi.fn(), putVariant: vi.fn() }));
vi.mock("./r2-provider", () => ({ CloudflareR2StorageProvider: class {
  createUploadUrl = r2Upload; readObject = r2.readObject; commitVerifiedObject = r2.commitVerifiedObject; putVariant = r2.putVariant;
} }));
import { authorizeMediaUpload, readMediaUrl, removeMedia, verifyPendingMedia } from "./media";

const OWNER = "70000009-0000-4000-8000-000000000009";
const rpc = vi.fn(); const sign = vi.fn(); const remove = vi.fn(); const upload = vi.fn();
// Controlled caller-scoped client: no network or shared data.
const client = { rpc, storage: { from: () => ({ createSignedUrl: sign, remove, createSignedUploadUrl: upload }) } } as unknown as ReturnType<typeof createClient>;
const pending = { provider: "supabase", reserved: true, contentType: "image/png", state: "pending", owner: OWNER };
beforeEach(() => {
  vi.clearAllMocks(); settings.R2_STORAGE_ENABLED = false;
  rpc.mockResolvedValue({ data: pending, error: null });
  sign.mockResolvedValue({ data: { signedUrl: "https://test.invalid/image" }, error: null });
  adminRpc.mockResolvedValue({ error: null });
  limiter.identity.mockResolvedValue({ id: OWNER });
  limiter.consume.mockResolvedValue({ outcome: "allowed", source: "memory" });
});

describe("mixed-provider authorization and finalization", () => {
  it("refuses a signed upload URL once the per-user ceiling is reached, before reserving anything", async () => {
    rpc.mockResolvedValue({ data: { ...pending, reserved: false }, error: null });
    limiter.consume.mockResolvedValue({ outcome: "limited", retryAfterSeconds: 30 });
    await expect(authorizeMediaUpload(client, "portfolio", "key.png", 93)).rejects.toThrow("rate limited");
    expect(limiter.consume).toHaveBeenCalledWith("media-upload", OWNER);
    expect(adminRpc).not.toHaveBeenCalled(); expect(r2Upload).not.toHaveBeenCalled(); expect(upload).not.toHaveBeenCalled();
  });
  it("verifies organization pending bytes through upload authority without granting pending reads", async () => {
    rpc.mockImplementation(async (_name, args) => ({ data: args.p_operation === "read" ? null : pending, error: null }));
    const bytes = await sharp({ create: { width: 4, height: 4, channels: 3, background: "white" } }).png().toBuffer();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(bytes))));
    await verifyPendingMedia(client, "product", "key.png");
    expect(rpc).not.toHaveBeenCalledWith("organization_media_resolve", expect.objectContaining({ p_operation: "read" }));
    expect(adminRpc).toHaveBeenCalledWith("media_storage_attest", expect.objectContaining({ p_namespace: "product", p_size: bytes.length }));
  });
  it("refuses missing bytes without writing a verification receipt", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    await expect(verifyPendingMedia(client, "portfolio", "key.png")).rejects.toThrow();
    expect(adminRpc).not.toHaveBeenCalled();
  });
  it("records trustworthy actual size/hash only after full content validation", async () => {
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "white" } }).png().toBuffer();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(bytes))));
    await verifyPendingMedia(client, "portfolio", "key.png");
    expect(adminRpc).toHaveBeenCalledWith("media_storage_attest", expect.objectContaining({
      p_owner: OWNER, p_size: bytes.length, p_content_type: "image/png", p_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
  });
  it("blocks wrong-type bytes and authorization refusal before privileged writes", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<script>bad</script>")));
    await expect(verifyPendingMedia(client, "certificate", "key.pdf")).rejects.toThrow();
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(authorizeMediaUpload(client, "avatar", "foreign.jpg")).rejects.toThrow();
    await expect(removeMedia(client, "avatar", "foreign.jpg")).rejects.toThrow();
    expect(adminRpc).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
  });
  it("preserves Supabase reads when routing is enabled, and R2 reads when it is disabled", async () => {
    settings.R2_STORAGE_ENABLED = true;
    rpc.mockResolvedValue({ data: { ...pending, state: "ready" }, error: null });
    expect(await readMediaUrl(client, "portfolio", "key.png")).toContain("/api/media/portfolio?key=");
    settings.R2_STORAGE_ENABLED = false;
    rpc.mockResolvedValue({ data: { ...pending, provider: "r2" }, error: null });
    r2Upload.mockResolvedValue({ provider: "r2", url: "https://r2.test/pending" });
    expect((await authorizeMediaUpload(client, "portfolio", "key.png", 93)).provider).toBe("r2");
    expect(adminRpc).not.toHaveBeenCalled();
  });
  it("writes thumb/card/full variants from the verified R2 bytes before the receipt", async () => {
    rpc.mockResolvedValue({ data: { ...pending, provider: "r2" }, error: null });
    const bytes = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "white" } }).png().toBuffer();
    r2.readObject.mockResolvedValue(new Uint8Array(bytes));
    const manifest = await verifyPendingMedia(client, "portfolio", "key.png");
    expect(r2.putVariant.mock.calls.map((c) => c[1])).toEqual(["thumb", "card", "full"]);
    expect(r2.putVariant.mock.calls.every((c) => c[0] === "key.png")).toBe(true);
    expect(manifest?.full).toMatchObject({ width: 1600, height: 800 });
    expect(r2.commitVerifiedObject.mock.invocationCallOrder[0]!).toBeLessThan(r2.putVariant.mock.invocationCallOrder[0]!);
    expect(r2.putVariant.mock.invocationCallOrder[2]!).toBeLessThan(adminRpc.mock.invocationCallOrder[0]!);
    // The manifest is recorded on the receipt AFTER attestation (the RPC requires a verified R2 row).
    expect(adminRpc.mock.calls.map((c) => c[0])).toEqual(["media_storage_attest", "media_storage_record_variants"]);
    expect(adminRpc).toHaveBeenLastCalledWith("media_storage_record_variants", { p_namespace: "portfolio", p_key: "key.png", p_owner: pending.owner, p_variants: manifest });
  });
  it("never fails a verified upload because a variant could not be written", async () => {
    rpc.mockResolvedValue({ data: { ...pending, provider: "r2" }, error: null });
    r2.readObject.mockResolvedValue(new Uint8Array(await sharp({ create: { width: 8, height: 8, channels: 3, background: "white" } }).png().toBuffer()));
    r2.putVariant.mockRejectedValueOnce(new Error("service unavailable"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await verifyPendingMedia(client, "portfolio", "key.png")).toBeNull();
    expect(adminRpc).toHaveBeenCalledWith("media_storage_attest", expect.objectContaining({ p_provider: "r2" }));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("media.variants_skipped"));
    warn.mockRestore();
  });
  it("does not write variants through the legacy Supabase provider", async () => {
    const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "white" } }).png().toBuffer();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array(bytes))));
    expect(await verifyPendingMedia(client, "portfolio", "key.png")).toBeNull();
    expect(r2.putVariant).not.toHaveBeenCalled();
  });
  it("does not reverify legacy ready objects on an idempotent retry", async () => {
    rpc.mockResolvedValue({ data: { ...pending, state: "ready" }, error: null });
    await verifyPendingMedia(client, "portfolio", "key.png");
    expect(sign).not.toHaveBeenCalled(); expect(adminRpc).not.toHaveBeenCalled();
  });
});
