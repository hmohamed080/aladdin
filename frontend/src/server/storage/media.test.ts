import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
vi.mock("server-only", () => ({}));
const adminRpc = vi.hoisted(() => vi.fn());
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc: adminRpc, storage: { from: () => ({ createSignedUrl: sign, remove }) } }) }));
vi.mock("@/lib/env", () => ({ readPublicEnv: () => ({ NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co" }) }));
const settings = vi.hoisted(() => ({ R2_STORAGE_ENABLED: false, MEDIA_LEGACY_STORAGE_WRITES: true, SUPABASE_SERVICE_ROLE_KEY: "test-only-key" }));
vi.mock("@/lib/env/storage", () => ({ readStorageEnv: () => settings,
  legacyStorageWritesOpen: (env: { R2_STORAGE_ENABLED: boolean; MEDIA_LEGACY_STORAGE_WRITES: boolean }) => !env.R2_STORAGE_ENABLED && env.MEDIA_LEGACY_STORAGE_WRITES }));
const limiter = vi.hoisted(() => ({ consume: vi.fn(), identity: vi.fn() }));
vi.mock("@/server/cache/rate-limit", () => ({ consumeRateLimit: limiter.consume }));
vi.mock("@/server/auth/session", () => ({ readSessionIdentity: limiter.identity }));
const r2Upload = vi.hoisted(() => vi.fn());
const r2 = vi.hoisted(() => ({ readObject: vi.fn(), commitVerifiedObject: vi.fn(), putVariant: vi.fn(), deleteObject: vi.fn() }));
const r2Keys = vi.hoisted(() => [] as unknown[][]);
vi.mock("./r2-provider", () => ({ CloudflareR2StorageProvider: class {
  constructor(...args: unknown[]) { r2Keys.push(args); }
  createUploadUrl = r2Upload; readObject = r2.readObject; commitVerifiedObject = r2.commitVerifiedObject; putVariant = r2.putVariant; deleteObject = (key: string) => r2.deleteObject(key);
} }));
import { authorizeMediaUpload, readMediaUrl, removeMedia, verifyPendingMedia } from "./media";

const OWNER = "70000009-0000-4000-8000-000000000009";
const OBJECT = `u/${OWNER}/portfolio/70000009-0000-4000-8000-0000000000aa/original.png`;
const writes = () => adminRpc.mock.calls.map((c) => c[0]).filter((name) => name !== "media_storage_object");
const rpc = vi.fn(); const sign = vi.fn(); const remove = vi.fn(); const upload = vi.fn();
// Controlled caller-scoped client: no network or shared data.
const client = { rpc, storage: { from: () => ({ createSignedUrl: sign, remove, createSignedUploadUrl: upload }) } } as unknown as ReturnType<typeof createClient>;
const pending = { provider: "supabase", reserved: true, contentType: "image/png", state: "pending", owner: OWNER };
beforeEach(() => {
  vi.clearAllMocks(); settings.R2_STORAGE_ENABLED = false; settings.MEDIA_LEGACY_STORAGE_WRITES = true;
  rpc.mockResolvedValue({ data: pending, error: null });
  sign.mockResolvedValue({ data: { signedUrl: "https://test.invalid/image" }, error: null });
  r2Keys.length = 0;
  adminRpc.mockImplementation(async (name: string) => name === "media_storage_object" ? { data: OBJECT, error: null } : { error: null });
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
    expect(writes()).toEqual([]);
    // The signed upload targets the physical key the database recorded, not one derived from the path.
    expect(adminRpc).toHaveBeenCalledWith("media_storage_object", { p_namespace: "portfolio", p_key: "key.png" });
    expect(r2Keys.at(-1)).toEqual(["portfolio", "private", OBJECT]);
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
    const attest = adminRpc.mock.calls.findIndex((c) => c[0] === "media_storage_attest");
    expect(r2.putVariant.mock.invocationCallOrder[2]!).toBeLessThan(adminRpc.mock.invocationCallOrder[attest]!);
    // The manifest is recorded on the receipt AFTER attestation (the RPC requires a verified R2 row).
    expect(writes()).toEqual(["media_storage_attest", "media_storage_record_variants"]);
    expect(r2Keys.at(-1)).toEqual(["portfolio", "private", OBJECT]);
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
  it("refuses an R2 operation when the database names no stored object", async () => {
    rpc.mockResolvedValue({ data: { ...pending, provider: "r2", state: "ready" }, error: null });
    adminRpc.mockImplementation(async () => ({ data: null, error: null }));
    await expect(removeMedia(client, "portfolio", "key.png")).rejects.toThrow("unavailable");
    expect(r2Keys).toEqual([]);
  });
  it("does not reverify legacy ready objects on an idempotent retry", async () => {
    rpc.mockResolvedValue({ data: { ...pending, state: "ready" }, error: null });
    await verifyPendingMedia(client, "portfolio", "key.png");
    expect(sign).not.toHaveBeenCalled(); expect(adminRpc).not.toHaveBeenCalled();
  });
});

describe("R2 is the only home of new media bytes", () => {
  const fresh = { ...pending, reserved: false };
  it("sends a new upload to R2 and never to Supabase once R2 routing is on", async () => {
    settings.R2_STORAGE_ENABLED = true;
    rpc.mockResolvedValue({ data: fresh, error: null });
    r2Upload.mockResolvedValue({ provider: "r2", url: "https://r2.test/pending" });
    await authorizeMediaUpload(client, "portfolio", "key.png", 93);
    expect(adminRpc).toHaveBeenCalledWith("media_storage_reserve", expect.objectContaining({ p_provider: "r2" }));
    expect(upload).not.toHaveBeenCalled();
  });
  it("refuses a Supabase upload that was reserved before activation, without touching Supabase Storage", async () => {
    settings.R2_STORAGE_ENABLED = true;
    rpc.mockResolvedValue({ data: pending, error: null });
    await expect(authorizeMediaUpload(client, "portfolio", "key.png", 93)).rejects.toThrow("unavailable");
    expect(upload).not.toHaveBeenCalled(); expect(r2Upload).not.toHaveBeenCalled();
  });
  it("refuses to verify pending Supabase bytes once legacy writes are closed", async () => {
    settings.R2_STORAGE_ENABLED = true;
    rpc.mockResolvedValue({ data: pending, error: null });
    await expect(verifyPendingMedia(client, "portfolio", "key.png")).rejects.toThrow("unavailable");
    expect(writes()).not.toContain("media_storage_attest");
  });
  it("pauses uploads instead of falling back when R2 is off and legacy writes are closed", async () => {
    settings.MEDIA_LEGACY_STORAGE_WRITES = false;
    rpc.mockResolvedValue({ data: fresh, error: null });
    await expect(authorizeMediaUpload(client, "avatar", "key.png", 93)).rejects.toThrow("unavailable");
    expect(adminRpc).not.toHaveBeenCalled(); expect(upload).not.toHaveBeenCalled();
  });
  it("does not fall back to Supabase when R2 fails: the error surfaces and nothing is written there", async () => {
    settings.R2_STORAGE_ENABLED = true;
    rpc.mockResolvedValue({ data: fresh, error: null });
    r2Upload.mockRejectedValue(new Error("R2 unavailable"));
    await expect(authorizeMediaUpload(client, "portfolio", "key.png", 93)).rejects.toThrow("R2 unavailable");
    expect(upload).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();
  });
  it("still allows legacy Supabase writes before activation (default) so the current release is unchanged", async () => {
    rpc.mockResolvedValue({ data: pending, error: null });
    upload.mockResolvedValue({ data: { token: "t" }, error: null });
    await expect(authorizeMediaUpload(client, "portfolio", "key.png")).resolves.toMatchObject({ provider: "supabase" });
  });
  it("still deletes legacy Supabase objects after activation", async () => {
    settings.R2_STORAGE_ENABLED = true;
    rpc.mockResolvedValue({ data: { ...pending, state: "ready" }, error: null });
    remove.mockResolvedValue({ data: [{ name: "key.png" }], error: null });
    await removeMedia(client, "portfolio", "key.png");
    expect(remove).toHaveBeenCalled();
  });
  it("authorizes uploads through the database resolver before any provider is created (cross-account)", async () => {
    settings.R2_STORAGE_ENABLED = true;
    rpc.mockResolvedValue({ data: null, error: { message: "denied" } });
    await expect(authorizeMediaUpload(client, "portfolio", `u/${OWNER}/portfolio/x/original.png`, 93)).rejects.toThrow();
    expect(r2Keys).toHaveLength(0); expect(adminRpc).not.toHaveBeenCalled();
  });
});

describe("cleanup completion", () => {
  const r2Ready = { provider: "r2", reserved: true, contentType: "image/png", state: "deleted", owner: OWNER };
  it("records cleaned_at after an R2 object's bytes are deleted", async () => {
    rpc.mockResolvedValue({ data: r2Ready, error: null });
    r2.deleteObject = vi.fn().mockResolvedValue(undefined);
    await removeMedia(client, "avatar", "key.png");
    expect(r2.deleteObject).toHaveBeenCalled();
    expect(adminRpc).toHaveBeenCalledWith("media_cleanup_complete", { p_namespace: "avatar", p_key: "key.png", p_owner: OWNER });
  });
  it("does not record completion when the delete fails, so the worker retries", async () => {
    rpc.mockResolvedValue({ data: r2Ready, error: null });
    r2.deleteObject = vi.fn().mockRejectedValue(new Error("r2 down"));
    await expect(removeMedia(client, "avatar", "key.png")).rejects.toThrow("r2 down");
    expect(adminRpc.mock.calls.map((c) => c[0])).not.toContain("media_cleanup_complete");
  });
  it("tolerates an unrecorded completion (bytes are gone; reconciliation finishes it)", async () => {
    rpc.mockResolvedValue({ data: r2Ready, error: null });
    r2.deleteObject = vi.fn().mockResolvedValue(undefined);
    adminRpc.mockImplementation(async (name: string) => name === "media_storage_object" ? { data: OBJECT, error: null } : { error: { message: "x" } });
    await expect(removeMedia(client, "avatar", "key.png")).resolves.toBeUndefined();
  });
});
