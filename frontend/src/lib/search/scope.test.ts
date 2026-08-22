import { describe, expect, it } from "vitest";
import { searchableGroups, canSearchGroup, SEARCH_GROUP_ORDER, MIN_QUERY_LENGTH } from "./scope";
import { allowedNavKeys } from "@/lib/nav/modules";

/**
 * The palette's gate is the one place a permission mistake would show up as
 * "extra rows in a list" rather than as a broken page, so it is tested on its
 * own rather than only through the action that calls it.
 */
describe("global search scope", () => {
  it("gives a member with no capabilities nothing but the public directory", () => {
    const groups = searchableGroups([]);
    expect([...groups]).toEqual(["organizations"]);
  });

  it("treats org.manage as the same blanket unlock the navigation does", () => {
    const groups = searchableGroups(["org.manage"]);
    expect([...groups].sort()).toEqual([...SEARCH_GROUP_ORDER].sort());
  });

  it("opens a group from ANY one of its capabilities, not all of them", () => {
    expect(canSearchGroup(["quote.submit"], "rfqs")).toBe(true);
    expect(canSearchGroup(["quote.submit"], "quotations")).toBe(true);
    // Selling capability does not reach the sales pipeline — different module.
    expect(canSearchGroup(["quote.submit"], "customers")).toBe(false);
    expect(canSearchGroup(["quote.submit"], "leads")).toBe(false);
  });

  it("does not let a sales seat search the catalogue it cannot manage", () => {
    const caps = ["sales.read", "sales.write"];
    expect(canSearchGroup(caps, "customers")).toBe(true);
    expect(canSearchGroup(caps, "leads")).toBe(true);
    // No catalogue rights: neither the org's own shelf nor the published one.
    expect(canSearchGroup(caps, "products")).toBe(false);
    expect(canSearchGroup(caps, "catalog")).toBe(false);
  });

  it("never opens a record group whose module the sidebar would hide", () => {
    // The invariant that matters: search must not become a back door into a
    // module the caller has no navigation entry for. Checked against the real
    // navigation gate rather than against a copy of it.
    const cases: { caps: string[]; group: (typeof SEARCH_GROUP_ORDER)[number]; navKey: string }[] = [
      { caps: ["catalog.write"], group: "products", navKey: "products" },
      { caps: ["sales.read"], group: "customers", navKey: "customers" },
      { caps: ["sales.read"], group: "leads", navKey: "leads" },
      { caps: ["order.manage"], group: "orders", navKey: "orders" },
      { caps: ["project.read"], group: "projects", navKey: "projects" },
      { caps: ["rfq.respond"], group: "rfqs", navKey: "purchaseRequests" },
    ];
    for (const { caps, group, navKey } of cases) {
      const reachable = allowedNavKeys(caps).includes(navKey as never) ||
        allowedNavKeys(caps, "seller").includes(navKey as never);
      expect(canSearchGroup(caps, group), `${group} vs nav ${navKey}`).toBe(reachable);
    }
  });

  it("keeps a minimum query length, so one keystroke cannot fan out", () => {
    expect(MIN_QUERY_LENGTH).toBeGreaterThanOrEqual(2);
  });
});
