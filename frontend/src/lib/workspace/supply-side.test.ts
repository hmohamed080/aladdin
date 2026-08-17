import { describe, expect, it } from "vitest";
import {
  SUPPLY_SIDE_ORG_TYPES,
  commerceStance,
  defaultCommerceSide,
  isSupplySide,
  supplyVoice,
} from "./supply-side";

describe("isSupplySide", () => {
  it("recognises every supply-side org_type", () => {
    for (const t of SUPPLY_SIDE_ORG_TYPES) expect(isSupplySide(t)).toBe(true);
  });

  it("rejects the demand-side and partner org types", () => {
    for (const t of ["showroom_dealer", "contractor_company", "design_office"]) {
      expect(isSupplySide(t)).toBe(false);
    }
  });

  it("treats an unclassified organization as not supply-side", () => {
    expect(isSupplySide(null)).toBe(false);
    expect(isSupplySide(undefined)).toBe(false);
    expect(isSupplySide("")).toBe(false);
  });

  it("does not accept a persona value that merely sounds like a business", () => {
    // Personas live on users.primary_account_type and are a different taxonomy;
    // a business classification must never be inferred from one.
    expect(isSupplySide("sales")).toBe(false);
    expect(isSupplySide("engineer")).toBe(false);
  });
});

describe("commerceStance", () => {
  it("puts the supply-side family in the seller seat", () => {
    expect(commerceStance("supplier")).toBe("seller");
    expect(commerceStance("manufacturer")).toBe("seller");
    expect(commerceStance("importer")).toBe("seller");
    expect(commerceStance("wholesaler")).toBe("seller");
  });

  it("leaves the showroom and its peers in the buyer seat", () => {
    expect(commerceStance("showroom_dealer")).toBe("buyer");
    expect(commerceStance("contractor_company")).toBe("buyer");
    expect(commerceStance("design_office")).toBe("buyer");
  });

  it("degrades an unknown or missing type to the buyer surface", () => {
    // Buyer is the long-standing default surface; an unrecognised type must land
    // somewhere complete rather than on a half-populated seller view.
    expect(commerceStance(null)).toBe("buyer");
    expect(commerceStance("something_new")).toBe("buyer");
  });
});

describe("defaultCommerceSide", () => {
  it("maps a stance onto the query layer's own vocabulary", () => {
    expect(defaultCommerceSide("seller")).toBe("supplier");
    expect(defaultCommerceSide("buyer")).toBe("requester");
  });
});

describe("supplyVoice", () => {
  it("gives manufacturer and importer their own approved terminology", () => {
    expect(supplyVoice("manufacturer")).toBe("manufacturer");
    expect(supplyVoice("importer")).toBe("importer");
  });

  it("uses the distributor voice for supplier and wholesaler", () => {
    // `supplier` is the internal identifier for the Distributor product concept,
    // and a wholesaler is the same reseller-supply relationship.
    expect(supplyVoice("supplier")).toBe("distributor");
    expect(supplyVoice("wholesaler")).toBe("distributor");
  });

  it("falls back to the distributor voice rather than throwing", () => {
    expect(supplyVoice(null)).toBe("distributor");
    expect(supplyVoice("showroom_dealer")).toBe("distributor");
  });
});
