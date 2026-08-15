import { describe, it, expect } from "vitest";
import { capabilityGroups, ROLE_PRESETS, ROLE_PRESET_ORDER } from "@/lib/org/roles";
import { en } from "@/lib/i18n/messages/en";
import { ar } from "@/lib/i18n/messages/ar";

/**
 * The client must never render a raw capability key.
 *
 * These tests guard the DISPLAY mapping only — authorization lives in the RPCs and
 * is not what is being asserted here. What is being asserted is that every key the
 * product can actually assign has a human, translated label behind it, so a new
 * capability cannot quietly reach the Team screen as `sales.opportunity.read`.
 */
describe("capabilityGroups", () => {
  it("collapses the blanket org.manage unlock to a single group", () => {
    expect(capabilityGroups(["org.manage", "sales.read", "catalog.write"])).toEqual(["manage"]);
  });

  it("maps a preset to the work it unlocks, not to its keys", () => {
    expect(capabilityGroups(ROLE_PRESETS.buyer)).toEqual(["buying", "catalog"]);
    expect(capabilityGroups(ROLE_PRESETS.sales_rep)).toEqual(["sales"]);
    expect(capabilityGroups(ROLE_PRESETS.members_manager)).toEqual(["people"]);
  });

  it("returns groups in canonical order regardless of input order", () => {
    const forwards = capabilityGroups(["project.read", "branch.manage", "rfq.create"]);
    const backwards = capabilityGroups(["rfq.create", "branch.manage", "project.read"]);
    expect(forwards).toEqual(backwards);
    expect(forwards).toEqual(["branches", "buying", "projects"]);
  });

  it("de-duplicates keys that share a group", () => {
    expect(capabilityGroups(["catalog.read", "catalog.write", "catalog.publish"])).toEqual(["catalog"]);
  });

  it("covers every fine-grained sales capability the sales module defines", () => {
    for (const key of ["sales.read", "sales.write", "sales.assign", "sales.manage", "sales.opportunity.read", "sales.task.write", "sales.followup.send"]) {
      expect(capabilityGroups([key]), key).toEqual(["sales"]);
    }
  });

  it("drops an unrecognised key rather than leaking it to the UI", () => {
    expect(capabilityGroups(["totally.new.capability"])).toEqual([]);
  });

  it("gives every group a label in both locales", () => {
    const groups = new Set(ROLE_PRESET_ORDER.flatMap((p) => capabilityGroups(ROLE_PRESETS[p])));
    groups.add("manage");
    groups.add("verification");
    for (const g of groups) {
      expect(en.org.capabilityGroup[g], `en ${g}`).toBeTruthy();
      expect(ar.org.capabilityGroup[g], `ar ${g}`).toBeTruthy();
    }
  });

  it("never produces a label that looks like a capability key", () => {
    const labels = Object.values(en.org.capabilityGroup);
    expect(labels.filter((l) => /^[a-z]+\.[a-z.]+$/.test(l))).toEqual([]);
  });
});
