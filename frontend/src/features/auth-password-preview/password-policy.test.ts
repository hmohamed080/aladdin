import { describe, expect, it } from "vitest";
import { passwordSchema, registrationSchema, resetPasswordSchema, PASSWORD_MIN_LENGTH, PASSWORD_MAX_BYTES, passwordByteLength } from "./password-policy";

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
  const base = { email: "person@example.test", password: "a-very-long-passphrase-1" };

  it("accepts matching password/confirmPassword", () => {
    const result = registrationSchema.safeParse({ ...base, confirmPassword: base.password });
    expect(result.success).toBe(true);
  });

  it("rejects a mismatched confirmation", () => {
    const result = registrationSchema.safeParse({ ...base, confirmPassword: "a-different-passphrase-1" });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid email", () => {
    const result = registrationSchema.safeParse({ email: "not-an-email", password: base.password, confirmPassword: base.password });
    expect(result.success).toBe(false);
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
