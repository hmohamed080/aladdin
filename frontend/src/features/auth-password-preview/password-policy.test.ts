import { describe, expect, it } from "vitest";
import { staffRegistrationSchema, registrationIssueCode, passwordSchema, registrationSchema, resetPasswordSchema, PASSWORD_MIN_LENGTH, PASSWORD_MAX_BYTES, passwordByteLength } from "./password-policy";

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
  const base = { displayName: "Mona Adel", email: "person@example.test", accountType: "installer_technician", password: "a-very-long-passphrase-1" };

  it("accepts a complete registration with no confirm-password", () => {
    expect(registrationSchema.safeParse(base).success).toBe(true);
  });

  it("has no age attestation, username or birth date field: stray values are stripped, never required", () => {
    const parsed = registrationSchema.safeParse({ ...base, ageConfirmed: false, username: "x", birthDate: "2015-01-01" });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(Object.keys(parsed.data).sort()).toEqual(["accountType", "displayName", "email", "password"]);
  });

  it("rejects an invalid email", () => {
    expect(registrationSchema.safeParse({ ...base, email: "not-an-email" }).success).toBe(false);
  });
});

describe("staff registration", () => {
  it("needs only name, email and password (no age attestation)", () => {
    const staff = { displayName: "Mona Adel", email: "person@example.test", password: "a-very-long-passphrase-1" };
    expect(staffRegistrationSchema.safeParse(staff).success).toBe(true);
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
    expect(registrationIssueCode({ message: "Expected string, received null", path: ["accountType"] })).toBe("authPasswordPreview.error.accountTypeRequired");
    expect(registrationIssueCode({ message: "Invalid email", path: ["email"] })).toBe("authPasswordPreview.error.invalidEmail");
  });

  it("keeps the schema's own message key", () => {
    expect(registrationIssueCode({ message: "authPasswordPreview.error.passwordCommon", path: ["password"] })).toBe("authPasswordPreview.error.passwordCommon");
  });
});
