import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/test/render";
import { CheckoutPhoneStep } from "./checkout-phone-step";

const refresh = vi.fn();
const setPhone = vi.fn();
const start = vi.fn();
const verify = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/server/actions/profile-identity", () => ({ setPhoneAction: (...a: unknown[]) => setPhone(...a) }));
vi.mock("@/server/actions/phone-verification", () => ({
  startPrimaryPhoneVerification: (...a: unknown[]) => start(...a),
  verifyPrimaryPhone: (...a: unknown[]) => verify(...a),
}));

const ACCT = "+201012345678";
const changed = vi.fn();

beforeEach(() => {
  [refresh, setPhone, start, verify, changed].forEach((m) => m.mockReset());
});

describe("checkout mobile step", () => {
  it("lets an account without a number add one, then asks the checkout again", async () => {
    setPhone.mockResolvedValue({ ok: true });
    renderWithI18n(<CheckoutPhoneStep account={{ e164: null, verified: false }} recipientPhone={null} onChanged={changed} />, "en");
    const save = screen.getByRole("button", { name: "Save number" });
    expect(save).toBeDisabled();
    fireEvent.change(document.getElementById("checkout-phone")!, { target: { value: "1012345678" } });
    fireEvent.click(save);
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
    const fd = setPhone.mock.calls[0]![1] as FormData;
    expect(fd.get("e164")).toBe(ACCT);
    expect(fd.get("countryIso2")).toBe("EG");
    expect(refresh).toHaveBeenCalled();
  });

  it("shows why a number could not be saved and asks nothing again", async () => {
    setPhone.mockResolvedValue({ ok: false, code: "profileIdentity.phone.unavailable" });
    renderWithI18n(<CheckoutPhoneStep account={{ e164: null, verified: false }} recipientPhone={null} onChanged={changed} />, "en");
    fireEvent.change(document.getElementById("checkout-phone")!, { target: { value: "1012345678" } });
    fireEvent.click(screen.getByRole("button", { name: "Save number" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(changed).not.toHaveBeenCalled();
  });

  it("verifies the account number in place and then asks the checkout again", async () => {
    start.mockResolvedValue({ status: "already_verified" });
    renderWithI18n(<CheckoutPhoneStep account={{ e164: ACCT, verified: false }} recipientPhone={ACCT} onChanged={changed} />, "en");
    expect(screen.getByTestId("phone-verify-panel")).toBeInTheDocument();
    expect(screen.queryByText(ACCT)).toBeNull(); // masked
    expect(screen.queryByRole("link", { name: "Edit addresses" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Send me a code" }));
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
  });

  it("explains an address that names another number", () => {
    renderWithI18n(<CheckoutPhoneStep account={{ e164: ACCT, verified: true }} recipientPhone="+201099999999" onChanged={changed} />, "en");
    expect(screen.getByRole("link", { name: "Edit addresses" })).toHaveAttribute("href", "/settings/addresses");
    expect(screen.queryByTestId("phone-verify-panel")).toBeNull();
  });
});
