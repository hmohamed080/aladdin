import { describe, expect, it } from "vitest";
import {
  personalNavKeys,
  personalNavSections,
  personalNavItem,
  activePersonalNavKey,
  type PersonalNavKey,
} from "./personal-modules";

/**
 * The personal rail's derivation.
 *
 * The property that matters most is NEGATIVE: an installer_technician — or any
 * professional who is not a salesperson — must never be offered the showroom
 * affiliation entry. `app.is_sales_persona` refuses that flow in the database
 * (`20260831090001`) and both showroom routes render an unavailable state, so a
 * rail that still advertised it would be the last surface telling a lie the rest
 * of the stack has stopped telling.
 */
describe("personalNavKeys", () => {
  it("gives a consumer a home and the option to start a business — and no profile", () => {
    const keys = personalNavKeys({ variant: "consumer", isSalesPersona: false });
    expect(keys).toEqual(["home", "addBusiness"]);
    // Not withheld — a consumer has no professional profile to show.
    expect(keys).not.toContain("profile");
  });

  it("gives a professional the profile hub", () => {
    const keys = personalNavKeys({ variant: "professional", isSalesPersona: false });
    expect(keys).toEqual(["home", "profile", "addBusiness"]);
  });

  it("NEVER offers the showroom entry to a non-Sales professional", () => {
    // The installer case, stated directly.
    const keys = personalNavKeys({ variant: "professional", isSalesPersona: false });
    expect(keys).not.toContain("connectShowroom");
  });

  it("offers the showroom entry to a salesperson, canonical or declared", () => {
    // The caller resolves canonical-or-declared before this point, so both kinds
    // of salesperson arrive here as the same `true`.
    const keys = personalNavKeys({ variant: "professional", isSalesPersona: true });
    expect(keys).toEqual(["home", "profile", "connectShowroom", "addBusiness"]);
  });

  it("offers a business to everyone, because owning one is a relationship", () => {
    for (const variant of ["consumer", "professional"] as const) {
      expect(personalNavKeys({ variant, isSalesPersona: false })).toContain("addBusiness");
    }
  });

  it("has a definition for every key it can emit — no dead entries", () => {
    const emitted = new Set<PersonalNavKey>([
      ...personalNavKeys({ variant: "consumer", isSalesPersona: false }),
      ...personalNavKeys({ variant: "professional", isSalesPersona: true }),
    ]);
    // Every reachable key, across every persona, resolves to a real destination.
    for (const key of emitted) {
      const item = personalNavItem(key);
      expect(item.href.startsWith("/")).toBe(true);
      expect(item.labelKey.startsWith("personalNav.")).toBe(true);
    }
    // And the union covers the whole key space — a key nothing can reach would be
    // an entry that exists only in the map.
    expect(emitted.size).toBe(4);
  });
});

describe("personalNavSections", () => {
  it("drops a section with nothing in it rather than rendering an empty heading", () => {
    const sections = personalNavSections({ variant: "consumer", isSalesPersona: false });
    expect(sections.map((s) => s.section)).toEqual(["account", "business"]);
    expect(sections.every((s) => s.keys.length > 0)).toBe(true);
  });

  it("groups the same keys personalNavKeys returns, in the same order", () => {
    const input = { variant: "professional", isSalesPersona: true } as const;
    expect(personalNavSections(input).flatMap((s) => s.keys)).toEqual(personalNavKeys(input));
  });
});

describe("activePersonalNavKey", () => {
  it("does not let /home swallow /home/profile", () => {
    // The reason the lookup sorts by href length: a prefix match against "/home"
    // matches every personal route there is.
    expect(activePersonalNavKey("/home")).toBe("home");
    expect(activePersonalNavKey("/home/profile")).toBe("profile");
    expect(activePersonalNavKey("/home/profile/edit")).toBe("profile");
  });

  it("keeps a sub-route on its own entry", () => {
    expect(activePersonalNavKey("/home/showroom")).toBe("connectShowroom");
    expect(activePersonalNavKey("/home/showroom/refer")).toBe("connectShowroom");
  });

  it("returns null for a route with no rail entry", () => {
    expect(activePersonalNavKey("/b2b")).toBeNull();
    expect(activePersonalNavKey("/")).toBeNull();
  });

  it("does not match a route that merely starts with the same characters", () => {
    expect(activePersonalNavKey("/homework")).toBeNull();
  });
});
