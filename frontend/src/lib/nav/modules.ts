/**
 * Capability-aware workspace navigation, organized into sections.
 *
 * Sprint 14 replaced a flat eleven-item list with five sections that follow the
 * shape of the work rather than the shape of the database:
 *
 *   Overview → Buying → Network → Selling → Business
 *
 * That ordering is buyer-first because the Showroom/Dealer was the account the
 * workspace was tuned for: a showroom spends its day requesting prices, comparing
 * incoming offers, and chasing deliveries.
 *
 * SUPPLY-SIDE SPRINT: THE SAME WORKSPACE, READ FROM THE OTHER SEAT
 * A Distributor, Manufacturer or Importer does the mirror-image work — it
 * RECEIVES requests, SENDS prices, and FULFILS orders — over the very same
 * records, because every RFQ, quotation and order names both parties. So the
 * supply side is not a second navigation, a second set of routes, or a second
 * application. It is this navigation with two things changed:
 *
 *   1. SECTION ORDER. The commerce trio leads under a "Supply" heading instead of
 *      trailing under "Buying", and the browse/shortlist pair demotes to a
 *      still-present "Buying" group (a distributor genuinely does buy raw
 *      materials — hiding that would be a lie about the business).
 *   2. LABELS. The same route is called "Purchase requests" from the buyer's seat
 *      and "Incoming demand" from the seller's. The href, the capability gate and
 *      the active rule are identical; only the word changes.
 *
 * Everything else — the rail, the collapse modes, the hover affordance, the mobile sheet,
 * the capability filter — is shared verbatim. There is deliberately no
 * `showroomNav` / `distributorNav` split to drift apart.
 *
 * Each module lists the capabilities that make it reachable (ANY-of). `org.manage`
 * is a blanket in-org unlock — the commerce/sales RPCs already treat it as a
 * superuser (checked as an OR on every trusted write path), so the nav mirrors that
 * exactly and never shows a module the caller cannot act on (no dead-ends).
 *
 * This is a pure, server-safe module: the AppShell computes the allowed keys from
 * the derived membership capabilities and passes them to the client nav.
 */
import type { CommerceStance } from "@/lib/workspace/supply-side";

export type NavKey =
  // Overview
  | "home"
  // The commerce trio — the same three routes from either seat.
  | "purchaseRequests"
  | "offers"
  | "orders"
  // Browsing and shortlisting other businesses' catalogs.
  | "catalog"
  | "saved"
  // Network — who this business works with
  | "suppliers"
  | "buyers"
  | "technicians"
  // Openings this organization posts for individual professionals. Sits beside
  // the Technicians DIRECTORY deliberately: that list is who we could hire, this
  // module is the work we are hiring for. Same subject, two verbs.
  | "jobs"
  | "institutions"
  // The sales pipeline this business runs for its own customers
  | "customers"
  | "leads"
  | "followUps"
  | "products"
  // Business — running the organization itself
  | "points"
  | "projects"
  | "team"
  | "reports"
  | "settings";

export type NavSection = "overview" | "supply" | "buying" | "network" | "selling" | "business";

const SALES = [
  "sales.read",
  "sales.write",
  "sales.manage",
  "sales.assign",
  "sales.opportunity.read",
  "sales.opportunity.write",
  "sales.task.write",
  "sales.followup.send",
];

/** Anything that lets a caller take part in the RFQ → quote → order chain. */
const COMMERCE = ["rfq.create", "rfq.respond", "quote.submit", "quote.decide", "order.create", "order.manage"];

/** Anyone who can browse or shortlist supplier products. */
const BROWSE = ["catalog.read", "catalog.write", "catalog.publish", "rfq.create", "order.create"];

/** null => always visible to any member with an active workspace. */
/**
 * The two Jobs capabilities, and why the module lists BOTH.
 *
 * They are genuinely different seats — `job.post` authors and publishes an
 * opening, `job.manage` decides who gets it — and the pages honour that
 * separately (a `job.post` holder sees no accept/reject control). But either one
 * alone is a reason to reach the module, so the nav gate is the union. Gating on
 * `job.post` only would hide the applicants queue from the person whose whole
 * job is working it.
 */
const JOBS = ["job.post", "job.manage"];

export const NAV_CAPS: Record<NavKey, string[] | null> = {
  home: null,

  purchaseRequests: COMMERCE,
  offers: COMMERCE,
  orders: ["order.create", "order.manage", "project.write", "project.read"],
  catalog: BROWSE,
  saved: BROWSE,

  // Directories of registered businesses and professionals. Read-only public
  // information, useful to every role in the workspace, so no capability gate —
  // there is no action behind them that could dead-end.
  suppliers: null,
  technicians: null,
  buyers: null,
  institutions: null,

  // NOT null. The directories above are read-only public information with no
  // action behind them, so no capability could gate them. Jobs is a write
  // surface: every destination inside it needs an authority the caller may not
  // hold, so an ungated entry would be the dead-end this map exists to prevent.
  jobs: JOBS,

  customers: SALES,
  leads: SALES,
  followUps: SALES,
  products: ["catalog.write", "catalog.publish"],

  // Points is the caller's OWN standing on the platform, not an organization
  // record, so no capability could gate it and none does. The page is SHIPPED —
  // balance, the one earning rule, and history (`app/b2b/points/page.tsx`).
  //
  // Because it is user-owned, the same page also belongs on the personal home
  // (`/home/points`, `lib/nav/personal-modules.ts`): this entry is the copy that
  // exists for a caller who happens to be in a workspace, not the primary one. An
  // organization-less professional reaches their Points there, since this layout
  // redirects them away before any nav is drawn.
  points: null,

  projects: ["project.write", "project.read", "order.manage"],
  team: ["org.members.manage"],
  reports: [...SALES, ...COMMERCE, "catalog.read", "project.read"],
  settings: null,
};

