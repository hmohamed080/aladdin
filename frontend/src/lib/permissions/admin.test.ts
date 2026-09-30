import { describe, expect, it } from "vitest";
import {
  ADMIN_ROUTE_RULES,
  can,
  canAccessAdminPath,
  meets,
  NO_ADMIN_ACCESS,
  parseAdminAccess,
  requirementFor,
  type AdminAccess,
  type AdminPermission,
} from "./admin";

// Effective permissions of each system role (docs/admin/ADMIN_RBAC_ARCHITECTURE.md §4).
const SUPPORT: AdminPermission[] = ["organizations.read", "points.read", "referrals.read", "users.read"];
const MODERATOR: AdminPermission[] = [
  "job_reviews.moderate", "organizations.read", "organizations.verify", "points.read",
  "referrals.approve", "referrals.read", "users.read", "users.suspend", "users.verify",
];

function access(permissions: AdminPermission[], rank = 40): AdminAccess {
  return { isStaff: true, rank, permissions, roles: [] };
}

describe("parseAdminAccess — fails closed", () => {
  it("parses the admin_my_access() payload", () => {
    const a = parseAdminAccess({
      is_staff: true,
      rank: 80,
      permissions: ["users.read", "audit.read"],
      roles: [{ key: "administrator", name: "Administrator", is_system: true, rank: 80 }],
    });
    expect(a).toEqual({
      isStaff: true,
      rank: 80,
      permissions: ["users.read", "audit.read"],
      roles: [{ key: "administrator", name: "Administrator", isSystem: true, rank: 80 }],
    });
  });

  it("drops permission keys the app does not know (never trusts them)", () => {
    expect(parseAdminAccess({ is_staff: true, rank: 40, permissions: ["users.read", "everything.all"] }).permissions)
      .toEqual(["users.read"]);
  });

  it.each([null, undefined, "x", 3, {}, { is_staff: false, rank: 80, permissions: ["users.read"] }, { is_staff: true, rank: 0 }])(
    "treats %j as no access",
    (raw) => {
      expect(parseAdminAccess(raw)).toEqual(NO_ADMIN_ACCESS);
    },
  );
});

describe("can / meets", () => {
  it("non-staff can do nothing, even with a forged permission list", () => {
    const forged: AdminAccess = { isStaff: false, rank: 0, permissions: ["roles.manage"], roles: [] };
    expect(can(forged, "roles.manage")).toBe(false);
    expect(meets(forged, "staff")).toBe(false);
  });

  it("any-of requirements", () => {
    expect(meets(access(["roles.read"]), ["admin_staff.read", "roles.read"])).toBe(true);
    expect(meets(access(["users.read"]), ["admin_staff.read", "roles.read"])).toBe(false);
  });
});

describe("route table", () => {
  it("longest prefix wins, trailing slashes ignored", () => {
    expect(requirementFor("/admin/preview/staff")).toEqual(["admin_staff.read", "roles.read"]);
    expect(requirementFor("/admin/preview/staff/")).toEqual(["admin_staff.read", "roles.read"]);
    expect(requirementFor("/admin/preview/users/abc")).toBe("users.read");
    expect(requirementFor("/admin/users/abc")).toBe("users.read");
    expect(requirementFor("/admin/preview")).toBe("staff");
    expect(requirementFor("/admin/preview/unknown")).toBe("staff");
  });

  it("does not match on a bare string prefix (/admin/users-x is not /admin/users)", () => {
    expect(requirementFor("/admin/users-export")).toBe("staff");
  });

  it("denies anything outside /admin", () => {
    expect(canAccessAdminPath(access(MODERATOR, 60), "/b2b")).toBe(false);
  });

  it("Support (read-only) sees reads, never Points ops, Staff, Audit or Analytics", () => {
    const a = access(SUPPORT);
    expect(canAccessAdminPath(a, "/admin/preview/users")).toBe(true);
    expect(canAccessAdminPath(a, "/admin/preview/points")).toBe(true);
    expect(canAccessAdminPath(a, "/admin/preview/staff")).toBe(false);
    expect(canAccessAdminPath(a, "/admin/preview/audit")).toBe(false);
    expect(canAccessAdminPath(a, "/admin/preview/analytics")).toBe(false);
  });

  it("Moderator reaches the Review Center but not Admin Staff", () => {
    const a = access(MODERATOR, 60);
    expect(canAccessAdminPath(a, "/admin/preview/review")).toBe(true);
    expect(canAccessAdminPath(a, "/admin/preview/staff")).toBe(false);
  });

  it("every rule names only catalog permissions", () => {
    for (const rule of Object.values(ADMIN_ROUTE_RULES)) {
      const list = rule === "staff" ? [] : typeof rule === "string" ? [rule] : rule;
      for (const p of list) expect(can(access([p]), p)).toBe(true);
    }
  });
});
