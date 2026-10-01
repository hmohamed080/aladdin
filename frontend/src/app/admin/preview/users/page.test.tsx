import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen, within } from "@testing-library/react";
import { ADMIN_PERMISSIONS, type AdminAccess } from "@/lib/permissions/admin";
import { I18nProvider } from "@/lib/i18n/context";
import type { AdminDirectoryUser } from "@/features/admin-preview/directory-mappers";

/**
 * Phase 1B-A — the Users directory page against its server read:
 * the URL is sanitized before it reaches `admin_users_list`, a failed read
 * shows a safe error state (never raw database text), and View on Platform
 * links the PROFILE id, never the user id.
 */
const loadUsersDirectory = vi.fn();
const loadStaffRanks = vi.fn();
const requireAdminRoute = vi.fn();
const CALLER_ID = "55555555-5555-4555-8555-555555555555";

const ALL = [...ADMIN_PERMISSIONS];
const acc = (rank: number, permissions: readonly (typeof ALL)[number][]): AdminAccess => ({ isStaff: true, rank, permissions, roles: [] });
const administrator = acc(80, ALL.filter((p) => p !== "roles.manage"));
const superAdmin = acc(100, ALL);

vi.mock("@/server/authorization/admin", () => ({ requireAdminRoute: (...a: unknown[]) => requireAdminRoute(...a) }));
vi.mock("@/server/queries/admin-rbac", () => ({ loadStaffRanks: (...a: unknown[]) => loadStaffRanks(...a) }));
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: vi.fn(async () => ({ auth: { getUser: async () => ({ data: { user: { id: CALLER_ID } } }) } })),
}));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => ({ value: "en" }) })) }));
vi.mock("@/server/queries/admin-directory", () => ({ loadUsersDirectory: (...a: unknown[]) => loadUsersDirectory(...a) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/admin/preview/users",
  useSearchParams: () => new URLSearchParams(),
}));

const { default: PreviewUsersPage } = await import("./page");

const USER_ID = "70000001-0000-4000-8000-000000000001";
const PROFILE_ID = "aed52a4d-7757-447f-82f2-8a7b2dc7ef1e";

function user(over: Partial<AdminDirectoryUser> = {}): AdminDirectoryUser {
  return {
    id: USER_ID,
    displayName: { name: "Hana Mansour", nameAr: null, nameEn: null },
    username: null,
    email: "hana@example.test",
    phone: null,
    accountType: null,
    status: "active",
    isVerified: false,
    createdAt: "2026-09-30T10:00:00Z",
    verificationState: "unverified",
    governorate: null,
    city: null,
    completion: 25,
    organization: null,
    organizationCount: 0,
    profileId: PROFILE_ID,
    publicProfileAvailable: true,
    flags: [],
    ...over,
  };
}

async function renderPage(searchParams: Record<string, string>) {
  const ui = await PreviewUsersPage({ searchParams: Promise.resolve(searchParams) });
  return render(
    <I18nProvider locale="en" dir="ltr">
      {ui}
    </I18nProvider>,
  );
}

const okPage = (rows: AdminDirectoryUser[], total = rows.length) => ({
  ok: true,
  data: { rows, total, page: 1, pageSize: 10, counts: { all: total, pending: 0, verified: 0, suspended: 0, rejected: 0 } },
});

beforeEach(() => {
  loadUsersDirectory.mockReset();
  loadStaffRanks.mockReset();
  loadStaffRanks.mockResolvedValue(new Map());
  requireAdminRoute.mockReset();
  requireAdminRoute.mockResolvedValue(administrator);
});
afterEach(cleanup);

