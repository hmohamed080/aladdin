import { describe, expect, it } from "vitest";
import { firstName, progressStep } from "./confirmed-view";

describe("thank-you page helpers", () => {
  it("greets by first name", () => {
    expect(firstName("Mona Hassan Ali")).toBe("Mona");
    expect(firstName("  منى   حسن ")).toBe("منى");
    expect(firstName(null)).toBe("");
  });
  it("maps the order status onto the four progress steps", () => {
    expect(progressStep("new")).toBe(0);
    expect(progressStep("preparing")).toBe(1);
    expect(progressStep("ready")).toBe(2);
    expect(progressStep("shipped")).toBe(2);
    expect(progressStep("delivered")).toBe(3);
  });
});
