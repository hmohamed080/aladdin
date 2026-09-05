import type { NetworkOrganization } from "@/server/queries/network";
import type { NetworkReferral } from "@/server/queries/network-referrals";

/**
 * The ONE merge of the two Network authorities into what a reader sees.
 *
 * Two real facts, never collapsed into a fake third one (§1 of the
 * increment brief): completed work (`my_network_organizations`) and a
 * referral (`my_network_referrals`). An organization may carry BOTH — a
 * showroom the installer referred and later did real work for — and this is
 * where that union happens, once, so every surface reads the same rows.
 *
 * A PENDING referral is never an organization row: it has no organization_id
 * yet, and §11 is explicit that it must never look like one.
 */
export type OrganizationRow = {
  kind: "organization";
  orgId: string;
  orgName: string;
  /** Present exactly when a verified (completed-work) relationship exists. */
  completedWork: NetworkOrganization | null;
  /** Present exactly when a JOINED referral names this organization. */
  referral: NetworkReferral | null;
};

export type PendingReferralRow = {
  kind: "pending_referral";
  referral: NetworkReferral;
};

export type NetworkRow = OrganizationRow | PendingReferralRow;

export type NetworkTab = "all" | "worked_with" | "referred" | "pending";

/**
 * Merge completed-work organizations and joined/pending referrals into rows.
 *
 * ORDER: worked-with-and-referred first (the richest, realest relationships),
 * then worked-with-only, then referred-only, then pending — each group newest
 * first by its own best date. Deterministic and never re-sorted by the caller.
 */
export function buildNetworkRows(
  organizations: readonly NetworkOrganization[],
  referrals: readonly NetworkReferral[],
): NetworkRow[] {
  const orgRows = new Map<string, OrganizationRow>();

  for (const org of organizations) {
    orgRows.set(org.orgId, {
      kind: "organization",
      orgId: org.orgId,
      orgName: org.orgName,
      completedWork: org,
      referral: null,
    });
  }

  const pending: PendingReferralRow[] = [];

  for (const referral of referrals) {
    if (referral.status === "cancelled") continue;
    if (referral.status === "pending") {
      pending.push({ kind: "pending_referral", referral });
      continue;
    }
    // status === 'joined'. A joined referral always names an organization —
    // the RPC layer guarantees it (case A immediately, case B on approval).
    if (!referral.organizationId || !referral.organizationName) continue;
    const existing = orgRows.get(referral.organizationId);
    if (existing) {
      existing.referral = referral;
    } else {
      orgRows.set(referral.organizationId, {
        kind: "organization",
        orgId: referral.organizationId,
        orgName: referral.organizationName,
        completedWork: null,
        referral,
      });
    }
  }

  const rows = [...orgRows.values()];
  const rank = (r: OrganizationRow) =>
    r.completedWork && r.referral ? 0 : r.completedWork ? 1 : 2;
  const dateOf = (r: OrganizationRow) =>
    r.completedWork?.lastCompletedAt ?? r.referral?.decidedAt ?? r.referral?.createdAt ?? "";
  rows.sort((a, b) => rank(a) - rank(b) || dateOf(b).localeCompare(dateOf(a)));

  return [...rows, ...pending];
}

/** Narrow the merged rows to one tab. */
export function filterNetworkRows(rows: readonly NetworkRow[], tab: NetworkTab): NetworkRow[] {
  switch (tab) {
    case "worked_with":
      return rows.filter((r) => r.kind === "organization" && r.completedWork !== null);
    case "referred":
      return rows.filter((r) => r.kind === "organization" && r.referral !== null);
    case "pending":
      return rows.filter((r) => r.kind === "pending_referral");
    case "all":
    default:
      return [...rows];
  }
}

/** Real counts for the tab labels — never a guess, always these same rows. */
export function countNetworkRows(rows: readonly NetworkRow[]) {
  return {
    all: rows.length,
    workedWith: rows.filter((r) => r.kind === "organization" && r.completedWork !== null).length,
    referred: rows.filter((r) => r.kind === "organization" && r.referral !== null).length,
    pending: rows.filter((r) => r.kind === "pending_referral").length,
  };
}

/**
 * Two real referral-contribution counts for the Network Points card.
 * DELIBERATELY NOT a level or a "points to next tier" — neither has any
 * authority in this schema (no level column, no threshold table), and
 * `docs/database/points-core.md` explicitly excludes tiers without a further
 * approved specification. These two are what the same `network_referrals`
 * rows can honestly say instead.
 */
export function countReferralStats(referrals: readonly NetworkReferral[]) {
  return {
    /** Distinct organizations JOINED through a referral — the uniqueness
     *  constraints on network_referrals already guarantee at most one row per
     *  (referrer, organization), so counting joined rows IS counting distinct
     *  organizations. */
    referredOrgsCount: referrals.filter((r) => r.status === "joined").length,
    /** Not-yet-registered showrooms the caller has referred — pending or
     *  joined; a withdrawn/cancelled candidate was never really "added". */
    showroomsAddedCount: referrals.filter((r) => r.origin === "new_showroom" && r.status !== "cancelled").length,
  };
}
