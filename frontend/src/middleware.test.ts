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
let sessionToken: string | null = null;
const rpc = vi.fn(async () => ({ data: accountStatus, error: null }));

vi.mock("@/lib/env", () => ({
  readPublicEnv: () => ({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:1", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" }),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user } }),
      getSession: async () => ({ data: { session: sessionToken ? { access_token: sessionToken } : null } }),
    },
    rpc,
  }),
}));

const { middleware } = await import("./middleware");

const at = (path: string) => middleware(new NextRequest(new URL(path, "http://localhost")));
const location = (res: Response) => (res.headers.get("location") ? new URL(res.headers.get("location")!).pathname : null);

beforeEach(() => {
  user = null;
  accountStatus = null;
  sessionToken = null;
  rpc.mockClear();
});

describe("middleware — account suspension", () => {
  it("sends a suspended account from every product surface to /auth/suspended", async () => {
    user = { id: "u1" };
    accountStatus = { status: "suspended", suspended: true };
    for (const path of ["/home", "/b2b/leads", "/admin/users", "/settings/profile", "/business/new", "/onboarding"]) {
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

const SESSION_ID = "a0000000-0000-4000-8000-0000000000a1";
const tokenFor = (sessionId: string) => `h.${btoa(JSON.stringify({ session_id: sessionId })).replace(/=+$/, "")}.s`;
const cookieNames = (res: Response) => res.headers.getSetCookie().map((c) => c.split("=")[0]);

describe("middleware — known devices", () => {
  it("gives a browser a device id cookie and records it once per session", async () => {
    user = { id: "u1" };
    accountStatus = { status: "active", suspended: false };
    sessionToken = tokenFor(SESSION_ID);
    const res = await middleware(new NextRequest(new URL("/home", "http://localhost"), { headers: { "user-agent": "Mozilla/5.0 Chrome/126" } }));
    expect(cookieNames(res)).toEqual(expect.arrayContaining(["aladdin_device", "aladdin_device_seen"]));
    expect(rpc).toHaveBeenCalledWith("touch_known_device", expect.objectContaining({ p_user_agent: "Mozilla/5.0 Chrome/126" }));
  });

  it("does not record it again when the same session was already recorded today", async () => {
    user = { id: "u1" };
    accountStatus = { status: "active", suspended: false };
    sessionToken = tokenFor(SESSION_ID);
    const marker = `${SESSION_ID}:${new Date().toISOString().slice(0, 10)}`;
    const device = "d0000000-0000-4000-8000-0000000000d1";
    await middleware(new NextRequest(new URL("/home", "http://localhost"), { headers: { cookie: `aladdin_device=${device}; aladdin_device_seen=${marker}` } }));
    expect(rpc).not.toHaveBeenCalledWith("touch_known_device", expect.anything());
  });

  it("records nothing for a signed-out visitor", async () => {
    await at("/auth/sign-in");
    expect(rpc).not.toHaveBeenCalledWith("touch_known_device", expect.anything());
  });
});
