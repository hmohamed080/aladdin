/**
 * Capability presets a manager can assign on the people screen. Each maps a
 * human "role" to the exact capability keys the live RPCs enforce. The manager
 * can only grant a preset whose keys they themselves hold (the RPC re-checks),
 * so an owner seeded with the full set can delegate any of these.
 *
 * These are convenience bundles, not a new permission concept — the source of
 * truth remains `membership_capabilities` + RLS.
 */
export type RolePresetKey =
  | "sales_rep"
  | "sales_manager"
  | "catalog_manager"
  | "buyer"
  | "supplier_rep"
  | "project_manager"
  | "members_manager"
  | "viewer";

export const ROLE_PRESETS: Record<RolePresetKey, string[]> = {
  sales_rep: ["sales.read", "sales.write"],
  sales_manager: ["sales.read", "sales.write", "sales.assign", "sales.manage"],
  catalog_manager: ["catalog.read", "catalog.write", "catalog.publish"],
  buyer: ["catalog.read", "rfq.create", "quote.decide", "order.create"],
  supplier_rep: ["catalog.read", "rfq.respond", "quote.submit", "order.manage"],
  project_manager: ["project.read", "project.write", "order.manage"],
  members_manager: ["org.members.manage"],
  viewer: ["catalog.read"],
};

export const ROLE_PRESET_ORDER: RolePresetKey[] = [
  "sales_rep",
  "sales_manager",
  "catalog_manager",
  "buyer",
  "supplier_rep",
  "project_manager",
  "members_manager",
  "viewer",
];

/**
 * Capability keys, expressed as the WORK they unlock.
 *
 * A capability key is an internal identifier. Rendering `org.members.manage` or
 * `sales.read` in the client leaks the permission model, renders untranslated in
 * Arabic, and tells the person reading it nothing — a manager wants to know that
 * a colleague "handles purchasing", not which four strings are in a join table.
 *
 * This is a DISPLAY mapping only. Authorization is unchanged: the RPCs still check
 * the raw keys, and nothing here can grant, widen or narrow anything.
 */
export type CapabilityGroupKey =
  | "manage"
  | "people"
  | "branches"
  | "catalog"
  | "buying"
  | "selling"
  | "projects"
  | "sales"
  | "verification";

const GROUP_OF: Record<string, CapabilityGroupKey> = {
  "org.manage": "manage",
  "org.members.manage": "people",
  "branch.manage": "branches",
  "catalog.read": "catalog",
  "catalog.write": "catalog",
  "catalog.publish": "catalog",
  "rfq.create": "buying",
  "quote.decide": "buying",
  "order.create": "buying",
  "rfq.respond": "selling",
  "quote.submit": "selling",
  "order.manage": "selling",
  "project.read": "projects",
  "project.write": "projects",
  "verification.submit": "verification",
  "verification.read": "verification",
};

/** Canonical display order — broadest authority first. */
const GROUP_ORDER: CapabilityGroupKey[] = [
  "manage",
  "people",
  "branches",
  "buying",
  "selling",
  "catalog",
  "projects",
  "sales",
  "verification",
];

/**
 * The distinct work areas a set of capabilities covers, in canonical order.
 *
 * `org.manage` is a blanket in-org unlock, so it collapses to a single "full
 * business management" chip rather than listing every area underneath it — eight
 * chips on an owner's row would say less than one.
 *
 * Any `sales.*` key maps to the sales group, including the finer-grained ones
 * (`sales.opportunity.read`, `sales.task.write`) that a preset never assigns but
 * a bespoke grant might. An unrecognised key contributes nothing rather than
 * rendering raw: a new capability must be given a label deliberately, not leak
 * into the UI the day it is added.
 */
export function capabilityGroups(capabilities: readonly string[]): CapabilityGroupKey[] {
  const found = new Set<CapabilityGroupKey>();
  for (const key of capabilities) {
    if (key === "org.manage") return ["manage"];
    const group = GROUP_OF[key] ?? (key.startsWith("sales.") ? "sales" : undefined);
    if (group) found.add(group);
  }
  return GROUP_ORDER.filter((g) => found.has(g));
}
