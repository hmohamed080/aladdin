import { describe, expect, it } from "vitest";
import { canAccessAdminPath, requirementFor, type AdminAccess } from "@/lib/permissions/admin";
import { complaintErrorCode, isComplaintState, noteIsValid } from "./model";

describe("complaintErrorCode", () => {
  it("maps mp: refusals to stable codes", () => {
    expect(complaintErrorCode({ message: "mp:not_permitted", code: "42501" })).toBe("not_permitted");
    expect(complaintErrorCode({ message: "mp:invalid_transition" })).toBe("invalid_transition");
    expect(complaintErrorCode({ message: "mp:complaint_exists" })).toBe("complaint_exists");
    expect(complaintErrorCode({ message: "mp:complaint_not_allowed" })).toBe("complaint_not_allowed");
  });
  it("falls back to the Postgres code, then to unexpected, and never leaks unknown text", () => {
    expect(complaintErrorCode({ message: "boom", code: "42501" })).toBe("not_permitted");
    expect(complaintErrorCode({ message: "mp:something_new" })).toBe("unexpected");
    expect(complaintErrorCode({ message: "relation x does not exist", code: "42P01" })).toBe("unexpected");
  });
});

describe("helpers", () => {
  it("validates the note length like the database (3 to 500 after trimming)", () => {
    expect(noteIsValid("  ab ")).toBe(false);
    expect(noteIsValid("abc")).toBe(true);
    expect(noteIsValid("x".repeat(500))).toBe(true);
    expect(noteIsValid("x".repeat(501))).toBe(false);
  });
  it("knows the four states", () => {
    expect(isComplaintState("open")).toBe(true);
    expect(isComplaintState("nope")).toBe(false);
    expect(isComplaintState(undefined)).toBe(false);
  });
});

describe("the permission gate of the admin route", () => {
  const staff = (permissions: AdminAccess["permissions"]): AdminAccess => ({ isStaff: true, rank: 20, permissions, roles: [] });
  it("is a dedicated, grantable permission, not the console door", () => {
    expect(requirementFor("/admin/marketplace/payment-complaints")).toBe("marketplace_payment_complaints.review");
    expect(requirementFor("/admin/marketplace/payment-complaints/abc")).toBe("marketplace_payment_complaints.review");
  });
  it("opens for the holder and stays closed for other staff", () => {
    expect(canAccessAdminPath(staff(["marketplace_payment_complaints.review"]), "/admin/marketplace/payment-complaints")).toBe(true);
    expect(canAccessAdminPath(staff(["users.read", "notification_templates.manage"]), "/admin/marketplace/payment-complaints")).toBe(false);
    expect(canAccessAdminPath(staff(["marketplace_payment_complaints.review"]), "/admin/marketplace")).toBe(true);
  });
});
