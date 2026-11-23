import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { listPhoneCountries } from "@/lib/contact/phone";
import { strengthOf } from "@/features/auth-password-preview/password-policy";
import { describe, it, expect } from "vitest";
import { authFormWithinLimit } from "./form-limits";
import { loginPasswordSchema, passwordSchema, passwordByteLength, registrationSchema, resetPasswordSchema } from "@/features/auth-password-preview/password-policy";
import { parsePhone, checkNewPassword } from "@/features/installer-phone-auth/validation";
describe("shared authentication boundaries", () => {
    it.each(["x", "short", " spaces "])("permits an existing password without strength checks: %s", value => expect(loginPasswordSchema.safeParse(value).success).toBe(true));
    it.each([null, undefined, 42, "", "x".repeat(73), "ب".repeat(37), "😀".repeat(19)])("rejects unsupported login input", value => expect(loginPasswordSchema.safeParse(value).success).toBe(false));
    it.each(["ب".repeat(36), "😀".repeat(18), "x".repeat(72)])("accepts exactly 72 UTF-8 bytes", value => {
        expect(passwordByteLength(value)).toBe(72);
        expect(loginPasswordSchema.safeParse(value).success).toBe(true);
        expect(passwordSchema.safeParse(value).success).toBe(true);
    });
    it("counts Unicode code points for the new-password minimum", () => expect(passwordSchema.safeParse("😀".repeat(5)).success).toBe(false));
    it("never trims or transforms a password", () => {
        const value = "  café blue roof  ";
        expect(checkNewPassword(value)).toEqual({ ok: true, value });
    });
    it("bounds all form fields before allocation/provider operations", () => {
        const form = new FormData();
        form.set("password", "x".repeat(1000000));
        expect(authFormWithinLimit(form)).toBe(false);
        form.set("password", "ب".repeat(5000));
        expect(authFormWithinLimit(form)).toBe(false);
        form.set("password", "ordinary password");
        expect(authFormWithinLimit(form)).toBe(true);
    });
    it("rejects files, excessive field counts and keys", () => {
        const form = new FormData();
        form.set("password", new Blob(["abc"]));
        expect(authFormWithinLimit(form)).toBe(false);
        form.delete("password");
        form.set("x".repeat(65), "a");
        expect(authFormWithinLimit(form)).toBe(false);
        form.delete("x".repeat(65));
        for (let i = 0; i < 17; i++)
            form.set(String(i), "a");
        expect(authFormWithinLimit(form)).toBe(false);
    });
    it("bounds confirmation on the reset schema", () => {
        expect(resetPasswordSchema.safeParse({ email: "sam@example.test", token: "123456", password: "green-tiles-on-roof", confirmPassword: "x".repeat(1000000) }).success).toBe(false);
    });
    it("bounds the password on the shared signup schema", () => {
        expect(registrationSchema.safeParse({ displayName: "Sam", email: "sam@example.test", accountType: "showroom_dealer", password: "x".repeat(1000000) }).success).toBe(false);
        expect(registrationSchema.safeParse({ displayName: "Sam", email: "sam@example.test", accountType: "showroom_dealer", password: "green-tiles-on-roof" }).success).toBe(true);
    });
});
describe("selected-country phone validation", () => {
    it.each([
        ["01012345678", "EG", "+201012345678"],
        ["٠١٠١٢٣٤٥٦٧٨", "EG", "+201012345678"],
        ["+201012345678", "EG", "+201012345678"],
        ["00201012345678", "EG", "+201012345678"],
        ["+1 202 555 0123", "US", "+12025550123"],
        ["07400 123456", "GB", "+447400123456"],
        ["0912 345 678", "VN", "+84912345678"],
        ["050 123 4567", "AE", "+971501234567"],
    ])("canonicalizes %s for %s", (number, country, e164) => {
        const result = parsePhone(number, country);
        expect(result.ok).toBe(true);
        if (result.ok)
            expect(result.value.e164).toBe(e164);
    });
    it.each([["0151234", "EG"], ["01912345678", "EG"], ["01012345678", "US"], ["+12025550123", "EG"], ["+20201012345678", "EG"], ["01012345678", "ZZ"], ["x".repeat(1000000), "EG"]])("rejects wrong pattern/country/code duplication", (number, country) => expect(parsePhone(number, country).ok).toBe(false));
});

it("uses the same Unicode character minimum in the shared strength indicator", () => {
 expect(strengthOf("😀".repeat(5)).tooShort).toBe(true);
 expect(strengthOf("😀".repeat(10)).sequential).toBe(true);
 expect(strengthOf("x".repeat(1000000)).tooLong).toBe(true);
});
it("ships a static safe flag asset for every supported phone country", () => {
 for(const {iso2} of listPhoneCountries()) {
  const file=resolve("public/assets/country-flags/"+iso2.toLowerCase()+".svg");
  expect(existsSync(file),iso2).toBe(true);
  expect(readFileSync(file,"utf8")).not.toMatch(/<script|<foreignObject|href=["']https?:/i);
 }
});

it("rejects non-FormData action arguments before reading fields", () => { for (const value of [null, undefined, "payload", 12, {}]) expect(authFormWithinLimit(value)).toBe(false); });
