import { describe, it, expect, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { loadUnappliedApproval } = await import("./admin-directory");

const ID = "70000001-0000-4000-8000-0000000000b1";
function client(result: unknown) {
  const q: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const m of ["select", "eq", "is", "neq", "order", "limit"]) q[m] = vi.fn(() => q);
  q.maybeSingle = vi.fn(async () => result);
  return { q, supabase: { from: vi.fn(() => q) } as never };
}

describe("loadUnappliedApproval", () => {
  it("reads the approved request whose applied_at is still null", async () => {
    const { q, supabase } = client({ data: { id: "r1", status: "approved", verification_type: "professional" }, error: null });
    expect(await loadUnappliedApproval(supabase, ID)).toEqual({ id: "r1", status: "approved", verificationType: "professional" });
    expect(q.eq).toHaveBeenCalledWith("user_id", ID);
    expect(q.eq).toHaveBeenCalledWith("status", "approved");
    expect(q.is).toHaveBeenCalledWith("applied_at", null);
    // identity approvals never set applied_at, so only professional requests may read as unapplied
    expect(q.eq).toHaveBeenCalledWith("verification_type", "professional");
  });
  it("returns null when nothing is unapplied, on a read error, and for a malformed id (no recovery is offered)", async () => {
    expect(await loadUnappliedApproval(client({ data: null, error: null }).supabase, ID)).toBeNull();
    expect(await loadUnappliedApproval(client({ data: null, error: { message: "boom" } }).supabase, ID)).toBeNull();
    const c = client({ data: null, error: null });
    expect(await loadUnappliedApproval(c.supabase, "not-a-uuid")).toBeNull();
    expect(c.q.maybeSingle).not.toHaveBeenCalled();
  });
});
