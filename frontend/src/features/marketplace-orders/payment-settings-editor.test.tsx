import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/test/render";
import { PaymentSettingsEditor } from "./payment-settings-editor";
import type { PaymentSettings } from "./contract";

const savePayment = vi.fn();
vi.mock("@/server/actions/marketplace-orders", () => ({
  savePaymentSettingsAction: (...a: unknown[]) => savePayment(...a),
}));

const ORG = "11111111-1111-4111-8111-111111111111";
const BASE: PaymentSettings = {
  cod_enabled: false,
  instapay_enabled: false,
  instapay_full_enabled: false,
  instapay_address: null,
  instapay_account_name: null,
  instapay_deposit_percent: null,
  can_edit: true,
};
const save = () => fireEvent.click(screen.getByRole("button", { name: "Save payment methods" }));

beforeEach(() => savePayment.mockReset());

describe("payment methods editor", () => {
  it("warns that buyers cannot order while no method is on", () => {
    renderWithI18n(<PaymentSettingsEditor organizationId={ORG} initial={BASE} />, "en");
    expect(screen.getByText(/No payment method is on/)).toBeInTheDocument();
  });

  it("asks for the InstaPay account when full payment is on, and sends nothing without it", () => {
    renderWithI18n(<PaymentSettingsEditor organizationId={ORG} initial={BASE} />, "en");
    fireEvent.click(screen.getByRole("checkbox", { name: "Accept full payment by InstaPay" }));
    save();
    expect(screen.getByText("Enter the InstaPay address and the account holder name.")).toBeInTheDocument();
    expect(savePayment).not.toHaveBeenCalled();
  });

  it("saves InstaPay full payment together with cash on delivery", async () => {
    savePayment.mockResolvedValue({ ok: true, settings: BASE });
    renderWithI18n(<PaymentSettingsEditor organizationId={ORG} initial={BASE} />, "en");
    fireEvent.click(screen.getByRole("checkbox", { name: "Accept cash on delivery" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Accept full payment by InstaPay" }));
    fireEvent.change(screen.getByLabelText(/^InstaPay address or mobile number/), { target: { value: "shop@instapay" } });
    fireEvent.change(screen.getByLabelText(/^Account holder name/), { target: { value: "Nile Interiors" } });
    save();
    await waitFor(() => expect(savePayment).toHaveBeenCalledTimes(1));
    expect(savePayment).toHaveBeenCalledWith(ORG, {
      cod_enabled: true,
      instapay_enabled: false,
      instapay_full_enabled: true,
      instapay_address: "shop@instapay",
      instapay_account_name: "Nile Interiors",
      instapay_deposit_percent: null,
    });
    expect(await screen.findByText("Payment methods saved.")).toBeInTheDocument();
  });

  it("still requires the deposit share for the InstaPay deposit", () => {
    renderWithI18n(<PaymentSettingsEditor organizationId={ORG} initial={{ ...BASE, instapay_address: "a@b", instapay_account_name: "Shop" }} />, "en");
    fireEvent.click(screen.getByRole("checkbox", { name: "Accept InstaPay deposits" }));
    save();
    expect(screen.getByText("Enter a whole number from 1 to 100.")).toBeInTheDocument();
    expect(savePayment).not.toHaveBeenCalled();
  });

  it("shows the Arabic copy", () => {
    renderWithI18n(<PaymentSettingsEditor organizationId={ORG} initial={BASE} />, "ar");
    expect(screen.getByText("إنستاباي (دفع كامل)")).toBeInTheDocument();
  });
});
