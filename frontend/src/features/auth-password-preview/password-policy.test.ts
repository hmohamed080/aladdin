import { describe, expect, it } from "vitest";
import { AGE_CONFIRMATION_FIELD, ageConfirmationSchema, ageConfirmedFromForm, ageConfirmationError, staffRegistrationSchema, registrationIssueCode, passwordSchema, registrationSchema, resetPasswordSchema, PASSWORD_MIN_LENGTH, PASSWORD_MAX_BYTES, passwordByteLength } from "./password-policy";

describe("passwordSchema", () => {
  it("rejects a password shorter than the minimum", () => {
    const result = passwordSchema.safeParse("short");
    expect(result.success).toBe(false);
  });

  it("accepts a password exactly at the minimum length", () => {
    const result = passwordSchema.safeParse("a".repeat(PASSWORD_MIN_LENGTH));
    expect(result.success).toBe(true);
  });

  it("allows spaces (passphrases)", () => {
    const result = passwordSchema.safeParse("correct horse battery staple");
    expect(result.success).toBe(true);
  });

  it("imposes no composition rule — an all-lowercase 15+ char string passes", () => {
    const result = passwordSchema.safeParse("aaaaaaaaaaaaaaa");
    expect(result.success).toBe(true);
  });

  it("rejects a password over the 72-byte bcrypt limit", () => {
    const result = passwordSchema.safeParse("a".repeat(PASSWORD_MAX_BYTES + 1));
    expect(result.success).toBe(false);
  });

  it("accepts exactly 72 bytes", () => {
    const result = passwordSchema.safeParse("a".repeat(PASSWORD_MAX_BYTES));
    expect(result.success).toBe(true);
  });

  it("counts multi-byte characters by BYTE length, not character count", () => {
    // Arabic letters are typically 2 bytes in UTF-8 — 40 chars can exceed 72 bytes.
    const arabic40 = "ا".repeat(40);
    expect(passwordByteLength(arabic40)).toBeGreaterThan(72);
    expect(passwordSchema.safeParse(arabic40).success).toBe(false);
  });
});

describe("registrationSchema", () => {
  const base = { displayName: "Mona Adel", email: "person@example.test", accountType: "installer_technician", password: "a-very-long-passphrase-1", ageConfirmed: true };

  it("accepts a complete registration with no confirm-password", () => {
    expect(registrationSchema.safeParse(base).success).toBe(true);
  });

  it.each([[undefined], [false], ["true"], ["on"], [1], [null]])("requires the 18+ attestation to be literally true (%s)", (value) => {
    const parsed = registrationSchema.safeParse({ ...base, ageConfirmed: value });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toBe("authPasswordPreview.error.ageNotConfirmed");
      expect(registrationIssueCode(parsed.error.issues[0])).toBe("authPasswordPreview.error.ageNotConfirmed");
    }
  });

  it("has no username and no birth date field any more: stray values are stripped, never required", () => {
    const parsed = registrationSchema.safeParse({ ...base, username: "x", birthDate: "2015-01-01" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(Object.keys(parsed.data).sort()).toEqual(["accountType", "ageConfirmed", "displayName", "email", "password"]);
  });

  it("rejects an invalid email", () => {
    expect(registrationSchema.safeParse({ ...base, email: "not-an-email" }).success).toBe(false);
  });
});

describe("age confirmation contract (shared with the UI)", () => {
  it("exports the field name the form must send", () => {
    expect(AGE_CONFIRMATION_FIELD).toBe("ageConfirmed");
  });

  it("the schema accepts only boolean true", () => {
    expect(ageConfirmationSchema.safeParse(true).success).toBe(true);
    for (const v of [false, "true", 1, undefined, null]) expect(ageConfirmationSchema.safeParse(v).success).toBe(false);
  });

  it("reads a checkbox as confirmed only for on / true / 1", () => {
    const form = (v?: string) => {
      const f = new FormData();
      if (v !== undefined) f.set("ageConfirmed", v);
      return f;
    };
    for (const v of ["on", "true", "1"]) {
      expect(ageConfirmedFromForm(form(v))).toBe(true);
      expect(ageConfirmationError(form(v))).toBeNull();
    }
    for (const v of [undefined, "", "off", "false", "0", "yes"]) {
      expect(ageConfirmedFromForm(form(v))).toBe(false);
      expect(ageConfirmationError(form(v))).toBe("authPasswordPreview.error.ageNotConfirmed");
    }
  });

  it("the staff registration schema requires it too", () => {
    const staff = { displayName: "Mona Adel", email: "person@example.test", password: "a-very-long-passphrase-1" };
    expect(staffRegistrationSchema.safeParse({ ...staff, ageConfirmed: true }).success).toBe(true);
    const refused = staffRegistrationSchema.safeParse({ ...staff, ageConfirmed: false });
    expect(refused.success || refused.error.issues[0]?.message).toBe("authPasswordPreview.error.ageNotConfirmed");
  });
});

describe("resetPasswordSchema", () => {
  it("requires a 6-digit token", () => {
    const result = resetPasswordSchema.safeParse({
      email: "person@example.test",
      token: "12",
      password: "a-very-long-passphrase-1",
      confirmPassword: "a-very-long-passphrase-1",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid reset payload", () => {
    const result = resetPasswordSchema.safeParse({
      email: "person@example.test",
      token: "123456",
      password: "a-very-long-passphrase-1",
      confirmPassword: "a-very-long-passphrase-1",
    });
    expect(result.success).toBe(true);
  });
});

describe("registrationIssueCode", () => {
  it("never shows a raw validator message", () => {
    expect(registrationIssueCode({ message: "Expected true, received null", path: ["ageConfirmed"] })).toBe("authPasswordPreview.error.ageNotConfirmed");
    expect(registrationIssueCode({ message: "Expected string, received null", path: ["accountType"] })).toBe("authPasswordPreview.error.accountTypeRequired");
    expect(registrationIssueCode({ message: "Invalid email", path: ["email"] })).toBe("authPasswordPreview.error.invalidEmail");
  });

  it("keeps the schema's own message key", () => {
    expect(registrationIssueCode({ message: "authPasswordPreview.error.passwordCommon", path: ["password"] })).toBe("authPasswordPreview.error.passwordCommon");
  });

  it("a missing attestation is asked for by name", () => {
    const parsed = registrationSchema.safeParse({ displayName: "Mona Adel", email: "person@example.test", accountType: "installer_technician", password: "a-very-long-passphrase-1" });
    expect(parsed.success || registrationIssueCode(parsed.error.issues[0])).toBe("authPasswordPreview.error.ageNotConfirmed");
  });
});