/**
 * Canonical order within each section, per stance; sections render in this order.
 *
 * The two arrays hold the SAME keys with two exceptions, and both are deliberate:
 *   - `buyers` (the customer/showroom network) appears only in the seller layout.
 *     A buyer-stance workspace already has its own customers under Selling; a
 *     second directory of the same idea would be two doors to one room.
 *   - `products` sits under Supply for a seller (it is the core module of the
 *     workspace) and under Selling for a buyer (a showroom's own shelf, secondary
 *     to its purchasing).
 */
const BUYER_SECTIONS: { section: NavSection; keys: NavKey[] }[] = [
  { section: "overview", keys: ["home"] },
  { section: "buying", keys: ["purchaseRequests", "offers", "orders", "catalog", "saved"] },
  { section: "network", keys: ["suppliers", "technicians", "jobs", "institutions"] },
  { section: "selling", keys: ["customers", "leads", "followUps", "products"] },
  { section: "business", keys: ["points", "projects", "team", "reports", "settings"] },
];

const SELLER_SECTIONS: { section: NavSection; keys: NavKey[] }[] = [
  { section: "overview", keys: ["home"] },
  { section: "supply", keys: ["purchaseRequests", "offers", "orders", "products"] },
  { section: "network", keys: ["buyers", "suppliers", "technicians", "jobs", "institutions"] },
  { section: "selling", keys: ["customers", "leads", "followUps"] },
  // Still present, deliberately last: a distributor buys raw materials too.
  { section: "buying", keys: ["catalog", "saved"] },
  { section: "business", keys: ["points", "projects", "team", "reports", "settings"] },
];

export function navSectionsFor(stance: CommerceStance) {
  return stance === "seller" ? SELLER_SECTIONS : BUYER_SECTIONS;
}

/**
 * Label overrides for the seller seat.
 *
 * Same route, same gate, different word. Anything absent falls through to the
 * module's default key, so adding a module never requires touching this map.
 *
 * Note what is NOT here: no override says "Supplier" or "Distributor" about the
 * caller's own organization. `supplier` is an internal identifier; the copy these
 * keys resolve to is written per locale in the message bundles.
 */
const SELLER_LABELS: Partial<Record<NavKey, string>> = {
  purchaseRequests: "nav.demand",
  offers: "nav.quotations",
  // "Orders & purchases" is the buyer's compound name for one list that holds
  // both directions. From the seller's seat the same list is just orders.
  orders: "nav.salesOrders",
};

export function navLabelKey(key: NavKey, stance: CommerceStance, fallback: string): string {
  return (stance === "seller" ? SELLER_LABELS[key] : undefined) ?? fallback;
}

/** Every module a stance can reach, flattened into that stance's order. */
export function navOrder(stance: CommerceStance = "buyer"): NavKey[] {
  return navSectionsFor(stance).flatMap((s) => s.keys);
}

/**
 * The buyer layout's canonical order.
 *
 * Kept as a named constant because it is the order the workspace has shipped in
 * since Sprint 14 and is pinned by tests. Note it does NOT list every NavKey:
 * `buyers` exists only in the seller layout, by design (see the section arrays).
 */
export const NAV_ORDER: NavKey[] = navOrder("buyer");

/** The nav keys a caller with these capabilities may reach, in the stance's order. */
export function allowedNavKeys(
  capabilities: readonly string[],
  stance: CommerceStance = "buyer",
): NavKey[] {
  const caps = new Set(capabilities);
  const superUser = caps.has("org.manage");
  return navSectionsFor(stance)
    .flatMap((s) => s.keys)
    .filter((key) => {
      const required = NAV_CAPS[key];
      if (required === null) return true;
      if (superUser) return true;
      return required.some((c) => caps.has(c));
    });
}

/**
 * The same allowed keys, grouped for the sidebar. Sections with no reachable
 * module are dropped so the rail never renders an empty heading.
 */
export function allowedNavSections(
  capabilities: readonly string[],
  stance: CommerceStance = "buyer",
): { section: NavSection; keys: NavKey[] }[] {
  const allowed = new Set(allowedNavKeys(capabilities, stance));
  return navSectionsFor(stance)
    .map(({ section, keys }) => ({
      section,
      keys: keys.filter((k) => allowed.has(k)),
    }))
    .filter((s) => s.keys.length > 0);
}
