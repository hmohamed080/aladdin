import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(fn: T) => fn }));
const rpc = vi.fn();
const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: vi.fn(async () => ({ rpc, auth: { getUser } })) }));
const loadAdminAccess = vi.fn();
vi.mock("@/server/authorization/admin", () => ({ loadAdminAccess }));
const consumeRateLimit = vi.fn();
vi.mock("@/server/cache/rate-limit", () => ({ consumeRateLimit }));
const ctor = vi.fn();
const getReadAccess = vi.fn();
vi.mock("@/server/storage/r2-provider", () => ({
  CloudflareR2StorageProvider: class {
    constructor(...args: unknown[]) { ctor(...args); }
    getReadAccess = getReadAccess;
  },
}));

const { GET } = await import("./route");

const ID = "71000006-0000-4000-8000-000000000006";
const MEDIA = "c1000000-0000-4000-8000-000000000001";
const OBJECT = "u/71000006-0000-4000-8000-000000000006/certificate/c1000000-0000-4000-8000-000000000001/original.pdf";
const SIGNED = "https://r2.example/signed?X-Amz-Signature=abc";
const ORIGIN = "https://app.example";
const call = (namespace = "certificate", id = ID, media = MEDIA, headers: Record<string, string> = { "sec-fetch-site": "same-origin" }) =>
  GET(new NextRequest(`${ORIGIN}/admin/users/${id}/view/media/${namespace}/${media}`, { headers }), {
    params: Promise.resolve({ id, namespace, mediaId: media }),
  });
const upstreamBody = (text = "bytes", headers: Record<string, string> = {}) =>
  new Response(text, { status: 200, headers: { etag: "abc", "set-cookie": "x=1", "cache-control": "public, max-age=999", ...headers } });
const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  loadAdminAccess.mockResolvedValue({ isStaff: true, rank: 80, permissions: ["users.view_as"], roles: [] });
  getUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
  consumeRateLimit.mockResolvedValue({ outcome: "allowed" });
  rpc.mockResolvedValue({ data: { object: OBJECT, contentType: "application/pdf" }, error: null });
  getReadAccess.mockResolvedValue(SIGNED);
  fetchMock.mockImplementation(async () => upstreamBody());
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("ADMIN_VIEW_AS_ENABLED", "true");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("GET /admin/users/[id]/view/media/[namespace]/[mediaId] - a viewed account's private file", () => {
  it("authorizes + audits through the database, then streams with private/no-store headers and no upstream headers", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("bytes");
    expect(rpc).toHaveBeenCalledWith("admin_view_as_media_open", { p_subject: ID, p_namespace: "certificate", p_media_id: MEDIA });
    expect(ctor).toHaveBeenCalledWith("certificate", "private", OBJECT);
    expect(getReadAccess).toHaveBeenCalledWith(OBJECT, 30);
    expect(fetchMock).toHaveBeenCalledWith(SIGNED, expect.objectContaining({ redirect: "manual", cache: "no-store" }));
    expect(res.headers.get("cache-control")).toBe("no-store, no-cache, must-revalidate, private");
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("sandbox");
    for (const h of ["etag", "set-cookie", "location"]) expect(res.headers.get(h)).toBeNull();
    // neither the signed URL nor the physical key is ever echoed to the browser
    expect([...res.headers.values()].join("\n")).not.toContain("X-Amz");
    expect([...res.headers.values()].join("\n")).not.toContain(OBJECT);
  });

  it("re-authorizes AFTER the fetch: if the view ended meanwhile (or the object changed), nothing is served", async () => {
    rpc.mockResolvedValueOnce({ data: { object: OBJECT, contentType: "application/pdf" }, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "42501" } });
    const res = await call();
    expect(res.status).toBe(404);
    expect(rpc).toHaveBeenCalledTimes(2);
    rpc.mockReset();
    rpc.mockResolvedValueOnce({ data: { object: OBJECT, contentType: "application/pdf" }, error: null })
      .mockResolvedValueOnce({ data: { object: `${OBJECT}x`, contentType: "application/pdf" }, error: null });
    expect((await call()).status).toBe(404);
  });

  it.each([
    ["a cross-site request", { "sec-fetch-site": "cross-site" }],
    ["a same-site (sibling subdomain) request", { "sec-fetch-site": "same-site" }],
    ["a typed-in / bookmarked URL", { "sec-fetch-site": "none" }],
    ["no Sec-Fetch-Site header at all (fails closed)", {}],
  ])("404s %s without touching the database or the storage", async (_n, headers) => {
    const res = await call("certificate", ID, MEDIA, headers);
    expect(res.status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("404s when the feature is off, an id is malformed, or the namespace is not on the allow-list", async () => {
    vi.stubEnv("ADMIN_VIEW_AS_ENABLED", "false");
    expect((await call()).status).toBe(404);
    vi.stubEnv("ADMIN_VIEW_AS_ENABLED", "true");
    expect((await call("certificate", "nope")).status).toBe(404);
    expect((await call("certificate", ID, "../../etc")).status).toBe(404);
    for (const ns of ["product", "organization", "request", "verification", "cover", "video", "..", ""]) {
      expect((await call(ns)).status).toBe(404);
    }
    expect(rpc).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("404s a caller without users.view_as, a non-staff caller and a signed-out caller", async () => {
    loadAdminAccess.mockResolvedValue({ isStaff: true, rank: 60, permissions: ["users.verify"], roles: [] });
    expect((await call()).status).toBe(404);
    loadAdminAccess.mockResolvedValue({ isStaff: false, rank: 0, permissions: [], roles: [] });
    expect((await call()).status).toBe(404);
    loadAdminAccess.mockResolvedValue({ isStaff: true, rank: 80, permissions: ["users.view_as"], roles: [] });
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await call()).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("404s (same empty response) whenever the database refuses: no live view session, other subject's media, pending file", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "not permitted" } });
    const res = await call();
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
    expect(ctor).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a content type outside the namespace policy, an upstream redirect or error, and an oversized body", async () => {
    rpc.mockResolvedValue({ data: { object: OBJECT, contentType: "text/html" }, error: null });
    expect((await call()).status).toBe(404);
    rpc.mockResolvedValue({ data: { object: OBJECT, contentType: "application/pdf" }, error: null });
    fetchMock.mockImplementation(async () => new Response(null, { status: 302, headers: { location: "https://evil.example/" } }));
    expect((await call()).status).toBe(404);
    fetchMock.mockImplementation(async () => new Response(null, { status: 404 }));
    expect((await call()).status).toBe(404);
    fetchMock.mockImplementation(async () => upstreamBody("x", { "content-length": String(10 * 1024 * 1024 * 1024) }));
    expect((await call()).status).toBe(404);
  });

  it("answers 429 when the per-admin media rate limit is hit, before any database authorization", async () => {
    consumeRateLimit.mockResolvedValue({ outcome: "limited", retryAfterSeconds: 7 });
    const res = await call();
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("7");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("never throws: an unexpected failure is the same empty 404", async () => {
    rpc.mockRejectedValue(new Error("boom"));
    expect((await call()).status).toBe(404);
    rpc.mockResolvedValue({ data: { object: OBJECT, contentType: "application/pdf" }, error: null });
    getReadAccess.mockRejectedValue(new Error("R2 credentials are not configured"));
    expect((await call()).status).toBe(404);
  });
});
