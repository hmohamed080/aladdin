import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: vi.fn(async () => ({ rpc })) }));

const { POST } = await import("./route");

const ID = "70000009-0000-4000-8000-000000000009";
const ORIGIN = "https://app.example";
const SAME = { origin: ORIGIN, "sec-fetch-site": "same-origin" };
const call = (id: string, headers: Record<string, string> = SAME) =>
  POST(new NextRequest(`${ORIGIN}/admin/users/${id}/view/exit`, { method: "POST", headers }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: true, error: null });
});

describe("POST /admin/users/[id]/view/exit", () => {
  it("ends the caller's own session and returns to the user's admin page (303, never cached)", async () => {
    const res = await call(ID);
    expect(rpc).toHaveBeenCalledWith("admin_view_as_end", { p_subject: ID, p_kind: "craftsman" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/admin/users/${ID}`);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it.each([
    ["a foreign Origin", { origin: "https://evil.example", "sec-fetch-site": "cross-site" }],
    ["a missing Origin", { "sec-fetch-site": "same-origin" }],
    ["Origin: null (sandboxed / no-referrer form)", { origin: "null", "sec-fetch-site": "same-origin" }],
    ["an explicit cross-site fetch with our Origin", { origin: ORIGIN, "sec-fetch-site": "cross-site" }],
    ["a same-site (sibling subdomain) fetch", { origin: ORIGIN, "sec-fetch-site": "same-site" }],
  ])("refuses %s without touching the database", async (_n, headers) => {
    const res = await call(ID, headers);
    expect(res.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does NOT redirect as though the session ended when the database call fails", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "db down" } });
    const res = await call(ID);
    expect(res.status).toBe(500);
    expect(res.headers.get("location")).toBeNull();
  });

  it("is idempotent: no live session left (false) still returns to the user page", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    expect((await call(ID)).status).toBe(303);
  });

  it("404s a malformed id", async () => {
    const res = await call("not-a-uuid");
    expect(res.status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });
});
