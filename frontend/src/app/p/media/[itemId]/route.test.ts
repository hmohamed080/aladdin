import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));

const rpc = vi.fn();
const createSignedUrl = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: async () => ({
    rpc,
    storage: { from: () => ({ createSignedUrl }) },
  }),
}));

vi.mock("@/lib/env", () => ({
  readPublicEnv: () => ({ NEXT_PUBLIC_SUPABASE_URL: "http://storage.test" }),
}));

import { GET } from "./route";

const ITEM = "11111111-1111-4111-8111-111111111111";
const KEY = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa.png";
const BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

const call = (itemId: string) =>
  GET(new Request(`http://app.test/p/media/${itemId}`), {
    params: Promise.resolve({ itemId }),
  });

beforeEach(() => {
  rpc.mockReset();
  createSignedUrl.mockReset();
  rpc.mockResolvedValue({ data: KEY, error: null });
  createSignedUrl.mockResolvedValue({
    data: { signedUrl: "/object/sign/professional-portfolio/x?token=y" },
    error: null,
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(BYTES, { status: 200 })),
  );
});

/**
 * The public media route, and the one property this file exists to defend.
 *
 * An earlier version served `cache-control: public, max-age=60`, reasoning that
 * the item disappears from the page on unpublish so only a saved media URL could
 * exploit the window. That reasoning names the exploit rather than removing it:
 * a saved `/p/media/<id>` is exactly what somebody keeps, and for up to a minute
 * after a person withdrew a photograph — or after the platform delisted their
 * profile — a cache would still be serving it.
 *
 * Withdrawal that is "immediate except for a minute" is not immediate, so these
 * assertions are deliberately about the HEADERS rather than about the bytes.
 */
describe("cacheability", () => {
  it("marks a served image as not storable by any cache", async () => {
    const res = await call(ITEM);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("carries no positive max-age that a shared cache could honour", async () => {
    const res = await call(ITEM);
    expect(res.headers.get("cache-control")).not.toMatch(/max-age=[1-9]/);
  });

  /**
   * A cached 404 is the same bug pointing the other way: publish a photograph and
   * a stored "not found" would keep it invisible. Both answers have to be
   * recomputed on every request.
   */
  it("makes its REFUSALS uncacheable too", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const res = await call(ITEM);
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("re-runs the full publication test on every single request", async () => {
    await call(ITEM);
    await call(ITEM);
    await call(ITEM);
    // Three requests, three resolutions. Nothing is memoised anywhere in the path.
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(createSignedUrl).toHaveBeenCalledTimes(3);
  });
});

/**
 * The key is the thing the whole opaque-key redesign protects. It must reach the
 * caller through no surface at all — not the body, and not a header.
 */
describe("what reaches the caller", () => {
  it("puts the storage key in no response header", async () => {
    const res = await call(ITEM);
    const headers = [...res.headers.entries()].map(([k, v]) => `${k}:${v}`).join("\n");
    expect(headers).not.toContain(KEY);
    expect(headers).not.toContain("professional-portfolio");
    expect(headers).not.toContain("token=");
  });

  it("returns the bytes rather than redirecting to storage", async () => {
    const res = await call(ITEM);
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(BYTES);
  });

  it("declares the image type and forbids sniffing it into something else", async () => {
    const res = await call(ITEM);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("sends no referrer onward, so the item id does not travel", async () => {
    const res = await call(ITEM);
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("signs for seconds, not minutes — the URL only has to outlive one fetch", async () => {
    await call(ITEM);
    expect(createSignedUrl).toHaveBeenCalledWith(KEY, 30);
  });
});

/**
 * One refusal for every reason. A visitor must not be able to tell "never
 * existed" from "not published" from "profile delisted", for the same reason
 * `loadPublicProfile` collapses its three cases into a single 404.
 */
describe("refusals", () => {
  it("answers a malformed id without asking the database anything", async () => {
    const res = await call("not-a-uuid");
    expect(res.status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("answers with an empty body, naming nothing", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    const res = await call(ITEM);
    expect(await res.text()).toBe("");
  });

  it("refuses a resolver result that is not a portfolio key, without signing it", async () => {
    // A certificate path, which is the shape this route must never serve.
    rpc.mockResolvedValue({ data: `${ITEM}/${KEY}`, error: null });
    const res = await call(ITEM);
    expect(res.status).toBe(404);
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("refuses when the storage policy declines to sign, even if the resolver spoke", async () => {
    createSignedUrl.mockResolvedValue({
      data: null,
      error: { code: "NoSuchKey", message: "Object not found" },
    });
    expect((await call(ITEM)).status).toBe(404);
  });

  it("refuses when the upstream fetch fails, rather than serving a broken body", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 403 })));
    expect((await call(ITEM)).status).toBe(404);
  });

  it("gives every refusal the same shape, whatever the reason", async () => {
    const reasons = [
      () => rpc.mockResolvedValue({ data: null, error: null }),
      () => rpc.mockResolvedValue({ data: null, error: { message: "denied" } }),
      () => createSignedUrl.mockResolvedValue({ data: null, error: { message: "nope" } }),
    ];
    for (const set of reasons) {
      set();
      const res = await call(ITEM);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("");
      expect(res.headers.get("cache-control")).toContain("no-store");
    }
  });
});
