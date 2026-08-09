import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * Read queries for the B2B execution workspace (Orders / Projects). Every query
 * runs through the caller-scoped client, so RLS enforces tenant and
 * requester/supplier visibility in the database (ADR-0008). The UI never filters
 * for security — only for UX. A filter can narrow results but never widen them
 * past what RLS already allows.
 */

type DB = SupabaseClient<Database>;

export type OrderRow = Database["public"]["Tables"]["orders"]["Row"];
export type OrderListRow = Database["public"]["Views"]["order_list"]["Row"];
export type OrderItemRow = Database["public"]["Tables"]["order_items"]["Row"];
export type ProjectRow = Database["public"]["Tables"]["projects"]["Row"];
export type ProjectListRow = Database["public"]["Views"]["project_list"]["Row"];

const LIST_LIMIT = 100;

// ---- Orders ----------------------------------------------------------------
/** `side` = requester (buyer) or supplier (executing org). RLS scopes rows. */
export type OrderSide = "requester" | "supplier";

export async function listOrders(
  supabase: DB,
  orgId: string,
  side: OrderSide,
): Promise<OrderListRow[]> {
  const col = side === "requester" ? "requester_org_id" : "supplier_org_id";
  const { data, error } = await supabase
    .from("order_list")
    .select("*")
    .eq(col, orgId)
    .order("updated_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (error) throw error;
  return data ?? [];
}

export async function getOrder(supabase: DB, id: string): Promise<OrderRow | null> {
  const { data, error } = await supabase.from("orders").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getOrderDisplay(supabase: DB, id: string): Promise<OrderListRow | null> {
  const { data, error } = await supabase.from("order_list").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function listOrderItems(supabase: DB, orderId: string): Promise<OrderItemRow[]> {
  const { data, error } = await supabase
    .from("order_items")
    .select("*")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/** The project for an order, if one exists yet. */
export async function getProjectForOrder(supabase: DB, orderId: string): Promise<ProjectRow | null> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .eq("order_id", orderId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** The order created from a given quotation, if any (used on the quotation page). */
export async function getOrderForQuotation(
  supabase: DB,
  quotationId: string,
): Promise<OrderRow | null> {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("quotation_id", quotationId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ---- Projects --------------------------------------------------------------
export type ProjectSide = "requester" | "executing";

export async function listProjects(
  supabase: DB,
  orgId: string,
  side: ProjectSide,
): Promise<ProjectListRow[]> {
  const col = side === "requester" ? "requester_org_id" : "executing_org_id";
  const { data, error } = await supabase
    .from("project_list")
    .select("*")
    .eq(col, orgId)
    .order("updated_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (error) throw error;
  return data ?? [];
}

export async function getProject(supabase: DB, id: string): Promise<ProjectRow | null> {
  const { data, error } = await supabase.from("projects").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getProjectDisplay(
  supabase: DB,
  id: string,
): Promise<ProjectListRow | null> {
  const { data, error } = await supabase
    .from("project_list")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}
