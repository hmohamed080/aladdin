import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("server-only", () => ({}));
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n/provider";

vi.mock("@/server/actions/admin-forms", () => ({ approveVerificationAction: vi.fn(), rejectVerificationAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { UserVerificationControls } = await import("./user-verification-controls");

const pending = (verificationType: string) => ({ id: "99999999-9999-4999-8999-999999999999", status: "submitted", verificationType });
const show = (verificationType: string) =>
  render(
    <I18nProvider locale="en" dir="ltr">
      <UserVerificationControls userId="u1" pending={pending(verificationType)} />
    </I18nProvider>,
  );
afterEach(cleanup);

describe("UserVerificationControls", () => {
  it("makes public listing an explicit, visible choice for a professional approval (unticked by default: approving never publishes on its own)", () => {
    show("professional");
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    const box = screen.getByRole("checkbox", { name: /list this profile publicly/i }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(box.name).toBe("grantListing");
    fireEvent.click(box);
    expect(box.checked).toBe(true);
  });

  it("offers no listing choice for an identity verification", () => {
    show("identity");
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("requires a reason to reject", () => {
    show("professional");
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect((document.querySelector('textarea[name="reason"]') as HTMLTextAreaElement).required).toBe(true);
  });
});
