import { describe, expect, it } from "vitest";
import { accountTypeLabel } from "./account-type-label";
import { createTranslator, getMessages } from "./translate";

const LEGACY = ["فني / مركّب", "فني / صنايعي", "فنّي تركيب", "Installer / Technician", "Tradespeople & Technicians"];

describe("accountTypeLabel — approved account-type taxonomy", () => {
  const ar = createTranslator("ar");
  const en = createTranslator("en");

  it("names the installer CATEGORY الصنايعية / Craftsmen", () => {
    expect(accountTypeLabel(ar, "installer_technician")).toBe("الصنايعية");
    expect(accountTypeLabel(en, "installer_technician")).toBe("Craftsmen");
  });

  it("describes ONE person with the singular صنايعي / Craftsman", () => {
    expect(accountTypeLabel(ar, "installer_technician", "person")).toBe("صنايعي");
    expect(accountTypeLabel(en, "installer_technician", "person")).toBe("Craftsman");
  });

  it("uses the approved Arabic and English CATEGORY labels", () => {
    const expected: Record<string, [string, string]> = {
      showroom_dealer: ["المعرض", "Showroom"],
      supplier: ["المورد", "Supplier"],
      manufacturer: ["المصنع", "Manufacturer"],
      importer: ["المستورد", "Importer"],
      contractor: ["المقاول", "Contractor"],
      engineer: ["المهندس", "Engineer"],
      installer_technician: ["الصنايعية", "Craftsmen"],
      sales: ["فريق المبيعات", "Sales Team"],
      end_consumer: ["حساب شخصي", "Personal Account"],
    };
    for (const [type, [arLabel, enLabel]] of Object.entries(expected)) {
      expect(accountTypeLabel(ar, type), type).toBe(arLabel);
      expect(accountTypeLabel(en, type), type).toBe(enLabel);
    }
  });

  it("uses the person form for one person, and the safe category label where no authoritative role exists", () => {
    expect(accountTypeLabel(ar, "engineer", "person")).toBe("مهندس");
    expect(accountTypeLabel(en, "engineer", "person")).toBe("Engineer");
    // Salesperson vs Sales Manager is not knowable here — never invented.
    expect(accountTypeLabel(ar, "sales", "person")).toBe("فريق المبيعات");
    expect(accountTypeLabel(en, "sales", "person")).toBe("Sales Team");
    expect(accountTypeLabel(en, "showroom_dealer", "person")).toBe("Showroom");
  });

  it("never leaks a raw catalog key", () => {
    expect(accountTypeLabel(en, "installer_technician", "person")).not.toContain("accountType");
  });

  it("no catalog still carries a legacy installer label", () => {
    for (const locale of ["ar", "en"] as const) {
      const blob = JSON.stringify(getMessages(locale));
      for (const legacy of LEGACY) expect(blob, `${locale}: ${legacy}`).not.toContain(legacy);
    }
  });
});
