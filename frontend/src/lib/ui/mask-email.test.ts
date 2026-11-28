import { describe, expect, it } from "vitest";
import { maskEmail } from "./mask-email";

describe("maskEmail", () => {
  it("keeps the first and last character of the local part and the whole domain", () => {
    expect(maskEmail("test789f@test.com")).toBe("t******f@test.com");
    expect(maskEmail("sayed@example.test")).toBe("s***d@example.test");
  });

  it("masks a three-character local part as first + one star + last", () => {
    expect(maskEmail("abc@example.test")).toBe("a*c@example.test");
  });

  it("never reveals a one- or two-character local part in full", () => {
    expect(maskEmail("a@example.test")).toBe("a*@example.test");
    expect(maskEmail("ab@example.test")).toBe("a*@example.test");
  });

  it("returns the input unchanged when it is not a real email shape", () => {
    expect(maskEmail("not-an-email")).toBe("not-an-email");
  });
});
