import { describe, expect, it } from "vitest";
import { ADMIN_PERMISSIONS, type AdminAccess, type AdminPermission } from "@/lib/permissions/admin";
import { assignableRoles, canEditRole, canManageMember, canSuspendUser, canWieldRole, staffRankOf } from "./eligibility";

const ALL = [...ADMIN_PERMISSIONS];
const ADMIN_PERMS = ALL.filter((p) => p !== "roles.manage");

const acc = (rank: number, permissions: AdminPermission[]): AdminAccess => ({ isStaff: true, rank, permissions, roles: [] });
const superAdmin = acc(100, ALL);
const administrator = acc(80, ADMIN_PERMS);

const role = (key: string, rank: number, permissions: string[], extra: Partial<{ status: "active" | "archived"; scopeType: string }> = {}) => ({
  key, rank, permissions, status: extra.status ?? ("active" as const), scopeType: extra.scopeType ?? "platform",
});

const ROLES = [
  role("super_admin", 100, ALL),
  role("administrator", 80, ADMIN_PERMS),
  role("moderator", 60, ["users.read", "users.verify"]),
  role("support", 40, ["users.read"]),
  role("points_auditor", 30, ["points.read", "roles.manage"]),
  role("retired", 20, ["users.read"], { status: "archived" }),
  role("org_viewer", 20, ["organizations.read"], { scopeType: "organization" }),
];

describe("canWieldRole / assignableRoles", () => {
  it("an Administrator may hand out lower roles whose permissions they hold", () => {
    expect(assignableRoles(administrator, ROLES).map((r) => r.key)).toEqual(["moderator", "support"]);
  });

  it("never offers own rank, higher ranks, roles carrying unheld permissions, archived or scoped roles", () => {
    const keys = assignableRoles(administrator, ROLES).map((r) => r.key);
    expect(keys).not.toContain("administrator"); // own rank
    expect(keys).not.toContain("super_admin"); // above
    expect(keys).not.toContain("points_auditor"); // carries roles.manage, which the Administrator lacks
    expect(keys).not.toContain("retired");
    expect(keys).not.toContain("org_viewer");
  });

  it("a Super Admin may hand out every active platform role, including Super Admin", () => {
    expect(canWieldRole(superAdmin, ROLES[0]!)).toBe(true);
    expect(assignableRoles(superAdmin, ROLES)).toHaveLength(5);
  });
});

describe("canManageMember", () => {
  it("never oneself", () => {
    expect(canManageMember(superAdmin, "me", { userId: "me", rank: 100 })).toBe(false);
  });
  it("only below own rank — except a Super Admin managing a Super Admin", () => {
    expect(canManageMember(administrator, "me", { userId: "x", rank: 60 })).toBe(true);
    expect(canManageMember(administrator, "me", { userId: "x", rank: 80 })).toBe(false);
    expect(canManageMember(administrator, "me", { userId: "x", rank: 100 })).toBe(false);
    expect(canManageMember(superAdmin, "me", { userId: "x", rank: 100 })).toBe(true);
  });
  it("requires admin_staff.manage", () => {
    expect(canManageMember(acc(80, ["admin_staff.read"]), "me", { userId: "x", rank: 10 })).toBe(false);
  });
  it("a disabled member (rank 0) can be restored by anyone who manages staff", () => {
    expect(canManageMember(administrator, "me", { userId: "x", rank: 0 })).toBe(true);
  });
});

describe("canEditRole", () => {
  it("requires roles.manage, excludes Super Admin, strictly below own rank", () => {
    expect(canEditRole(administrator, { key: "support", rank: 40 })).toBe(false); // no roles.manage
    expect(canEditRole(superAdmin, { key: "super_admin", rank: 100 })).toBe(false);
    expect(canEditRole(superAdmin, { key: "administrator", rank: 80 })).toBe(true);
    expect(canEditRole(acc(70, ["roles.manage"]), { key: "x", rank: 70 })).toBe(false);
  });
});

describe("Super Admin is never assignable or manageable by a lower rank", () => {
  it("no role at or above an Administrator's rank is offered to them, and Super Admin never is", () => {
    const offered = assignableRoles(administrator, ROLES).map((r) => r.key);
    expect(offered).not.toContain("super_admin");
    expect(offered).not.toContain("administrator");
  });

  it("an Administrator may not manage a Super Admin member or an equal-rank peer", () => {
    expect(canManageMember(administrator, "me", { userId: "sa", rank: 100 })).toBe(false);
    expect(canManageMember(administrator, "me", { userId: "peer", rank: 80 })).toBe(false);
    expect(canManageMember(administrator, "me", { userId: "mod", rank: 60 })).toBe(true);
  });
});

describe("staffRankOf", () => {
  it("is null when ranks are unreadable, 0 for a non-staff user, the rank for staff", () => {
    expect(staffRankOf(null, "u")).toBeNull();
    expect(staffRankOf(new Map([["a", 80]]), "u")).toBe(0);
    expect(staffRankOf(new Map([["a", 80]]), "a")).toBe(80);
  });
});

describe("canSuspendUser", () => {
  const ME = "me";
  it("needs users.suspend", () => {
    expect(canSuspendUser(acc(40, ["users.read"]), ME, { userId: "u", staffRank: 0 })).toBe(false);
  });
  it("never on yourself, for anyone", () => {
    expect(canSuspendUser(administrator, ME, { userId: ME, staffRank: 80 })).toBe(false);
    expect(canSuspendUser(superAdmin, ME, { userId: ME, staffRank: 100 })).toBe(false);
  });
  it("an Administrator: ordinary users and lower staff yes; equal or higher rank no", () => {
    expect(canSuspendUser(administrator, ME, { userId: "u", staffRank: 0 })).toBe(true);
    expect(canSuspendUser(administrator, ME, { userId: "mod", staffRank: 60 })).toBe(true);
    expect(canSuspendUser(administrator, ME, { userId: "peer", staffRank: 80 })).toBe(false);
    expect(canSuspendUser(administrator, ME, { userId: "sa", staffRank: 100 })).toBe(false);
  });
  it("a Super Admin may act on any other user, including other Super Admins", () => {
    expect(canSuspendUser(superAdmin, ME, { userId: "sa2", staffRank: 100 })).toBe(true);
    expect(canSuspendUser(superAdmin, ME, { userId: "u", staffRank: 0 })).toBe(true);
  });
  it("an unknown rank (viewer cannot read staff) draws the control; the server decides", () => {
    expect(canSuspendUser(administrator, ME, { userId: "sa", staffRank: null })).toBe(true);
  });
});
