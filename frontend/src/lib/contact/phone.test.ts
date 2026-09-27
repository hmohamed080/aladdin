import { describe, expect, it } from "vitest";
import { DEFAULT_PHONE_COUNTRY, listPhoneCountries, toCanonicalPhone, toE164 } from "./phone";

describe("canonical profile phone (libphonenumber-js)", () => {
  it("defaults to Egypt and lists it first, without making it the only country", () => {
    const countries = listPhoneCountries();
    expect(DEFAULT_PHONE_COUNTRY).toBe("EG");
    expect(countries[0]).toEqual({ iso2: "EG", callingCode: "20" });
    expect(countries.length).toBeGreaterThan(200);
    expect(countries.some((c) => c.iso2 === "SA" && c.callingCode === "966")).toBe(true);
  });

  it("turns an Egyptian national number into canonical E.164", () => {
    expect(toCanonicalPhone("1012345678", "EG")).toEqual({
      countryIso2: "EG",
      national: "1012345678",
      e164: "+201012345678",
    });
    // The trunk-prefixed form a person commonly types resolves to the same number.
    expect(toCanonicalPhone("01012345678", "EG")?.e164).toBe("+201012345678");
  });

  it("validates against the SELECTED country's numbering plan, not Egypt's", () => {
    expect(toCanonicalPhone("501234567", "SA")?.e164).toBe("+966501234567");
    expect(toCanonicalPhone("1012345678", "SA")).toBeNull();
  });

  it("refuses anything it cannot validate rather than guessing", () => {
    expect(toCanonicalPhone("", "EG")).toBeNull();
    expect(toCanonicalPhone("123", "EG")).toBeNull();
    expect(toCanonicalPhone("not a number", "EG")).toBeNull();
  });

  it("leaves the WhatsApp-invite normalizer untouched", () => {
    expect(toE164("01002003040")).toBe("+201002003040");
  });
});
