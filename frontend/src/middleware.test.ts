import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Admin Core 1B-B (PD-010): a suspended account is sent to /auth/suspended from
 * every product surface, an active one is sent away from that page, and the
 * existing sign-in guard is unchanged. The database itself refuses the
 * suspended account's data requests — this only chooses the page it sees.
 *
 * WP8 (Auth request reduction): the session is read with `getClaims()` (local
 * JWT verification) everywhere except /admin, which still asks the Auth server
 * with `getUser()`; a router prefetch skips only the status RPC.
 */
type Claims = Record<string, unknown>;
type CookieAdapter = { setAll: (c: { name: string; value: string; options: object }[]) => void };

let claims: Claims | null = null;
let claimsError: Error | null = null;
let claimsThrows = false;
let refreshOnRead = false;
let networkUser: { id: string } | null = null;
let accountStatus: { status: string; suspended: boolean; session_active?: boolean } | null = null;
let adapter: CookieAdapter | null = null;

const rpc = vi.fn(async () => ({ data: accountStatus, error: null }));
const getUser = vi.fn(async () => ({ data: { user: networkUser }, error: null }));
const signOut = vi.fn(async () => {
  // supabase-js clears the session through the cookie adapter.
  adapter?.setAll([{ name: "sb-test-auth-token", value: "", options: { path: "/", maxAge: 0 } }]);
  return { error: null };
});
const getClaims = vi.fn(async () => {
  if (claimsThrows) throw new Error("jwks unreachable");
  // supabase-js refreshes an expired session through the cookie adapter first.
  if (refreshOnRead) adapter?.setAll([{ name: "sb-test-auth-token", value: "refreshed", options: { path: "/" } }]);
  if (claimsError) return { data: null, error: claimsError };
  return claims ? { data: { claims, header: {}, signature: new Uint8Array() }, error: null } : { data: null, error: null };
});

vi.mock("@/lib/env", () => ({
  readPublicEnv: () => ({ NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:1", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" }),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _key: string, options: { cookies: CookieAdapter }) => {
    adapter = options.cookies;
    return { auth: { getUser, getClaims, signOut }, rpc };
  },
}));

const { middleware, config } = await import("./middleware");

const SIGNED_IN: Claims = { sub: "u1", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 600, session_id: "s1" };

const at = (path: string, init?: { method?: string; headers?: Record<string, string> }) =>
  middleware(new NextRequest(new URL(path, "http://localhost"), init));
const location = (res: Response) => (res.headers.get("location") ? new URL(res.headers.get("location")!) : null);
const pathOf = (res: Response) => location(res)?.pathname ?? null;
const PREFETCH = { headers: { "next-router-prefetch": "1" } };

beforeEach(() => {
  claims = null;
  claimsError = null;
  claimsThrows = false;
  refreshOnRead = false;
  networkUser = null;
  accountStatus = null;
  adapter = null;
  rpc.mockClear();
  getUser.mockClear();
  getClaims.mockClear();
  signOut.mockClear();
});

