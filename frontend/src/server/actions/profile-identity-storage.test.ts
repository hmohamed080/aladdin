import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const rpc = vi.hoisted(() => vi.fn());
const authorize = vi.hoisted(() => vi.fn()); const verify = vi.hoisted(() => vi.fn()); const remove = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: async () => ({ rpc }) }));
vi.mock("@/server/storage/media", () => ({ authorizeMediaUpload: authorize, verifyPendingMedia: verify, removeMedia: remove }));
import { requestAvatarUploadAction, confirmAvatarUploadAction, deleteAvatarAction } from "./profile-identity";
beforeEach(() => { vi.clearAllMocks(); rpc.mockResolvedValue({ data: "new.jpg", error: null }); verify.mockResolvedValue(undefined); remove.mockResolvedValue(undefined); });
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
