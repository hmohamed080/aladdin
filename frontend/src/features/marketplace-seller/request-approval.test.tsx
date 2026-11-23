import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/test/render";
import { RequestApprovalButton } from "./request-approval";
import { SellerStandingPanel } from "./standing-panel";
import { getMessages } from "@/lib/i18n/translate";

const request = vi.fn();
const refresh = vi.fn();
vi.mock("@/server/actions/marketplace-seller", () => ({ requestSellerApprovalAction: (...a: unknown[]) => request(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));

beforeEach(() => {
  request.mockReset();
  refresh.mockReset();
  request.mockResolvedValue({ ok: true });
});

describe("RequestApprovalButton", () => {
  it("sends the request for this organization and confirms it", async () => {
    renderWithI18n(<RequestApprovalButton organizationId="org-1" again={false} />, "en");
    fireEvent.click(screen.getByRole("button", { name: "Request approval" }));
    await waitFor(() => expect(request).toHaveBeenCalledWith("org-1"));
    await waitFor(() => expect(screen.getByText("Your request was sent.")).toBeTruthy());
    expect(refresh).toHaveBeenCalled();
  });

  it("is labelled 'again' after a rejection and reports a refusal without raw text", async () => {
    request.mockResolvedValue({ ok: false, code: "not_permitted" });
    renderWithI18n(<RequestApprovalButton organizationId="org-1" again />, "en");
    fireEvent.click(screen.getByRole("button", { name: "Request approval again" }));
    await waitFor(() => expect(screen.getByText("Only the showroom owner can request approval.")).toBeTruthy());
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("SellerStandingPanel", () => {
  const copy = getMessages("en").marketplaceSeller.approval;
  const panel = (status: string | null, canRequest: boolean, message: string | null = null) =>
    renderWithI18n(
      <SellerStandingPanel
        standing={status ? { status: status as never, messageAr: message ? "رسالة" : null, messageEn: message } : null}
        copy={copy}
        locale="en"
        organizationId="org-1"
        canRequest={canRequest}
      />,
      "en",
    );

  it("lets the owner ask when nothing was requested yet, and again after a rejection", () => {
    const first = panel(null, true);
    expect(screen.getByRole("button", { name: "Request approval" })).toBeTruthy();
    first.unmount();
    panel("rejected", true);
    expect(screen.getByRole("button", { name: "Request approval again" })).toBeTruthy();
  });

  it("offers no request while pending, suspended, revoked or approved, or to a non-owner", () => {
    for (const status of ["pending", "suspended", "revoked", "approved"]) {
      const view = panel(status, true);
      expect(screen.queryByRole("button")).toBeNull();
      view.unmount();
    }
    panel(null, false);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows the message the platform team wrote to the owner", () => {
    panel("rejected", true, "Please complete your details.");
    expect(screen.getByTestId("seller-owner-message").textContent).toContain("Please complete your details.");
  });
});
