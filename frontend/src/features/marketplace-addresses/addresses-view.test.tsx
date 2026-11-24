import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithI18n } from "@/test/render";
import { AddressesView } from "./addresses-view";
import type { SavedAddress } from "./address-model";

const refresh = vi.fn();
const save = vi.fn();
const del = vi.fn();
const setDefault = vi.fn();
const start = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/server/actions/marketplace-addresses", () => ({
  saveBuyerAddressAction: (...a: unknown[]) => save(...a),
  deleteBuyerAddressAction: (...a: unknown[]) => del(...a),
  setDefaultBuyerAddressAction: (...a: unknown[]) => setDefault(...a),
}));
vi.mock("@/server/actions/phone-verification", () => ({
  startPrimaryPhoneVerification: (...a: unknown[]) => start(...a),
  verifyPrimaryPhone: vi.fn(),
}));

const ACCT = "+201012345678";
function address(over: Partial<SavedAddress> = {}): SavedAddress {
  return {
    id: "11111111-1111-4111-8111-111111111111", kind: "home", nickname: null, governorate_key: "cairo", area_key: "maadi", district: null,
    street: "Road 9", building: "4", floor_apartment: null, directions: null, latitude: null, longitude: null, location_source: "manual",
    recipient_first_name: "Sara", recipient_last_name: "Ali", recipient_phone_e164: ACCT, recipient_phone_verified: false, is_default: true,
    created_at: "2026-11-24T10:00:00Z", ...over,
  };
}
const none = { provider: "none" } as const;

beforeEach(() => {
  [refresh, save, del, setDefault, start].forEach((m) => m.mockReset());
});

describe("addresses view", () => {
  it("shows the empty state and lets the buyer add", () => {
    renderWithI18n(<AddressesView addresses={[]} accountPhone={null} mapsConfig={none} />, "en");
    expect(screen.getByText("You have no saved address yet.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add an address" }));
    expect(screen.getByTestId("address-form")).toBeTruthy();
    // no map provider: the manual coordinate fallback is offered, no map
    expect(screen.getByTestId("pin-picker")).toBeTruthy();
    expect(screen.queryByTestId("google-map")).toBeNull();
    expect(screen.getByLabelText("Latitude (optional)")).toBeTruthy();
  });

  it("never prints the full mobile number and shows the derived verification state", () => {
    renderWithI18n(
      <AddressesView
        addresses={[
          address(),
          address({ id: "22222222-2222-4222-8222-222222222222", is_default: false, recipient_phone_e164: "+201099999999" }),
          address({ id: "33333333-3333-4333-8333-333333333333", is_default: false, recipient_phone_verified: true }),
        ]}
        accountPhone={ACCT}
        mapsConfig={none}
      />,
      "en",
    );
    expect(document.body.textContent).not.toContain("1012345678");
    expect(screen.getAllByTestId("phone-state-verify")).toHaveLength(1);
    expect(screen.getAllByTestId("phone-state-own")).toHaveLength(1);
    expect(screen.getAllByTestId("phone-state-ready")).toHaveLength(1);
  });

  it("asks for a code through the existing authority and says plainly when it is unavailable", async () => {
    start.mockResolvedValue({ status: "unavailable" });
    renderWithI18n(<AddressesView addresses={[address()]} accountPhone={ACCT} mapsConfig={none} />, "en");
    fireEvent.click(screen.getByRole("button", { name: "Send me a code" }));
    await waitFor(() => expect(screen.getByText("Verification is not available right now. Please try again later.")).toBeTruthy());
    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith(); // no number, no user id: the server knows the account
  });

  it("disables adding at the limit", () => {
    const ten = Array.from({ length: 10 }, (_, i) => address({ id: `11111111-1111-4111-8111-1111111111${String(i).padStart(2, "0")}`, is_default: i === 0 }));
    renderWithI18n(<AddressesView addresses={ten} accountPhone={ACCT} mapsConfig={none} />, "en");
    expect((screen.getByRole("button", { name: "Add an address" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("You have reached the limit of 10 addresses. Delete one to add another.")).toBeTruthy();
  });

  it("confirms before deleting, then deletes and refreshes", async () => {
    del.mockResolvedValue({ ok: true });
    renderWithI18n(<AddressesView addresses={[address()]} accountPhone={ACCT} mapsConfig={none} />, "en");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(del).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete address" }));
    await waitFor(() => expect(del).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111"));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("refuses an invalid form without calling the server", async () => {
    renderWithI18n(<AddressesView addresses={[]} accountPhone={null} mapsConfig={none} />, "en");
    fireEvent.click(screen.getByRole("button", { name: "Add an address" }));
    fireEvent.click(screen.getByRole("button", { name: "Save address" }));
    await waitFor(() => expect(screen.getByText("Choose a governorate.")).toBeTruthy());
    expect(save).not.toHaveBeenCalled();
  });

  it("suggests places from the catalogue while typing", () => {
    renderWithI18n(<AddressesView addresses={[]} accountPhone={null} mapsConfig={none} />, "en");
    fireEvent.click(screen.getByRole("button", { name: "Add an address" }));
    fireEvent.change(screen.getByLabelText("Search for your area"), { target: { value: "maadie" } });
    expect(screen.getByTestId("place-suggestions").textContent).toContain("Maadi, Cairo");
  });
});
