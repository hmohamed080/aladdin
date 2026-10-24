import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), deliver: vi.fn(), missing: vi.fn(() => new Response(null, { status: 404, headers: { "cache-control": "no-store" } })) }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/server/storage/delivery", () => ({ deliverMedia: mocks.deliver, mediaNotFound: mocks.missing }));
import { GET } from "./route";
const ID = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const KEY = `${ID}.png`;
const request = new Request("https://local.test/p/media/" + ID);
beforeEach(() => { vi.clearAllMocks(); mocks.rpc.mockResolvedValue({ data: KEY, error: null }); mocks.deliver.mockResolvedValue(new Response("image")); });
it("refuses malformed IDs and unpublished records without upstream access", async () => {
 expect((await GET(request, { params: Promise.resolve({ itemId: "bad" }) })).status).toBe(404);
 expect(mocks.rpc).not.toHaveBeenCalled();
 mocks.rpc.mockResolvedValue({ data: null, error: null });
 expect((await GET(request, { params: Promise.resolve({ itemId: ID }) })).status).toBe(404);
 expect(mocks.deliver).not.toHaveBeenCalled();
});
it("passes a fresh publication callback that denies owner access after withdrawal", async () => {
 await GET(request, { params: Promise.resolve({ itemId: ID }) });
 const check = mocks.deliver.mock.calls[0]?.[3];
 expect(await check()).toBe(true);
 mocks.rpc.mockResolvedValue({ data: null, error: null });
 expect(await check()).toBe(false);
 mocks.rpc.mockResolvedValue({ data: "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb.png", error: null });
 expect(await check()).toBe(false);
});
