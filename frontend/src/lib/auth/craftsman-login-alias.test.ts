import { describe, expect, it } from "vitest";
import {
  CRAFTSMAN_LOGIN_ALIAS_DOMAIN,
  craftsmanLoginAlias,
  isCraftsmanLoginAlias,
  userFacingEmail,
} from "./craftsman-login-alias";

describe("craftsman login alias", () => {
  it("derives a deterministic, undeliverable alias from a canonical E.164 phone", () => {
    expect(craftsmanLoginAlias("+201012345678")).toBe(`p201012345678@${CRAFTSMAN_LOGIN_ALIAS_DOMAIN}`);
    expect(CRAFTSMAN_LOGIN_ALIAS_DOMAIN.endsWith(".invalid")).toBe(true);
  });

  it("refuses anything that is not already canonical", () => {
    expect(() => craftsmanLoginAlias("01012345678")).toThrow();
    expect(() => craftsmanLoginAlias("+20 101 234 5678")).toThrow();
  });

  it("recognizes the alias case-insensitively", () => {
    expect(isCraftsmanLoginAlias(craftsmanLoginAlias("+201012345678").toUpperCase())).toBe(true);
    expect(isCraftsmanLoginAlias("someone@example.com")).toBe(false);
    expect(isCraftsmanLoginAlias(null)).toBe(false);
  });

  it("never returns the alias as a user-facing email", () => {
    expect(userFacingEmail(craftsmanLoginAlias("+201012345678"))).toBeNull();
    expect(userFacingEmail(" person@example.com ")).toBe("person@example.com");
    expect(userFacingEmail("")).toBeNull();
    expect(userFacingEmail(undefined)).toBeNull();
  });
});
