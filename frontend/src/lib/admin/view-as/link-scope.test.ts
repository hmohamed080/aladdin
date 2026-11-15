import { describe, expect, it } from "vitest";
import { ACCOUNT_VIEWS, viewAsExactBasePath, viewAsStartPath } from "./registry";
import { createLinkScope, IDENTITY_SCOPE } from "./link-scope";

const ID = "70000009-0000-4000-8000-000000000009";
const scope = createLinkScope(viewAsExactBasePath(ID));

describe("LinkScope", () => {
  it("maps every /home href into the view tree", () => {
    expect(scope.href("/home")).toBe(`/view-as/${ID}`);
    expect(scope.href("/home/points")).toBe(`/view-as/${ID}/points`);
    expect(scope.href("/home/profile#coverage")).toBe(`/view-as/${ID}/profile#coverage`);
    expect(scope.href("/home?tab=x")).toBe(`/view-as/${ID}?tab=x`);
  });

  it("leaves everything else alone (no prefix collisions, externals, hashes)", () => {
    for (const h of ["/homepage", "/homes/1", "/b2b", "https://x.test/home", "#top", "/admin/users"]) expect(scope.href(h)).toBe(h);
  });

  it("is the identity outside a view, so normal sessions are unchanged", () => {
    expect(IDENTITY_SCOPE.href("/home/points")).toBe("/home/points");
    expect(IDENTITY_SCOPE.unscope("/home/points")).toBe("/home/points");
  });

  it("unscopes the view pathname back to /home for active-link matching", () => {
    expect(scope.unscope(`/view-as/${ID}`)).toBe("/home");
    expect(scope.unscope(`/view-as/${ID}/jobs/3`)).toBe("/home/jobs/3");
    expect(scope.unscope("/elsewhere")).toBe("/elsewhere");
  });
});

describe("registry parity flag", () => {
  it("Craftsman is interim until signed off: the eye opens the interim view, not /view-as", () => {
    expect(ACCOUNT_VIEWS.craftsman.parity).toBe("interim");
    expect(viewAsStartPath(ID)).toBe(`/admin/users/${ID}/view/start`);
  });

  it("an exact kind opens the /view-as tree", () => {
    const original = ACCOUNT_VIEWS.craftsman;
    (ACCOUNT_VIEWS as Record<string, unknown>).craftsman = { ...original, parity: "exact" };
    try {
      expect(viewAsStartPath(ID, "craftsman")).toBe(`/view-as/${ID}/start`);
    } finally {
      (ACCOUNT_VIEWS as Record<string, unknown>).craftsman = original;
    }
  });
});
