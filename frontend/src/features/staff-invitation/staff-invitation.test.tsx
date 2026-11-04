import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { en } from "@/lib/i18n/messages/en";
import { ar } from "@/lib/i18n/messages/ar";

const createStaffInvitationAction = vi.fn();
vi.mock("@/server/actions/staff-invitation", () => ({
  acceptStaffInvitationAction: vi.fn(async () => ({ ok: false, code: "staffInvitation.error.recipientMismatch" })),
  createStaffInvitationAction: (...a: unknown[]) => createStaffInvitationAction(...a),
  revokeStaffInvitationAction: vi.fn(async () => ({ ok: true })),
  requestStaffSignUp: vi.fn(),
  verifyStaffSignUp: vi.fn(),
}));
vi.mock("@/features/auth-password-preview/turnstile-widget", () => ({ TurnstileWidget: () => null }));

import { StaffInvitationEntry } from "./staff-invitation-entry";
import { StaffRegisterForm } from "./staff-register-form";
import { StaffInvitationsPanel } from "@/features/admin-staff-invitations/invitations-panel";

const pending = { status: "pending", roleName: "Administrator", emailMasked: "q•••@•••.", matchesCaller: false } as const;

describe("StaffInvitationEntry", () => {
  it("signed out: offers registration and sign-in, and no link carries the token", () => {
    renderWithI18n(<StaffInvitationEntry view={pending} isSignedIn={false} />, "en");
    expect(screen.getByRole("link", { name: en.staffInvitation.createAccount })).toHaveAttribute("href", "/auth/staff-invitation/register");
    const signIn = screen.getByRole("link", { name: en.staffInvitation.haveAccount });
    expect(signIn).toHaveAttribute("href", "/auth/sign-in?next=%2Fauth%2Fstaff-invitation");
    for (const a of document.querySelectorAll("a")) expect(a.getAttribute("href") ?? "").not.toMatch(/[0-9a-f]{64}/);
    expect(document.body.textContent).toContain("Administrator");
  });
  it("signed in as someone else: explains the mismatch and offers no accept button", () => {
    renderWithI18n(<StaffInvitationEntry view={pending} isSignedIn />, "en");
    expect(screen.getByRole("alert")).toHaveTextContent("different address");
    expect(screen.queryByRole("button", { name: en.staffInvitation.accept })).toBeNull();
  });
  it("signed in as the invited address: shows an explicit Accept", () => {
    renderWithI18n(<StaffInvitationEntry view={{ ...pending, matchesCaller: true }} isSignedIn />, "en");
    expect(screen.getByRole("button", { name: en.staffInvitation.accept })).toBeInTheDocument();
  });
  it.each(["invalid", "expired", "revoked", "accepted"] as const)("a %s invitation says so and offers nothing", (status) => {
    renderWithI18n(<StaffInvitationEntry view={{ status, roleName: null, emailMasked: null, matchesCaller: false }} isSignedIn={false} />, "en");
    expect(document.body.textContent).toContain(en.staffInvitation.states[status]);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
  it("renders in Arabic", () => {
    renderWithI18n(<StaffInvitationEntry view={pending} isSignedIn={false} />, "ar");
    expect(screen.getByRole("link", { name: ar.staffInvitation.createAccount })).toBeInTheDocument();
  });
});

describe("StaffRegisterForm (no persona)", () => {
  it("has no account-type, username or token field; password and birth date follow marketplace rules", () => {
    renderWithI18n(<StaffRegisterForm />, "en");
    const names = [...document.querySelectorAll("input, select")].map((el) => (el as HTMLInputElement).name).filter(Boolean);
    expect(names).toEqual(expect.arrayContaining(["email", "password", "displayName", "consent_terms", "consent_privacy", "consent_pilot"]));
    for (const forbidden of ["username", "accountType", "token"]) expect(names).not.toContain(forbidden);
    expect((document.querySelector("input[name=email]") as HTMLInputElement).type).toBe("email");
    expect((document.querySelector("input[name=password]") as HTMLInputElement).autocomplete).toBe("new-password");
    expect(document.querySelectorAll("form form").length).toBe(0);
  });
  it("renders in Arabic", () => {
    renderWithI18n(<StaffRegisterForm />, "ar");
    expect(document.body.textContent).toContain(ar.staffInvitation.register.intro);
  });
});

describe("StaffInvitationsPanel", () => {
  const rows = [
    { id: "r1", emailMasked: "n•••@•••.", roleName: "Moderator", status: "pending", expiresLabel: "Nov 12", invitedByName: "Owner", inviterAuthorized: true },
    { id: "r2", emailMasked: "o•••@•••.", roleName: "Administrator", status: "pending", expiresLabel: "Nov 12", invitedByName: "Owner", inviterAuthorized: false },
    { id: "r3", emailMasked: "p•••@•••.", roleName: "Moderator", status: "accepted", expiresLabel: "Nov 10", invitedByName: "Owner", inviterAuthorized: true },
  ] as const;
  const roles = [{ id: "role-1", name: "Moderator" }];

  it("lists masked addresses only, a withdraw control for pending rows, and flags an inviter who lost authority", () => {
    renderWithI18n(<StaffInvitationsPanel rows={[...rows]} roles={roles} canManage />, "en");
    expect(document.body.textContent).toContain("n•••@•••.");
    expect(document.body.textContent).not.toMatch(/@example|@staffinv/);
    expect(screen.getAllByRole("button", { name: en.staffInvitation.admin.revoke })).toHaveLength(2);
    expect(document.body.textContent).toContain(en.staffInvitation.admin.inviterUnauthorized);
  });
  it("read-only viewers (admin_staff.read without manage) see the roster but no create form and no withdraw buttons", () => {
    renderWithI18n(<StaffInvitationsPanel rows={[...rows]} roles={roles} canManage={false} />, "en");
    expect(screen.queryByLabelText(en.staffInvitation.admin.emailLabel)).toBeNull();
    expect(screen.queryByRole("button", { name: en.staffInvitation.admin.revoke })).toBeNull();
    expect(screen.queryByRole("button", { name: en.staffInvitation.admin.create })).toBeNull();
  });
  it("with no invitable role it says so instead of showing a form", () => {
    renderWithI18n(<StaffInvitationsPanel rows={[]} roles={[]} canManage />, "en");
    expect(document.body.textContent).toContain(en.staffInvitation.admin.noRoles);
    expect(screen.queryByLabelText(en.staffInvitation.admin.emailLabel)).toBeNull();
  });
  it("shows the one-time link once after creation, built from this origin, with the warning", async () => {
    createStaffInvitationAction.mockResolvedValue({ ok: true, email: "x@example.com", token: "d".repeat(64), expiresAt: "2026-11-12T00:00:00Z" });
    renderWithI18n(<StaffInvitationsPanel rows={[]} roles={roles} canManage />, "en");
    fireEvent.change(screen.getByLabelText(en.staffInvitation.admin.emailLabel), { target: { value: "x@example.com" } });
    fireEvent.change(screen.getByLabelText(en.staffInvitation.admin.reasonLabel), { target: { value: "A7 QA staff onboarding" } });
    fireEvent.submit(document.querySelector("form")!);
    const box = await screen.findByTestId("invitation-link");
    await waitFor(() => expect((box.querySelector("input") as HTMLInputElement).value).toBe(`${window.location.origin}/auth/staff-invitation/${"d".repeat(64)}`));
    expect(box.textContent).toContain(en.staffInvitation.admin.linkWarning);
  });
  it("renders in Arabic", () => {
    renderWithI18n(<StaffInvitationsPanel rows={[...rows]} roles={roles} canManage />, "ar");
    expect(document.body.textContent).toContain(ar.staffInvitation.admin.status.pending);
  });
});
