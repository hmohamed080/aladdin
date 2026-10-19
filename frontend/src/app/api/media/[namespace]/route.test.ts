import { beforeEach, expect, it, vi } from "vitest";
import { claimsFrom } from "@/test/session-claims";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ user: vi.fn(), resolve: vi.fn(), deliver: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: async () => ({ auth: { getUser: mocks.user, getClaims: claimsFrom(() => mocks.user()) } }) }));
vi.mock("@/server/storage/media", () => ({ resolveMedia: mocks.resolve }));
vi.mock("@/server/storage/delivery", () => ({ deliverMedia: mocks.deliver,
  mediaNotFound: () => new Response(null, { status: 404, headers: { "cache-control": "private, no-store" } }) }));
import { GET } from "./route";
const OWNER = "70000009-0000-4000-8000-000000000009";
const KEY = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa.png";
beforeEach(() => {
  vi.clearAllMocks(); mocks.user.mockResolvedValue({ data: { user: { id: OWNER } }, error: null });
  mocks.resolve.mockResolvedValue({ owner: OWNER });
  mocks.deliver.mockImplementation(async (_client, _namespace, _key, authority) =>
    new Response(null, { status: await authority() ? 200 : 404 }));
});
const read = (namespace: string, key = KEY) => GET(new Request(`https://local.test/api/media/${namespace}?key=${encodeURIComponent(key)}`), { params: Promise.resolve({ namespace }) });
it.each(["avatar", "portfolio"])("supports owned opaque %s keys", async (namespace) => { expect((await read(namespace)).status).toBe(200); });
it("supports an owned certificate without exposing a token", async () => { expect((await read("certificate", `${OWNER}/${KEY.replace("png", "pdf")}`)).status).toBe(200); });
it("denies unauthenticated reads before upstream retrieval", async () => {
  mocks.user.mockResolvedValue({ data: { user: null }, error: null });
  expect((await read("portfolio")).status).toBe(404); expect(mocks.deliver).not.toHaveBeenCalled();
});
it.each([null, "71000006-0000-4000-8000-000000000006"])("does not grant owner-private access through publication or tenant membership", async (owner) => {
  mocks.resolve.mockResolvedValue({ owner }); expect((await read("portfolio")).status).toBe(404);
});
it("denies traversal, foreign certificate prefixes, duplicate keys and unknown buckets", async () => {
  expect((await read("certificate", `foreign/${KEY}`)).status).toBe(404);
  expect((await read("portfolio", "../x.png")).status).toBe(404);
  expect((await read("other")).status).toBe(404);
  expect((await GET(new Request(`https://local.test/api/media/portfolio?key=${KEY}&key=${KEY}`), { params: Promise.resolve({ namespace: "portfolio" }) })).status).toBe(404);
  expect(mocks.deliver).not.toHaveBeenCalled();
});
