import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen, within, fireEvent } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n/context";
import { ADMIN_PERMISSIONS, type AdminAccess } from "@/lib/permissions/admin";
import type { AdminAssignment, AdminRoleRow, AdminStaffMember } from "@/server/queries/admin-rbac";
import { en } from "@/lib/i18n/messages/en";

/**
 * Admin Staff page - the role boundary of the Invite / Change role / Add role flows (Admin Core stabilization).
 *
 * An Administrator (rank 80, no `roles.manage`) must NEVER be offered Super Admin - or any role at or above their
 * own rank - in any role picker, must see no management action against Super Admin or against themselves, and the
 * "Invite Admin Staff" dialog must not carry a role picker at all. A Super Admin keeps the controls they may use.
 * These are presentation rules only: `admin_staff_assign_role` / `admin_staff_change_role` re-check every rank
 * ceiling in the database, which this test does not replace.
 */
const requireAdminRoute = vi.fn();
const listAdminStaff = vi.fn();
const listAdminRoles = vi.fn();
const withAccountEmails = vi.fn();

const ME = "55555555-5555-4555-8555-555555555555";
const SUPER = "70000099-0000-4000-8000-000000000099";
const MODERATOR = "70000060-0000-4000-8000-000000000060";

const ALL = [...ADMIN_PERMISSIONS];
const ADMIN_PERMS = ALL.filter((p) => p !== "roles.manage");
const acc = (rank: number, permissions: readonly (typeof ALL)[number][]): AdminAccess => ({ isStaff: true, rank, permissions, roles: [] });
const administrator = acc(80, ADMIN_PERMS);
const superAdmin = acc(100, ALL);

vi.mock("@/server/authorization/admin", () => ({ requireAdminRoute: (...a: unknown[]) => requireAdminRoute(...a) }));
vi.mock("@/lib/supabase/server", () => ({
  getServerSupabase: vi.fn(async () => ({ auth: { getUser: async () => ({ data: { user: { id: ME } } }) } })),
}));
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => ({ get: () => ({ value: "en" }) })) }));
vi.mock("@/server/queries/admin-rbac", () => ({
  listAdminStaff: (...a: unknown[]) => listAdminStaff(...a),
  listAdminRoles: (...a: unknown[]) => listAdminRoles(...a),
  listAdminPermissions: vi.fn(async () => []),
  withAccountEmails: (...a: unknown[]) => withAccountEmails(...a),
}));
vi.mock("@/server/actions/admin-rbac", () => ({
  assignRoleAction: vi.fn(),
  changeStaffRoleAction: vi.fn(),
  createRoleAction: vi.fn(),
  updateRoleAction: vi.fn(),
  setRoleArchivedAction: vi.fn(),
  setStaffDisabledAction: vi.fn(),
  unassignRoleAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/admin/preview/staff",
  useSearchParams: () => new URLSearchParams(),
}));

const { default: AdminStaffPage } = await import("./page");

const role = (id: string, key: string, rank: number, permissions: string[]): AdminRoleRow => ({
  id,
  key,
  name: key,
  description: "",
  rank,
  scopeType: "platform",
  isSystem: true,
  status: "active",
  staffCount: 0,
  permissions,
  lockedPermissions: [],
});

const ROLES: AdminRoleRow[] = [
  role("r-super", "super_admin", 100, ALL),
  role("r-admin", "administrator", 80, ADMIN_PERMS),
  role("r-mod", "moderator", 60, ["users.read", "users.verify"]),
  role("r-support", "support", 40, ["users.read"]),
];

const assignment = (roleKey: string, rank: number): AdminAssignment => ({
  id: `a-${roleKey}`,
  roleId: `r-${roleKey}`,
  roleKey,
  roleName: roleKey,
  isSystem: true,
  rank,
  roleStatus: "active",
  scopeType: "platform",
  scopeOrganizationId: null,
  scopeOrganizationName: null,
  isActive: true,
  createdAt: "2026-10-01T00:00:00Z",
  deactivatedAt: null,
  deactivationKind: null,
});

const member = (userId: string, name: string, roleKey: string, rank: number): AdminStaffMember => ({
  userId,
  displayName: name,
  email: null,
  accountStatus: "active",
  isActive: true,
  firstAssignedAt: "2026-10-01T00:00:00Z",
  lastSignInAt: null,
  assignments: [assignment(roleKey, rank)],
  rank,
});

const STAFF = [member(ME, "Platform Admin", "administrator", 80), member(SUPER, "Super Person", "super_admin", 100), member(MODERATOR, "Mo Derator", "moderator", 60)];

async function renderPage(searchParams: Record<string, string> = {}) {
  const ui = await AdminStaffPage({ searchParams: Promise.resolve(searchParams) });
  return render(
    <I18nProvider locale="en" dir="ltr">
      {ui}
    </I18nProvider>,
  );
}

