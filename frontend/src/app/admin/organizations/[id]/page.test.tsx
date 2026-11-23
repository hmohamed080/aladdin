import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
vi.mock("server-only", () => ({}));
import { render, cleanup, screen } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n/provider";
import { ADMIN_PERMISSIONS, type AdminAccess } from "@/lib/permissions/admin";
import type { AdminOrgDetail } from "@/features/admin-preview/directory-mappers";

/**
 * Organization details: ONE guard decides every Verify / Reject control (the header buttons and the Overview "Available actions"
 * links). A pending organization offers them, a rejected one still does (the Admin may re-initiate, as for users), and without `organizations.verify` there are none.
 */
const requireAdminRoute = vi.fn();
const loadOrganizationDetail = vi.fn();

const ALL = [...ADMIN_PERMISSIONS];
const acc = (permissions: readonly (typeof ALL)[number][]): AdminAccess => ({ isStaff: true, rank: 80, permissions, roles: [] });

vi.mock("@/server/authorization/admin", () => ({ requireAdminRoute: (...a: unknown[]) => requireAdminRoute(...a) }));
vi.mock("@/server/queries/admin-directory", () => ({
  loadOrganizationDetail: (...a: unknown[]) => loadOrganizationDetail(...a),
  loadOrganizationRegistration: vi.fn(async () => ({ phone: null, email: null, legalName: null, description: null, activities: [], branches: [] })),
}));
vi.mock("@/server/actions/admin-forms", () => ({ approveVerificationAction: vi.fn(), rejectVerificationAction: vi.fn(), adminInitiateVerificationAction: vi.fn() }));
vi.mock("@/server/queries/admin-preview", () => ({ previewSubjectAudit: vi.fn(async () => null) }));
vi.mock("@/server/queries/admin-operations", () => ({
  loadNotes: vi.fn(async () => null),
  loadOrganizationDuplicates: vi.fn(async () => null),
  loadSuspension: vi.fn(async () => null),
  loadTimeline: vi.fn(async () => null),
}));
vi.mock("@/features/admin-ops/suspension", () => ({ SuspensionAction: () => null, SuspensionBanner: () => null }));
vi.mock("@/lib/supabase/server", () => ({ getServerSupabase: vi.fn(async () => ({})) }));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => ({ value: "en" }) })) }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/admin/organizations/x",
  useSearchParams: () => new URLSearchParams(),
}));

const { default: PreviewOrgDetailPage } = await import("./page");

const ID = "13700000-0000-4000-8000-000000000003";
function org(over: Partial<AdminOrgDetail>): AdminOrgDetail {
  return {
    id: ID,
    name: "Detail Org",
    nameAr: null,
    nameEn: null,
    orgType: "supplier",
    status: "pending_verification",
    isVerified: false,
    verificationState: "pending",
    approvalState: "pending",
    latestVerificationStatus: "submitted",
    createdAt: "2026-03-01T00:00:00Z",
    source: null,
    businessVerifiedAt: null,
    referredBy: null,
    owners: [],
    members: [],
    branches: [],
    verifications: [],
    ...over,
  } as AdminOrgDetail;
}

async function renderPage(detail: AdminOrgDetail, access: AdminAccess) {
  requireAdminRoute.mockResolvedValue(access);
  loadOrganizationDetail.mockResolvedValue({ ok: true, data: detail });
  const ui = await PreviewOrgDetailPage({ params: Promise.resolve({ id: ID }), searchParams: Promise.resolve({}) });
  return render(
    <I18nProvider locale="en" dir="ltr">
      {ui}
    </I18nProvider>,
  );
}

const links = () => screen.queryAllByRole("link", { name: /^(Verify|Reject|Approve)$/ });
const buttons = () => screen.queryAllByRole("button", { name: /^(Verify|Reject|Approve)/ });

beforeEach(() => {
  requireAdminRoute.mockReset();
  loadOrganizationDetail.mockReset();
});
afterEach(cleanup);

describe("Organization details - Verify / Reject guard", () => {
  const verifier = acc(ALL.filter((p) => p !== "roles.manage"));
  const noVerify = acc(ALL.filter((p) => p !== "organizations.verify" && p !== "roles.manage"));

  it("a rejected application still offers the controls to a verifier (re-initiation, same as users)", async () => {
    await renderPage(org({ approvalState: "rejected", latestVerificationStatus: "rejected" }), verifier);
    expect(screen.getByText(/Available actions/i)).toBeTruthy();
    expect(links().length).toBeGreaterThanOrEqual(2);
  });

  it("a rejected application shows nothing without organizations.verify", async () => {
    await renderPage(org({ approvalState: "rejected", latestVerificationStatus: "rejected" }), noVerify);
    expect(links()).toHaveLength(0);
    expect(buttons()).toHaveLength(0);
  });

  it("a pending organization shows them in the Overview", async () => {
    await renderPage(org({}), verifier);
    expect(screen.getByText(/Available actions/i)).toBeTruthy();
    expect(links().length).toBeGreaterThanOrEqual(2);
  });

  it("without organizations.verify a pending organization shows no Verify / Reject at all", async () => {
    await renderPage(org({}), noVerify);
    expect(screen.queryByText(/Available actions/i)).toBeNull();
    expect(links()).toHaveLength(0);
    expect(buttons()).toHaveLength(0);
  });

  it("an approved, active organization has no approval actions", async () => {
    await renderPage(org({ status: "active", isVerified: true, approvalState: "approved", latestVerificationStatus: "approved" }), verifier);
    expect(screen.queryByText(/Available actions/i)).toBeNull();
  });
});
