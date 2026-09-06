import { describe, expect, it } from "vitest";
import { buildNetworkRows, filterNetworkRows, countNetworkRows, countReferralStats } from "./rows";
import type { NetworkOrganization } from "@/server/queries/network";
import type { NetworkReferral } from "@/server/queries/network-referrals";

/**
 * The one merge every Network tab reads from (§1/§9 of the increment brief).
 * The property that matters most: completed work and a referral are two real
 * facts that may coexist on one organization, and neither is ever invented
 * from the other.
 */
function org(over: Partial<NetworkOrganization> = {}): NetworkOrganization {
  return {
    orgId: "org-a",
    orgName: "Horizon Contracting",
    completedCount: 1,
    firstCompletedAt: "2026-06-01T00:00:00Z",
    lastCompletedAt: "2026-06-01T00:00:00Z",
    tradeKeys: ["marble_granite"],
    latestJobTitle: "Marble foyer restoration",
    latestAssignmentId: "assignment-1",
    reviewCount: 0,
    ...over,
  };
}

function referral(over: Partial<NetworkReferral> = {}): NetworkReferral {
  return {
    id: "ref-1",
    origin: "known_organization",
    organizationId: "org-a",
    organizationName: "Horizon Contracting",
    displayName: null,
    governorate: null,
    city: null,
    phone: null,
    note: null,
    status: "joined",
    decisionReason: null,
    createdAt: "2026-06-01T00:00:00Z",
    decidedAt: "2026-06-01T00:00:00Z",
    ...over,
  };
}

describe("buildNetworkRows", () => {
  it("returns nothing for an empty network", () => {
    expect(buildNetworkRows([], [])).toEqual([]);
  });

  it("shows a completed-work organization with no referral", () => {
    const rows = buildNetworkRows([org()], []);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "organization", orgId: "org-a", completedWork: expect.anything(), referral: null });
  });

  it("shows a joined referral with no completed work as its own organization row", () => {
    const rows = buildNetworkRows([], [referral()]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "organization", orgId: "org-a", completedWork: null, referral: expect.anything() });
  });

  it("MERGES a completed-work organization and a joined referral into ONE row — never two", () => {
    const rows = buildNetworkRows([org({ orgId: "org-a" })], [referral({ organizationId: "org-a" })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "organization", completedWork: expect.anything(), referral: expect.anything() });
  });

  it("keeps two DIFFERENT organizations as two separate rows", () => {
    const rows = buildNetworkRows(
      [org({ orgId: "org-a" })],
      [referral({ organizationId: "org-b", organizationName: "Nile Finishing Supplies" })],
    );
    expect(rows).toHaveLength(2);
  });

  it("a PENDING referral is never an organization row", () => {
    const rows = buildNetworkRows([], [
      referral({ id: "ref-2", origin: "new_showroom", status: "pending", organizationId: null,
        organizationName: null, displayName: "Al Amal Marble Workshop" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("pending_referral");
  });

  it("a CANCELLED referral contributes nothing at all", () => {
    const rows = buildNetworkRows([], [
      referral({ id: "ref-3", status: "cancelled", organizationId: null, organizationName: null,
        displayName: "Withdrawn Candidate" }),
    ]);
    expect(rows).toHaveLength(0);
  });

  it("orders the richest relationships first: worked-with-and-referred, then worked-with, then referred, then pending", () => {
    const rows = buildNetworkRows(
      [org({ orgId: "both", orgName: "Both" }), org({ orgId: "work-only", orgName: "Work Only" })],
      [
        referral({ id: "r1", organizationId: "both", organizationName: "Both" }),
        referral({ id: "r2", organizationId: "ref-only", organizationName: "Ref Only" }),
        referral({ id: "r3", origin: "new_showroom", status: "pending", organizationId: null,
          organizationName: null, displayName: "Pending One" }),
      ],
    );
    expect(rows.map((r) => (r.kind === "organization" ? r.orgId : "pending"))).toEqual([
      "both", "work-only", "ref-only", "pending",
    ]);
  });
});

describe("filterNetworkRows / countNetworkRows", () => {
  const rows = buildNetworkRows(
    [org({ orgId: "both" }), org({ orgId: "work-only", orgName: "Work Only" })],
    [
      referral({ id: "r1", organizationId: "both" }),
      referral({ id: "r2", organizationId: "ref-only", organizationName: "Ref Only" }),
      referral({ id: "r3", origin: "new_showroom", status: "pending", organizationId: null,
        organizationName: null, displayName: "Pending One" }),
    ],
  );

  it("counts every tab from the SAME merged rows", () => {
    expect(countNetworkRows(rows)).toEqual({ all: 4, workedWith: 2, referred: 2, pending: 1 });
  });

  it("'worked_with' includes an organization with a coexisting referral", () => {
    const kept = filterNetworkRows(rows, "worked_with");
    expect(kept.map((r) => (r.kind === "organization" ? r.orgId : null))).toEqual(
      expect.arrayContaining(["both", "work-only"]),
    );
  });

  it("'referred' includes an organization with a coexisting completed-work relationship", () => {
    const kept = filterNetworkRows(rows, "referred");
    expect(kept.map((r) => (r.kind === "organization" ? r.orgId : null))).toEqual(
      expect.arrayContaining(["both", "ref-only"]),
    );
  });

  it("'pending' shows only pending referrals, never an organization row", () => {
    const kept = filterNetworkRows(rows, "pending");
    expect(kept).toHaveLength(1);
    expect(kept[0]?.kind).toBe("pending_referral");
  });

  it("'all' returns every row unfiltered", () => {
    expect(filterNetworkRows(rows, "all")).toHaveLength(4);
  });
});

describe("countReferralStats", () => {
  it("returns zero for no referrals at all", () => {
    expect(countReferralStats([])).toEqual({ referredOrgsCount: 0, showroomsAddedCount: 0 });
  });

  it("counts JOINED referrals as organizations, regardless of origin", () => {
    const stats = countReferralStats([
      referral({ id: "r1", origin: "known_organization", status: "joined" }),
      referral({ id: "r2", origin: "new_showroom", status: "joined", organizationId: "org-b", organizationName: "B" }),
    ]);
    expect(stats.referredOrgsCount).toBe(2);
  });

  it("does not count a pending or cancelled referral as a joined organization", () => {
    const stats = countReferralStats([
      referral({ id: "r1", status: "pending", organizationId: null, organizationName: null, displayName: "Pending One" }),
      referral({ id: "r2", status: "cancelled", organizationId: null, organizationName: null, displayName: "Withdrawn" }),
    ]);
    expect(stats.referredOrgsCount).toBe(0);
  });

  it("counts new_showroom referrals that are pending or joined as 'added', never a cancelled one", () => {
    const stats = countReferralStats([
      referral({ id: "r1", origin: "new_showroom", status: "pending", organizationId: null, organizationName: null, displayName: "A" }),
      referral({ id: "r2", origin: "new_showroom", status: "joined", displayName: null }),
      referral({ id: "r3", origin: "new_showroom", status: "cancelled", organizationId: null, organizationName: null, displayName: "Withdrawn" }),
    ]);
    expect(stats.showroomsAddedCount).toBe(2);
  });

  it("never counts a known-organization referral as a 'showroom added' — it was never new", () => {
    const stats = countReferralStats([
      referral({ id: "r1", origin: "known_organization", status: "joined" }),
    ]);
    expect(stats.showroomsAddedCount).toBe(0);
  });
});
