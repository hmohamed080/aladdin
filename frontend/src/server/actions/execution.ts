import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * Trusted B2B execution workflow boundaries (Phase 3, Sprint 10 — Order /
 * Project / Completion). Thin, typed wrappers over the server-side
 * security-definer RPCs. ALL authorization (organization scope, capability
 * checks, lifecycle rules), tenant isolation, optimistic concurrency, and audit
 * emission live in the database functions (ADR-0008). These wrappers only forward
 * the CALLER's JWT via a caller-scoped server client — no privileged logic, no
 * service-role client, no authorization decision duplicated in TypeScript.
 */

type Client = SupabaseClient<Database>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireUuid(value: unknown, rpc: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new Error(`${rpc} returned an invalid identifier.`);
  }
  return value;
}
function requireVersion(value: unknown, rpc: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${rpc} returned an invalid version.`);
  }
  return value;
}

// ---- Orders ----------------------------------------------------------------
export async function createOrderFromQuotation(
  supabase: Client,
  quotationId: string,
): Promise<string> {
  const { data, error } = await supabase.rpc("create_order_from_quotation", {
    p_quotation_id: quotationId,
  });
  if (error) throw error;
  return requireUuid(data, "create_order_from_quotation");
}

export async function startOrder(
  supabase: Client,
  orderId: string,
  expectedVersion: number,
): Promise<number> {
  const { data, error } = await supabase.rpc("start_order", {
    p_order_id: orderId,
    p_expected_version: expectedVersion,
  });
  if (error) throw error;
  return requireVersion(data, "start_order");
}

export async function cancelOrder(supabase: Client, orderId: string): Promise<void> {
  const { error } = await supabase.rpc("cancel_order", { p_order_id: orderId });
  if (error) throw error;
}

// ---- Projects --------------------------------------------------------------
export async function createProjectFromOrder(
  supabase: Client,
  input: {
    orderId: string;
    title: string;
    location?: string;
    description?: string;
    startDate?: string;
    targetDate?: string;
  },
): Promise<string> {
  const { data, error } = await supabase.rpc("create_project_from_order", {
    p_order_id: input.orderId,
    p_title: input.title,
    ...(input.location ? { p_location: input.location } : {}),
    ...(input.description ? { p_description: input.description } : {}),
    ...(input.startDate ? { p_start_date: input.startDate } : {}),
    ...(input.targetDate ? { p_target_date: input.targetDate } : {}),
  });
  if (error) throw error;
  return requireUuid(data, "create_project_from_order");
}

export async function activateProject(
  supabase: Client,
  projectId: string,
  expectedVersion: number,
): Promise<number> {
  const { data, error } = await supabase.rpc("activate_project", {
    p_project_id: projectId,
    p_expected_version: expectedVersion,
  });
  if (error) throw error;
  return requireVersion(data, "activate_project");
}

export async function completeProject(
  supabase: Client,
  projectId: string,
  expectedVersion: number,
): Promise<number> {
  const { data, error } = await supabase.rpc("complete_project", {
    p_project_id: projectId,
    p_expected_version: expectedVersion,
  });
  if (error) throw error;
  return requireVersion(data, "complete_project");
}
