import { describe, expect, it } from "vitest";
import type { WorkspaceEntry } from "@/lib/workspace/model";
import {
  BUSINESS_CREATOR_PERSONAS,
  canCreateBusiness,
  decideBusinessCreation,
  showsGenericWorkspaceSwitcher,
} from "./entitlements";

const personal: WorkspaceEntry = { kind: "personal", name: "P", persona: null };
const biz = (orgType: string, relationship: "owner" | "manager" | "member"): WorkspaceEntry => ({
  kind: "business",
  organizationId: "o1",
  name: "Org",
  orgType,
  relationship,
});

describe("canCreateBusiness — an entitlement of the account type, never of a membership", () => {
  it("is true for exactly the five approved personas", () => {
    expect([...BUSINESS_CREATOR_PERSONAS].sort()).toEqual(
      ["engineer", "importer", "manufacturer", "showroom_dealer", "supplier"].sort(),
    );
    for (const persona of BUSINESS_CREATOR_PERSONAS) {
      expect(canCreateBusiness({ persona, entries: [personal] }), persona).toBe(true);
    }
  });

  it("is false for installer/craftsman, sales, personal and every other persona", () => {
    for (const persona of [
      "installer_technician",
      "sales",
      "end_consumer",
      "contractor",
      "interior_designer",
      "trainer",
      "trainee",
      "wholesaler",
      null,
    ]) {
      expect(canCreateBusiness({ persona, entries: [personal] }), String(persona)).toBe(false);
    }
  });

  it("is not granted by holding a membership as an employee or manager", () => {
    for (const relationship of ["member", "manager"] as const) {
      expect(canCreateBusiness({ persona: null, entries: [biz("showroom_dealer", relationship)] })).toBe(false);
    }
  });

  it("is granted to a business-only identity that OWNS a business of an approved type", () => {
    for (const orgType of ["showroom_dealer", "supplier", "manufacturer", "importer"]) {
      expect(canCreateBusiness({ persona: null, entries: [biz(orgType, "owner")] }), orgType).toBe(true);
    }
    expect(canCreateBusiness({ persona: null, entries: [biz("wholesaler", "owner")] })).toBe(false);
  });

  it("never lets a salesperson or craftsman create, even as owner of an approved-type org", () => {
    expect(canCreateBusiness({ persona: "sales", entries: [biz("showroom_dealer", "owner")] })).toBe(false);
    expect(canCreateBusiness({ persona: "installer_technician", entries: [biz("supplier", "owner")] })).toBe(false);
  });
});

describe("showsGenericWorkspaceSwitcher — only the approved five categories", () => {
  const show = (persona: string | null, entries: WorkspaceEntry[]) => showsGenericWorkspaceSwitcher({ persona, entries });

  it("is shown for each approved category", () => {
    for (const persona of ["showroom_dealer", "supplier", "manufacturer", "importer", "engineer"]) {
      expect(show(persona, [personal]), persona).toBe(true);
    }
  });

  it("is never shown for installer, sales, personal, contractor, trainer or trainee — even with memberships", () => {
    for (const persona of ["installer_technician", "sales", "end_consumer", "contractor", "trainer", "trainee"]) {
      expect(show(persona, [personal]), persona).toBe(false);
      expect(show(persona, [personal, biz("showroom_dealer", "member")]), `${persona} + membership`).toBe(false);
      expect(show(persona, [personal, biz("showroom_dealer", "manager")]), `${persona} + manager`).toBe(false);
    }
  });

  it("is shown to a business-only owner of an approved business type, not to its employee", () => {
    expect(show(null, [biz("showroom_dealer", "owner")])).toBe(true);
    expect(show(null, [biz("showroom_dealer", "member")])).toBe(false);
  });
});

describe("decideBusinessCreation — the /business/new gate", () => {
  const base = { persona: null as string | null, entries: [personal] as WorkspaceEntry[], openDraftId: null, registrationBusinessIntent: false };

  it("denies installer, sales, personal, contractor and trainee with no draft and no registration intent", () => {
    for (const persona of ["installer_technician", "sales", "end_consumer", "contractor", "trainee"]) {
      expect(decideBusinessCreation({ ...base, persona }).allowed, persona).toBe(false);
    }
  });

  it("denies membership alone", () => {
    expect(decideBusinessCreation({ ...base, entries: [personal, biz("showroom_dealer", "member")] }).allowed).toBe(false);
  });

  it("allows an engineer (persona authority)", () => {
    expect(decideBusinessCreation({ ...base, persona: "engineer" })).toEqual({ allowed: true, via: "entitlement" });
  });

  it("allows an eligible existing business owner to add another", () => {
    expect(decideBusinessCreation({ ...base, entries: [biz("supplier", "owner")] })).toEqual({ allowed: true, via: "entitlement" });
  });

  it("allows a first business from an approved registration choice, with no organization yet", () => {
    expect(decideBusinessCreation({ ...base, registrationBusinessIntent: true })).toEqual({ allowed: true, via: "registration" });
  });

  it("allows completing an already-open draft, whatever the persona", () => {
    expect(decideBusinessCreation({ ...base, persona: "contractor", openDraftId: "d1" })).toEqual({ allowed: true, via: "draft" });
  });
});
