import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Admin Core 1B-B (PD-010): a suspended account is sent to /auth/suspended from
 * every product surface, an active one is sent away from that page, and the
 * existing sign-in guard is unchanged. The database itself refuses the
 * suspended account's data requests — this only chooses the page it sees.
 */
let user: { id: string } | null = null;
let accountStatus: { status: string; suspended: boolean } | null = null;
const rpc = vi.fn(async () => ({ data: accountStatus, error: null }));

vi.mock("@/lib/env", () => ({
  readPublicEnv: () => ({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:1", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" }),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getUser: async () => ({ data: { user } }) }, rpc }),
}));

const { middleware } = await import("./middleware");

const at = (path: string) => middleware(new NextRequest(new URL(path, "http://localhost")));
const location = (res: Response) => (res.headers.get("location") ? new URL(res.headers.get("location")!).pathname : null);

beforeEach(() => {
  user = null;
  accountStatus = null;
  rpc.mockClear();
});

describe("middleware — account suspension", () => {
  it("sends a suspended account from every product surface to /auth/suspended", async () => {
    user = { id: "u1" };
    accountStatus = { status: "suspended", suspended: true };
    for (const path of ["/home", "/b2b/leads", "/admin/preview/users", "/settings/profile", "/business/new", "/onboarding"]) {
      expect(location(await at(path)), path).toBe("/auth/suspended");
    }
    expect(rpc).toHaveBeenCalledWith("my_account_status");
  });

  it("lets an active account through and does not show it the suspended page", async () => {
    user = { id: "u1" };
    accountStatus = { status: "active", suspended: false };
    expect(location(await at("/home"))).toBeNull();
    expect(location(await at("/auth/suspended"))).toBe("/onboarding");
  });

  it("keeps a suspended account on the suspended page", async () => {
    user = { id: "u1" };
    accountStatus = { status: "suspended", suspended: true };
    expect(location(await at("/auth/suspended"))).toBeNull();
  });

  it("asks nothing for a signed-out visitor and keeps the sign-in guard", async () => {
    expect(location(await at("/home"))).toBe("/auth/sign-in");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does not check public pages", async () => {
    user = { id: "u1" };
    accountStatus = { status: "suspended", suspended: true };
    expect(location(await at("/p/abc"))).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
});
