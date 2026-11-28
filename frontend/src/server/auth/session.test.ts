import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`redirect:${to}`);
  },
}));

// Emulate React's per-request `cache()` (a fresh scope per test = per request):
// outside an RSC render the real one does not memoize at all.
// Each cached function gets its own memo per "request" (`scope.request`).
const scope = { request: {} as object };
vi.mock("react", async (orig) => ({
  ...(await orig<typeof import("react")>()),
  cache: <A extends unknown[], R>(fn: (...args: A) => R) => {
    const perRequest = new WeakMap<object, Map<unknown, R>>();
    return (...args: A): R => {
      const memo = perRequest.get(scope.request) ?? new Map<unknown, R>();
      perRequest.set(scope.request, memo);
      if (!memo.has(args[0])) memo.set(args[0], fn(...args));
      return memo.get(args[0]) as R;
    };
  },
}));

const getUser = vi.fn();
const getClaims = vi.fn();
const client = { auth: { getUser, getClaims } };
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: async () => client }));

const { getSessionIdentity, readSessionIdentity, getCurrentUser, requireUser } = await import("./session");

const exp = Math.floor(Date.now() / 1000) + 600;
const claims = { sub: "u1", role: "authenticated", exp, email: "a@b.test", phone: "", session_id: "s1" };

beforeEach(() => {
  scope.request = {};
  getUser.mockReset();
  getClaims.mockReset();
  getClaims.mockResolvedValue({ data: { claims }, error: null });
  getUser.mockResolvedValue({ data: { user: { id: "u1", email: "a@b.test" } }, error: null });
});

describe("getSessionIdentity (local JWT verification)", () => {
  it("returns the verified identity without any network getUser()", async () => {
    expect(await getSessionIdentity()).toEqual({ id: "u1", email: "a@b.test", phone: null, sessionId: "s1", expiresAt: exp });
    expect(getUser).not.toHaveBeenCalled();
  });

  it("reads the session once per request however many loaders ask", async () => {
    await Promise.all([getSessionIdentity(), getSessionIdentity(), readSessionIdentity(client as never)]);
    await getSessionIdentity();
    expect(getClaims).toHaveBeenCalledTimes(1);
  });

  it("a new request reads again (nothing is shared across requests)", async () => {
    await getSessionIdentity();
    scope.request = {};
    await getSessionIdentity();
    expect(getClaims).toHaveBeenCalledTimes(2);
  });

  it("is null for a missing, invalid or unusable token, and when verification throws", async () => {
    getClaims.mockResolvedValueOnce({ data: null, error: null });
    expect(await getSessionIdentity()).toBeNull();
    scope.request = {};
    getClaims.mockResolvedValueOnce({ data: null, error: new Error("Invalid JWT signature") });
    expect(await getSessionIdentity()).toBeNull();
    scope.request = {};
    getClaims.mockResolvedValueOnce({ data: { claims: { ...claims, role: "anon" } }, error: null });
    expect(await getSessionIdentity()).toBeNull();
    scope.request = {};
    getClaims.mockRejectedValueOnce(new Error("network"));
    expect(await getSessionIdentity()).toBeNull();
  });
});

describe("getCurrentUser (network-validated)", () => {
  it("asks the Auth server, once per request", async () => {
    await Promise.all([getCurrentUser(), getCurrentUser()]);
    expect(await getCurrentUser()).toEqual({ id: "u1", email: "a@b.test" });
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(getClaims).not.toHaveBeenCalled();
  });

  it("sees a revoked session immediately even when the JWT still verifies locally", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: new Error("session_not_found") });
    expect(await getSessionIdentity()).not.toBeNull(); // the local token is still within exp
    expect(await getCurrentUser()).toBeNull();
    await expect(requireUser("/admin/users")).rejects.toThrow("redirect:/auth/sign-in?next=%2Fadmin%2Fusers");
  });
});
