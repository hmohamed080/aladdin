/**
 * Capability-aware workspace navigation, organized into sections.
 *
 * Sprint 14 replaced a flat eleven-item list with five sections that follow the
 * shape of the work rather than the shape of the database:
 *
 *   Overview → Buying → Network → Selling → Business
 *
 * The ordering is buyer-first because the Showroom/Dealer is the account this
 * workspace is tuned for: a showroom spends its day requesting prices, comparing
 * incoming offers, and chasing deliveries. A pure sales rep still sees a coherent
 * workspace — the Buying and Network sections simply collapse to whatever their
 * capabilities allow, and an empty section renders nothing at all.
 *
 * Each module lists the capabilities that make it reachable (ANY-of). `org.manage`
 * is a blanket in-org unlock — the commerce/sales RPCs already treat it as a
 * superuser (checked as an OR on every trusted write path), so the nav mirrors that
 * exactly and never shows a module the caller cannot act on (no dead-ends).
 *
 * This is a pure, server-safe module: the AppShell computes the allowed keys from
 * the derived membership capabilities and passes them to the client nav.
 */
export type NavKey =
  // Overview
  | "home"
  // Buying — what a showroom does with its suppliers
  | "purchaseRequests"
  | "offers"
  | "orders"
  | "catalog"
  | "saved"
  // Network — who a showroom works with
  | "suppliers"
  | "technicians"
  | "institutions"
  // Selling — what a showroom does with its own customers
  | "customers"
  | "leads"
  | "followUps"
  | "products"
  // Business — running the showroom itself
  | "projects"
  | "team"
  | "reports"
  | "settings";

export type NavSection = "overview" | "buying" | "network" | "selling" | "business";

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
  institutions: null,

  customers: SALES,
  leads: SALES,
  followUps: SALES,
  products: ["catalog.write", "catalog.publish"],

  projects: ["project.write", "project.read", "order.manage"],
  team: ["org.members.manage"],
  reports: [...SALES, ...COMMERCE, "catalog.read", "project.read"],
  settings: null,
};

/** Canonical order within each section; sections render in this key order. */
export const NAV_SECTIONS: { section: NavSection; keys: NavKey[] }[] = [
  { section: "overview", keys: ["home"] },
  { section: "buying", keys: ["purchaseRequests", "offers", "orders", "catalog", "saved"] },
  { section: "network", keys: ["suppliers", "technicians", "institutions"] },
  { section: "selling", keys: ["customers", "leads", "followUps", "products"] },
  { section: "business", keys: ["projects", "team", "reports", "settings"] },
];

export const NAV_ORDER: NavKey[] = NAV_SECTIONS.flatMap((s) => s.keys);

/** The nav keys a caller with these capabilities may reach, in canonical order. */
export function allowedNavKeys(capabilities: readonly string[]): NavKey[] {
  const caps = new Set(capabilities);
  const superUser = caps.has("org.manage");
  return NAV_ORDER.filter((key) => {
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
): { section: NavSection; keys: NavKey[] }[] {
  const allowed = new Set(allowedNavKeys(capabilities));
  return NAV_SECTIONS.map(({ section, keys }) => ({
    section,
    keys: keys.filter((k) => allowed.has(k)),
  })).filter((s) => s.keys.length > 0);
}
