/**
 * WHAT GLOBAL SEARCH IS ALLOWED TO LOOK AT.
 *
 * Pure module, no server imports, so the rule that decides which entity families
 * a caller may search is unit-testable on its own — which matters more here than
 * almost anywhere else in the app. Global search is the one surface that touches
 * every table at once, and a quietly widened gate would not show up as a broken
 * page; it would show up as records appearing in a list where they do not belong.
 *
 * THIS IS NOT THE SECURITY BOUNDARY. RLS is (ADR-0008), and it runs whether or
 * not this function is called. What this decides is which queries are ISSUED at
 * all, and it exists for two reasons:
 *
 *   1. A result the caller cannot open is a dead end, and dead ends in a command
 *      palette are worse than absences — the user pays attention to them.
 *   2. Nine parallel reads per keystroke for groups that will return nothing is
 *      the difference between a palette that feels instant and one that does not.
 *
 * The gates mirror `lib/nav/modules` exactly: if a module is not on the caller's
 * rail, its records are not in the caller's palette. `org.manage` is a blanket
 * in-org unlock, the same way it is for navigation and for the commerce RPCs.
 */

/** The entity families the palette can answer for. Never widened speculatively. */
export type SearchGroup =
  | "products"
  | "catalog"
  | "rfqs"
  | "quotations"
  | "orders"
  | "projects"
  | "customers"
  | "leads"
  | "organizations";

export type SearchHit = {
  id: string;
  group: SearchGroup;
  title: string;
  subtitle: string | null;
  href: string;
  /** Translation key for a status chip, resolved by the client. */
  statusKey?: string;
};

/** Below this a query is noise — two characters match half a catalogue. */
export const MIN_QUERY_LENGTH = 2;

/** Enough to be useful, few enough that one group never becomes the whole list. */
export const PER_GROUP = 6;

/**
 * Record groups render before navigation, and in this order: you reached for the
 * palette to find a THING; the menu is what you get when the thing is not there.
 */
export const SEARCH_GROUP_ORDER: SearchGroup[] = [
  "products",
  "rfqs",
  "quotations",
  "orders",
  "projects",
  "customers",
  "leads",
  "catalog",
  "organizations",
];

/** ANY-of capability lists, matching the navigation gates one for one. */
const GROUP_CAPS: Record<SearchGroup, string[] | null> = {
  products: ["catalog.write", "catalog.publish"],
  catalog: ["catalog.read", "catalog.write", "catalog.publish", "rfq.create", "order.create"],
  rfqs: ["rfq.create", "rfq.respond", "quote.submit", "quote.decide", "order.create", "order.manage"],
  quotations: ["rfq.create", "rfq.respond", "quote.submit", "quote.decide", "order.create", "order.manage"],
  orders: ["order.create", "order.manage", "project.read", "project.write"],
  projects: ["project.read", "project.write", "order.manage"],
  customers: [
    "sales.read",
    "sales.write",
    "sales.manage",
    "sales.assign",
    "sales.opportunity.read",
    "sales.opportunity.write",
  ],
  leads: [
    "sales.read",
    "sales.write",
    "sales.manage",
    "sales.assign",
    "sales.opportunity.read",
    "sales.opportunity.write",
  ],
  // The PUBLIC business directory. No gate, for the same reason the Suppliers and
  // Institutions modules have none: it is a public projection with no private
  // commercial data in it, and there is no action behind a row that could
  // dead-end. It is still never the caller's OWN organization — see the action.
  organizations: null,
};

/**
 * The groups this caller may search. An empty set is a legitimate answer: a
 * member with no capabilities at all still gets navigation results and a
 * directory lookup, and issues no record queries.
 */
export function searchableGroups(capabilities: readonly string[]): Set<SearchGroup> {
  const caps = new Set(capabilities);
  const superUser = caps.has("org.manage");
  const allowed = new Set<SearchGroup>();
  for (const group of SEARCH_GROUP_ORDER) {
    const required = GROUP_CAPS[group];
    if (required === null || superUser || required.some((c) => caps.has(c))) allowed.add(group);
  }
  return allowed;
}

export function canSearchGroup(capabilities: readonly string[], group: SearchGroup): boolean {
  return searchableGroups(capabilities).has(group);
}
