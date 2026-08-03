import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

import { canWrite, canAssign, hasCap, type OrgContext } from "./context";
import { resolveTheme } from "@/lib/theme/config";

function ctx(caps: string[], canManageSales = false): OrgContext {
  return {
    organizationId: "org",
    organizationName: "Org",
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

describe("resolveTheme", () => {
  it("defaults to light, honors dark", () => {
    expect(resolveTheme(undefined)).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
    expect(resolveTheme("nonsense")).toBe("light");
  });
});
