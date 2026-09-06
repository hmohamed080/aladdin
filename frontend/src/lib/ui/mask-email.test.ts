import { describe, expect, it } from "vitest";
import { maskEmail } from "./mask-email";

describe("maskEmail", () => {
  it("keeps the first character and the whole domain, masks the rest of the local part", () => {
    expect(maskEmail("sayed@example.test")).toBe("s••••@example.test");
  });

  it("masks a one-character local part as itself plus one dot, never zero", () => {
    expect(maskEmail("a@example.test")).toBe("a•@example.test");
  });

  it("returns the input unchanged when it is not a real email shape", () => {
    expect(maskEmail("not-an-email")).toBe("not-an-email");
  });
});
