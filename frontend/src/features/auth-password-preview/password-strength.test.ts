import { describe, expect, it } from "vitest";
import {
  isCommonPassword,
  hasSequentialOrRepetitiveRun,
  isAccountRelated,
  evaluatePasswordStrength,
} from "./password-strength";

describe("isCommonPassword", () => {
  it("rejects well-known common passwords", () => {
    expect(isCommonPassword("password")).toBe(true);
    expect(isCommonPassword("qwerty")).toBe(true);
    expect(isCommonPassword("iloveyou")).toBe(true);
  });

  it("rejects a common password with a trailing digit suffix", () => {
    expect(isCommonPassword("password123")).toBe(true);
    expect(isCommonPassword("aladdin2024")).toBe(true);
  });

  it("is case- and punctuation-insensitive", () => {
    expect(isCommonPassword("PassWord!")).toBe(true);
  });

  it("rejects the product-specific guesses", () => {
    expect(isCommonPassword("aladdin")).toBe(true);
    expect(isCommonPassword("genie")).toBe(true);
  });

  it("accepts a genuinely uncommon passphrase", () => {
    expect(isCommonPassword("correct horse battery staple pilot")).toBe(false);
  });
});

describe("hasSequentialOrRepetitiveRun", () => {
  it("flags 4+ identical repeated characters", () => {
    expect(hasSequentialOrRepetitiveRun("aaaa1234xyz")).toBe(true);
  });

  it("flags an ascending numeric run", () => {
    expect(hasSequentialOrRepetitiveRun("xy12345678")).toBe(true);
  });

  it("flags a descending alphabetic run", () => {
    expect(hasSequentialOrRepetitiveRun("xyzdcbafoo")).toBe(true);
  });

  it("flags a keyboard-row run", () => {
    expect(hasSequentialOrRepetitiveRun("xxqwertyxx")).toBe(true);
  });

  it("does not flag a genuinely varied passphrase", () => {
    expect(hasSequentialOrRepetitiveRun("correct horse battery staple")).toBe(false);
  });
});

describe("isAccountRelated", () => {
  it("flags a password containing the email local-part", () => {
    expect(isAccountRelated("ahmedhassan99", ["ahmed.hassan@example.test"])).toBe(true);
  });

  it("flags a password that is itself contained in the identifier", () => {
    expect(isAccountRelated("ahmed", ["ahmedhassan@example.test"])).toBe(true);
  });

  it("ignores short/empty context entries", () => {
    expect(isAccountRelated("correcthorsebattery", ["a@example.test", ""])).toBe(false);
  });

  it("does not flag an unrelated password", () => {
    expect(isAccountRelated("correct horse battery staple", ["someone.else@example.test"])).toBe(false);
  });
});

describe("evaluatePasswordStrength", () => {
  const byteLength = (v: string) => new TextEncoder().encode(v).length;

  it("hard-rejects (score 0, weak) a common password even if long enough", () => {
    const s = evaluatePasswordStrength("iloveyou12345", [], 10, 72, byteLength);
    expect(s.common).toBe(true);
    expect(s.score).toBe(0);
    expect(s.level).toBe("weak");
    expect(s.acceptable).toBe(false);
  });

  it("hard-rejects an account-related password regardless of length/variety", () => {
    const s = evaluatePasswordStrength("Ahmed12345678!!", ["ahmed@example.test"], 10, 72, byteLength);
    expect(s.accountRelated).toBe(true);
    expect(s.acceptable).toBe(false);
  });

  it("never requires composition variety to be acceptable — a long lowercase passphrase passes", () => {
    const s = evaluatePasswordStrength("a genuinely long passphrase", [], 10, 72, byteLength);
    expect(s.acceptable).toBe(true);
  });

  it("composition variety only ever adds to the score, on top of an already-acceptable password", () => {
    const plain = evaluatePasswordStrength("longenoughpassphrase", [], 10, 72, byteLength);
    const varied = evaluatePasswordStrength("Long3nough!Passphrase", [], 10, 72, byteLength);
    expect(plain.acceptable).toBe(true);
    expect(varied.score).toBeGreaterThanOrEqual(plain.score);
  });

  it("marks a too-short password as unacceptable without hitting the weak-list checks", () => {
    const s = evaluatePasswordStrength("short", [], 10, 72, byteLength);
    expect(s.tooShort).toBe(true);
    expect(s.acceptable).toBe(false);
    expect(s.score).toBe(0);
  });

  it("marks an over-72-byte password as unacceptable", () => {
    const s = evaluatePasswordStrength("a".repeat(80), [], 10, 72, byteLength);
    expect(s.tooLong).toBe(true);
    expect(s.acceptable).toBe(false);
  });
});
