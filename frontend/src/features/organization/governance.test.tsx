import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";
import { en } from "@/lib/i18n/messages/en";
import { ar } from "@/lib/i18n/messages/ar";
import { mapGovernanceError } from "@/server/actions/error-mapping";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/server/actions/organization-governance", () => ({
  requestIdentityChangeAction: vi.fn(),
  withdrawIdentityChangeAction: vi.fn(),
  createBranchAction: vi.fn(),
  requestBranchVerificationAction: vi.fn(),
  setBranchActiveAction: vi.fn(),
  requestCoOwnerVerificationAction: vi.fn(),
}));
vi.mock("@/server/actions/organization-i18n", () => ({
  updateOrganizationI18nAction: vi.fn(),
  updateBranchI18nAction: vi.fn(),
}));
vi.mock("@/server/actions/organization-profile", () => ({
  setBranchLocationAction: vi.fn(),
  saveLegalNameAction: vi.fn(),
}));

import { IdentityChangePanel, type IdentityChangeView } from "./identity-change-panel";
import { BranchGovernance, branchState, type BranchGovernanceRow } from "./branch-governance";
import { CoOwnerSection, type CoOwnerRow } from "./co-owner-section";

beforeEach(() => vi.clearAllMocks());

const identity = (over: Partial<IdentityChangeView> = {}): IdentityChangeView => ({
  locked: true,
  name: "Alpha Showroom",
  nameAr: null,
  nameEn: null,
  requestStatus: null,
  proposed: null,
  reason: null,
  ...over,
});

const branch = (over: Partial<BranchGovernanceRow> = {}): BranchGovernanceRow => ({
  id: "b1",
  name: "Alexandria",
  nameAr: null,
  nameEn: null,
  addressAr: null,
  addressEn: "12 Corniche",
  timezone: null,
  isActive: true,
  locationVerified: false,
  reviewStatus: null,
  reviewReason: null,
  hasUnreviewedChanges: false,
  ...over,
});

describe("identity change panel", () => {
  it("is not shown for an organization whose name is not verified yet", () => {
    renderWithI18n(<IdentityChangePanel orgId="o1" view={identity({ locked: false })} />, "en");
    expect(screen.queryByTestId("identity-panel")).toBeNull();
  });

  it("offers a request, never a direct edit, for a verified name", () => {
    renderWithI18n(<IdentityChangePanel orgId="o1" view={identity()} />, "en");
    expect(screen.getByRole("button", { name: en.governance.identity.request })).toBeTruthy();
    expect(screen.queryByRole("button", { name: en.governance.identity.withdraw })).toBeNull();
  });

  it("shows a pending request with its proposed name and a withdraw control, and no second request", () => {
    renderWithI18n(
      <IdentityChangePanel
        orgId="o1"
        view={identity({ requestStatus: "pending_review", proposed: { name: "Alpha Group" } })}
      />,
      "en",
    );
    expect(screen.getByText(en.governance.identity.status.pending_review)).toBeTruthy();
    expect(screen.getByTestId("identity-proposed").textContent).toContain("Alpha Group");
    expect(screen.getByRole("button", { name: en.governance.identity.withdraw })).toBeTruthy();
    expect(screen.queryByRole("button", { name: en.governance.identity.request })).toBeNull();
  });

  it("shows the reviewer's reason and a corrected-request control after a rejection", () => {
    renderWithI18n(
      <IdentityChangePanel
        orgId="o1"
        view={identity({ requestStatus: "rejected", proposed: { name: "X" }, reason: "Licence mismatch." })}
      />,
      "en",
    );
    expect(screen.getByTestId("identity-reason").textContent).toContain("Licence mismatch.");
    expect(screen.getByRole("button", { name: en.governance.identity.requestCorrected })).toBeTruthy();
  });

  it("renders in Arabic", () => {
    renderWithI18n(<IdentityChangePanel orgId="o1" view={identity()} />, "ar");
    expect(screen.getByRole("button", { name: ar.governance.identity.request })).toBeTruthy();
  });
});

