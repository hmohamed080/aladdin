/**
 * PERSONAL navigation — the sibling of `modules.ts`, and deliberately not an
 * extension of it.
 *
 * `modules.ts` answers a question this file cannot ask: *"which modules does this
 * membership's capability set unlock inside an organization?"* A personal account
 * has no membership and no capabilities, so every gate there is inapplicable here.
 * Reusing that model would have meant inventing pseudo-capabilities for a person,
 * which is precisely the conflation the account model exists to prevent — a person
 * is not a tiny organization.
 *
 * What replaces capabilities is the PERSONA, and only in the narrow sense of "does
 * this destination exist for this kind of account":
 *
 *   * every personal account has a home;
 *   * a professional has a professional profile; a consumer does not, because
 *     there is no professional profile to show — not because it is withheld;
 *   * a professional has Points, for the same reason they have a profile: the
 *     ledger is user-owned and the one approved earning rule credits a person,
 *     not an organization. It is deliberately NOT gated on holding a balance —
 *     a page that appears only once you have something is a page nobody can find
 *     the first time;
 *   * a salesperson has the showroom-affiliation route, which the database
 *     refuses to anyone else (`app.is_sales_persona`);
 *   * anyone may start a business, because owning one is a relationship, never an
 *     account type.
 *
 * NOTHING HERE IS AN AUTHORITY DECISION. Each destination re-checks its own
 * access server-side; this module decides only what to draw. A nav that shows a
 * link the page then refuses is a worse failure than one that omits it, which is
 * why `connectShowroom` takes the SAME resolved answer the page and the layout
 * use rather than re-deriving a persona test of its own.
 *
 * Pure module: no server imports, so the derivation is unit-testable.
 */

export type PersonalNavKey =
  | "home"
  | "profile"
  | "points"
  | "jobs"
  | "connectShowroom"
  | "addBusiness";

/**
 * Three groups, not six. The reference pack shows a richer rail — learning,
 * points, network, reviews — and Points has since arrived under "account", where
 * it belongs: the ledger is the caller's own standing, not a separate programme.
 * "work" arrived with Increment 8, when Job Opportunities became a real
 * destination rather than a picture. The rest are later increments or unapproved
 * elements, and a heading with nothing under it is worse than no heading.
 * Sections are dropped when empty, so this grows without being edited.
 */
export type PersonalNavSection = "account" | "work" | "business";

export type PersonalNavItem = {
  key: PersonalNavKey;
  href: string;
  /** Message key for the label — resolved by the caller's translator. */
  labelKey: string;
};

const ITEMS: Record<PersonalNavKey, PersonalNavItem> = {
  home: { key: "home", href: "/home", labelKey: "personalNav.home" },
  profile: { key: "profile", href: "/home/profile", labelKey: "personalNav.profile" },
  points: { key: "points", href: "/home/points", labelKey: "personalNav.points" },
  jobs: { key: "jobs", href: "/home/jobs", labelKey: "personalNav.jobs" },
  connectShowroom: {
    key: "connectShowroom",
    href: "/home/showroom",
    labelKey: "personalNav.connectShowroom",
  },
  addBusiness: { key: "addBusiness", href: "/business/new", labelKey: "personalNav.addBusiness" },
};

const SECTIONS: { section: PersonalNavSection; keys: PersonalNavKey[] }[] = [
  { section: "account", keys: ["home", "profile", "points"] },
  /* Work is its own group rather than a fourth entry under "account", because it
     is the only destination here that is about the OUTSIDE world: the other
     three are the caller's own record. It is also where Increment 9's My Work
     joins, and a group of one that is about to be a group of two is better than
     an "account" heading that quietly starts meaning "everything". */
  { section: "work", keys: ["jobs"] },
  { section: "business", keys: ["connectShowroom", "addBusiness"] },
];

/**
 * What the rail is derived FROM. Both fields are already resolved by the caller —
 * `variant` by `loadPersonalHome` (track, then persona) and `isSalesPersona` by
 * `loadIsSalesPersona` (canonical, then declared) — so this module never reads a
 * raw column and cannot disagree with the pages it links to.
 */
export type PersonalNavInput = {
  variant: "consumer" | "professional";
  isSalesPersona: boolean;
};

/** Whether one destination exists for this account. */
function isReachable(key: PersonalNavKey, input: PersonalNavInput): boolean {
  switch (key) {
    case "profile":
    case "points":
      return input.variant === "professional";
    /* THE SAME TEST THE DATABASE APPLIES. `job_application_submit` refuses
       anyone who is not `app.is_professional_persona`, so a consumer offered
       this rail entry could browse openings and then be refused at the one
       action the page exists for. Discovery itself is open to any authenticated
       caller — this is about not advertising a door that does not open. */
    case "jobs":
      return input.variant === "professional";
    case "connectShowroom":
      return input.isSalesPersona;
    default:
      return true;
  }
}

/** The destinations this account has, in canonical order. */
export function personalNavKeys(input: PersonalNavInput): PersonalNavKey[] {
  return SECTIONS.flatMap((s) => s.keys).filter((key) => isReachable(key, input));
}

/** The same destinations grouped for the rail; empty sections are dropped. */
export function personalNavSections(
  input: PersonalNavInput,
): { section: PersonalNavSection; keys: PersonalNavKey[] }[] {
  return SECTIONS.map(({ section, keys }) => ({
    section,
    keys: keys.filter((key) => isReachable(key, input)),
  })).filter((s) => s.keys.length > 0);
}

/** The item definition for a key — href and label, never a permission. */
export function personalNavItem(key: PersonalNavKey): PersonalNavItem {
  return ITEMS[key];
}

/**
 * Which rail entry a pathname belongs to, longest href first so `/home/profile`
 * is not swallowed by `/home`. Returns null for a personal route with no rail
 * entry of its own (`/home/showroom/refer` resolves to `connectShowroom`, but a
 * future route need not resolve to anything).
 */
export function activePersonalNavKey(pathname: string): PersonalNavKey | null {
  const candidates = (Object.keys(ITEMS) as PersonalNavKey[])
    .map((key) => ITEMS[key])
    .sort((a, b) => b.href.length - a.href.length);
  const hit = candidates.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  return hit?.key ?? null;
}
