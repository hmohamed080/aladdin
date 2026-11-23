import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithI18n } from "@/test/render";

const action = vi.fn();
const refresh = vi.fn();
vi.mock("server-only", () => ({}));
vi.mock("@/server/actions/craftsman-verification", () => ({ requestCraftsmanVerificationAction: (a: boolean) => action(a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const { CraftsmanVerificationCard } = await import("./craftsman-verification-card");

function renderCard(percent: number, verification: { status: string; reason: string | null } | null) {
  return renderWithI18n(<CraftsmanVerificationCard percent={percent} verification={verification} />, "en");
}

describe("CraftsmanVerificationCard", () => {
  beforeEach(() => {
    action.mockReset();
    refresh.mockReset();
  });

  it("renders nothing for an incomplete profile with no request", () => {
    const { container } = renderCard(75, null);
    expect(container).toBeEmptyDOMElement();
  });

  it("offers a safe retry when the profile is 100% but no request exists, and a failure is shown as a failure", async () => {
    action.mockResolvedValueOnce({ outcome: "failed" });
    renderCard(100, null);
    expect(screen.getByText(/has not been sent yet/i)).toBeTruthy();
    fireEvent.click(screen.getByTestId("verification-request"));
    await waitFor(() => expect(screen.getByTestId("verification-result")).toBeTruthy());
    expect(screen.getByTestId("verification-result").getAttribute("role")).toBe("alert");
    expect(screen.getByTestId("verification-result").textContent).toMatch(/couldn't send/i);
    expect(action).toHaveBeenCalledWith(false);
  });

  it("disables the button while the request is in flight, so a double press cannot file twice", async () => {
    let release: (v: { outcome: string }) => void = () => {};
    action.mockReturnValueOnce(new Promise((r) => { release = r; }));
    renderCard(100, null);
    const button = screen.getByTestId("verification-request") as HTMLButtonElement;
    fireEvent.click(button);
    fireEvent.click(button);
    expect(button.disabled).toBe(true);
    expect(action).toHaveBeenCalledTimes(1);
    release({ outcome: "submitted" });
    await waitFor(() => expect(screen.getByTestId("verification-result").textContent).toMatch(/sent for review/i));
    expect(refresh).toHaveBeenCalled();
  });

  it("shows the rejection reason and Resubmit only at 100%", async () => {
    action.mockResolvedValueOnce({ outcome: "resubmitted_after_rejection" });
    renderCard(100, { status: "rejected", reason: "documents unclear" });
    expect(screen.getByTestId("verification-reason").textContent).toBe("documents unclear");
    fireEvent.click(screen.getByTestId("verification-resubmit"));
    await waitFor(() => expect(action).toHaveBeenCalledWith(true));
  });

  it("shows the reason but no Resubmit while the profile is below 100%", () => {
    renderCard(88, { status: "rejected", reason: "documents unclear" });
    expect(screen.getByTestId("verification-reason").textContent).toBe("documents unclear");
    expect(screen.queryByTestId("verification-resubmit")).toBeNull();
    expect(screen.getByText(/complete your profile to 100% to resubmit/i)).toBeTruthy();
  });

  it.each(["submitted", "under_review", "approved"])("offers no action while the request is %s", (status) => {
    renderCard(100, { status, reason: null });
    expect(screen.queryByTestId("verification-request")).toBeNull();
    expect(screen.queryByTestId("verification-resubmit")).toBeNull();
  });
});
