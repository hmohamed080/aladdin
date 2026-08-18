"use server";

import { getServerSupabase } from "@/lib/supabase/server";
import { loadWorkspaceContext } from "@/server/queries/context";
import { loadPlatformRole, isPlatformStaff } from "@/server/queries/platform";
import { sanitizeSearchTerm } from "@/server/queries/sales";
import { commerceStance, defaultCommerceSide } from "@/lib/workspace/supply-side";
import {
  MIN_QUERY_LENGTH,
  PER_GROUP,
  searchableGroups,
  type SearchHit,
} from "@/lib/search/scope";

/**
 * GLOBAL SEARCH — the data half of the command palette.
 *
 * SECURITY, WHICH IS THE WHOLE DESIGN
 * A global search is the easiest place in a multi-tenant product to build a
 * cross-tenant leak, because it is the one surface that queries every table at
 * once and nobody reviews its results row by row. Three rules hold here, and
 * none of them may be relaxed for convenience:
 *
 *   1. EVERY read goes through `getServerSupabase()` — the caller-scoped client.
 *      RLS is the boundary, exactly as it is on every list page (ADR-0008).
 *      Nothing here uses a service key, and there is no denormalized search
 *      index that could out-live a revoked membership.
 *   2. Every read is additionally pinned to the caller's ACTIVE organization.
 *      That is not the security boundary (RLS already is) — it is correctness: a
 *      user who belongs to two businesses must not see one from inside the other.
 *   3. A group is only QUERIED when the caller holds a capability that makes the
 *      module reachable. A result the caller cannot open is at best a dead end,
 *      and at worst discloses that a record exists.
 *
 * A caller with no active organization — a personal `/home` account — gets an
 * empty result set by construction: there is no org to scope to, so no business
 * record is read at all. Their palette is navigation-only, built on the client
 * from routes they already hold.
 *
 * SCALE
 * Bounded at both ends. A minimum query length stops a single keystroke fanning
 * out across nine relations, and every group is capped at `PER_GROUP`. Nothing
 * here pulls a table into the browser.
 */

/**
 * A "use server" module may export only async functions, so the types, the
 * bounds and the capability rule live in `lib/search/scope` — which also makes
 * the gate unit-testable without a database, and lets the client import the
 * result shape without pulling in a server action.
 */
export type { SearchGroup, SearchHit } from "@/lib/search/scope";

