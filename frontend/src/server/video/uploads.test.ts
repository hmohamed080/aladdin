import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  enabled: vi.fn(() => true), identity: vi.fn(), limit: vi.fn(), admin: vi.fn(), redis: vi.fn(),
  publicEnv: vi.fn(() => ({ NEXT_PUBLIC_APP_ENV: "local" })), storageEnv: vi.fn(() => ({ R2_PRODUCTION_WRITES_APPROVED: false })),
}));
vi.mock("./playback", () => ({ videoEnabled: mocks.enabled }));
vi.mock("@/server/auth/session", () => ({ readSessionIdentity: mocks.identity }));
vi.mock("@/server/cache/rate-limit", () => ({ consumeRateLimit: mocks.limit }));
vi.mock("@/server/cache/redis", () => ({ withRedis: mocks.redis, cacheKey: (...p: unknown[]) => JSON.stringify(p) }));
vi.mock("@/server/storage/media", () => ({ privilegedStorageClient: () => ({ rpc: mocks.admin }) }));
vi.mock("@/server/storage/r2-multipart", () => ({ R2VideoUploads: class {} }));
vi.mock("@/lib/env", () => ({ readPublicEnv: mocks.publicEnv }));
vi.mock("@/lib/env/storage", () => ({ readStorageEnv: mocks.storageEnv }));
import { VIDEO_MIN_PART_BYTES as VIDEO_PART_BYTES } from "@/lib/media/video-policy";
import {
  beginSchema, beginVideoUpload, completeVideoUpload, deleteVideo, signVideoParts, updateVideo, videoUploadStatus, VideoUploadError,
} from "./uploads";

const ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const USER = "70000009-0000-4000-8000-000000000009";
const MP4_HEAD = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]);

function client(answers: Record<string, { data?: unknown; error?: { code: string } | null }>) {
  const rpc = vi.fn(async (name: string) => answers[name] ?? { data: null, error: null });
  return { rpc } as unknown as Parameters<typeof beginVideoUpload>[0] & { rpc: typeof rpc };
}
function uploads(overrides: Partial<Record<"create" | "abort" | "listParts" | "signParts" | "complete" | "readHead", unknown>> = {}) {
  return {
    create: vi.fn(async () => "up-1"), abort: vi.fn(async () => undefined), listParts: vi.fn(async () => []),
    signParts: vi.fn(async (_id: string, _u: string, _b: number, parts: number[]) => Object.fromEntries(parts.map((n) => [n, `https://r2/${n}`]))),
    complete: vi.fn(async () => 20), readHead: vi.fn(async () => MP4_HEAD), ...overrides,
  } as never;
}
const resolved = (over: Record<string, unknown> = {}) => ({ data: { id: ID, state: "uploading", contentType: "video/mp4",
  declaredBytes: 20, uploadId: "up-1", expired: false, ...over }, error: null });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enabled.mockReturnValue(true);
  mocks.identity.mockResolvedValue({ id: USER });
  mocks.limit.mockResolvedValue({ outcome: "allowed" });
  mocks.admin.mockResolvedValue({ data: null, error: null });
  mocks.redis.mockResolvedValue(undefined);
  mocks.publicEnv.mockReturnValue({ NEXT_PUBLIC_APP_ENV: "local" });
  mocks.storageEnv.mockReturnValue({ R2_PRODUCTION_WRITES_APPROVED: false });
});

describe("beginSchema", () => {
  it("binds productId to product scope only", () => {
    const base = { title: "t", contentType: "video/mp4", bytes: 10 };
    expect(beginSchema.safeParse({ ...base, scope: "portfolio" }).success).toBe(true);
    expect(beginSchema.safeParse({ ...base, scope: "portfolio", productId: ID }).success).toBe(false);
    expect(beginSchema.safeParse({ ...base, scope: "product" }).success).toBe(false);
    expect(beginSchema.safeParse({ ...base, scope: "product", productId: ID }).success).toBe(true);
  });
  it("refuses other types, and sizes only beyond R2's own object limit", () => {
    expect(beginSchema.safeParse({ scope: "portfolio", title: "t", contentType: "video/x-msvideo", bytes: 10 }).success).toBe(false);
    expect(beginSchema.safeParse({ scope: "portfolio", title: "t", contentType: "video/mp4", bytes: 600 * 1024 * 1024 }).success).toBe(true);
    expect(beginSchema.safeParse({ scope: "portfolio", title: "t", contentType: "video/mp4", bytes: 200 * 1024 ** 3 }).success).toBe(true);
    expect(beginSchema.safeParse({ scope: "portfolio", title: "t", contentType: "video/mp4", bytes: 5 * 1024 ** 4 + 1 }).success).toBe(false);
  });
});