describe("branch governance", () => {
  it("a new branch is internal, never presented as a verified location", () => {
    renderWithI18n(<BranchGovernance m={en} orgId="o1" rows={[branch()]} orgIsApproved />, "en");
    expect(screen.getByTestId("branch-internal")).toBeTruthy();
    expect(screen.getByText(en.governance.branches.status.internal)).toBeTruthy();
    expect(screen.queryByText(en.governance.branches.status.verified)).toBeNull();
    expect(screen.getByRole("button", { name: en.governance.branches.requestVerification })).toBeTruthy();
  });

  it("a pending request is not verified and cannot be requested twice", () => {
    renderWithI18n(<BranchGovernance m={en} orgId="o1" rows={[branch({ reviewStatus: "pending_review" })]} orgIsApproved />, "en");
    expect(screen.getByTestId("branch-pending_review")).toBeTruthy();
    expect(screen.queryByText(en.governance.branches.status.verified)).toBeNull();
    expect(screen.queryByRole("button", { name: en.governance.branches.requestVerification })).toBeNull();
  });

  it("a verified branch with unreviewed edits stays verified, says so, and offers the amendment", () => {
    renderWithI18n(
      <BranchGovernance m={en} orgId="o1" rows={[branch({ locationVerified: true, hasUnreviewedChanges: true })]} orgIsApproved />,
      "en",
    );
    expect(screen.getByText(en.governance.branches.status.verified)).toBeTruthy();
    expect(screen.getByTestId("branch-unreviewed")).toBeTruthy();
    expect(screen.getByRole("button", { name: en.governance.branches.requestAmendment })).toBeTruthy();
  });

  it("a rejected amendment shows its reason and keeps the verified state", () => {
    renderWithI18n(
      <BranchGovernance
        m={en}
        orgId="o1"
        rows={[branch({ locationVerified: true, reviewStatus: "rejected", reviewReason: "Address unclear." })]}
        orgIsApproved
      />,
      "en",
    );
    expect(screen.getByTestId("branch-review-reason").textContent).toContain("Address unclear.");
  });

  it("offers no add-branch control while the organization is not approved", () => {
    renderWithI18n(<BranchGovernance m={en} orgId="o1" rows={[branch()]} orgIsApproved={false} />, "en");
    expect(screen.queryByRole("button", { name: en.governance.branches.add })).toBeNull();
    expect(screen.queryByRole("button", { name: en.governance.branches.requestVerification })).toBeNull();
  });

  it("derives the state: a review status wins, otherwise verified / internal", () => {
    expect(branchState({ locationVerified: false, reviewStatus: null })).toBe("internal");
    expect(branchState({ locationVerified: true, reviewStatus: null })).toBe("verified");
    expect(branchState({ locationVerified: true, reviewStatus: "needs_changes" })).toBe("needs_changes");
  });
});

describe("co-owner section", () => {
  const row = (over: Partial<CoOwnerRow> = {}): CoOwnerRow => ({
    organizationId: "o1",
    name: "Alpha Showroom",
    relationship: "member",
    requestStatus: null,
    reason: null,
    canRequest: true,
    ...over,
  });

  it("a plain member can only ask for verification - they are not shown as an owner", () => {
    renderWithI18n(<CoOwnerSection rows={[row()]} />, "en");
    expect(screen.getByTestId("co-owner-member")).toBeTruthy();
    expect(screen.getByText(en.governance.coOwner.relationship.member)).toBeTruthy();
    expect(screen.getByRole("button", { name: en.governance.coOwner.request })).toBeTruthy();
  });

  it("shows a verified co-owner without a request control", () => {
    renderWithI18n(<CoOwnerSection rows={[row({ relationship: "verified_co_owner", canRequest: false })]} />, "en");
    expect(screen.getByText(en.governance.coOwner.relationship.verified_co_owner)).toBeTruthy();
    expect(screen.queryByRole("button", { name: en.governance.coOwner.request })).toBeNull();
  });

  it("renders nothing when the person belongs to no approved organization", () => {
    renderWithI18n(<CoOwnerSection rows={[]} />, "en");
    expect(screen.queryByTestId("co-owner-section")).toBeNull();
  });
});

describe("governance error mapping", () => {
  it("maps the database hints to stable keys", () => {
    expect(mapGovernanceError({ code: "22023", hint: "change_pending" })).toBe("governance.errors.changePending");
    expect(mapGovernanceError({ code: "23505", hint: "slug_taken" })).toBe("governance.errors.slugTaken");
    expect(mapGovernanceError({ code: "22023", hint: "org_not_approved" })).toBe("governance.errors.orgNotApproved");
    expect(mapGovernanceError({ code: "23505", hint: "duplicate_branch_name" })).toBe("governance.errors.duplicateBranch");
    expect(mapGovernanceError({ code: "42501" })).toBe("governance.errors.denied");
    expect(mapGovernanceError({ code: "XX000" })).toBe("states.genericRetry");
  });
});

describe("registered location on a branch", () => {
  it("shows the governorate and city given at registration, and offers an edit", () => {
    renderWithI18n(
      <BranchGovernance
        m={en}
        orgId="o1"
        rows={[branch()]}
        orgIsApproved
        locations={{ b1: { governorate: "cairo", city: "maadi", cityCustomName: null } }}
      />,
      "en",
    );
    expect(screen.getByTestId("branch-location").textContent).toBe("Cairo - Maadi");
    expect(screen.getByRole("button", { name: "Edit location" })).toBeTruthy();
  });

  it("shows a typed city exactly as entered, and Arabic names in Arabic", () => {
    renderWithI18n(
      <BranchGovernance
        m={en}
        orgId="o1"
        rows={[branch()]}
        orgIsApproved
        locations={{ b1: { governorate: "giza", city: null, cityCustomName: "Hay El Gamaa" } }}
      />,
      "ar",
    );
    expect(screen.getByTestId("branch-location").textContent).toBe("الجيزة - Hay El Gamaa");
  });

  it("draws no location line for a branch that never had one", () => {
    renderWithI18n(<BranchGovernance m={en} orgId="o1" rows={[branch()]} orgIsApproved />, "en");
    expect(screen.queryByTestId("branch-location")).toBeNull();
  });
});
