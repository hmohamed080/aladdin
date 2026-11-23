/**
 * The Admin dashboard's organization APPROVAL cards (All / Pending / Approved / Rejected / Suspended) come from the SAME tab
 * counts the Organizations directory shows (`admin_organizations_list().counts`), so each card equals the list it links to.
 * When that read fails every one of them is a dash: never a misleading zero and never a number from a different source.
 *
 * Organization LIFECYCLE status (`organizations.status`) is a different thing and keeps its own distribution panel
 * ("Organizations by lifecycle status"): a rejected application stays `pending_verification` there until its owner abandons
 * it, while here it is counted under Rejected only.
 */
export type OrgTabCounts = { all: number; pending: number; verified: number; suspended: number; rejected: number };

export type OrgCards = {
  all: number | string;
  pending: number | string;
  approved: number | string;
  rejected: number | string;
  suspended: number | string;
};

export function dashboardOrgCards(result: { ok: true; data: { counts: OrgTabCounts } } | { ok: false }): OrgCards {
  if (!result.ok) return { all: "—", pending: "—", approved: "—", rejected: "—", suspended: "—" };
  const { all, pending, verified, rejected, suspended } = result.data.counts;
  return { all, pending, approved: verified, rejected, suspended };
}