describe("beginVideoUpload", () => {
  it("plans larger parts for a file that would need more than 10,000", async () => {
    const c = client({ video_upload_begin: { data: ID, error: null } });
    const bytes = 200 * 1024 ** 3;
    const plan = await beginVideoUpload(c, { scope: "portfolio", title: "t", contentType: "video/mp4", bytes }, uploads());
    expect(plan.partCount).toBeLessThanOrEqual(10_000);
    expect(plan.partBytes).toBeGreaterThan(VIDEO_PART_BYTES);
  });

  it("asks the database as the caller first, then opens and attaches the multipart upload", async () => {
    const c = client({ video_upload_begin: { data: ID, error: null } });
    const u = uploads();
    const plan = await beginVideoUpload(c, { scope: "portfolio", title: "t", contentType: "video/mp4", bytes: VIDEO_PART_BYTES * 2 + 1 }, u);
    expect(plan).toEqual({ id: ID, transport: "r2-multipart", partBytes: VIDEO_PART_BYTES, partCount: 3, uploaded: [] });
    // PostgREST resolves functions by argument names: a portfolio upload must still send p_product_id.
    expect(c.rpc).toHaveBeenCalledWith("video_upload_begin", { p_scope: "portfolio", p_product_id: null, p_title: "t",
      p_content_type: "video/mp4", p_bytes: VIDEO_PART_BYTES * 2 + 1 });
    expect(mocks.admin).toHaveBeenCalledWith("video_upload_attach", { p_id: ID, p_upload_id: "up-1" });
  });
  it.each([["42501", "not_allowed"], ["23514", "limit"], ["22023", "invalid"]])("maps database refusal %s to %s and never touches R2", async (code, expected) => {
    const u = uploads();
    await expect(beginVideoUpload(client({ video_upload_begin: { data: null, error: { code } } }),
      { scope: "portfolio", title: "t", contentType: "video/mp4", bytes: 10 }, u)).rejects.toMatchObject({ code: expected });
    expect((u as unknown as { create: ReturnType<typeof vi.fn> }).create).not.toHaveBeenCalled();
  });
  it("releases the slot when R2 fails", async () => {
    const c = client({ video_upload_begin: { data: ID, error: null } });
    await expect(beginVideoUpload(c, { scope: "portfolio", title: "t", contentType: "video/mp4", bytes: 10 },
      uploads({ create: vi.fn(async () => { throw new Error("r2 down"); }) }))).rejects.toMatchObject({ code: "unavailable" });
    expect(c.rpc).toHaveBeenCalledWith("video_delete", { p_id: ID });
  });
  it("is unavailable when video is off, and in production without write approval", async () => {
    mocks.enabled.mockReturnValue(false);
    await expect(beginVideoUpload(client({}), { scope: "portfolio", title: "t", contentType: "video/mp4", bytes: 10 }, uploads()))
      .rejects.toMatchObject({ code: "unavailable" });
    mocks.enabled.mockReturnValue(true);
    mocks.publicEnv.mockReturnValue({ NEXT_PUBLIC_APP_ENV: "production" });
    await expect(beginVideoUpload(client({}), { scope: "portfolio", title: "t", contentType: "video/mp4", bytes: 10 }, uploads()))
      .rejects.toMatchObject({ code: "unavailable" });
  });
});

