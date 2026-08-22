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

export type OrgFacet = { products: number; categories: ProductCategory[] };
export type ProductCategory = Database["public"]["Enums"]["product_category"];

/**
 * What each listed business actually SELLS, for the directory rows.
 *
 * A directory of names is an address book; a sourcing module has to answer "who
 * can supply floor tiling" before the buyer opens anything. That answer already
 * exists in the published catalog, so this reads two columns of it — ONE request
 * for the whole visible page rather than one per row — and tallies here.
 *
 * Scoped to the ids actually being rendered: an unfiltered read would grow with
 * the platform instead of with the page.
 */
export async function organizationProductFacets(
  supabase: DB,
  orgIds: string[],
): Promise<Map<string, OrgFacet>> {
  const out = new Map<string, OrgFacet>();
  if (orgIds.length === 0) return out;

  const { data, error } = await supabase
    .from("catalog_published_products")
    .select("organization_id, category")
    .in("organization_id", orgIds);
  if (error) throw error;

  for (const row of data ?? []) {
    if (!row.organization_id) continue;
    const cur = out.get(row.organization_id) ?? { products: 0, categories: [] };
    cur.products += 1;
    if (row.category && !cur.categories.includes(row.category)) cur.categories.push(row.category);
    out.set(row.organization_id, cur);
  }
  return out;
}

export type SharedWork = { orders: number; value: number };

/**
 * Orders exchanged between this organization and each counterparty, in EITHER
 * direction — the "have we worked together" column on the Institutions module.
 *
 * This is relationship context the caller is already entitled to (they are a
 * party to every order counted), not private information about the other
 * business: it says how much work WE have done with THEM, and would read zero for
 * any other viewer.
 */
export async function sharedWorkCounts(supabase: DB, orgId: string): Promise<Map<string, SharedWork>> {
  const { data, error } = await supabase
    .from("order_list")
    .select("requester_org_id, supplier_org_id, total")
    .or(`requester_org_id.eq.${orgId},supplier_org_id.eq.${orgId}`);
  if (error) throw error;

  const out = new Map<string, SharedWork>();
  for (const r of data ?? []) {
    const other = r.requester_org_id === orgId ? r.supplier_org_id : r.requester_org_id;
    if (!other) continue;
    const cur = out.get(other) ?? { orders: 0, value: 0 };
    cur.orders += 1;
    cur.value += Number(r.total ?? 0);
    out.set(other, cur);
  }
  return out;
}

/**
 * The organizations a supply-side business actually SELLS TO, with the shape of
 * each relationship.
 *
 * WHY THIS IS NOT A DIRECTORY QUERY
 * Everything else in this file reads a public projection: "who exists on Aladdin".
 * This reads the caller's OWN commerce records and groups them by counterparty:
 * "who works with me, and how much". Those are different questions, and the
 * second one cannot be answered from a directory at all.
 *
 * WHAT MAKES IT SAFE
 * Every row counted here is a record the caller is a PARTY TO — it sent the
 * quotation, it is fulfilling the order. The figures are therefore facts about
 * the caller's own business ("we have done 4 orders worth X with them"), not
 * disclosures about the customer's ("they spend Y in total"), and they would read
 * zero for any other viewer. Nothing private about the counterparty is exposed:
 * the only columns taken from the customer's side are its NAME, which is already
 * on every record the caller can open, and whatever the hardened public directory
 * chooses to publish.
 *
 * A customer that is not verified simply has no public row, so it keeps the name
 * from the commerce records and reports `listed: false`. It is deliberately NOT
 * dropped — a real trading relationship must not disappear from the seller's own
 * customer list because the other business has not finished verification.
 *
 * There is no invented CRM here: no contact person, no credit terms, no
 * segments, no scores. Every field is either a count of records or a published
 * public column.
 */
