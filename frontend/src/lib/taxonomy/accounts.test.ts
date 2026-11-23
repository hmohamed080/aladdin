import { describe, expect, it } from "vitest";
import { ar } from "@/lib/i18n/messages/ar";
import { en } from "@/lib/i18n/messages/en";
import { ACCOUNT_TYPE_CHOICES, BUSINESS_ORG_TYPES, REGISTRATION_CHOICE_ORDER } from "@/lib/onboarding/account-types";
import {
  ACCOUNT_BY_ID,
  PRODUCT_AUDIENCE_CODES,
  PUBLIC_ACCOUNTS,
  PUBLIC_ACCOUNT_IDS,
  accountForOrgType,
  accountForPersona,
  audienceFor,
  isSubtypeOf,
} from "./accounts";

const RETIRED = ["interior_designer", "wholesaler", "trainer", "trainee"];

describe("the canonical account taxonomy", () => {
  it("has exactly the nine approved public accounts", () => {
    expect(PUBLIC_ACCOUNT_IDS).toEqual(["showroom", "supplier", "manufacturer", "importer", "contractor", "engineer", "craftsman", "sales_team", "personal"]);
    expect(PUBLIC_ACCOUNTS).toHaveLength(9);
  });

  it("carries exactly the approved subtypes", () => {
    expect(ACCOUNT_BY_ID.showroom.subtypes).toHaveLength(4);
    expect(ACCOUNT_BY_ID.supplier.subtypes).toEqual(["distributor", "wholesaler"]);
    expect(ACCOUNT_BY_ID.manufacturer.subtypes).toEqual(["paint_manufacturer", "decor_manufacturer"]);
    expect(ACCOUNT_BY_ID.importer.subtypes).toEqual(["decor_supplies_importer", "paint_importer"]);
    expect(ACCOUNT_BY_ID.engineer.subtypes).toEqual(["finishing"]);
    for (const id of ["contractor", "craftsman", "personal", "sales_team"] as const) expect(ACCOUNT_BY_ID[id].subtypes).toEqual([]);
    expect(ACCOUNT_BY_ID.sales_team.staffRoles).toEqual(["sales_rep", "sales_manager"]);
  });

  it("allows wholesaler only under Supplier, and never crosses accounts", () => {
    for (const id of PUBLIC_ACCOUNT_IDS) expect(isSubtypeOf(id, "wholesaler")).toBe(id === "supplier");
    expect(isSubtypeOf("showroom", "distributor")).toBe(false);
    expect(isSubtypeOf("supplier", "paint_importer")).toBe(false);
    expect(isSubtypeOf("engineer", "paint_manufacturer")).toBe(false);
    const all = PUBLIC_ACCOUNTS.flatMap((a) => a.subtypes);
    expect(new Set(all).size).toBe(all.length);
  });

  it("never names a retired value", () => {
    const text = JSON.stringify(PUBLIC_ACCOUNTS);
    for (const r of RETIRED.filter((x) => x !== "wholesaler")) expect(text).not.toContain(r);
    expect(PUBLIC_ACCOUNTS.map((a) => a.orgType)).not.toContain("wholesaler");
  });

  it("maps every account to one of the eight audiences, except Sales Team", () => {
    expect(PRODUCT_AUDIENCE_CODES).toHaveLength(8);
    for (const a of PUBLIC_ACCOUNTS) {
      if (a.id === "sales_team") expect(a.audience).toBeNull();
      else expect(PRODUCT_AUDIENCE_CODES).toContain(a.audience);
    }
    expect(new Set(PUBLIC_ACCOUNTS.map((a) => a.audience).filter(Boolean)).size).toBe(8);
  });

  it("derives the audience from the active workspace first; Sales Team inherits it", () => {
    expect(audienceFor("showroom_dealer", "sales")).toBe("showroom_dealer");
    expect(audienceFor("supplier", "sales")).toBe("supplier");
    expect(audienceFor(null, "sales")).toBeNull();
    expect(audienceFor(null, "engineer")).toBe("engineer");
    expect(audienceFor("design_office", null)).toBe("engineer");
    expect(audienceFor("contractor_company", null)).toBe("contractor");
    expect(audienceFor(null, "interior_designer")).toBeNull();
  });

  it("resolves internal identifiers to their public account", () => {
    expect(accountForOrgType("contractor_company")?.id).toBe("contractor");
    expect(accountForOrgType("design_office")?.id).toBe("engineer");
    expect(accountForPersona("installer_technician")?.id).toBe("craftsman");
    expect(accountForPersona("trainer")).toBeNull();
  });
});