describe("resume and signing", () => {
  it("reports only parts R2 holds at their exact length", async () => {
    const bytes = VIDEO_PART_BYTES + 5;
    const c = client({ video_upload_resolve: resolved({ declaredBytes: bytes }) });
    const status = await videoUploadStatus(c, ID, uploads({ listParts: vi.fn(async () => [
      { partNumber: 1, size: VIDEO_PART_BYTES, etag: "a" }, { partNumber: 2, size: 4, etag: "b" }, { partNumber: 9, size: 5, etag: "c" }]) }));
    expect(status.uploaded).toEqual([1]);
    expect(status.partCount).toBe(2);
  });
  it("signs only parts inside the declared size, once each", async () => {
    const c = client({ video_upload_resolve: resolved({ declaredBytes: VIDEO_PART_BYTES * 2 }) });
    expect(await signVideoParts(c, ID, [1, 2], uploads())).toEqual({ 1: "https://r2/1", 2: "https://r2/2" });
    await expect(signVideoParts(c, ID, [3], uploads())).rejects.toMatchObject({ code: "invalid" });
    await expect(signVideoParts(c, ID, [1, 1], uploads())).rejects.toMatchObject({ code: "invalid" });
  });
  it("refuses signing without a session, when rate limited, or after the upload ended", async () => {
    mocks.identity.mockResolvedValueOnce(null);
    await expect(signVideoParts(client({}), ID, [1], uploads())).rejects.toMatchObject({ code: "not_allowed" });
    mocks.limit.mockResolvedValueOnce({ outcome: "limited" });
    await expect(signVideoParts(client({}), ID, [1], uploads())).rejects.toMatchObject({ code: "rate_limited" });
    await expect(signVideoParts(client({ video_upload_resolve: resolved({ state: "processing", uploadId: null }) }), ID, [1], uploads()))
      .rejects.toMatchObject({ code: "not_found" });
    await expect(signVideoParts(client({ video_upload_resolve: resolved({ expired: true }) }), ID, [1], uploads()))
      .rejects.toMatchObject({ code: "not_found" });
  });
  it("rejects a malformed id before asking anything", async () => {
    const c = client({});
    await expect(videoUploadStatus(c, "../x", uploads())).rejects.toBeInstanceOf(VideoUploadError);
    expect(c.rpc).not.toHaveBeenCalled();
  });
});

describe("completeVideoUpload", () => {
  it("completes from stored parts, checks the signature, queues the job", async () => {
    const c = client({ video_upload_resolve: resolved() });
    expect(await completeVideoUpload(c, ID, uploads())).toEqual({ state: "processing" });
    expect(mocks.admin).toHaveBeenCalledWith("video_upload_complete", { p_id: ID, p_size: 20 });
    expect(mocks.redis).toHaveBeenCalledWith("jobs", expect.any(Function));
  });
  it("is idempotent once processing", async () => {
    const u = uploads();
    expect(await completeVideoUpload(client({ video_upload_resolve: resolved({ state: "processing" }) }), ID, u)).toEqual({ state: "processing" });
    expect((u as unknown as { complete: ReturnType<typeof vi.fn> }).complete).not.toHaveBeenCalled();
  });
  it("reports missing parts as incomplete", async () => {
    await expect(completeVideoUpload(client({ video_upload_resolve: resolved() }), ID, uploads({ complete: vi.fn(async () => null) })))
      .rejects.toMatchObject({ code: "incomplete" });
  });
  it.each([
    ["a size mismatch", { complete: vi.fn(async () => 21) }],
    ["bytes that are not the declared container", { readHead: vi.fn(async () => new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0])) }],
  ])("retires the video on %s", async (_label, override) => {
    const c = client({ video_upload_resolve: resolved() });
    await expect(completeVideoUpload(c, ID, uploads(override))).rejects.toMatchObject({ code: "invalid" });
    expect(c.rpc).toHaveBeenCalledWith("video_delete", { p_id: ID });
    expect(mocks.admin).not.toHaveBeenCalledWith("video_upload_complete", expect.anything());
  });
});

describe("delete and update", () => {
  it("revokes in the database, then aborts the open upload", async () => {
    const u = uploads();
    await deleteVideo(client({ video_delete: { data: "up-1", error: null } }), ID, u);
    expect((u as unknown as { abort: ReturnType<typeof vi.fn> }).abort).toHaveBeenCalledWith(ID, "up-1");
  });
  it("does not abort when the database refused", async () => {
    const u = uploads();
    await expect(deleteVideo(client({ video_delete: { data: null, error: { code: "42501" } } }), ID, u)).rejects.toMatchObject({ code: "not_allowed" });
    expect((u as unknown as { abort: ReturnType<typeof vi.fn> }).abort).not.toHaveBeenCalled();
  });
  it("validates titles and forwards visibility to the database", async () => {
    const c = client({});
    await expect(updateVideo(c, ID, { title: "   " })).rejects.toMatchObject({ code: "invalid" });
    await updateVideo(c, ID, { isPublic: true });
    expect(c.rpc).toHaveBeenCalledWith("video_set_visibility", { p_id: ID, p_public: true });
  });
});
