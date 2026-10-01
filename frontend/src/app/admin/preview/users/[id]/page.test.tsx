import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n/context";
import { ADMIN_PERMISSIONS, type AdminAccess } from "@/lib/permissions/admin";
import type { AdminUserDetail } from "@/features/admin-preview/directory-mappers";

/**
 * Admin Core stabilization — the User Details header follows the SAME authority model as the database:
 * Suspend / Restore is drawn only when the viewer may use it on THIS user (never their own account, never Admin
 * Staff at or above their rank unless Super Admin). Server guards (`admin_user_suspend`) remain authoritative;
 * these tests pin what the page DRAWS so an action that can never work is never exposed.
 */
const requireAdminRoute = vi.fn();
const loadUserDetail = vi.fn();
const loadStaffRanks = vi.fn();

const CALLER_ID = "55555555-5555-4555-8555-555555555555";
const SUPER_ID = "70000099-0000-4000-8000-000000000099";
const ORDINARY_ID = "70000001-0000-4000-8000-000000000001";

const ALL = [...ADMIN_PERMISSIONS];
const acc = (rank: number, permissions: readonly (typeof ALL)[number][]): AdminAccess => ({ isStaff: true, rank, permissions, roles: [] });
const administrator = acc(80, ALL.filter((p) => p !== "roles.manage"));
const superAdmin = acc(100, ALL);

vi.mock("@/server/authorization/admin", () => ({ requireAdminRoute: (...a: unknown[]) => requireAdminRoute(...a) }));
vi.mock("@/server/queries/admin-directory", () => ({ loadUserDetail: (...a: unknown[]) => loadUserDetail(...a) }));
vi.mock("@/server/queries/admin-rbac", () => ({ loadStaffRanks: (...a: unknown[]) => loadStaffRanks(...a) }));
vi.mock("@/server/queries/admin-preview", () => ({
  previewUserPointsLedger: vi.fn(async () => null),
  previewSubjectAudit: vi.fn(async () => null),
}));
vi.mock("@/server/queries/admin-operations", () => ({
  loadCases: vi.fn(async () => null),
  loadFollowUpAssignees: vi.fn(async () => []),
  loadFollowUps: vi.fn(async () => null),
  loadNotes: vi.fn(async () => null),
  loadSuspension: vi.fn(async () => null),
  loadTimeline: vi.fn(async () => null),
}));
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: vi.fn(async () => ({ auth: { getUser: async () => ({ data: { user: { id: CALLER_ID } } }) } })),
}));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => ({ value: "en" }) })) }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound");
  },
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/admin/preview/users/x",
  useSearchParams: () => new URLSearchParams(),
}));

const { default: PreviewUserDetailPage } = await import("./page");

function detail(id: string, over: Partial<AdminUserDetail> = {}): AdminUserDetail {
  return {
    id,
    displayName: { name: "Some Person", nameAr: null, nameEn: null },
    username: null,
    email: "person@example.test",
    phone: null,
    accountType: null,
    status: "active",
    isVerified: true,
    createdAt: "2026-09-30T10:00:00Z",
    verificationState: "verified",
    governorate: null,
    city: null,
    profileId: null,
    publicProfileAvailable: false,
    headline: null,
    bio: null,
    lastSignInAt: null,
    completion: { percent: 50, missing: [] },
    memberships: [],
    verifications: [],
    ...over,
  };
}

async function renderPage(id: string) {
  const ui = await PreviewUserDetailPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) });
  return render(
    <I18nProvider locale="en" dir="ltr">
      {ui}
    </I18nProvider>,
  );
}

const suspendButtons = () => screen.queryAllByRole("button", { name: /^suspend$/i });

beforeEach(() => {
  requireAdminRoute.mockReset();
  requireAdminRoute.mockResolvedValue(administrator);
  loadUserDetail.mockReset();
  loadStaffRanks.mockReset();
  loadStaffRanks.mockResolvedValue(new Map([[SUPER_ID, 100], [CALLER_ID, 80]]));
});
afterEach(cleanup);

describe("User Details - rank-aware Suspend", () => {
  it("an Administrator viewing a Super Admin is NOT shown Suspend", async () => {
    loadUserDetail.mockResolvedValue({ ok: true, data: detail(SUPER_ID) });
    await renderPage(SUPER_ID);
    expect(suspendButtons()).toHaveLength(0);
  });

  it("an Administrator viewing an ordinary user IS shown Suspend", async () => {
    loadUserDetail.mockResolvedValue({ ok: true, data: detail(ORDINARY_ID) });
    await renderPage(ORDINARY_ID);
    expect(suspendButtons()).toHaveLength(1);
  });

  it("nobody is shown Suspend on their own details page", async () => {
    loadUserDetail.mockResolvedValue({ ok: true, data: detail(CALLER_ID) });
    await renderPage(CALLER_ID);
    expect(suspendButtons()).toHaveLength(0);
  });

  it("a Super Admin viewing another Super Admin keeps Suspend (the server's last-Super-Admin guard still applies)", async () => {
    requireAdminRoute.mockResolvedValue(superAdmin);
    loadStaffRanks.mockResolvedValue(new Map([[SUPER_ID, 100], [CALLER_ID, 100]]));
    loadUserDetail.mockResolvedValue({ ok: true, data: detail(SUPER_ID) });
    await renderPage(SUPER_ID);
    expect(suspendButtons()).toHaveLength(1);
  });

  it("when staff ranks are unreadable the control is drawn and the server stays the judge", async () => {
    requireAdminRoute.mockResolvedValue(acc(60, ["users.read", "users.suspend"]));
    loadStaffRanks.mockResolvedValue(null);
    loadUserDetail.mockResolvedValue({ ok: true, data: detail(SUPER_ID) });
    await renderPage(SUPER_ID);
    expect(suspendButtons()).toHaveLength(1);
  });

  it("a suspended ordinary user shows Restore, not Suspend, to an Administrator", async () => {
    loadUserDetail.mockResolvedValue({ ok: true, data: detail(ORDINARY_ID, { status: "suspended" }) });
    await renderPage(ORDINARY_ID);
    expect(suspendButtons()).toHaveLength(0);
    expect(screen.getAllByRole("button", { name: /^restore$/i }).length).toBeGreaterThan(0);
  });
});
