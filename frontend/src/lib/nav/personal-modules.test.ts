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

  it("gives a professional the profile hub and Job Opportunities", () => {
    const keys = personalNavKeys({ variant: "professional", isSalesPersona: false });
    expect(keys).toEqual(["home", "profile", "points", "jobs", "addBusiness"]);
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
    expect(keys).toEqual(["home", "profile", "points", "jobs", "connectShowroom", "addBusiness"]);
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
    expect(emitted.size).toBe(6);
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

/**
 * Increment 8's destination. The gate is the SAME test `job_application_submit`
 * applies (`app.is_professional_persona`), because the one action the page
 * exists for is refused to anybody else — discovery itself is open to any
 * authenticated caller, so this is about not advertising a door that does not
 * open rather than about withholding a secret.
 */
describe("Job Opportunities in the personal rail", () => {
  it("offers Jobs to a professional", () => {
    expect(personalNavKeys({ variant: "professional", isSalesPersona: false })).toContain("jobs");
  });

  it("does NOT offer it to a consumer, whom the database would refuse", () => {
    expect(personalNavKeys({ variant: "consumer", isSalesPersona: false })).not.toContain("jobs");
  });

  it("resolves to /home/jobs and its own label key", () => {
    expect(personalNavItem("jobs")).toEqual({
      key: "jobs",
      href: "/home/jobs",
      labelKey: "personalNav.jobs",
    });
  });

  /**
   * §1: the parent entry stays active on every nested route. `/home/jobs/
   * applications` is a static segment that would otherwise have no rail entry,
   * and a job detail page is a uuid that never will.
   */
  it("keeps every nested Jobs route on the Jobs entry", () => {
    expect(activePersonalNavKey("/home/jobs")).toBe("jobs");
    expect(activePersonalNavKey("/home/jobs/applications")).toBe("jobs");
    expect(activePersonalNavKey("/home/jobs/f1000001-0000-4000-8000-000000000001")).toBe("jobs");
  });

  it("does not claim a route that merely starts with the same characters", () => {
    expect(activePersonalNavKey("/home")).toBe("home");
    // It falls back to `home` like any other unclaimed /home/* route — the point
    // is that Jobs does not claim it on a bare prefix match.
    expect(activePersonalNavKey("/home/jobsearch")).toBe("home");
  });

  /**
   * THE B2B AUTHORITY MUST NOT LEAK. `job.post` and `job.manage` are membership
   * capabilities and mean nothing to a person: the personal rail has no
   * capability input at all, and it must stay that way — a personal account that
   * happened to hold an org capability must not gain or lose this entry for it.
   */
  it("derives Jobs from the persona alone, never from a B2B capability", () => {
    const withSales = personalNavKeys({ variant: "professional", isSalesPersona: true });
    const without = personalNavKeys({ variant: "professional", isSalesPersona: false });
    expect(withSales.includes("jobs")).toBe(true);
    expect(without.includes("jobs")).toBe(true);
  });

  it("puts Jobs in its own group, so Increment 9 has somewhere to land", () => {
    const sections = personalNavSections({ variant: "professional", isSalesPersona: false });
    expect(sections.map((s) => s.section)).toEqual(["account", "work", "business"]);
    expect(sections.find((s) => s.section === "work")?.keys).toEqual(["jobs"]);
  });
});
