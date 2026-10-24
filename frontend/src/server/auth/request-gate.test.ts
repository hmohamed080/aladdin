import { describe, expect, it } from "vitest";
import {
  identityFromClaims,
  isAuthRequiredPath,
  isPrefetchRequest,
  isProductSurfacePath,
  needsNetworkValidatedSession,
} from "./request-gate";

const exp = 2_000_000_000;

describe("identityFromClaims", () => {
  it("maps a signed-in user's verified claims", () => {
    expect(identityFromClaims({ sub: "u", role: "authenticated", exp, email: "e@x.test", phone: "+20100", session_id: "s" }))
      .toEqual({ id: "u", email: "e@x.test", phone: "+20100", sessionId: "s", expiresAt: exp });
  });
  it("normalises empty contact claims to null", () => {
    expect(identityFromClaims({ sub: "u", role: "authenticated", exp, email: "", phone: "" }))
      .toMatchObject({ email: null, phone: null, sessionId: null });
  });
  it("rejects anything that is not a signed-in user's token", () => {
    for (const c of [null, undefined, "x", {}, { sub: "u", exp }, { sub: "u", role: "anon", exp },
      { sub: "u", role: "service_role", exp }, { sub: 1, role: "authenticated", exp }, { sub: "u", role: "authenticated" }]) {
      expect(identityFromClaims(c), JSON.stringify(c)).toBeNull();
    }
  });
});

describe("isPrefetchRequest", () => {
  const h = (o: Record<string, string>) => new Headers(o);
  it("detects router and browser prefetches on GET/HEAD only", () => {
    expect(isPrefetchRequest("GET", h({ "next-router-prefetch": "1" }))).toBe(true);
    expect(isPrefetchRequest("GET", h({ "sec-purpose": "prefetch" }))).toBe(true);
    expect(isPrefetchRequest("HEAD", h({ purpose: "Prefetch" }))).toBe(true);
    expect(isPrefetchRequest("GET", h({}))).toBe(false);
    expect(isPrefetchRequest("POST", h({ "next-router-prefetch": "1" }))).toBe(false);
  });
});

describe("route classes", () => {
  it("keeps the existing auth-required and product surfaces", () => {
    expect(["/b2b", "/admin/x", "/home", "/onboarding/a"].every(isAuthRequiredPath)).toBe(true);
    expect(["/settings/x", "/business/new", "/home"].every(isProductSurfacePath)).toBe(true);
    expect(["/", "/p/abc", "/auth/sign-in"].some(isProductSurfacePath)).toBe(false);
  });
  it("network-validates exactly the admin console", () => {
    expect(needsNetworkValidatedSession("/admin")).toBe(true);
    expect(needsNetworkValidatedSession("/admin/users/1")).toBe(true);
    expect(needsNetworkValidatedSession("/administrator")).toBe(false);
    expect(needsNetworkValidatedSession("/home")).toBe(false);
  });
});
