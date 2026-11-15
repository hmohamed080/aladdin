import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(fn: T) => fn }));
const rpc = vi.fn();
const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: vi.fn(async () => ({ rpc, auth: { getUser } })) }));
vi.mock("@/server/authorization/admin", () => ({ loadAdminAccess: vi.fn(async () => ({ isStaff: true, rank: 80, permissions: ["users.view_as"], roles: [] })) }));
const consumeRateLimit = vi.fn();
vi.mock("@/server/cache/rate-limit", () => ({ consumeRateLimit }));
vi.mock("@/server/storage/r2-provider", () => ({ CloudflareR2StorageProvider: class { getReadAccess = vi.fn(async () => "https://r2.example/signed?X-Amz-Signature=abc"); } }));

const { GET } = await import("./route");
const ID = "71000006-0000-4000-8000-000000000006";
const MEDIA = "c1000000-0000-4000-8000-000000000001";
const call = (namespace: string, headers: Record<string, string> = { "sec-fetch-site": "same-origin" }) =>
  GET(new NextRequest(`https://app.example/view-as/${ID}/media/${namespace}/${MEDIA}`, { headers }), { params: Promise.resolve({ id: ID, namespace, mediaId: MEDIA }) });

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
  consumeRateLimit.mockResolvedValue({ outcome: "allowed" });
  rpc.mockResolvedValue({ data: { object: "u/x/certificate/y/original.pdf", contentType: "application/pdf" }, error: null });
  vi.stubGlobal("fetch", vi.fn(async () => new Response("pdf", { status: 200 })));
  vi.stubEnv("ADMIN_VIEW_AS_ENABLED", "true");
});

describe("GET /view-as/[id]/media/[namespace]/[mediaId] shares the view door implementation", () => {
  it("serves a private image through admin_view_as_media_open with the media-read limit", async () => {
    const res = await call("certificate");
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("admin_view_as_media_open", { p_subject: ID, p_namespace: "certificate", p_media_id: MEDIA });
    expect(consumeRateLimit).toHaveBeenCalledWith("media-read", "admin-1");
  });
  it("refuses a missing or spoofed fetch-site, a forged Referer and a namespace off the allow-list", async () => {
    expect((await call("certificate", {})).status).toBe(404);
    expect((await call("certificate", { referer: `https://app.example/view-as/${ID}` })).status).toBe(404);
    expect((await call("certificate", { "sec-fetch-site": "cross-site", referer: `https://app.example/view-as/${ID}` })).status).toBe(404);
    for (const ns of ["product", "video", "verification", ".."]) expect((await call(ns)).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });
});
