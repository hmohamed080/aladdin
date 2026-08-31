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
    expect(keys).not.toContain("points");
    // Not withheld — a consumer has no professional profile to show.
    expect(keys).not.toContain("profile");
  });

  it("gives a professional the profile hub", () => {
    const keys = personalNavKeys({ variant: "professional", isSalesPersona: false });
    expect(keys).toEqual(["home", "profile", "points", "addBusiness"]);
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
    expect(keys).toEqual(["home", "profile", "points", "connectShowroom", "addBusiness"]);
  });

  it("gives an org-less professional a route to their OWN Points", () => {
    // The reachability fix this increment exists for: `/b2b/points` was the only
    // Points route and `/b2b/layout.tsx` redirects an org-less caller away, so an
    // installer held a real balance with no door to it.
    const installer = personalNavKeys({ variant: "professional", isSalesPersona: false });
    expect(installer).toContain("points");
    expect(personalNavItem("points").href).toBe("/home/points");
  });

  it("does not gate Points on already having some", () => {
    // A destination that appears only once you have something is one nobody
    // finds the first time. The guarantee is structural: the derivation's INPUT
    // carries no balance, so no amount of it can change the answer — every
    // professional gets the entry whatever else is true of them.
    for (const isSalesPersona of [true, false]) {
      expect(personalNavKeys({ variant: "professional", isSalesPersona })).toContain("points");
    }
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
    expect(emitted.size).toBe(5);
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
  it("keeps Points on its own entry", () => {
    // `usePathname()` never carries the query string, so `?show=` is not a case
    // this function can see — the pagination link stays on the Points entry
    // because the PATH is unchanged, not because a query is parsed away.
    expect(activePersonalNavKey("/home/points")).toBe("points");
  });

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
