import { describe, expect, it } from "vitest";
import { mapRbacError } from "./admin-rbac-errors";

// Messages are the exact RPC texts from 20260929100001_admin_rbac_foundation.sql.
const cases: [string, string, string][] = [
  ["42501", "the last active Super Admin cannot be removed", "admin.rbac.error.lastSuperAdmin"],
  ["42501", "you cannot change your own Admin roles", "admin.rbac.error.self"],
  ["42501", "target is not an existing Admin Staff member", "admin.rbac.error.notStaff"],
  ["22023", "a reason is required", "admin.rbac.error.reasonRequired"],
  ["22023", "a role name is required", "admin.rbac.error.nameRequired"],
  ["23505", "a role with this name already exists", "admin.rbac.error.duplicate"],
  ["23505", "this role is already assigned at this scope", "admin.rbac.error.duplicate"],
  ["42501", "the Super Admin role is locked", "admin.rbac.error.locked"],
  ["42501", "core permissions of a system role cannot be removed", "admin.rbac.error.locked"],
  ["42501", "system role identity is immutable", "admin.rbac.error.locked"],
  ["42501", "system roles cannot be archived", "admin.rbac.error.locked"],
  ["42501", "role rank must be below your own rank (80)", "admin.rbac.error.ceiling"],
  ["42501", "you can only manage staff below your own rank", "admin.rbac.error.ceiling"],
  ["42501", "you cannot assign a role at or above your own authority", "admin.rbac.error.ceiling"],
  ["42501", "the current role is above your authority", "admin.rbac.error.ceiling"],
  ["42501", "cannot grant permission points.adjust you do not hold", "admin.rbac.error.ceiling"],
  ["42501", "role is not assignable", "admin.rbac.error.notAssignable"],
  ["22023", "staff member is already disabled", "admin.rbac.error.noChange"],
  ["22023", "nothing to restore", "admin.rbac.error.noChange"],
  ["42501", "admin permission roles.manage required", "admin.rbac.error.denied"],
];

describe("mapRbacError", () => {
  it.each(cases)("[%s] %s → %s", (code, message, key) => {
    expect(mapRbacError({ code, message })).toBe(key);
  });

  it("never leaks a raw database string", () => {
    expect(mapRbacError({ code: "XX000", message: "internal: relation foo" })).toBe("states.genericRetry");
    expect(mapRbacError(null)).toBe("states.genericRetry");
  });
});
