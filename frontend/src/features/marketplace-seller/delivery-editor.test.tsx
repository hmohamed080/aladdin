import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/test/render";
import { DeliveryEditor } from "./delivery-editor";

const savePrices = vi.fn();
const pickup = vi.fn();
const refresh = vi.fn();
vi.mock("@/server/actions/marketplace-seller", () => ({
  saveSellerPricesAction: (...a: unknown[]) => savePrices(...a),
  setSellerPickupAction: (...a: unknown[]) => pickup(...a),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));

const ORG = "11111111-1111-4111-8111-111111111111";
const feeInputs = () => screen.getAllByRole("textbox") as HTMLInputElement[];
const PLACES = [
  { governorate_key: "cairo", area_key: null, fee_egp: "80.00" },
  { governorate_key: "cairo", area_key: "maadi", fee_egp: null },
  { governorate_key: "giza", area_key: null, fee_egp: null },
];

beforeEach(() => {
  savePrices.mockReset();
  pickup.mockReset();
  refresh.mockReset();
});

describe("delivery prices editor", () => {
  it("lists each covered place with its price; an unset price is blank", () => {
    renderWithI18n(<DeliveryEditor organizationId={ORG} initialRates={PLACES} initialPickup={false} />, "en");
    expect(screen.getByLabelText(/Cairo \(All areas\) — Delivery fee/)).toHaveValue("80");
    expect(screen.getByLabelText(/Cairo — Maadi — Delivery fee/)).toHaveValue("");
    expect(feeInputs()).toHaveLength(3);
    expect(screen.getByText("2 places have no price yet — buyers cannot choose delivery there.")).toBeInTheDocument();
  });

  it("shows the places in Arabic", () => {
    renderWithI18n(<DeliveryEditor organizationId={ORG} initialRates={[PLACES[0]!, PLACES[1]!]} initialPickup={false} />, "ar");
    expect(screen.getByText("القاهرة (كل المناطق)")).toBeInTheDocument();
    expect(screen.getByText("القاهرة — المعادي")).toBeInTheDocument();
  });

  it("sends the showroom to the Areas page when it covers nowhere yet", () => {
    renderWithI18n(<DeliveryEditor organizationId={ORG} initialRates={[]} initialPickup={false} />, "en");
    expect(screen.getByText(/you have not added any delivery areas yet/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add delivery areas" })).toHaveAttribute("href", "/b2c/seller/areas");
    expect(screen.queryByRole("button", { name: "Save prices" })).not.toBeInTheDocument();
  });

  it("refuses a wrong price by naming the place, and sends nothing", () => {
    renderWithI18n(<DeliveryEditor organizationId={ORG} initialRates={PLACES} initialPickup={false} />, "en");
    fireEvent.change(feeInputs()[1]!, { target: { value: "abc" } });
    fireEvent.click(screen.getByRole("button", { name: "Save prices" }));
    expect(screen.getByText(/Cairo — Maadi: enter a fee from 0 to 100,000/)).toBeInTheDocument();
    expect(savePrices).not.toHaveBeenCalled();
  });

  it("saves every price at once - a blank one as null, Arabic digits as numbers - and refreshes", async () => {
    savePrices.mockResolvedValue({ ok: true, saved: 3 });
    renderWithI18n(<DeliveryEditor organizationId={ORG} initialRates={PLACES} initialPickup={false} />, "en");
    fireEvent.change(feeInputs()[1]!, { target: { value: "١٢٠٫٥" } });
    fireEvent.change(feeInputs()[2]!, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Save prices" }));
    await waitFor(() => expect(savePrices).toHaveBeenCalledTimes(1));
    expect(savePrices).toHaveBeenCalledWith(ORG, [
      { governorate_key: "cairo", area_key: null, fee_egp: 80 },
      { governorate_key: "cairo", area_key: "maadi", fee_egp: 120.5 },
      { governorate_key: "giza", area_key: null, fee_egp: 0 },
    ]);
    expect(await screen.findByText("Prices saved.")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("clears a price when its box is emptied", async () => {
    savePrices.mockResolvedValue({ ok: true, saved: 1 });
    renderWithI18n(<DeliveryEditor organizationId={ORG} initialRates={[PLACES[0]!]} initialPickup={false} />, "en");
    fireEvent.change(feeInputs()[0]!, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save prices" }));
    await waitFor(() => expect(savePrices).toHaveBeenCalledWith(ORG, [{ governorate_key: "cairo", area_key: null, fee_egp: null }]));
  });

  it("shows the database's refusal in the showroom's language, never a raw code", async () => {
    savePrices.mockResolvedValue({ ok: false, code: "delivery_area_unknown", detail: "giza/" });
    renderWithI18n(<DeliveryEditor organizationId={ORG} initialRates={[PLACES[0]!]} initialPickup={false} />, "ar");
    fireEvent.click(screen.getByRole("button", { name: "حفظ الأسعار" }));
    expect(await screen.findByText("هذا المكان ليس ضمن مناطق التوصيل لديك. أضِفه أولًا من صفحة المناطق: giza/.")).toBeInTheDocument();
  });

  it("switches pickup on and off through the database", async () => {
    pickup.mockResolvedValue({ ok: true, pickupAvailable: true });
    renderWithI18n(<DeliveryEditor organizationId={ORG} initialRates={[]} initialPickup={false} />, "en");
    const box = screen.getByRole("checkbox", { name: "Buyers can choose to pick up" });
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    await waitFor(() => expect(pickup).toHaveBeenCalledWith(ORG, true));
    await waitFor(() => expect(box).toBeChecked());
    expect(screen.getByText("Pickup setting saved.")).toBeInTheDocument();
  });
});
