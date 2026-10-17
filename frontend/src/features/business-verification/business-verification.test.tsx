import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/test/render";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/supabase/client", () => ({ createBrowserSupabaseClient: vi.fn() }));
vi.mock("@/server/actions/business-verification", () => ({
  requestBvUploadAction: vi.fn(),
  confirmBvUploadAction: vi.fn(),
  removeBvDocumentAction: vi.fn(),
  submitBvAction: vi.fn(),
  startBvReviewAction: vi.fn(),
  requestBvInfoAction: vi.fn(),
  approveBvAction: vi.fn(),
  rejectBvAction: vi.fn(),
}));

import { BvAdminActions } from "./admin-actions";
import { BvOwnerPanel } from "./owner-panel";

const ID = "11111111-1111-4111-8111-111111111111";

describe("BvAdminActions draws only what the database allows this reviewer", () => {
  it("offers approve and reject to an approver on an open request", () => {
    renderWithI18n(<BvAdminActions id={ID} status="under_review" canReview canDecide />, "en");
    expect(screen.getByRole("button", { name: "Approve and verify" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reject" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Request information" })).toBeTruthy();
  });
  it("lets a Moderator review and ask for information but never decide", () => {
    renderWithI18n(<BvAdminActions id={ID} status="under_review" canReview canDecide={false} />, "en");
    expect(screen.queryByRole("button", { name: "Approve and verify" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
    expect(screen.getByRole("button", { name: "Request information" })).toBeTruthy();
  });
  it("shows nothing on a decided request or to a non-reviewer", () => {
    const { container } = renderWithI18n(<BvAdminActions id={ID} status="verified" canReview canDecide />, "en");
    expect(container.textContent).toBe("");
    const other = renderWithI18n(<BvAdminActions id={ID} status="pending" canReview={false} canDecide />, "en");
    expect(other.container.textContent).toBe("");
  });
});

describe("BvOwnerPanel", () => {
  it("asks for an answer on a resubmission, in Arabic", () => {
    renderWithI18n(<BvOwnerPanel orgId={ID} drafts={[]} canUpload canSubmit isResubmission />, "ar");
    expect(screen.getByLabelText("ردك على المراجع")).toBeTruthy();
    expect(screen.getByRole("button", { name: "إرسال مرة أخرى" })).toBeTruthy();
  });
  it("hides the send button when the request cannot be sent", () => {
    renderWithI18n(<BvOwnerPanel orgId={ID} drafts={[]} canUpload canSubmit={false} isResubmission={false} />, "en");
    expect(screen.queryByTestId("bv-submit")).toBeNull();
    expect(screen.getByTestId("bv-add-document")).toBeTruthy();
  });
});
