import { describe, it, expect } from "vitest";
import { allowedNavKeys } from "./modules";
import { ROLE_PRESETS } from "@/lib/org/roles";

/**
 * Capability-aware navigation is the spine of the role-differentiated Pilot
 * experience, so its visibility rules are pinned here.
 */
describe("allowedNavKeys", () => {
  it("always shows Home to any member", () => {
    expect(allowedNavKeys([])).toEqual(["home"]);
  });

  it("shows a branch salesperson the CRM but not products or people-ops", () => {
    const keys = allowedNavKeys(ROLE_PRESETS.sales_rep);
    expect(keys).toContain("customers");
    expect(keys).toContain("leads");
    expect(keys).toContain("followUps");
    expect(keys).not.toContain("products");
    expect(keys).not.toContain("organization");
  });

  it("shows a catalog manager products but not the sales CRM", () => {
    const keys = allowedNavKeys(ROLE_PRESETS.catalog_manager);
    expect(keys).toContain("products");
    expect(keys).toContain("catalog");
    expect(keys).not.toContain("customers");
  });

  it("treats org.manage as a blanket in-org unlock", () => {
    const keys = allowedNavKeys(["org.manage"]);
    for (const k of ["customers", "products", "rfqs", "quotations", "orders", "projects", "organization"]) {
      expect(keys).toContain(k);
    }
  });

  it("gates people-ops behind org.members.manage", () => {
    expect(allowedNavKeys(["sales.read"])).not.toContain("organization");
    expect(allowedNavKeys(["org.members.manage"])).toContain("organization");
  });

  it("preserves canonical ordering", () => {
    const keys = allowedNavKeys(["org.manage"]);
    expect(keys[0]).toBe("home");
    expect(keys.indexOf("customers")).toBeLessThan(keys.indexOf("products"));
  });
});
