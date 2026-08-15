import { describe, it, expect } from "vitest";
import { allowedNavKeys, allowedNavSections, NAV_ORDER } from "./modules";
import { ROLE_PRESETS } from "@/lib/org/roles";

/**
 * Capability-aware navigation is the spine of the role-differentiated Pilot
 * experience, so its visibility rules are pinned here.
 *
 * Sprint 14 regrouped the rail and renamed three keys to match what the modules
 * actually are (`rfqs` → `purchaseRequests`, `quotations` → `offers`,
 * `organization` → `team`). The rules below are the contract, not the labels.
 */
describe("allowedNavKeys", () => {
  it("gives a member with no capabilities Home, the directories, and Settings", () => {
    // Directories are read-only public information and Settings is the caller's
    // own workspace, so neither can dead-end. Everything else must be earned.
    expect(allowedNavKeys([])).toEqual([
      "home",
      "suppliers",
      "technicians",
      "institutions",
      "settings",
    ]);
  });

  it("shows a branch salesperson the CRM but not products or people-ops", () => {
    const keys = allowedNavKeys(ROLE_PRESETS.sales_rep);
    expect(keys).toContain("customers");
    expect(keys).toContain("leads");
    expect(keys).toContain("followUps");
    expect(keys).not.toContain("products");
    expect(keys).not.toContain("team");
  });

  it("shows a catalog manager products but not the sales CRM", () => {
    const keys = allowedNavKeys(ROLE_PRESETS.catalog_manager);
    expect(keys).toContain("products");
    expect(keys).toContain("catalog");
    expect(keys).not.toContain("customers");
  });

  it("gives a buyer the purchasing modules and the shortlist", () => {
    const keys = allowedNavKeys(ROLE_PRESETS.buyer);
    expect(keys).toContain("purchaseRequests");
    expect(keys).toContain("offers");
    expect(keys).toContain("catalog");
    expect(keys).toContain("saved");
  });

  it("treats org.manage as a blanket in-org unlock", () => {
    expect(allowedNavKeys(["org.manage"])).toEqual(NAV_ORDER);
  });

  it("gates people-ops behind org.members.manage", () => {
    expect(allowedNavKeys(["sales.read"])).not.toContain("team");
    expect(allowedNavKeys(["org.members.manage"])).toContain("team");
  });

  it("preserves canonical ordering, buying before selling", () => {
    const keys = allowedNavKeys(["org.manage"]);
    expect(keys[0]).toBe("home");
    expect(keys.indexOf("purchaseRequests")).toBeLessThan(keys.indexOf("customers"));
    expect(keys.indexOf("customers")).toBeLessThan(keys.indexOf("products"));
  });
});

describe("allowedNavSections", () => {
  it("drops a section with no reachable module rather than rendering an empty heading", () => {
    const sections = allowedNavSections([]);
    expect(sections.map((s) => s.section)).toEqual(["overview", "network", "business"]);
    expect(sections.every((s) => s.keys.length > 0)).toBe(true);
  });

  it("returns every section for a full-access member, in canonical order", () => {
    const sections = allowedNavSections(["org.manage"]);
    expect(sections.map((s) => s.section)).toEqual([
      "overview",
      "buying",
      "network",
      "selling",
      "business",
    ]);
    expect(sections.flatMap((s) => s.keys)).toEqual(NAV_ORDER);
  });

  it("gives a salesperson a Selling section and no Buying section", () => {
    const sections = allowedNavSections(ROLE_PRESETS.sales_rep);
    const names = sections.map((s) => s.section);
    expect(names).toContain("selling");
    expect(names).not.toContain("buying");
  });
});
