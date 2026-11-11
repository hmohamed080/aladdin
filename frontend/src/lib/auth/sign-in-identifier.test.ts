import { describe, expect, it } from "vitest";
import { classifySignInIdentifier } from "./sign-in-identifier";

describe("classifySignInIdentifier", () => {
  it("reads anything with @ as an email, lowercased", () => {
    expect(classifySignInIdentifier("  Mona@Example.COM ")).toEqual({ kind: "email", value: "mona@example.com" });
  });

  it("reads an Egyptian mobile in local, international or Arabic-digit form as one canonical phone", () => {
    for (const raw of ["01012345678", "+20 101 234 5678", "00201012345678", "٠١٠١٢٣٤٥٦٧٨"]) {
      expect(classifySignInIdentifier(raw)).toMatchObject({ kind: "phone", value: { e164: "+201012345678" } });
    }
  });

  it("does not read a letter-first handle as anything: there is no username sign-in", () => {
    for (const raw of ["Ahmed.Showroom_1", "mona_adel", "validuser123", "ab"]) {
      expect(classifySignInIdentifier(raw)).toBeNull();
    }
  });

  it("rejects empty, malformed or impossible values", () => {
    for (const raw of ["", "   ", "123", "!!", "_bad", undefined, 42]) {
      expect(classifySignInIdentifier(raw)).toBeNull();
    }
  });
});
