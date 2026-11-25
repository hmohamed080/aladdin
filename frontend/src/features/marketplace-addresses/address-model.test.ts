import { describe, expect, it } from "vitest";
import {
  MAX_ADDRESSES,
  addressDraftSchema,
  canAddAddress,
  firstAddressIssue,
  maskPhone,
  phoneState,
  placeLabel,
  streetLine,
  toBuyerPlace,
} from "./address-model";

const base = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "home",
  governorate_key: "cairo",
  area_key: "maadi",
  street: "12 Road 9",
  building: "4",
  floor: "3",
  apartment: "7",
  landmark: "next to the pharmacy",
  recipient_first_name: "Sara",
  recipient_last_name: "Ali",
  recipient_phone_e164: "+201012345678",
};

describe("address draft validation", () => {
  it("accepts a complete address and normalises empty optionals to null", () => {
    const r = addressDraftSchema.parse({ ...base, nickname: " ", latitude: "", longitude: null });
    expect(r.nickname).toBeNull();
    expect(r.floor).toBe("3");
    expect(r.latitude).toBeNull();
    expect(r.location_source).toBe("manual");
    expect(r.make_default).toBe(false);
  });

  it("always requires the area, even when a location is shared", () => {
    expect(firstAddressIssue({ ...base, area_key: "" })?.field).toBe("area");
    expect(firstAddressIssue({ ...base, area_key: "", latitude: 30.04, longitude: 31.23, location_source: "device" })?.field).toBe("area");
  });

  it("needs street, building, floor, apartment and landmark without coordinates, and none with them", () => {
    expect(firstAddressIssue({ ...base, street: "" })?.field).toBe("street");
    expect(firstAddressIssue({ ...base, building: "" })?.field).toBe("building");
    expect(firstAddressIssue({ ...base, floor: "" })?.field).toBe("floor");
    expect(firstAddressIssue({ ...base, apartment: "" })?.field).toBe("apartment");
    expect(firstAddressIssue({ ...base, landmark: "" })?.field).toBe("landmark");
    const shared = { ...base, street: "", building: "", floor: "", apartment: "", landmark: "", latitude: "30.044420", longitude: "31.235712", location_source: "device" };
    expect(addressDraftSchema.safeParse(shared).success).toBe(true);
    // a street that IS given must still be a real street
    expect(firstAddressIssue({ ...shared, street: "ab" })?.field).toBe("street");
  });

  it("accepts floor, apartment and landmark within their limits", () => {
    expect(addressDraftSchema.safeParse({ ...base, floor: "3", apartment: "7", landmark: "next to the pharmacy" }).success).toBe(true);
    expect(firstAddressIssue({ ...base, landmark: "x".repeat(121) })).not.toBeNull();
    expect(firstAddressIssue({ ...base, floor: "x".repeat(21) })).not.toBeNull();
  });

  it("refuses a device source without coordinates", () => {
    expect(firstAddressIssue({ ...base, location_source: "device" })?.field).toBe("pin");
  });

  it.each([
    ["unknown governorate", { governorate_key: "atlantis" }, "governorate"],
    ["area of another governorate", { governorate_key: "giza", area_key: "maadi" }, "area"],
    ["short street", { street: "ab" }, "street"],
    ["missing building", { building: "" }, "building"],
    ["missing landmark", { landmark: "" }, "landmark"],
    ["empty first name", { recipient_first_name: "  " }, "name"],
    ["local-format mobile", { recipient_phone_e164: "01012345678" }, "phone"],
    ["line break in the street", { street: "12 Road\n9" }, "characters"],
    ["latitude without longitude", { latitude: 30.04 }, "pin"],
    ["pin outside Egypt", { latitude: 48.85, longitude: 2.35 }, "pinOutside"],
    ["map source without a pin", { location_source: "map" }, "pin"],
  ])("refuses %s", (_name, patch, field) => {
    expect(firstAddressIssue({ ...base, ...patch })?.field).toBe(field);
  });

  it("accepts a pin inside Egypt typed as text", () => {
    const r = addressDraftSchema.parse({ ...base, latitude: "30.044420", longitude: "31.235712", location_source: "map" });
    expect(r.latitude).toBeCloseTo(30.04442);
  });
});

describe("address presentation", () => {
  it("maps a saved address onto the delivery place showrooms use", () => {
    expect(toBuyerPlace({ governorate_key: "cairo", area_key: "maadi" })).toEqual({ gov: "cairo", area: "maadi" });
    expect(toBuyerPlace({ governorate_key: "cairo", area_key: "" })).toEqual({ gov: "cairo", area: "" });
    // an area that is not in the catalogue collapses to the governorate instead of promising a wrong estimate
    expect(toBuyerPlace({ governorate_key: "cairo", area_key: "nowhere" })).toEqual({ gov: "cairo", area: "" });
  });

  it("words the place in either language", () => {
    expect(placeLabel({ governorate_key: "cairo", area_key: "maadi" }, "en")).toBe("Maadi, Cairo");
    expect(placeLabel({ governorate_key: "cairo", area_key: "maadi" }, "ar")).toBe("المعادي، القاهرة");
    expect(placeLabel({ governorate_key: "giza", area_key: "" }, "en")).toBe("Giza");
  });

  it("builds the street line from the filled parts only", () => {
    const labels = { building: "building", floor: "floor", apartment: "apartment" };
    const none = { district: null, floor: null, apartment: null, landmark: null };
    expect(streetLine({ ...none, street: "Road 9", building: "4", floor: "3", apartment: "7", landmark: "Pharmacy" }, labels)).toBe("Road 9، building 4، floor 3، apartment 7، Pharmacy");
    expect(streetLine({ ...none, street: "Road 9", building: null }, labels)).toBe("Road 9");
    expect(streetLine({ ...none, street: null, building: null }, labels)).toBe("");
  });

  it("never repeats a full number", () => {
    expect(maskPhone("+201012345678")).toBe("+20••••••••78");
    expect(maskPhone("+201012345678")).not.toContain("1012345");
  });

  it("derives what the buyer must do about the mobile", () => {
    const acct = "+201012345678";
    expect(phoneState({ recipient_phone_e164: acct, recipient_phone_verified: true }, acct)).toBe("ready");
    expect(phoneState({ recipient_phone_e164: acct, recipient_phone_verified: false }, acct)).toBe("verify");
    expect(phoneState({ recipient_phone_e164: "+201099999999", recipient_phone_verified: false }, acct)).toBe("own_number_only");
    expect(phoneState({ recipient_phone_e164: acct, recipient_phone_verified: false }, null)).toBe("own_number_only");
  });

  it("caps the list at ten", () => {
    expect(MAX_ADDRESSES).toBe(10);
    expect(canAddAddress(9)).toBe(true);
    expect(canAddAddress(10)).toBe(false);
  });
});
