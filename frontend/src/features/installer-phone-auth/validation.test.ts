import { describe, expect, it } from "vitest";
import { isUsernameWellFormed } from "@/lib/identity/username";
import { checkNewPassword, parseFullName, parsePhone, toAsciiDigits } from "./validation";
import { GENERATED_USERNAME_PREFIX, generateCraftsmanUsername } from "./username";

describe("installer phone auth validation", () => {
  it("requires a name and collapses whitespace", () => {
    expect(parseFullName("  ")).toEqual({ ok: false, code: "temporaryCraftsman.error.nameRequired" });
    expect(parseFullName(null)).toEqual({ ok: false, code: "temporaryCraftsman.error.nameRequired" });
    expect(parseFullName("  أحمد   محمد ")).toEqual({ ok: true, value: "أحمد محمد" });
    expect(parseFullName("a".repeat(81))).toEqual({ ok: false, code: "temporaryCraftsman.error.nameTooLong" });
  });

  it("canonicalizes Egyptian numbers to E.164 through the canonical phone module", () => {
    for (const input of ["01012345678", "+201012345678", "00201012345678", "010 1234 5678", "٠١٠١٢٣٤٥٦٧٨"]) {
      const parsed = parsePhone(input);
      expect(parsed.ok, input).toBe(true);
      if (parsed.ok) {
        expect(parsed.value.e164).toBe("+201012345678");
        expect(parsed.value.countryIso2).toBe("EG");
      }
    }
  });

  it("rejects invalid phone numbers", () => {
    for (const input of ["", "123", "0100", "abcdefghijk", "0101234567890123", undefined]) {
      expect(parsePhone(input)).toEqual({ ok: false, code: "temporaryCraftsman.error.phoneInvalid" });
    }
  });

  it("maps Arabic-Indic and Eastern Arabic-Indic digits to ASCII", () => {
    expect(toAsciiDigits("٠١٢٣٤٥٦٧٨٩")).toBe("0123456789");
    expect(toAsciiDigits("۰۱۲۳۴۵۶۷۸۹")).toBe("0123456789");
  });

  it("applies the existing 10-character password policy, not the mockup's 6", () => {
    expect(checkNewPassword("abc12")).toEqual({ ok: false, code: "temporaryCraftsman.error.passwordTooShort" });
    expect(checkNewPassword("Qx7!tree9")).toEqual({ ok: false, code: "temporaryCraftsman.error.passwordTooShort" });
    expect(checkNewPassword("green-tiles-on-roof").ok).toBe(true);
  });

  it("rejects weak passwords (common, sequential, account-related)", () => {
    expect(checkNewPassword("password123")).toEqual({ ok: false, code: "temporaryCraftsman.error.passwordCommon" });
    expect(checkNewPassword("aaaaaaaaaaaa").ok).toBe(false);
    const phone = parsePhone("01093817264");
    if (!phone.ok) throw new Error("fixture");
    expect(checkNewPassword("x01093817264x", { phone: phone.value })).toEqual({
      ok: false,
      code: "temporaryCraftsman.error.passwordAccountRelated",
    });
  });

  it("rejects passwords over the bcrypt 72-byte cap", () => {
    expect(checkNewPassword("ب".repeat(40))).toEqual({ ok: false, code: "temporaryCraftsman.error.passwordTooLong" });
  });
});

describe("generated craftsman username", () => {
  it("always satisfies the canonical username rules", () => {
    for (let i = 0; i < 500; i += 1) {
      const username = generateCraftsmanUsername();
      expect(username.startsWith(GENERATED_USERNAME_PREFIX)).toBe(true);
      expect(isUsernameWellFormed(username), username).toBe(true);
    }
  });

  it("is random, not derived from the phone or name", () => {
    const seen = new Set(Array.from({ length: 200 }, () => generateCraftsmanUsername()));
    expect(seen.size).toBe(200);
  });

  it("uses only unbiased bytes from the random source", () => {
    // 252+ are rejected; the rest map deterministically.
    const bytes = [255, 254, 253, 252, 0, 1, 2, 3, 4, 5, 6, 7, 0, 0, 0, 0];
    const username = generateCraftsmanUsername((buffer) => {
      buffer.set(bytes.slice(0, buffer.length));
      return buffer;
    });
    expect(username).toBe("craftsman.abcdefgh");
  });
});
