import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T,>(fn: T) => fn }));
const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: vi.fn(async () => ({ rpc })) }));
const loadAdminAccess = vi.fn();
vi.mock("@/server/authorization/admin", () => ({ loadAdminAccess }));

const { POST } = await import("./route");

const ID = "70000009-0000-4000-8000-000000000009";
const ORIGIN = "https://app.example";
const session = () => ({
  session_id: "s1",
  kind: "craftsman",
  subject_user_id: ID,
  started_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 25 * 60_000).toISOString(),
  subject_name: "Ahmed",
});
const call = (id = ID, headers: Record<string, string> = { origin: ORIGIN, "sec-fetch-site": "same-origin" }) =>
  POST(new NextRequest(`${ORIGIN}/admin/users/${id}/view/start`, { method: "POST", headers }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  rpc.mockReset();
  loadAdminAccess.mockReset();
  loadAdminAccess.mockResolvedValue({ isStaff: true, rank: 80, permissions: ["users.view_as"], roles: [] });
  rpc.mockResolvedValue({ data: session(), error: null });
  vi.stubEnv("ADMIN_VIEW_AS_ENABLED", "true");
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /admin/users/[id]/view/start — the only place a view session opens", () => {
  it("opens the audited session for a same-origin POST and lands on the view (303, never cached)", async () => {
    const res = await call();
    expect(rpc).toHaveBeenCalledWith("admin_view_as_begin", { p_subject: ID, p_kind: "craftsman" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/admin/users/${ID}/view`);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it.each([
    ["a foreign Origin", { origin: "https://evil.example", "sec-fetch-site": "cross-site" }],
    ["no Origin at all", { "sec-fetch-site": "same-origin" }],
    ["a cross-site fetch even with our Origin", { origin: ORIGIN, "sec-fetch-site": "cross-site" }],
    ["a same-site (sibling subdomain) fetch", { origin: ORIGIN, "sec-fetch-site": "same-site" }],
  ])("refuses %s without touching the database (no forged audit row)", async (_n, headers) => {
    const res = await call(ID, headers);
    expect(res.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("404s when the feature is off, the id is malformed, or the caller lacks users.view_as", async () => {
    vi.stubEnv("ADMIN_VIEW_AS_ENABLED", "false");
    expect((await call()).status).toBe(404);
    vi.stubEnv("ADMIN_VIEW_AS_ENABLED", "true");
    expect((await call("nope")).status).toBe(404);
    loadAdminAccess.mockResolvedValue({ isStaff: true, rank: 60, permissions: ["users.verify"], roles: [] });
    expect((await call()).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("404s whatever the database refuses (ineligible / unknown / lower-ranked subject: same answer)", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "not permitted" } });
    expect((await call()).status).toBe(404);
  });
});
