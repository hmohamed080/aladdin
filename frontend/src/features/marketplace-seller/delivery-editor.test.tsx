import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/test/render";
import { DeliveryEditor } from "./delivery-editor";

const saveTerms = vi.fn();
const pickup = vi.fn();
const listFree = vi.fn();
const setFree = vi.fn();
const refresh = vi.fn();
vi.mock("@/server/actions/marketplace-seller", () => ({
  saveSellerDeliveryTermsAction: (...a: unknown[]) => saveTerms(...a),
  setSellerPickupAction: (...a: unknown[]) => pickup(...a),
  listFreeShippingProductsAction: (...a: unknown[]) => listFree(...a),
  setProductFreeShippingAction: (...a: unknown[]) => setFree(...a),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));

const ORG = "11111111-1111-4111-8111-111111111111";
const PLACES = [
  { governorate_key: "cairo", area_key: null, fee_egp: "80.00" },
  { governorate_key: "cairo", area_key: "maadi", fee_egp: null },
  { governorate_key: "giza", area_key: null, fee_egp: null },
];
const NO_TERMS = { duration_min_days: null, duration_max_days: null, next_day_available: false, next_day_fee_egp: null, free_shipping_min_egp: null };
const save = () => fireEvent.click(screen.getByRole("button", { name: "Save delivery settings" }));
const fee = (place: RegExp) => screen.getByLabelText(new RegExp(`${place.source} — Delivery fee`));

beforeEach(() => {
  saveTerms.mockReset();
  pickup.mockReset();
  listFree.mockReset();
  setFree.mockReset();
  refresh.mockReset();
});

describe("delivery settings editor", () => {
  it("lists each covered place with its fee; an unset fee is blank", () => {
    renderWithI18n(<DeliveryEditor organizationId={ORG} initialRates={PLACES} initialPickup={false} />, "en");
    expect(fee(/Cairo \(All areas\)/)).toHaveValue("80");
    expect(fee(/Cairo — Maadi/)).toHaveValue("");
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
    expect(screen.getByRole("link", { name: "Add delivery areas" })).toHaveAttribute("href", "/showroom/marketplace/areas");
  });

  it("lists what still blocks publishing, and says when nothing does", () => {
    const { unmount } = renderWithI18n(
      <DeliveryEditor organizationId={ORG} initialRates={[]} initialPickup={false} initialMissing={["preparation_days_missing", "payment_method_missing"]} />,
      "en",
    );
    expect(screen.getByText("Complete these before you can publish products")).toBeInTheDocument();
    expect(screen.getByText("Set your preparation days.")).toBeInTheDocument();
    expect(screen.getByText("Turn on at least one payment method.")).toBeInTheDocument();
    unmount();
    renderWithI18n(<DeliveryEditor organizationId={ORG} initialRates={[]} initialPickup={false} initialMissing={[]} />, "en");
    expect(screen.getByText("Delivery and payment are complete")).toBeInTheDocument();
  });

  it("refuses a wrong fee by naming the place, and sends nothing", () => {
    renderWithI18n(<DeliveryEditor organizationId={ORG} initialRates={PLACES} initialPickup={false} />, "en");
    fireEvent.change(fee(/Cairo — Maadi/), { target: { value: "abc" } });
    save();
    expect(screen.getByText(/Cairo — Maadi: enter a fee from 0 to 100,000/)).toBeInTheDocument();
    expect(saveTerms).not.toHaveBeenCalled();
  });

  it("refuses a delivery range with only one bound, and a bad preparation value", () => {
    renderWithI18n(<DeliveryEditor organizationId={ORG} initialRates={[PLACES[0]!]} initialPickup={false} />, "en");
    fireEvent.change(screen.getByLabelText(/Cairo \(All areas\) — Delivery takes from/), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText(/^Preparation days/), { target: { value: "99" } });
    save();
    expect(screen.getByText(/Cairo \(All areas\): enter both delivery days/)).toBeInTheDocument();
    expect(screen.getByText("Preparation days must be a whole number from 0 to 30.")).toBeInTheDocument();
    expect(saveTerms).not.toHaveBeenCalled();
  });

  it("requires a fee for next-day delivery", () => {
    renderWithI18n(<DeliveryEditor organizationId={ORG} initialRates={[PLACES[0]!]} initialPickup={false} />, "en");
    fireEvent.click(screen.getByRole("checkbox", { name: "Offer next-day delivery here" }));
    save();
    expect(screen.getByText(/Cairo \(All areas\): enter the next-day fee/)).toBeInTheDocument();
    expect(saveTerms).not.toHaveBeenCalled();
  });

  it("saves the settings and every place's terms at once - Arabic digits as numbers, blanks as null - and refreshes", async () => {
    saveTerms.mockResolvedValue({ ok: true, missing: ["payment_method_missing"] });
    renderWithI18n(<DeliveryEditor organizationId={ORG} initialRates={PLACES} initialPickup={false} />, "en");
    fireEvent.change(screen.getByLabelText(/^Preparation days/), { target: { value: "٢" } });
    fireEvent.change(screen.getByLabelText(/Free shipping from order value/), { target: { value: "5000" } });
    fireEvent.change(fee(/Cairo — Maadi/), { target: { value: "١٢٠٫٥" } });
    fireEvent.change(screen.getByLabelText(/Cairo \(All areas\) — Delivery takes from/), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText(/Cairo \(All areas\) — to \(days\)/), { target: { value: "3" } });
    fireEvent.click(screen.getAllByRole("checkbox", { name: "Offer next-day delivery here" })[0]!);
    fireEvent.change(screen.getByLabelText(/Cairo \(All areas\) — Extra fee for next day/), { target: { value: "40" } });
    save();
    await waitFor(() => expect(saveTerms).toHaveBeenCalledTimes(1));
    expect(saveTerms).toHaveBeenCalledWith(
      ORG,
      { preparation_days: 2, free_shipping_min_egp: 5000, pickup_instructions: null },
      [
        { governorate_key: "cairo", area_key: null, fee_egp: 80, ...NO_TERMS, duration_min_days: 1, duration_max_days: 3, next_day_available: true, next_day_fee_egp: 40 },
        { governorate_key: "cairo", area_key: "maadi", fee_egp: 120.5, ...NO_TERMS },
        { governorate_key: "giza", area_key: null, fee_egp: null, ...NO_TERMS },
      ],
    );
    expect(await screen.findByText("Delivery settings saved.")).toBeInTheDocument();
    expect(screen.getByText("Turn on at least one payment method.")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("clears a fee when its box is emptied", async () => {
    saveTerms.mockResolvedValue({ ok: true, missing: [] });
    renderWithI18n(<DeliveryEditor organizationId={ORG} initialRates={[PLACES[0]!]} initialPickup={false} />, "en");
    fireEvent.change(fee(/Cairo \(All areas\)/), { target: { value: "" } });
    save();
    await waitFor(() => expect(saveTerms).toHaveBeenCalled());
    expect(saveTerms.mock.calls[0]![2]).toEqual([{ governorate_key: "cairo", area_key: null, fee_egp: null, ...NO_TERMS }]);
  });

  it("shows the database's refusal in the showroom's language, never a raw code", async () => {
    saveTerms.mockResolvedValue({ ok: false, code: "delivery_area_unknown", detail: "giza/" });
    renderWithI18n(<DeliveryEditor organizationId={ORG} initialRates={[PLACES[0]!]} initialPickup={false} />, "ar");
    fireEvent.click(screen.getByRole("button", { name: "حفظ إعدادات التوصيل" }));
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

  it("finds products and flags one as free shipping", async () => {
    listFree.mockResolvedValue({ ok: true, flaggedCount: 0, items: [{ id: "p1", name_ar: "بلاط", name_en: "Tile", status: "draft", free_shipping: false }] });
    setFree.mockResolvedValue({ ok: true, freeShipping: true });
    renderWithI18n(<DeliveryEditor organizationId={ORG} initialRates={[]} initialPickup={false} freeShippingCount={0} />, "en");
    fireEvent.click(screen.getByRole("button", { name: "Search your products" }));
    const box = await screen.findByRole("checkbox", { name: "Free shipping on Tile" });
    fireEvent.click(box);
    await waitFor(() => expect(setFree).toHaveBeenCalledWith(ORG, "p1", true));
    await waitFor(() => expect(box).toBeChecked());
    expect(screen.getByText("1 products ship free.")).toBeInTheDocument();
  });
});