describe("Users directory page", () => {
  it("sends only sanitized arguments to the server read", async () => {
    loadUsersDirectory.mockResolvedValue(okPage([]));
    await renderPage({ page: "-4", pageSize: "13", sort: "name:asc", status: "deleted", q: "  hana ", governorate: "giza" });
    expect(loadUsersDirectory.mock.calls[0]?.[1]).toEqual({
      search: "hana",
      status: null,
      accountType: null,
      verification: null,
      governorate: "giza",
      sort: "registered:desc",
      page: 1,
      pageSize: 10,
    });
  });

  it("links View on Platform to the profile id, never the user id", async () => {
    loadUsersDirectory.mockResolvedValue(okPage([user()]));
    const { container } = await renderPage({});
    const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toContain(`/p/${PROFILE_ID}`);
    expect(hrefs).not.toContain(`/p/${USER_ID}`);
  });

  it("never links an unlisted profile", async () => {
    loadUsersDirectory.mockResolvedValue(okPage([user({ publicProfileAvailable: false })]));
    const { container } = await renderPage({});
    expect(Array.from(container.querySelectorAll("a")).some((a) => a.getAttribute("href")?.startsWith("/p/"))).toBe(false);
  });

  it("shows the server's total, not the number of rows on the page", async () => {
    loadUsersDirectory.mockResolvedValue(okPage([user()], 213));
    await renderPage({});
    expect(screen.getAllByText(/213/).length).toBeGreaterThan(0);
  });

  it("renders a safe error state when the read fails", async () => {
    loadUsersDirectory.mockResolvedValue({ ok: false });
    await renderPage({});
    expect(screen.getByText(/could not be loaded/i)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

/**
 * Rank-aware Suspend (Admin Core stabilization): the row control follows the SAME rule the database enforces in
 * `admin_user_suspend` - never your own row, never Admin Staff at or above your rank (Super Admin excepted for
 * others). The RPC stays the judge; these tests pin what the console DRAWS.
 */
describe("Users directory page - rank-aware Suspend", () => {
  const SUPER_ID = "70000099-0000-4000-8000-000000000099";
  const OTHER_SUPER_ID = "70000098-0000-4000-8000-000000000098";
  const PEER_ID = "70000077-0000-4000-8000-000000000077";
  const suspendButtons = (row: HTMLElement) => within(row).queryAllByRole("button", { name: /suspend/i });
  const rowOf = (container: HTMLElement, id: string) => {
    const link = container.querySelector(`tbody a[href$="/${id}"]`);
    const row = link?.closest("tr");
    if (!row) throw new Error(`row for ${id} not found`);
    return row as HTMLElement;
  };

  it("an Administrator is not offered Suspend on a Super Admin, but is on an ordinary user", async () => {
    loadStaffRanks.mockResolvedValue(new Map([[SUPER_ID, 100]]));
    loadUsersDirectory.mockResolvedValue(
      okPage([user({ id: SUPER_ID, displayName: { name: "Super Person", nameAr: null, nameEn: null } }), user({ id: USER_ID })]),
    );
    const { container } = await renderPage({});
    expect(suspendButtons(rowOf(container, SUPER_ID))).toHaveLength(0);
    expect(suspendButtons(rowOf(container, USER_ID))).toHaveLength(1);
  });

  it("nobody is offered Suspend on their own row", async () => {
    loadStaffRanks.mockResolvedValue(new Map([[CALLER_ID, 80]]));
    loadUsersDirectory.mockResolvedValue(okPage([user({ id: CALLER_ID }), user({ id: USER_ID })]));
    const { container } = await renderPage({});
    expect(suspendButtons(rowOf(container, CALLER_ID))).toHaveLength(0);
    expect(suspendButtons(rowOf(container, USER_ID))).toHaveLength(1);
  });

  it("a Super Admin keeps Suspend on other staff (even other Super Admins) but not on themselves", async () => {
    requireAdminRoute.mockResolvedValue(superAdmin);
    loadStaffRanks.mockResolvedValue(new Map([[CALLER_ID, 100], [OTHER_SUPER_ID, 100]]));
    loadUsersDirectory.mockResolvedValue(okPage([user({ id: CALLER_ID }), user({ id: OTHER_SUPER_ID }), user({ id: USER_ID })]));
    const { container } = await renderPage({});
    expect(suspendButtons(rowOf(container, CALLER_ID))).toHaveLength(0);
    expect(suspendButtons(rowOf(container, OTHER_SUPER_ID))).toHaveLength(1);
    expect(suspendButtons(rowOf(container, USER_ID))).toHaveLength(1);
  });

  it("an equal-rank Administrator row is not offered either", async () => {
    loadStaffRanks.mockResolvedValue(new Map([[PEER_ID, 80]]));
    loadUsersDirectory.mockResolvedValue(okPage([user({ id: PEER_ID })]));
    const { container } = await renderPage({});
    expect(suspendButtons(rowOf(container, PEER_ID))).toHaveLength(0);
  });

  it("when staff ranks cannot be read the control is drawn and the server stays the judge", async () => {
    loadStaffRanks.mockResolvedValue(null);
    loadUsersDirectory.mockResolvedValue(okPage([user({ id: SUPER_ID })]));
    const { container } = await renderPage({});
    expect(suspendButtons(rowOf(container, SUPER_ID))).toHaveLength(1);
  });

  it("without users.suspend there is never a Suspend control", async () => {
    requireAdminRoute.mockResolvedValue(acc(40, ["users.read"]));
    loadUsersDirectory.mockResolvedValue(okPage([user({ id: USER_ID })]));
    const { container } = await renderPage({});
    expect(suspendButtons(rowOf(container, USER_ID))).toHaveLength(0);
  });
});
