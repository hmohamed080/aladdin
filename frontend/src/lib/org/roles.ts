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
