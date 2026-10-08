import { describe, expect, it } from "vitest";
import { availabilityState } from "./availability-state";

describe("availabilityState — unknown is not unavailable", () => {
  it("true is AVAILABLE, whatever the marker says", () => {
    expect(availabilityState(true, "2027-01-01T00:00:00Z")).toBe("available");
    expect(availabilityState(true, null)).toBe("available");
  });
  it("a false WITH a declaration marker is explicitly UNAVAILABLE", () => {
    expect(availabilityState(false, "2027-01-01T00:00:00Z")).toBe("unavailable");
  });
  it("a false with NO declaration marker is UNKNOWN — it is never inferred to be unavailable", () => {
    expect(availabilityState(false, null)).toBe("unknown");
    expect(availabilityState(false, undefined)).toBe("unknown");
    expect(availabilityState(false, "")).toBe("unknown");
  });
});