export async function searchWorkspace(rawQuery: string): Promise<SearchHit[]> {
  const term = sanitizeSearchTerm(typeof rawQuery === "string" ? rawQuery : "");
  if (term.length < MIN_QUERY_LENGTH) return [];

  const supabase = await getServerSupabase();
  const workspace = await loadWorkspaceContext(supabase);
  const org = workspace.active;
  if (!org) return [];

  const groups = searchableGroups(org.capabilities);
  const orgId = org.organizationId;
  const like = `%${term}%`;

  // Which seat this workspace leads from, so a seller's subtitle names the buyer
  // and a buyer's names the supplier. Both seats are searched either way — an
  // RFQ is one record with two parties and one route.
  const side = defaultCommerceSide(commerceStance(org.orgType));

  const none = Promise.resolve({ data: null });

  /** Match on either party of a two-sided commerce record, in one round trip. */
  const eitherParty = (a: string, b: string) => `${a}.eq.${orgId},${b}.eq.${orgId}`;

  const [products, catalog, rfqs, quotations, orders, projects, customers, leads, organizations] =
    await Promise.all([
      groups.has("products")
        ? supabase
            .from("products")
            .select("id, name, sku, brand, status")
            .eq("organization_id", orgId)
            .is("deleted_at", null)
            .or(`name.ilike.${like},sku.ilike.${like},brand.ilike.${like}`)
            .order("updated_at", { ascending: false })
            .limit(PER_GROUP)
        : none,
      groups.has("catalog")
        ? supabase
            .from("catalog_published_products")
            .select("id, name, supplier_name, sku")
            .neq("organization_id", orgId)
            .or(`name.ilike.${like},sku.ilike.${like},brand.ilike.${like}`)
            .limit(PER_GROUP)
        : none,
      groups.has("rfqs")
        ? supabase
            .from("rfq_list")
            .select("id, title, status, requester_name, supplier_name")
            .or(eitherParty("requester_org_id", "supplier_org_id"))
            .ilike("title", like)
            .order("updated_at", { ascending: false })
            .limit(PER_GROUP)
        : none,
      groups.has("quotations")
        ? supabase
            .from("quotation_list")
            .select("id, rfq_title, status, requester_name, supplier_name")
            .or(eitherParty("requester_org_id", "supplier_org_id"))
            .ilike("rfq_title", like)
            .order("updated_at", { ascending: false })
            .limit(PER_GROUP)
        : none,
      groups.has("orders")
        ? supabase
            .from("order_list")
            .select("id, title, status, requester_name, supplier_name")
            .or(eitherParty("requester_org_id", "supplier_org_id"))
            .ilike("title", like)
            .order("updated_at", { ascending: false })
            .limit(PER_GROUP)
        : none,
      groups.has("projects")
        ? supabase
            .from("project_list")
            .select("id, title, status, location, requester_name")
            .or(eitherParty("requester_org_id", "executing_org_id"))
            .ilike("title", like)
            .order("updated_at", { ascending: false })
            .limit(PER_GROUP)
        : none,
      groups.has("customers")
        ? supabase
            .from("customers")
            .select("id, display_name, primary_phone")
            .eq("organization_id", orgId)
            .or(`display_name.ilike.${like},primary_phone.ilike.${like}`)
            .order("updated_at", { ascending: false })
            .limit(PER_GROUP)
        : none,
      groups.has("leads")
        ? supabase
            .from("leads")
            .select("id, title, stage")
            .eq("organization_id", orgId)
            .ilike("title", like)
            .order("updated_at", { ascending: false })
            .limit(PER_GROUP)
        : none,
      // The PUBLIC business directory — the same projection the Suppliers and
      // Institutions modules read, carrying no private commercial data. The
      // caller's own organization is excluded: a business is never its own
      // counterparty, and the row would only ever lead back to itself.
      supabase
        .from("organization_public_directory")
        .select("id, name, org_type")
        .neq("id", orgId)
        .ilike("name", like)
        .limit(PER_GROUP),
    ]);

  const hits: SearchHit[] = [];

  for (const p of products.data ?? []) {
    hits.push({
      id: p.id,
      group: "products",
      title: p.name,
      subtitle: p.sku ?? p.brand ?? null,
      href: `/b2b/products/${p.id}`,
      statusKey: `commerce.productStatus.${p.status}`,
    });
  }
  for (const c of catalog.data ?? []) {
    if (!c.id) continue;
    hits.push({
      id: c.id,
      group: "catalog",
      title: c.name ?? "",
      subtitle: c.supplier_name ?? c.sku,
      href: `/b2b/catalog/${c.id}`,
    });
  }
  for (const r of rfqs.data ?? []) {
    if (!r.id) continue;
    hits.push({
      id: r.id,
      group: "rfqs",
      title: r.title ?? "",
      subtitle: side === "supplier" ? r.requester_name : r.supplier_name,
      href: `/b2b/rfqs/${r.id}`,
      statusKey: r.status ? `commerce.rfqStatus.${r.status}` : undefined,
    });
  }
  for (const q of quotations.data ?? []) {
    if (!q.id) continue;
    hits.push({
      id: q.id,
      group: "quotations",
      title: q.rfq_title ?? "",
      subtitle: side === "supplier" ? q.requester_name : q.supplier_name,
      href: `/b2b/quotations/${q.id}`,
      statusKey: q.status ? `commerce.quotationStatus.${q.status}` : undefined,
    });
  }
  for (const o of orders.data ?? []) {
    if (!o.id) continue;
    hits.push({
      id: o.id,
      group: "orders",
      title: o.title ?? "",
      subtitle: side === "supplier" ? o.requester_name : o.supplier_name,
      href: `/b2b/orders/${o.id}`,
      statusKey: o.status ? `execution.orderStatus.${o.status}` : undefined,
    });
  }
  for (const p of projects.data ?? []) {
    if (!p.id) continue;
    hits.push({
      id: p.id,
      group: "projects",
      title: p.title ?? "",
      subtitle: p.location ?? p.requester_name,
      href: `/b2b/projects/${p.id}`,
      statusKey: p.status ? `execution.projectStatus.${p.status}` : undefined,
    });
  }
  for (const c of customers.data ?? []) {
    hits.push({
      id: c.id,
      group: "customers",
      title: c.display_name,
      subtitle: c.primary_phone,
      href: `/b2b/customers/${c.id}`,
    });
  }
  for (const l of leads.data ?? []) {
    hits.push({
      id: l.id,
      group: "leads",
      title: l.title,
      subtitle: null,
      href: `/b2b/leads/${l.id}`,
      statusKey: l.stage ? `leads.stages.${l.stage}` : undefined,
    });
  }
  for (const o of organizations.data ?? []) {
    if (!o.id || !o.name) continue;
    // The directory has no per-organization detail route, so a hit deep-links to
    // the module that LISTS it, pre-filtered to the name. Inventing a route that
    // does not exist would be a 404 with a nice icon on it.
    const supplySide =
      o.org_type === "supplier" ||
      o.org_type === "manufacturer" ||
      o.org_type === "importer" ||
      o.org_type === "wholesaler";
    const base = supplySide ? "/b2b/suppliers" : "/b2b/institutions";
    hits.push({
      id: o.id,
      group: "organizations",
      title: o.name,
      subtitle: null,
      href: `${base}?q=${encodeURIComponent(o.name)}`,
      statusKey: o.org_type ? `orgType.${o.org_type}` : undefined,
    });
  }

  return hits;
}

/**
 * Whether the caller may see Admin destinations in the palette.
 *
 * Resolved on the server rather than trusted from the client, for the obvious
 * reason: a client-side flag is a suggestion. The admin routes themselves stay
 * gated by `AdminLayout` and by `is_platform(...)` in RLS, so this only decides
 * whether the DOOR is drawn — a forged flag would still land on a redirect.
 */
export async function canSearchAdmin(): Promise<boolean> {
  const supabase = await getServerSupabase();
  return isPlatformStaff(await loadPlatformRole(supabase));
}
