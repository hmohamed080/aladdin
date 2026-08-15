import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { sanitizeSearchTerm } from "@/server/queries/sales";

/**
 * Read queries for the workspace directories — Suppliers, Institutions and
 * Technicians.
 *
 * All three read the hardened PUBLIC directory projections
 * (`organization_public_directory` / `profile_public_directory`), never the base
 * tables. Those views expose only approved public columns of listed, active,
 * verified, non-deleted records, so a directory can show WHO exists on Aladdin
 * without leaking a single private organization or personal detail. Filters here
 * narrow the projection for UX; they are not the security boundary.
 *
 * These are directories of real registered businesses and people — deliberately
 * NOT a private address book the showroom types into. Creating a supplier record
 * from the buyer side would fork business identity, which the account/organization
 * model forbids.
 */
type DB = SupabaseClient<Database>;

export type OrgDirectoryRow = Database["public"]["Views"]["organization_public_directory"]["Row"];
export type ProfileDirectoryRow = Database["public"]["Views"]["profile_public_directory"]["Row"];
export type OrgType = Database["public"]["Enums"]["organization_type"];
export type PersonaType = Database["public"]["Enums"]["persona_type"];

const LIST_LIMIT = 60;

/** Businesses a showroom BUYS from. */
export const SUPPLIER_ORG_TYPES: OrgType[] = ["supplier", "manufacturer", "importer", "wholesaler"];

/**
 * Institutional counterparties — contracting companies, design/engineering
 * offices, and peer showrooms. These are the organizations a showroom sells to,
 * partners with, or executes projects alongside, as distinct from the suppliers it
 * buys materials from.
 */
export const INSTITUTION_ORG_TYPES: OrgType[] = ["contractor_company", "design_office", "showroom_dealer"];

/** On-site trades — الصنايعية. */
export const TECHNICIAN_PERSONAS: PersonaType[] = ["installer_technician"];

/** Professionals a showroom consults or refers work to, other than trades. */
export const CONSULTANT_PERSONAS: PersonaType[] = ["engineer", "interior_designer", "contractor"];

export async function listOrganizations(
  supabase: DB,
  f: { types: OrgType[]; search?: string; type?: string; excludeOrgId?: string },
): Promise<OrgDirectoryRow[]> {
  // A caller-supplied `type` may only ever narrow the module's own allow-list —
  // it can never be used to browse a category this directory does not cover.
  const types = f.type && f.types.includes(f.type as OrgType) ? [f.type as OrgType] : f.types;

  let q = supabase
    .from("organization_public_directory")
    .select("*")
    .in("org_type", types)
    .order("is_verified", { ascending: false })
    .order("name")
    .limit(LIST_LIMIT);

  // A business is never its own counterparty. Listing yourself here is a dead end:
  // the RFQ path already refuses a request addressed to your own organization, so
  // the row could only ever lead to "this is your own product".
  if (f.excludeOrgId) q = q.neq("id", f.excludeOrgId);

  if (f.search?.trim()) {
    const term = sanitizeSearchTerm(f.search);
    if (term) q = q.ilike("name", `%${term}%`);
  }

  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

export async function listProfessionals(
  supabase: DB,
  f: { personas: PersonaType[]; search?: string; persona?: string },
): Promise<ProfileDirectoryRow[]> {
  const personas =
    f.persona && f.personas.includes(f.persona as PersonaType) ? [f.persona as PersonaType] : f.personas;

  let q = supabase
    .from("profile_public_directory")
    .select("*")
    .in("persona", personas)
    .order("display_name")
    .limit(LIST_LIMIT);

  if (f.search?.trim()) {
    const term = sanitizeSearchTerm(f.search);
    if (term) q = q.or(`display_name.ilike.%${term}%,headline.ilike.%${term}%`);
  }

  const { data, error } = await q;
  if (error) throw error;
  return data ?? [];
}

/**
 * Counts per organization type across a module's allow-list, for its KPI strip.
 *
 * ONE read of two narrow columns, tallied here. The obvious-looking alternative —
 * a `head: true` count per tile — was measured and rejected: it turns one request
 * into six, and on this stack a round trip costs far more than the two small columns
 * it saves. The scale answer is a `group by` aggregate in the database; that is a
 * migration, and this page does not need it at directory sizes.
 */
export async function organizationTypeCounts(
  supabase: DB,
  types: OrgType[],
  excludeOrgId?: string,
): Promise<{ total: number; verified: number; byType: Record<string, number> }> {
  // Must apply the same exclusion as the list, or the tiles would count a row the
  // table below them deliberately does not show.
  let q = supabase.from("organization_public_directory").select("org_type, is_verified").in("org_type", types);
  if (excludeOrgId) q = q.neq("id", excludeOrgId);
  const { data, error } = await q;
  if (error) throw error;

  const rows = data ?? [];
  const byType: Record<string, number> = {};
  let verified = 0;
  for (const r of rows) {
    if (r.org_type) byType[r.org_type] = (byType[r.org_type] ?? 0) + 1;
    if (r.is_verified) verified += 1;
  }
  return { total: rows.length, verified, byType };
}

/**
 * How many listed professionals fall in a persona group. Used for the Technicians
 * tab/KPI counts, which previously re-ran the full directory LIST query — once for
 * the visible table and again for each group's count, including a run that was
 * byte-for-byte the query the table had already made.
 */
export async function professionalCount(supabase: DB, personas: PersonaType[]): Promise<number> {
  const { count, error } = await supabase
    .from("profile_public_directory")
    .select("*", { count: "exact", head: true })
    .in("persona", personas);
  if (error) throw error;
  return count ?? 0;
}
