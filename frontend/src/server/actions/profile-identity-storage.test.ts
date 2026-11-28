import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const rpc = vi.hoisted(() => vi.fn());
const authorize = vi.hoisted(() => vi.fn()); const verify = vi.hoisted(() => vi.fn()); const remove = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: async () => ({ rpc }) }));
vi.mock("@/server/storage/media", () => ({ authorizeMediaUpload: authorize, verifyPendingMedia: verify, removeMedia: remove }));
const limit = vi.hoisted(() => vi.fn());
vi.mock("@/server/media/limits", () => ({ imageMaxBytes: limit }));
import { requestAvatarUploadAction, confirmAvatarUploadAction, deleteAvatarAction } from "./profile-identity";
const MB = 1024 * 1024;
beforeEach(() => { vi.clearAllMocks(); limit.mockResolvedValue(3 * MB); rpc.mockResolvedValue({ data: "new.jpg", error: null }); verify.mockResolvedValue(undefined); remove.mockResolvedValue(undefined); });
describe("avatar upload size, checked against the limit an administrator sets", () => {
  it("refuses a photo above the stored limit with a size-specific message, before any pending row or upload", async () => {
    limit.mockResolvedValue(100 * 1024);
    expect(await requestAvatarUploadAction("image/jpeg", 145_016)).toEqual({ ok: false, code: "profileIdentity.avatar.errorTooLarge" });
    expect(rpc).not.toHaveBeenCalled(); expect(authorize).not.toHaveBeenCalled();
  });
  it("follows a RAISED limit: 4 MB passes under a 5 MB limit and is refused under the 3 MB default", async () => {
    authorize.mockResolvedValue({ provider: "r2", url: "https://test.invalid/pending" });
    limit.mockResolvedValue(5 * MB);
    expect((await requestAvatarUploadAction("image/jpeg", 4 * MB)).ok).toBe(true);
    limit.mockResolvedValue(3 * MB);
    expect(await requestAvatarUploadAction("image/jpeg", 4 * MB)).toEqual({ ok: false, code: "profileIdentity.avatar.errorTooLarge" });
  });
  it("accepts a photo exactly at the limit and still refuses an empty or invalid size with the generic message", async () => {
    authorize.mockResolvedValue({ provider: "r2", url: "https://test.invalid/pending" });
    expect((await requestAvatarUploadAction("image/jpeg", 3 * MB)).ok).toBe(true);
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(await requestAvatarUploadAction("image/jpeg", bad)).toEqual({ ok: false, code: "profileIdentity.avatar.errorUpload" });
    }
  });
});
describe("authoritative avatar storage integration", () => {
  it("creates metadata before issuing an upload grant", async () => {
    authorize.mockResolvedValue({ provider: "r2", url: "https://test.invalid/pending" });
    const result = await requestAvatarUploadAction("image/jpeg", 100);
    expect(result.ok).toBe(true); expect(rpc).toHaveBeenCalledWith("avatar_request_upload", { p_content_type: "image/jpeg" });
    expect(authorize).toHaveBeenCalledWith(expect.anything(), "avatar", "new.jpg", 100);
  });
  it("does not confirm nonexistent bytes or switch the current avatar", async () => {
    verify.mockRejectedValue(new Error("missing"));
    expect((await confirmAvatarUploadAction("new.jpg")).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
  });
  it("replaces only after verification, then cleans up the retired provider", async () => {
    rpc.mockResolvedValue({ data: "old.jpg", error: null });
    expect((await confirmAvatarUploadAction("new.jpg")).ok).toBe(true);
    expect(verify).toHaveBeenCalledWith(expect.anything(), "avatar", "new.jpg");
    expect(remove).toHaveBeenCalledWith(expect.anything(), "avatar", "old.jpg");
  });
  it("does not delete bytes when database deletion is unauthorized", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    expect((await deleteAvatarAction()).ok).toBe(false); expect(remove).not.toHaveBeenCalled();
  });
});
