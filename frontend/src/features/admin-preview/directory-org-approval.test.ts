import { describe, it, expect } from "vitest";
import {
  mapDirectoryOrg,
  mapOrgDetail,
  mapOrgsPage,
  organizationApprovalState,
  organizationDirectoryTab,
} from "./directory-mappers";
import { dashboardOrgCards } from "@/lib/admin/dashboard-org-counts";

/**
 * Organization APPROVAL is one rule, in three places that must agree: the SQL (admin_organizations_list /
 * admin_organization_detail, 20261116090001; pinned by pgTAP 137), this mirror, and what the pages show. The table below is
 * the pgTAP fixture table: the same lifecycle / is_verified / latest-decision inputs and the same expected tab and approval.
 */
type Case = { name: string; status: string; isVerified: boolean; latest: string | null; tab: string | null; approval: string };

const CASES: Case[] = [
  { name: "01 active approved", status: "active", isVerified: true, latest: "approved", tab: "verified", approval: "approved" },
  { name: "02 pending open", status: "pending_verification", isVerified: false, latest: "submitted", tab: "pending", approval: "pending" },
  { name: "03 pending rejected", status: "pending_verification", isVerified: false, latest: "rejected", tab: "rejected", approval: "rejected" },
  { name: "04 pending no request", status: "pending_verification", isVerified: false, latest: null, tab: "pending", approval: "pending" },
  { name: "05 suspended approved", status: "suspended", isVerified: true, latest: "approved", tab: "suspended", approval: "approved" },
  { name: "06 suspended rejected", status: "suspended", isVerified: false, latest: "rejected", tab: "suspended", approval: "rejected" },
  { name: "07 archived cancelled", status: "archived", isVerified: false, latest: "cancelled", tab: null, approval: "none" },
  { name: "08 draft", status: "draft", isVerified: false, latest: null, tab: null, approval: "none" },
  { name: "09 pending tie rejected", status: "pending_verification", isVerified: false, latest: "rejected", tab: "rejected", approval: "rejected" },
  { name: "10 active legacy flag", status: "active", isVerified: false, latest: null, tab: "verified", approval: "approved" },
  { name: "11 pending tie cancelled", status: "pending_verification", isVerified: false, latest: "cancelled", tab: "pending", approval: "pending" },
  { name: "13 pending needs info", status: "pending_verification", isVerified: false, latest: "needs_more_info", tab: "pending", approval: "pending" },
  { name: "14 draft rejected", status: "draft", isVerified: false, latest: "rejected", tab: null, approval: "rejected" },
];

describe("organizationApprovalState / organizationDirectoryTab (mirror of the SQL)", () => {
  it.each(CASES)("$name -> tab $tab, approval $approval", (c) => {
    expect(organizationApprovalState({ isVerified: c.isVerified, status: c.status, latestStatus: c.latest })).toBe(c.approval);
    expect(organizationDirectoryTab({ status: c.status, latestStatus: c.latest })).toBe(c.tab);
  });

  it("lifecycle never changes the approval: suspending an approved organization keeps it approved", () => {
    expect(organizationApprovalState({ isVerified: true, status: "suspended", latestStatus: "approved" })).toBe("approved");
    expect(organizationApprovalState({ isVerified: false, status: "suspended", latestStatus: "rejected" })).toBe("rejected");
  });

  it("an abandoned application (latest cancelled, archived) is neither pending nor rejected", () => {
    expect(organizationApprovalState({ isVerified: false, status: "archived", latestStatus: "cancelled" })).toBe("none");
    expect(organizationDirectoryTab({ status: "archived", latestStatus: "cancelled" })).toBeNull();
  });
});

const payload = (c: Case, withApproval: boolean) => ({
  id: "13700000-0000-4000-8000-000000000001",
  name: c.name,
  org_type: "supplier",
  status: c.status,
  is_verified: c.isVerified,
  created_at: "2026-03-01T00:00:00Z",
  verification_state: c.isVerified ? "verified" : c.status === "pending_verification" ? "pending" : "unverified",
  ...(withApproval ? { approval_state: c.approval, latest_verification_status: c.latest } : {}),
});

describe("list, detail and dashboard show the same approval", () => {
  const rejected = CASES.find((c) => c.name === "03 pending rejected")!;

  it("a rejected organization is rejected in the list row, the detail and the dashboard count", () => {
    const row = mapDirectoryOrg(payload(rejected, true));
    const detail = mapOrgDetail({ ...payload(rejected, true), members: [], owners: [], branches: [], verifications: [] });
    expect(row?.approvalState).toBe("rejected");
    expect(detail?.approvalState).toBe("rejected");
    expect(detail?.latestVerificationStatus).toBe("rejected");
    // The dashboard card reads the directory's own Rejected tab count, which holds this very organization.
    const page = mapOrgsPage({ rows: [payload(rejected, true)], total: 1, page: 1, page_size: 10, counts: { all: 9, pending: 3, verified: 4, suspended: 0, rejected: 2 } });
    expect(page?.counts.rejected).toBe(2);
    expect(dashboardOrgCards({ ok: true, data: { counts: page!.counts } }).rejected).toBe(2);
  });

  it("requires the new-schema fields: a row without a valid approval_state is refused, never guessed", () => {
    for (const c of CASES) {
      expect(mapDirectoryOrg(payload(c, true))?.approvalState).toBe(c.approval);
      expect(mapDirectoryOrg(payload(c, false))).toBeNull();
    }
    expect(mapDirectoryOrg({ ...payload(rejected, true), approval_state: "bogus" })).toBeNull();
    expect(mapOrgDetail({ ...payload(rejected, false), members: [], owners: [], branches: [], verifications: [] })).toBeNull();
  });

  it("a pre-migration page (no counts.rejected, or any row without approval_state) is a shape failure, not zeros", () => {
    const row = payload(rejected, true);
    const ok = { rows: [row], total: 1, page: 1, page_size: 10, counts: { all: 1, pending: 0, verified: 0, suspended: 0, rejected: 1 } };
    expect(mapOrgsPage(ok)).not.toBeNull();
    expect(mapOrgsPage({ ...ok, counts: { all: 1, pending: 1, verified: 0, suspended: 0 } })).toBeNull();
    expect(mapOrgsPage({ ...ok, rows: [row, payload(rejected, false)], total: 2 })).toBeNull();
  });

  it("keeps lifecycle status and verification_state separate from the approval", () => {
    const row = mapDirectoryOrg(payload(rejected, true));
    expect(row?.status).toBe("pending_verification");
    expect(row?.verificationState).toBe("pending");
    expect(row?.approvalState).toBe("rejected");
  });

  it("maps the Rejected tab count of a directory page, including a real zero", () => {
    const base = { rows: [], total: 0, page: 1, page_size: 10 };
    expect(mapOrgsPage({ ...base, counts: { all: 0, pending: 0, verified: 0, suspended: 0, rejected: 0 } })?.counts.rejected).toBe(0);
  });
});