describe("registration and labels follow the canonical taxonomy", () => {
  it("offers the nine accounts in the canonical order, with no retired choice", () => {
    expect(REGISTRATION_CHOICE_ORDER).toHaveLength(9);
    const open = ACCOUNT_TYPE_CHOICES.filter((c) => !c.transitional);
    expect(open.map((c) => c.key).sort()).toEqual([...REGISTRATION_CHOICE_ORDER].sort());
    for (const c of ACCOUNT_TYPE_CHOICES) expect(RETIRED).not.toContain(c.key);
    for (const c of ACCOUNT_TYPE_CHOICES) expect(RETIRED).not.toContain(String(c.accountType));
  });

  it("shows available registration choices first and Coming Soon choices last", () => {
    expect(REGISTRATION_CHOICE_ORDER).toEqual([
      "showroom_dealer", "supplier", "manufacturer", "importer",
      "installer_technician", "salesperson",
      "contractor", "engineer", "end_consumer",
    ]);
    const choicesByKey = new Map(ACCOUNT_TYPE_CHOICES.map((choice) => [choice.key, choice]));
    const firstComingSoon = REGISTRATION_CHOICE_ORDER.findIndex((key) => choicesByKey.get(key)?.comingSoon);
    expect(firstComingSoon).toBe(6);
    expect(REGISTRATION_CHOICE_ORDER.slice(0, firstComingSoon).every((key) => !choicesByKey.get(key)?.comingSoon)).toBe(true);
    expect(REGISTRATION_CHOICE_ORDER.slice(firstComingSoon).every((key) => choicesByKey.get(key)?.comingSoon)).toBe(true);
  });

  it("registers businesses only as the four public types plus the Engineer business", () => {
    expect([...BUSINESS_ORG_TYPES]).toEqual(["showroom_dealer", "supplier", "manufacturer", "importer", "design_office"]);
    expect(BUSINESS_ORG_TYPES as readonly string[]).not.toContain("contractor_company");
  });

  it("labels each account identically wherever it is named, in both languages", () => {
    const canonical = {
      showroom_dealer: ["Showroom", "المعرض"],
      supplier: ["Supplier", "المورد"],
      manufacturer: ["Manufacturer", "المصنع"],
      importer: ["Importer", "المستورد"],
      contractor: ["Contractor", "المقاول"],
      engineer: ["Engineer", "المهندس"],
      sales: ["Sales Team", "فريق المبيعات"],
      end_consumer: ["Personal Account", "حساب شخصي"],
    } as const;
    for (const [key, [e, a]] of Object.entries(canonical)) {
      expect((en.accountType as Record<string, string>)[key]).toBe(e);
      expect((ar.accountType as Record<string, string>)[key]).toBe(a);
    }
    for (const [key, [e, a]] of [["showroom_dealer", ["Showroom", "المعرض"]], ["supplier", ["Supplier", "المورد"]], ["manufacturer", ["Manufacturer", "المصنع"]], ["importer", ["Importer", "المستورد"]], ["contractor_company", ["Contractor", "المقاول"]], ["design_office", ["Engineer", "المهندس"]]] as const) {
      expect((en.orgType as Record<string, string>)[key]).toBe(e);
      expect((ar.orgType as Record<string, string>)[key]).toBe(a);
      expect((en.directory.orgType as Record<string, string>)[key]).toBe(e);
      expect((ar.directory.orgType as Record<string, string>)[key]).toBe(a);
    }
  });

  it("holds no label for a retired account", () => {
    for (const dict of [en, ar]) {
      for (const map of [dict.orgType, dict.accountType, dict.directory.orgType, dict.directory.persona] as Record<string, string>[]) {
        for (const r of RETIRED) expect(Object.keys(map)).not.toContain(r);
      }
    }
  });
});
