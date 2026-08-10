/**
 * Capability-aware workspace navigation. Each module lists the capabilities that
 * make it reachable (ANY-of). `org.manage` is a blanket in-org unlock — the
 * commerce/sales RPCs already treat it as a superuser (it is checked as an OR on
 * every trusted write path), so the nav mirrors that exactly and never shows a
 * module the caller cannot act on (no dead-ends). Home is always present for a
 * member with an active workspace.
 *
 * This is a pure, server-safe module: the AppShell computes the allowed keys
 * from the derived membership capabilities and passes them to the client nav.
 */
export type NavKey =
  | "home"
  | "customers"
  | "leads"
  | "followUps"
  | "catalog"
  | "products"
  | "rfqs"
  | "quotations"
  | "orders"
  | "projects"
  | "organization";

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

/** null => always visible to any workspace member. */
export const NAV_CAPS: Record<NavKey, string[] | null> = {
  home: null,
  customers: SALES,
  leads: SALES,
  followUps: [...SALES],
  catalog: ["catalog.read", "catalog.write", "catalog.publish", "rfq.create", "order.create"],
  products: ["catalog.write", "catalog.publish"],
  rfqs: ["rfq.create", "rfq.respond", "quote.submit", "quote.decide"],
  quotations: ["quote.submit", "quote.decide", "rfq.respond", "rfq.create"],
  orders: ["order.create", "order.manage", "project.write", "project.read"],
  projects: ["project.write", "project.read", "order.manage"],
  organization: ["org.members.manage"],
};

export const NAV_ORDER: NavKey[] = [
  "home",
  "customers",
  "leads",
  "followUps",
  "catalog",
  "products",
  "rfqs",
  "quotations",
  "orders",
  "projects",
  "organization",
];

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