describe("middleware — account suspension", () => {
  it("sends a suspended account from every product surface to /auth/suspended", async () => {
    claims = SIGNED_IN;
    networkUser = { id: "u1" };
    accountStatus = { status: "suspended", suspended: true };
    for (const path of ["/home", "/b2b/leads", "/admin/users", "/settings/profile", "/business/new", "/onboarding"]) {
      expect(pathOf(await at(path)), path).toBe("/auth/suspended");
    }
    expect(rpc).toHaveBeenCalledWith("my_account_status");
  });

  it("lets an active account through and does not show it the suspended page", async () => {
    claims = SIGNED_IN;
    accountStatus = { status: "active", suspended: false };
    expect(pathOf(await at("/home"))).toBeNull();
    expect(pathOf(await at("/auth/suspended"))).toBe("/onboarding");
  });

  it("keeps a suspended account on the suspended page", async () => {
    claims = SIGNED_IN;
    accountStatus = { status: "suspended", suspended: true };
    expect(pathOf(await at("/auth/suspended"))).toBeNull();
  });

  it("asks nothing for a signed-out visitor and keeps the sign-in guard", async () => {
    expect(pathOf(await at("/home"))).toBe("/auth/sign-in");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does not check public pages", async () => {
    claims = SIGNED_IN;
    accountStatus = { status: "suspended", suspended: true };
    expect(pathOf(await at("/p/abc"))).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("still checks a suspended account's Server Action POST (never treated as a prefetch)", async () => {
    claims = SIGNED_IN;
    accountStatus = { status: "suspended", suspended: true };
    const res = await at("/b2b/leads", { method: "POST", headers: { "next-action": "abc", "next-router-prefetch": "1" } });
    expect(pathOf(res)).toBe("/auth/suspended");
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe("middleware — revoked session", () => {
  it("clears the cookies of a session revoked elsewhere and sends it to sign in", async () => {
    claims = SIGNED_IN;
    accountStatus = { status: "active", suspended: false, session_active: false };
    const res = await at("/b2b/leads?tab=new");
    expect(pathOf(res)).toBe("/auth/sign-in");
    expect(location(res)?.searchParams.get("next")).toBe("/b2b/leads?tab=new");
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(res.headers.get("set-cookie")).toContain("sb-test-auth-token=;");
  });

  it("treats a revoked session before suspension", async () => {
    claims = SIGNED_IN;
    accountStatus = { status: "suspended", suspended: true, session_active: false };
    expect(pathOf(await at("/home"))).toBe("/auth/sign-in");
  });

  it("leaves a live session alone", async () => {
    claims = SIGNED_IN;
    accountStatus = { status: "active", suspended: false, session_active: true };
    expect(pathOf(await at("/b2b/leads"))).toBeNull();
    expect(signOut).not.toHaveBeenCalled();
  });
});

describe("middleware — session read (getClaims, no Auth request)", () => {
  it("verifies the session locally on non-admin surfaces and never calls getUser()", async () => {
    claims = SIGNED_IN;
    accountStatus = { status: "active", suspended: false };
    for (const path of ["/", "/home", "/b2b/leads", "/settings/profile", "/p/abc"]) await at(path);
    expect(getClaims).toHaveBeenCalledTimes(5);
    expect(getUser).not.toHaveBeenCalled();
  });

  it("redirects a missing session to sign-in with the destination preserved", async () => {
    const url = location(await at("/b2b/leads?tab=open"));
    expect(url?.pathname).toBe("/auth/sign-in");
    expect(url?.searchParams.get("next")).toBe("/b2b/leads?tab=open");
  });

  it("treats an invalid / forged / expired JWT as signed out", async () => {
    claimsError = Object.assign(new Error("Invalid JWT signature"), { name: "AuthInvalidJwtError" });
    expect(pathOf(await at("/home"))).toBe("/auth/sign-in");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("fails closed when verification throws (e.g. the key set cannot be fetched)", async () => {
    claimsThrows = true;
    expect(pathOf(await at("/b2b"))).toBe("/auth/sign-in");
  });

  it("does not accept a token that is not a signed-in user's (anon / service role / no subject)", async () => {
    for (const bad of [
      { role: "anon", exp: SIGNED_IN.exp },
      { sub: "u1", role: "service_role", exp: SIGNED_IN.exp },
      { sub: "", role: "authenticated", exp: SIGNED_IN.exp },
      { sub: "u1", role: "authenticated" },
    ]) {
      claims = bad;
      expect(pathOf(await at("/home")), JSON.stringify(bad)).toBe("/auth/sign-in");
    }
  });

  it("keeps cookie refresh: cookies written during the read are on the response", async () => {
    claims = SIGNED_IN;
    refreshOnRead = true;
    accountStatus = { status: "active", suspended: false };
    const res = await at("/home");
    expect(pathOf(res)).toBeNull();
    expect(res.cookies.get("sb-test-auth-token")?.value).toBe("refreshed");
  });

  it("bounces a signed-in caller off the sign-in / sign-up pages", async () => {
    claims = SIGNED_IN;
    for (const path of ["/auth/sign-in", "/auth/sign-up"]) {
      expect(pathOf(await at(path)), path).toBe("/onboarding");
    }
    claims = null;
    expect(pathOf(await at("/auth/sign-in"))).toBeNull();
  });

  it("carries a session refreshed during the read onto every redirect", async () => {
    claims = SIGNED_IN;
    refreshOnRead = true;
    const bounced = await at("/auth/sign-in");
    expect(pathOf(bounced)).toBe("/onboarding");
    expect(bounced.cookies.get("sb-test-auth-token")?.value).toBe("refreshed");

    accountStatus = { status: "suspended", suspended: true };
    const suspended = await at("/home");
    expect(pathOf(suspended)).toBe("/auth/suspended");
    expect(suspended.cookies.get("sb-test-auth-token")?.value).toBe("refreshed");
  });
});

describe("middleware — admin routes stay network-validated", () => {
  it("asks the Auth server (getUser) on /admin, not the local token", async () => {
    claims = SIGNED_IN;
    networkUser = { id: "u1" };
    accountStatus = { status: "active", suspended: false };
    expect(pathOf(await at("/admin/users"))).toBeNull();
    expect(pathOf(await at("/admin"))).toBeNull();
    expect(getUser).toHaveBeenCalledTimes(2);
    expect(getClaims).not.toHaveBeenCalled();
  });

  it("refuses a revoked admin session at once even though its JWT is still unexpired", async () => {
    claims = SIGNED_IN; // locally valid token...
    networkUser = null; // ...but the Auth server no longer knows the session
    expect(pathOf(await at("/admin/staff"))).toBe("/auth/sign-in");
  });

  it("is not fooled by look-alike paths", async () => {
    claims = SIGNED_IN;
    await at("/administrator");
    expect(getUser).not.toHaveBeenCalled();
  });
});

describe("middleware — prefetch", () => {
  it("skips only the status RPC for a router prefetch of a product surface", async () => {
    claims = SIGNED_IN;
    accountStatus = { status: "suspended", suspended: true };
    const res = await at("/b2b/leads", PREFETCH);
    expect(pathOf(res)).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
    // The real navigation that follows is checked.
    expect(pathOf(await at("/b2b/leads"))).toBe("/auth/suspended");
  });

  it("recognises browser speculative loads too", async () => {
    claims = SIGNED_IN;
    await at("/home", { headers: { "sec-purpose": "prefetch;prerender" } });
    await at("/home", { headers: { purpose: "prefetch" } });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("keeps the sign-in guard for a signed-out prefetch", async () => {
    expect(pathOf(await at("/home", PREFETCH))).toBe("/auth/sign-in");
  });

  it("still network-validates an admin prefetch", async () => {
    claims = SIGNED_IN;
    networkUser = null;
    expect(pathOf(await at("/admin/users", PREFETCH))).toBe("/auth/sign-in");
    expect(getUser).toHaveBeenCalledTimes(1);
  });
});

describe("middleware — matcher", () => {
  const matcher = new RegExp(`^${config.matcher[0]}$`);
  it("skips static assets and the self-authorizing media routes", () => {
    for (const path of [
      "/_next/static/chunks/app.js",
      "/_next/image",
      "/favicon.ico",
      "/api/health",
      "/api/media/avatar",
      "/p/media/70000009-0000-4000-8000-000000000009",
      "/assets/hero.webp",
      "/fonts/inter.woff2",
      "/robots.txt",
    ]) {
      expect(matcher.test(path), path).toBe(false);
    }
  });

  it("still runs on pages, Server Actions and other routes", () => {
    for (const path of ["/", "/home", "/b2b/leads", "/admin/users", "/auth/sign-in", "/p/abc", "/api/other", "/p/mediakit"]) {
      expect(matcher.test(path), path).toBe(true);
    }
  });
});
