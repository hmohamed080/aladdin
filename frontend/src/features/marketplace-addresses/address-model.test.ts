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
  recipient_first_name: "Sara",
  recipient_last_name: "Ali",
  recipient_phone_e164: "+201012345678",
};

describe("address draft validation", () => {
  it("accepts a complete address and normalises empty optionals to null", () => {
    const r = addressDraftSchema.parse({ ...base, nickname: " ", building: "", latitude: "", longitude: null });
    expect(r.nickname).toBeNull();
    expect(r.building).toBeNull();
    expect(r.latitude).toBeNull();
    expect(r.location_source).toBe("manual");
    expect(r.make_default).toBe(false);
  });

  it("accepts a governorate with no area", () => {
    expect(addressDraftSchema.safeParse({ ...base, area_key: "" }).success).toBe(true);
  });

  it.each([
    ["unknown governorate", { governorate_key: "atlantis" }, "governorate"],
    ["area of another governorate", { governorate_key: "giza", area_key: "maadi" }, "area"],
    ["short street", { street: "ab" }, "street"],
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
    expect(toBuyerPlace({ governorate_key: "cairo", area_key: null })).toEqual({ gov: "cairo", area: "" });
    // an area that is not in the catalogue collapses to the governorate instead of promising a wrong estimate
    expect(toBuyerPlace({ governorate_key: "cairo", area_key: "nowhere" })).toEqual({ gov: "cairo", area: "" });
  });

  it("words the place in either language", () => {
    expect(placeLabel({ governorate_key: "cairo", area_key: "maadi" }, "en")).toBe("Maadi, Cairo");
    expect(placeLabel({ governorate_key: "cairo", area_key: "maadi" }, "ar")).toBe("المعادي، القاهرة");
    expect(placeLabel({ governorate_key: "giza", area_key: null }, "en")).toBe("Giza");
  });

  it("builds the street line from the filled parts only", () => {
    const labels = { building: "building", floorApartment: "floor / apt" };
    expect(streetLine({ street: "Road 9", district: null, building: "4", floor_apartment: "3 / 7" }, labels)).toBe("Road 9، building 4، floor / apt 3 / 7");
    expect(streetLine({ street: "Road 9", district: null, building: null, floor_apartment: null }, labels)).toBe("Road 9");
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
