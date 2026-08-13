import { describe, expect, it } from "vitest";
import {
  PERSONAL_CONTEXT,
  landingFor,
  resolveActiveBusinessId,
  resolveWorkContext,
  type WorkspaceEntry,
} from "./model";

/**
 * The work-context rules, pinned in isolation. These decide what a person sees
 * after switching, and — because a stale cookie is the normal case after a
 * membership is revoked — what happens when the selection is no longer valid.
 */
const personal: WorkspaceEntry = { kind: "personal", name: "Ahmed Hassan", persona: "engineer" };
const orgA: WorkspaceEntry = {
  kind: "business",
  organizationId: "A",
  name: "AH Design Studio",
  orgType: "showroom_dealer",
  relationship: "owner",
};
const orgB: WorkspaceEntry = {
  kind: "business",
  organizationId: "B",
  name: "AH Import",
  orgType: "importer",
  relationship: "owner",
};

describe("resolveWorkContext", () => {
  it("honors an explicit personal selection", () => {
    expect(resolveWorkContext([personal, orgA], PERSONAL_CONTEXT)).toEqual({ kind: "personal" });
  });

  it("honors an explicit business selection", () => {
    expect(resolveWorkContext([personal, orgA, orgB], "B")).toEqual({
      kind: "business",
      organizationId: "B",
    });
  });

  it("ignores a selection the caller does not have and prefers Personal", () => {
    // A forged or stale org id must never widen access — it resolves to the
    // caller's own contexts only.
    expect(resolveWorkContext([personal, orgA], "SOMEONE-ELSES-ORG")).toEqual({ kind: "personal" });
  });

  it("falls back to a valid business when a revoked membership was selected", () => {
    expect(resolveWorkContext([orgB], "A")).toEqual({ kind: "business", organizationId: "B" });
  });

  it("never invents a Personal context for a business-only identity", () => {
    // The cookie explicitly asks for Personal, but there is no personal persona.
    expect(resolveWorkContext([orgA], PERSONAL_CONTEXT)).toEqual({
      kind: "business",
      organizationId: "A",
    });
  });

  it("returns null when there is no usable workspace at all", () => {
    expect(resolveWorkContext([], "A")).toBeNull();
  });
});

describe("landingFor", () => {
  it("puts platform staff in /admin regardless of context", () => {
    expect(landingFor({ kind: "business", organizationId: "A" }, true)).toBe("/admin");
    expect(landingFor(null, true)).toBe("/admin");
  });

  it("maps business context to /b2b and personal to /home", () => {
    expect(landingFor({ kind: "business", organizationId: "A" }, false)).toBe("/b2b");
    expect(landingFor({ kind: "personal" }, false)).toBe("/home");
  });

  it("uses /home as the account-safe fallback with no context", () => {
    expect(landingFor(null, false)).toBe("/home");
  });
});

describe("resolveActiveBusinessId", () => {
  it("keeps a B2B route on the selected business", () => {
    expect(resolveActiveBusinessId([personal, orgA, orgB], "B")).toBe("B");
  });

  it("falls through to a valid business when Personal is selected", () => {
    // Following a B2B link while in Personal context should show a business, not
    // bounce — the selection is a preference, not a permission.
    expect(resolveActiveBusinessId([personal, orgA], PERSONAL_CONTEXT)).toBe("A");
  });

  it("returns null when the caller has no active membership", () => {
    expect(resolveActiveBusinessId([personal], "A")).toBeNull();
  });
});
