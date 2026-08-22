import { describe, it, expect } from "vitest";
import { allowedNavKeys, allowedNavSections, navLabelKey, navOrder, NAV_ORDER } from "./modules";
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
      // Points is the caller's own standing, not an organization record — there
      // is no capability that could gate it.
      "points",
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

/**
 * THE SUPPLY-SIDE STANCE
 *
 * The contract these pin is that Distributor, Manufacturer and Importer get the
 * SAME navigation as a Showroom, reordered and relabelled — not a second one. So
 * the assertions are deliberately about identity (same hrefs, same gates, same
 * component) as much as about difference (order, labels).
 */
describe("seller stance", () => {
  it("leads with Supply and demotes Buying, without dropping either", () => {
    const sections = allowedNavSections(["org.manage"], "seller");
    expect(sections.map((s) => s.section)).toEqual([
      "overview",
      "supply",
      "network",
      "selling",
      "buying",
      "business",
    ]);
  });

  it("puts the commerce trio ahead of everything but Home", () => {
    const keys = allowedNavKeys(["org.manage"], "seller");
    expect(keys[0]).toBe("home");
    expect(keys.slice(1, 4)).toEqual(["purchaseRequests", "offers", "orders"]);
  });

  it("moves products into Supply for a seller and leaves it in Selling for a buyer", () => {
    const supply = allowedNavSections(["org.manage"], "seller").find((s) => s.section === "supply");
    expect(supply?.keys).toContain("products");
    const selling = allowedNavSections(["org.manage"], "buyer").find((s) => s.section === "selling");
    expect(selling?.keys).toContain("products");
  });

  it("adds the customer/showroom directory only on the seller layout", () => {
    expect(allowedNavKeys(["org.manage"], "seller")).toContain("buyers");
    expect(allowedNavKeys(["org.manage"], "buyer")).not.toContain("buyers");
  });

  it("still gates every module on the same capabilities as the buyer layout", () => {
    // A distributor's salesperson must not reach products or people-ops just
    // because the workspace reordered itself.
    const keys = allowedNavKeys(ROLE_PRESETS.sales_rep, "seller");
    expect(keys).toContain("customers");
    expect(keys).not.toContain("products");
    expect(keys).not.toContain("team");
  });

  it("exposes exactly the buyer's modules plus the customer directory", () => {
    // Proof there is no second, drifting module set: the two layouts hold the
    // same keys, in different places.
    const seller = new Set(navOrder("seller"));
    const buyer = new Set(NAV_ORDER);
    for (const k of buyer) expect(seller.has(k)).toBe(true);
    expect([...seller].filter((k) => !buyer.has(k))).toEqual(["buyers"]);
  });

  it("relabels the commerce trio without changing which module it is", () => {
    expect(navLabelKey("purchaseRequests", "seller", "nav.purchaseRequests")).toBe("nav.demand");
    expect(navLabelKey("offers", "seller", "nav.offers")).toBe("nav.quotations");
    expect(navLabelKey("orders", "seller", "nav.orders")).toBe("nav.salesOrders");
    // Anything without an override falls through untouched.
    expect(navLabelKey("settings", "seller", "nav.settings")).toBe("nav.settings");
    expect(navLabelKey("purchaseRequests", "buyer", "nav.purchaseRequests")).toBe(
      "nav.purchaseRequests",
    );
  });
});
