import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("server-only", () => ({}));
import { render, cleanup, screen, within } from "@testing-library/react";
import { ADMIN_PERMISSIONS, type AdminAccess } from "@/lib/permissions/admin";
import { I18nProvider } from "@/lib/i18n/provider";
import type { AdminDirectoryOrg } from "@/features/admin-preview/directory-mappers";

/**
 * Organizations directory page: the Organization approval column and the Rejected tab come from the database's approval
 * decision, separate from the LIFECYCLE Status column. A rejected application stays `pending_verification` (lifecycle) until its
 * owner abandons it, shows "Rejected" (approval), is counted under the Rejected tab, and still offers Approve / Reject (the Admin may re-initiate, as for users).
 */
const loadOrganizationsDirectory = vi.fn();
const loadPendingOrganizationVerifications = vi.fn();
const requireAdminRoute = vi.fn();

const ALL = [...ADMIN_PERMISSIONS];
const administrator: AdminAccess = { isStaff: true, rank: 80, permissions: ALL.filter((p) => p !== "roles.manage"), roles: [] };

vi.mock("@/server/authorization/admin", () => ({ requireAdminRoute: (...a: unknown[]) => requireAdminRoute(...a) }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: vi.fn(async () => ({})) }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => ({ value: "en" }) })) }));
vi.mock("@/server/queries/admin-directory", () => ({
  loadOrganizationsDirectory: (...a: unknown[]) => loadOrganizationsDirectory(...a),
  loadPendingOrganizationVerifications: (...a: unknown[]) => loadPendingOrganizationVerifications(...a),
}));
vi.mock("@/server/actions/admin-forms", () => ({ approveVerificationAction: vi.fn(), rejectVerificationAction: vi.fn(), adminInitiateVerificationAction: vi.fn() }));
vi.mock("@/features/admin-ops/suspension", () => ({ SuspensionAction: () => null }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/admin/organizations",
  useSearchParams: () => new URLSearchParams(),
}));

const { default: PreviewOrganizationsPage } = await import("./page");

function org(over: Partial<AdminDirectoryOrg>): AdminDirectoryOrg {
  return {
    id: "13700000-0000-4000-8000-000000000001",
    name: "Org",
    nameAr: null,
    nameEn: null,
    orgType: "supplier",
    status: "active",
    isVerified: true,
    verificationState: "verified",
    approvalState: "approved",
    latestVerificationStatus: "approved",
    createdAt: "2026-03-01T00:00:00Z",
    source: null,
    memberCount: 1,
    branchCount: 1,
    owner: { userId: "u1", displayName: "Owner" },
    ...over,
  };
}

const REJECTED = org({
  id: "13700000-0000-4000-8000-000000000003",
  name: "Rejected Org",
  status: "pending_verification",
  isVerified: false,
  verificationState: "pending",
  approvalState: "rejected",
  latestVerificationStatus: "rejected",
});
const PENDING = org({
  id: "13700000-0000-4000-8000-000000000002",
  name: "Pending Org",
  status: "pending_verification",
  isVerified: false,
  verificationState: "pending",
  approvalState: "pending",
  latestVerificationStatus: "submitted",
});
const APPROVED = org({ id: "13700000-0000-4000-8000-000000000001", name: "Approved Org" });

const okPage = (rows: AdminDirectoryOrg[], counts: Record<string, number>) => ({
  ok: true,
  data: { rows, total: rows.length, page: 1, pageSize: 10, counts },
});

async function renderPage(searchParams: Record<string, string> = {}) {
  const ui = await PreviewOrganizationsPage({ searchParams: Promise.resolve(searchParams) });
  return render(
    <I18nProvider locale="en" dir="ltr">
      {ui}
    </I18nProvider>,
  );
}

const rowOf = (name: string) => screen.getAllByText(name).map((e) => e.closest("tr")).find((r): r is HTMLTableRowElement => r !== null) as HTMLElement;

beforeEach(() => {
  loadOrganizationsDirectory.mockReset();
  loadPendingOrganizationVerifications.mockReset();
  loadPendingOrganizationVerifications.mockResolvedValue(new Map());
  requireAdminRoute.mockReset();
  requireAdminRoute.mockResolvedValue(administrator);
});
afterEach(cleanup);

describe("Organizations directory - approval vs lifecycle", () => {
  const counts = { all: 3, pending: 1, verified: 1, suspended: 0, rejected: 1 };

  it("labels the column Organization approval and shows Rejected next to the unchanged lifecycle status", async () => {
    loadOrganizationsDirectory.mockResolvedValue(okPage([APPROVED, PENDING, REJECTED], counts));
    await renderPage();
    expect(screen.getByRole("columnheader", { name: /Organization approval/ })).toBeTruthy();
    const rejected = rowOf("Rejected Org");
    expect(within(rejected).getByText("Rejected")).toBeTruthy(); // approval
    expect(within(rejected).getByText("Pending verification")).toBeTruthy(); // lifecycle status, unchanged
    expect(within(rowOf("Pending Org")).getByText("Pending")).toBeTruthy();
    expect(within(rowOf("Approved Org")).getByText("Approved")).toBeTruthy();
  });

  it("has a Rejected tab whose count is the directory's rejected count", async () => {
    loadOrganizationsDirectory.mockResolvedValue(okPage([APPROVED, PENDING, REJECTED], counts));
    await renderPage();
    const tab = screen.getAllByRole("link").find((a) => /^Rejected/.test(a.textContent ?? ""));
    expect(tab?.textContent).toMatch(/1/);
    expect(tab?.getAttribute("href")).toContain("status=rejected");
  });

  it("passes the rejected filter through to the server read", async () => {
    loadOrganizationsDirectory.mockResolvedValue(okPage([REJECTED], { ...counts, all: 3 }));
    await renderPage({ status: "rejected" });
    expect(loadOrganizationsDirectory.mock.calls[0]?.[1]).toMatchObject({ status: "rejected" });
  });

  it("offers Approve / Reject on a rejected application too (re-initiation, same as users), like a pending one", async () => {
    loadOrganizationsDirectory.mockResolvedValue(okPage([PENDING, REJECTED], counts));
    await renderPage();
    expect(within(rowOf("Rejected Org")).getAllByRole("button", { name: /Approve|Reject/ }).length).toBeGreaterThan(0);
    expect(within(rowOf("Pending Org")).getAllByRole("button", { name: /Approve|Reject/ }).length).toBeGreaterThan(0);
  });

  it("zero results: an empty state, no rows", async () => {
    loadOrganizationsDirectory.mockResolvedValue(okPage([], { all: 3, pending: 1, verified: 1, suspended: 0, rejected: 1 }));
    await renderPage({ status: "suspended" });
    expect(screen.queryByText("Rejected Org")).toBeNull();
    expect(screen.getByText(/No organizations/i)).toBeTruthy();
  });
});
