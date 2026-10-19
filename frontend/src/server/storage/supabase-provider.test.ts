import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("server-only", () => ({}));
import { SupabaseStorageProvider } from "./supabase-provider";
const remove = vi.fn(); const list = vi.fn();
const client = { storage: { from: () => ({ remove, list }) } } as unknown as SupabaseClient;
const provider = new SupabaseStorageProvider(client, "professional-certificates");
beforeEach(() => vi.clearAllMocks());
it("requires exact removal evidence", async () => {
  remove.mockResolvedValue({ data: [{ name: "owner/file.pdf" }], error: null });
  await provider.deleteObject("owner/file.pdf"); expect(list).not.toHaveBeenCalled();
});
it("retains retryable cleanup on empty success while metadata still exists", async () => {
  remove.mockResolvedValue({ data: [], error: null }); list.mockResolvedValue({ data: [{ name: "file.pdf" }], error: null });
  await expect(provider.deleteObject("owner/file.pdf")).rejects.toThrow("unconfirmed");
  expect(list).toHaveBeenCalledWith("owner", { search: "file.pdf", limit: 1 });
  remove.mockResolvedValue({ data: [{ name: "owner/file.pdf" }], error: null });
  await provider.deleteObject("owner/file.pdf");
});
it("makes absent-object retry idempotent without trusting a byte cache", async () => {
  remove.mockResolvedValue({ data: [], error: null }); list.mockResolvedValue({ data: [], error: null });
  await provider.deleteObject("owner/file.pdf");
});
it("fails closed on removal or inventory failure", async () => {
  remove.mockResolvedValue({ data: null, error: Error("storage unavailable") });
  await expect(provider.deleteObject("owner/file.pdf")).rejects.toThrow();
  remove.mockResolvedValue({ data: [], error: null }); list.mockResolvedValue({ data: null, error: Error("inventory unavailable") });
  await expect(provider.deleteObject("owner/file.pdf")).rejects.toThrow("unconfirmed");
});
