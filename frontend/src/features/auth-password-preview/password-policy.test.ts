import { describe, expect, it } from "vitest";
import { parseBirthDate, passwordSchema, registrationSchema, resetPasswordSchema, PASSWORD_MIN_LENGTH, PASSWORD_MAX_BYTES, passwordByteLength } from "./password-policy";

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
  const base = { displayName: "Mona Adel", email: "person@example.test", username: "validuser123", accountType: "installer_technician", password: "a-very-long-passphrase-1", birthDate: "1990-05-17" };

  it("accepts a complete registration with no confirm-password", () => {
    expect(registrationSchema.safeParse(base).success).toBe(true);
  });

  it("requires an adult birthday", () => {
    const missing = registrationSchema.safeParse({ ...base, birthDate: undefined });
    expect(missing.success || missing.error.issues[0]?.message).toBe("authPasswordPreview.error.birthDateRequired");
    const child = registrationSchema.safeParse({ ...base, birthDate: `${new Date().getFullYear() - 10}-01-01` });
    expect(child.success || child.error.issues[0]?.message).toBe("authPasswordPreview.error.birthDateTooYoung");
  });

  it("rejects an invalid email", () => {
    expect(registrationSchema.safeParse({ ...base, email: "not-an-email" }).success).toBe(false);
  });
});

describe("parseBirthDate", () => {
  const today = new Date(Date.UTC(2026, 9, 28));

  it("accepts someone who turned 18 today, and refuses someone who turns 18 tomorrow", () => {
    expect(parseBirthDate("2008-10-28", today)).toEqual({ ok: true, value: "2008-10-28" });
    expect(parseBirthDate("2008-10-29", today)).toEqual({ ok: false, code: "authPasswordPreview.error.birthDateTooYoung" });
  });

  it("refuses impossible or out-of-range dates", () => {
    for (const raw of ["1990-02-30", "1899-12-31", "17/05/1990", "1990-5-17"]) {
      expect(parseBirthDate(raw, today)).toEqual({ ok: false, code: "authPasswordPreview.error.birthDateInvalid" });
    }
    expect(parseBirthDate("", today)).toEqual({ ok: false, code: "authPasswordPreview.error.birthDateRequired" });
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
