import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ resolve: vi.fn(), sign: vi.fn(), admin: vi.fn(), provider: vi.fn() }));
vi.mock("./media", () => ({ resolveMedia: mocks.resolve, privilegedStorageClient: mocks.admin, mediaProvider: mocks.provider }));
import { deliverMedia } from "./delivery";
const client = {} as SupabaseClient;
const ready = { provider: "supabase", state: "ready", contentType: "image/png", owner: "owner" };
const fetcher = vi.fn();
beforeEach(() => {
  vi.clearAllMocks(); mocks.resolve.mockResolvedValue(ready); mocks.admin.mockReturnValue({ serverOnly: true });
  mocks.provider.mockReturnValue({ getReadAccess: mocks.sign }); mocks.sign.mockResolvedValue("https://private.invalid/object?token=internal");
  fetcher.mockImplementation(async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "cf-cache-status": "HIT", "cache-control": "public, max-age=3600", etag: "upstream" } }));
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => vi.unstubAllGlobals());
it.each(["supabase", "r2"])("streams authorized %s bytes without credentials or upstream cache headers", async (provider) => {
  mocks.resolve.mockResolvedValue({ ...ready, provider });
  const response = await deliverMedia(client, "portfolio", "image.png");
  expect(response.status).toBe(200); expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
  expect(response.headers.get("cache-control")).toContain("no-store"); expect(response.headers.get("cdn-cache-control")).toBe("no-store");
  for (const name of ["etag", "location", "cf-cache-status"]) expect(response.headers.has(name)).toBe(false);
  expect(fetcher).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ cache: "no-store", redirect: "manual" }));
  expect(mocks.admin).toHaveBeenCalledTimes(provider === "supabase" ? 1 : 0);
});
it.each(["wrong-user", "wrong-tenant", "deleted", "purged"])("denies %s before consulting cached upstream", async () => {
  mocks.resolve.mockRejectedValue(Error("media unavailable"));
  const response = await deliverMedia(client, "certificate", "owner/file.pdf");
  expect(response.status).toBe(404); expect(response.headers.get("cache-control")).toContain("no-store");
  expect(fetcher).not.toHaveBeenCalled(); expect(mocks.admin).not.toHaveBeenCalled();
});
it("never follows or serves an upstream redirect", async () => {
  fetcher.mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://elsewhere.invalid/" } }));
  const response = await deliverMedia(client, "portfolio", "image.png");
  expect(response.status).toBe(404); expect(response.headers.has("location")).toBe(false); expect(fetcher).toHaveBeenCalledTimes(1);
});
it("refuses pending display", async () => {
  mocks.resolve.mockResolvedValue({ ...ready, state: "pending" });
  expect((await deliverMedia(client, "portfolio", "image.png")).status).toBe(404); expect(fetcher).not.toHaveBeenCalled();
});
it("drops cached bytes when revocation commits during retrieval", async () => {
  mocks.resolve.mockResolvedValueOnce(ready).mockResolvedValueOnce({ ...ready, state: "deleted" });
  const response = await deliverMedia(client, "portfolio", "image.png");
  expect(response.status).toBe(404); expect(await response.text()).toBe(""); expect(fetcher).toHaveBeenCalledTimes(1);
});
it("rechecks publication even when caller is owner", async () => {
  const publication = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  expect((await deliverMedia(client, "portfolio", "image.png", publication)).status).toBe(404);
});
it("denies same and fresh sessions after revocation despite cached upstream", async () => {
  expect((await deliverMedia(client, "portfolio", "image.png")).status).toBe(200);
  mocks.resolve.mockRejectedValue(Error("withdrawn"));
  expect((await deliverMedia(client, "portfolio", "image.png")).status).toBe(404);
  expect((await deliverMedia({} as SupabaseClient, "portfolio", "image.png")).status).toBe(404);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("fails closed on upstream errors and oversized streams", async () => {
  fetcher.mockResolvedValueOnce(new Response(null, { status: 404 }));
  expect((await deliverMedia(client, "portfolio", "image.png")).status).toBe(404);
  fetcher.mockResolvedValueOnce(new Response(new Uint8Array(5 * 1024 * 1024 + 1)));
  const response = await deliverMedia(client, "portfolio", "image.png");
  await expect(response.arrayBuffer()).rejects.toThrow("media stream limit");
});
