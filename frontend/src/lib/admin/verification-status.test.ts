import { describe, it, expect } from "vitest";
import { canStartVerification } from "./verification-status";

describe("canStartVerification for active accounts", () => {
  it("offers Admin verification for an active, unverified professional (reachable via All / Unverified)", () => {
    expect(canStartVerification({ accountType: "engineer", status: "active", verificationState: "unverified" })).toBe(true);
  });
  it("does not offer it for an active consumer, a verified account or a suspended one", () => {
    expect(canStartVerification({ accountType: "end_consumer", status: "active", verificationState: "unverified" })).toBe(false);
    expect(canStartVerification({ accountType: "engineer", status: "active", verificationState: "verified" })).toBe(false);
    expect(canStartVerification({ accountType: "engineer", status: "suspended", verificationState: "unverified" })).toBe(false);
  });
});
