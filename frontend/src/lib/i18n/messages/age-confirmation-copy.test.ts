import { describe, expect, it } from "vitest";
import { en } from "./en";
import { ar } from "./ar";

/** Every key path of a nested messages object, e.g. "authPasswordPreview.signUp.title". */
function keyPaths(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => keyPaths(child, prefix ? `${prefix}.${key}` : key));
}

describe("Phase 1 copy: 18+ confirmation replaces birth date and username", () => {
  it("has the confirmation label and its typed error in both languages", () => {
    expect(en.authPasswordPreview.signUp.ageConfirmLabel).toBe("I confirm I am 18 or older");
    expect(ar.authPasswordPreview.signUp.ageConfirmLabel).toBe("أقرّ بأن عمري ١٨ عامًا أو أكثر");
    expect(en.authPasswordPreview.error.ageNotConfirmed.length).toBeGreaterThan(0);
    expect(ar.authPasswordPreview.error.ageNotConfirmed.length).toBeGreaterThan(0);
  });

  it("the sign-in copy names a mobile number or an email only", () => {
    for (const messages of [en, ar]) {
      expect(messages.authPasswordPreview.signIn.identifierLabel).not.toMatch(/username|اسم المستخدم/i);
      expect(messages.authPasswordPreview.signIn.subtitle).not.toMatch(/username|اسم المستخدم/i);
    }
    expect(en.authPasswordPreview.signIn.identifierLabel).toBe("Mobile number or email");
  });

  it("no birth-date or username key remains in either language", () => {
    for (const messages of [en, ar]) {
      expect(keyPaths(messages).filter((path) => /birth|(^|\.)username/i.test(path))).toEqual([]);
    }
  });

  it("English and Arabic have exactly the same key set (RTL/i18n parity)", () => {
    expect(keyPaths(ar).sort()).toEqual(keyPaths(en).sort());
  });
});