const rowOf = (container: HTMLElement, name: string) => {
  const cell = Array.from(container.querySelectorAll("tbody tr")).find((tr) => tr.textContent?.includes(name));
  if (!cell) throw new Error(`row ${name} not found`);
  return cell as HTMLElement;
};
/** Opens (never submits) every Change role / Add role dialog on the page, then reads the role pickers. */
const openRolePickers = () => {
  for (const b of screen.getAllByRole("button", { name: /^(change role|add role)$/i })) fireEvent.click(b);
};
const optionTexts = () => Array.from(document.querySelectorAll('select[name="roleId"] option')).map((o) => o.textContent?.trim());
const names = en.admin.preview.staff.roleNames as Record<string, string>;
// the labels the assertions below rely on must exist (an undefined name would match every button)
if (!en.admin.preview.staff.invite || !en.admin.preview.staff.rolesTab.create || !en.admin.preview.staff.rolesTab.edit) throw new Error("missing labels");

beforeEach(() => {
  requireAdminRoute.mockReset();
  requireAdminRoute.mockResolvedValue(administrator);
  listAdminStaff.mockReset();
  listAdminStaff.mockResolvedValue(STAFF);
  listAdminRoles.mockReset();
  listAdminRoles.mockResolvedValue(ROLES);
  withAccountEmails.mockReset();
  withAccountEmails.mockImplementation(async (_s: unknown, _a: unknown, rows: AdminStaffMember[]) => rows);
});
afterEach(cleanup);

describe("Admin Staff - Administrator role boundary", () => {
  it("never offers Super Admin (or any role at or above their rank) in any role picker", async () => {
    await renderPage();
    openRolePickers();
    const offered = optionTexts();
    expect(offered.length).toBeGreaterThan(0);
    expect(offered).not.toContain(names.super_admin);
    expect(offered).not.toContain(names.administrator);
    expect(offered).toEqual(expect.arrayContaining([names.moderator, names.support]));
  });

  it("shows no management action on the Super Admin row or on the viewer's own row", async () => {
    const { container } = await renderPage();
    expect(within(rowOf(container, "Super Person")).queryAllByRole("button")).toHaveLength(0);
    expect(within(rowOf(container, "Platform Admin")).queryAllByRole("button")).toHaveLength(0);
  });

  it("does offer management on a lower-ranked member", async () => {
    const { container } = await renderPage();
    expect(within(rowOf(container, "Mo Derator")).queryAllByRole("button").length).toBeGreaterThan(0);
  });

  it("the Invite Admin Staff dialog carries no role picker, so it cannot grant Super Admin", async () => {
    await renderPage();
    const trigger = screen.getByRole("button", { name: en.admin.preview.staff.invite });
    expect(trigger).toBeTruthy();
    // the invite form's own fields: name + email only (the role pickers all live in per-row Change/Add role dialogs)
    const dialog = trigger.parentElement as HTMLElement;
    expect(dialog.querySelectorAll("select")).toHaveLength(0);
    expect(dialog.textContent ?? "").not.toContain(names.super_admin);
  });

  it("has no Create role or Edit role control without roles.manage", async () => {
    await renderPage({ tab: "roles" });
    expect(screen.queryByRole("button", { name: en.admin.preview.staff.rolesTab.create })).toBeNull();
    expect(screen.queryAllByRole("button", { name: en.admin.preview.staff.rolesTab.edit })).toHaveLength(0);
  });
});

describe("Admin Staff - Super Admin keeps what they may use", () => {
  it("is offered every role in the pickers, and may manage a lower member but not themselves", async () => {
    requireAdminRoute.mockResolvedValue(superAdmin);
    listAdminStaff.mockResolvedValue([member(ME, "Platform Admin", "super_admin", 100), member(MODERATOR, "Mo Derator", "moderator", 60)]);
    const { container } = await renderPage();
    expect(within(rowOf(container, "Platform Admin")).queryAllByRole("button")).toHaveLength(0);
    openRolePickers();
    expect(optionTexts()).toEqual(expect.arrayContaining([names.super_admin, names.administrator, names.moderator]));
    expect(within(rowOf(container, "Mo Derator")).queryAllByRole("button").length).toBeGreaterThan(0);
  });

  it("sees Create role on the Roles tab", async () => {
    requireAdminRoute.mockResolvedValue(superAdmin);
    await renderPage({ tab: "roles" });
    expect(screen.getAllByRole("button", { name: en.admin.preview.staff.rolesTab.create }).length).toBeGreaterThan(0);
  });
});

describe("Admin Staff - email", () => {
  it("shows the email resolved by withAccountEmails and a dash only when none exists", async () => {
    withAccountEmails.mockImplementation(async (_s: unknown, _a: unknown, rows: AdminStaffMember[]) =>
      rows.map((r) => (r.userId === SUPER ? { ...r, email: "super@example.test" } : r)),
    );
    const { container } = await renderPage();
    expect(rowOf(container, "Super Person").textContent).toContain("super@example.test");
    expect(rowOf(container, "Mo Derator").textContent).not.toContain("@");
  });
});
