import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const rpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: vi.fn(async () => ({ rpc })) }));

const { POST } = await import("./route");

const ID = "70000009-0000-4000-8000-000000000009";
const call = (id: string, headers: Record<string, string> = {}) =>
  POST(
    new NextRequest(`https://app.example/admin/users/${id}/view/exit`, { method: "POST", headers }),
    { params: Promise.resolve({ id }) },
  );

beforeEach(() => {
  rpc.mockReset();
  rpc.mockResolvedValue({ data: true, error: null });
});

describe("POST /admin/users/[id]/view/exit", () => {
  it("ends the caller's own session and returns to the user's admin page (303, never cached)", async () => {
    const res = await call(ID, { origin: "https://app.example" });
    expect(rpc).toHaveBeenCalledWith("admin_view_as_end", { p_subject: ID, p_kind: "craftsman" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`https://app.example/admin/users/${ID}`);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("refuses a cross-site POST without touching the database", async () => {
    const res = await call(ID, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("404s a malformed id", async () => {
    const res = await call("not-a-uuid");
    expect(res.status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });
});
