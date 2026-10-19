import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), authorize: vi.fn(), verify: vi.fn(), remove: vi.fn(), refresh: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/server/storage/media", () => ({ authorizeMediaUpload: mocks.authorize, verifyPendingMedia: mocks.verify, removeMedia: mocks.remove }));
import { requestOrganizationImageUploadAction, confirmOrganizationImageUploadAction, removeOrganizationImageAction } from "./organization-image";
beforeEach(() => { vi.resetAllMocks(); mocks.rpc.mockResolvedValue({ data: "key.png", error: null }); mocks.authorize.mockResolvedValue({ provider: "supabase", token: "synthetic" }); });
it("requires the caller RPC before issuing a provider upload grant", async () => {
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
  expect((await requestOrganizationImageUploadAction("org", "image/png", 100)).ok).toBe(false);
  expect(mocks.authorize).not.toHaveBeenCalled();
  expect((await requestOrganizationImageUploadAction("org", "image/png", 100)).ok).toBe(true);
  expect(mocks.authorize).toHaveBeenCalledWith(expect.anything(), "organization", "key.png", 100);
});
it("rejects oversized uploads before creating metadata", async () => {
  expect((await requestOrganizationImageUploadAction("org", "image/png", 3 * 1024 * 1024 + 1)).ok).toBe(false);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it("never makes missing or spoofed bytes current", async () => {
  mocks.verify.mockRejectedValueOnce(Error("invalid bytes"));
  expect((await confirmOrganizationImageUploadAction("pending.png")).ok).toBe(false);
  expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.remove).not.toHaveBeenCalled();
});
it("verifies first, switches through the caller RPC, then cleans only the returned retired key", async () => {
  mocks.rpc.mockResolvedValueOnce({ data: "retired.png", error: null });
  expect((await confirmOrganizationImageUploadAction("new.png")).ok).toBe(true);
  expect(mocks.verify.mock.invocationCallOrder[0]).toBeLessThan(mocks.rpc.mock.invocationCallOrder[0] ?? -1);
  expect(mocks.remove).toHaveBeenCalledWith(expect.anything(), "organization", "retired.png");
});
it("reports interrupted cleanup honestly and permits a scoped retry", async () => {
  mocks.remove.mockRejectedValueOnce(Error("Storage unavailable"));
  expect((await removeOrganizationImageAction("org")).ok).toBe(false);
  expect((await removeOrganizationImageAction("org")).ok).toBe(true);
  expect(mocks.remove).toHaveBeenCalledTimes(2);
});
it("does not clean bytes after an unauthorized removal", async () => {
  mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
  expect((await removeOrganizationImageAction("foreign")).ok).toBe(false);
  expect(mocks.remove).not.toHaveBeenCalled();
});