export type CustomerOrganization = {
  organizationId: string;
  name: string;
  /** Present only when the business is verified and publicly listed. */
  orgType: OrgType | null;
  /** Whether the business appears in the public directory (i.e. is verified). */
  listed: boolean;
  slug: string | null;
  requests: number;
  quotations: number;
  accepted: number;
  orders: number;
  orderValue: number;
  /** Most recent record of any kind, for "last activity". */
  lastActivity: string | null;
};

export async function customerOrganizations(
  supabase: DB,
  orgId: string,
): Promise<CustomerOrganization[]> {
  // Three reads of the caller's own supply-side records. Each selects only the
  // counterparty, the state and the timestamp — never the record set.
  const [rfqs, quotes, orders] = await Promise.all([
    supabase
      .from("rfq_list")
      .select("requester_org_id, requester_name, created_at")
      .eq("supplier_org_id", orgId),
    supabase
      .from("quotation_list")
      .select("requester_org_id, requester_name, status, created_at")
      .eq("supplier_org_id", orgId),
    supabase
      .from("order_list")
      .select("requester_org_id, requester_name, total, confirmed_at")
      .eq("supplier_org_id", orgId),
  ]);
  if (rfqs.error) throw rfqs.error;
  if (quotes.error) throw quotes.error;
  if (orders.error) throw orders.error;

  const byOrg = new Map<string, CustomerOrganization>();
  const touch = (id: string | null, name: string | null, at: string | null) => {
    if (!id) return null;
    let row = byOrg.get(id);
    if (!row) {
      row = {
        organizationId: id,
        name: name ?? "—",
        orgType: null,
        listed: false,
        slug: null,
        requests: 0,
        quotations: 0,
        accepted: 0,
        orders: 0,
        orderValue: 0,
        lastActivity: null,
      };
      byOrg.set(id, row);
    }
    if (at && (!row.lastActivity || at > row.lastActivity)) row.lastActivity = at;
    return row;
  };

  for (const r of rfqs.data ?? []) {
    const row = touch(r.requester_org_id, r.requester_name, r.created_at);
    if (row) row.requests += 1;
  }
  for (const q of quotes.data ?? []) {
    const row = touch(q.requester_org_id, q.requester_name, q.created_at);
    if (!row) continue;
    row.quotations += 1;
    if (q.status === "accepted") row.accepted += 1;
  }
  for (const o of orders.data ?? []) {
    const row = touch(o.requester_org_id, o.requester_name, o.confirmed_at);
    if (!row) continue;
    row.orders += 1;
    row.orderValue += Number(o.total ?? 0);
  }

  // One enrichment pass, bounded by the customers the caller actually has. The
  // public projection is the ONLY source for classification and verification —
  // this never touches the base `organizations` table.
  const ids = [...byOrg.keys()];
  if (ids.length > 0) {
    const { data, error } = await supabase
      .from("organization_public_directory")
      .select("id, name, org_type, slug")
      .in("id", ids);
    if (error) throw error;
    for (const pub of data ?? []) {
      if (!pub.id) continue;
      const row = byOrg.get(pub.id);
      if (!row) continue;
      row.listed = true;
      row.orgType = pub.org_type;
      row.slug = pub.slug;
      // The published name wins where one exists: it is the business's own
      // canonical public name, and a commerce record only ever holds a copy.
      if (pub.name) row.name = pub.name;
    }
  }

  // Strongest relationship first — value won, then orders, then how recently they
  // were in touch. A customer that has only ever sent requests still appears; it
  // is exactly the one a seller should be chasing.
  return [...byOrg.values()].sort(
    (a, b) =>
      b.orderValue - a.orderValue ||
      b.orders - a.orders ||
      (b.lastActivity ?? "").localeCompare(a.lastActivity ?? ""),
  );
}

/** The org types that BUY from the supply side — the "find new customers" set. */
export const BUYER_ORG_TYPES: OrgType[] = ["showroom_dealer", "contractor_company", "design_office"];
