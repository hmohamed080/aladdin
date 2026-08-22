import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

import {
  canWrite,
  canAssign,
  hasCap,
  resolveActiveOrg,
  resolveActiveBranch,
  type OrgContext,
} from "./context";
import { resolveTheme } from "@/lib/theme/config";

function ctx(caps: string[], canManageSales = false): OrgContext {
  return {
    organizationId: "org",
    organizationName: "Org",
    orgType: "showroom_dealer",
    membershipId: "mem",
    capabilities: caps,
    canManageSales,
    branches: [],
    activeBranchId: null,
  };
}

describe("sales capability gates (mirror the DB authority; UI hides, RLS enforces)", () => {
  it("sales.write grants write but not assign", () => {
    const c = ctx(["sales.read", "sales.write"]);
    expect(canWrite(c)).toBe(true);
    expect(canAssign(c)).toBe(false);
  });

  it("sales.assign grants assign", () => {
    expect(canAssign(ctx(["sales.assign"]))).toBe(true);
  });

  it("sales.manage / org.manage grant everything (org-wide authority)", () => {
    const manager = ctx(["sales.manage"], true);
    expect(canWrite(manager)).toBe(true);
    expect(canAssign(manager)).toBe(true);
  });

  it("a read-only member can neither write nor assign", () => {
    const reader = ctx(["sales.read"]);
    expect(canWrite(reader)).toBe(false);
    expect(canAssign(reader)).toBe(false);
    expect(hasCap(reader, "sales.read")).toBe(true);
  });
});

describe("resolveActiveOrg (a forged/stale org cookie grants nothing)", () => {
  const orgs = [{ id: "a" }, { id: "b" }];
  it("honors a cookie that names an org the caller belongs to", () => {
    expect(resolveActiveOrg(orgs, "b")?.id).toBe("b");
  });
  it("falls back to the first org for a forged/unknown cookie", () => {
    expect(resolveActiveOrg(orgs, "zzz")?.id).toBe("a");
    expect(resolveActiveOrg(orgs, undefined)?.id).toBe("a");
  });
  it("returns null when the caller has no orgs", () => {
    expect(resolveActiveOrg([], "a")).toBeNull();
  });
});

describe("resolveActiveBranch (UI value must match data scope)", () => {
  it("auto-selects the only assigned branch (cookie irrelevant)", () => {
    expect(resolveActiveBranch([{ id: "b1" }], undefined)).toBe("b1");
    expect(resolveActiveBranch([{ id: "b1" }], "forged")).toBe("b1");
  });
  it("honors an in-scope cookie when multiple branches exist", () => {
    expect(resolveActiveBranch([{ id: "b1" }, { id: "b2" }], "b2")).toBe("b2");
  });
  it("treats a forged/removed branch cookie as full scope (null), never out-of-scope", () => {
    expect(resolveActiveBranch([{ id: "b1" }, { id: "b2" }], "evil")).toBeNull();
    expect(resolveActiveBranch([{ id: "b1" }, { id: "b2" }], undefined)).toBeNull();
  });
  it("returns null when there are no branches (whole org)", () => {
    expect(resolveActiveBranch([], "anything")).toBeNull();
  });
});

describe("resolveTheme", () => {
  it("defaults to light, honors dark", () => {
    expect(resolveTheme(undefined)).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
    expect(resolveTheme("nonsense")).toBe("light");
  });
});
