import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

/**
 * Trusted B2B sales workflow boundaries (Phase 2, Sprint 3).
 *
 * Thin wrappers over the server-side sales RPCs. ALL authorization (organization
 * + branch scope, capability checks, assignment/lifecycle rules), tenant
 * isolation, optimistic concurrency, and audit emission live in the database
 * functions (ADR-0008). These wrappers only forward the CALLER's JWT via a
 * caller-scoped server client, so the database enforces who may do what. No
 * privileged logic runs here, no service-role client is used, and no
 * authorization decision is duplicated in TypeScript.
 */

type SalesSource = Database["public"]["Enums"]["sales_source"];
type SalesPriority = Database["public"]["Enums"]["sales_priority"];
type CustomerType = Database["public"]["Enums"]["customer_type"];
type LeadStage = Database["public"]["Enums"]["lead_stage"];
type LeadStatus = Database["public"]["Enums"]["lead_status"];
type SalesActivityType = Database["public"]["Enums"]["sales_activity_type"];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireUuid(value: unknown, rpcName: string): string {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new Error(`${rpcName} returned an invalid identifier.`);
  }
  return value;
}

function requireVersion(value: unknown, rpcName: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`${rpcName} returned an invalid version.`);
  }
  return value;
}

type Client = SupabaseClient<Database>;

// ---- Customers -------------------------------------------------------------
export async function createCustomer(
  supabase: Client,
  input: {
    orgId: string;
    displayName: string;
    customerType?: CustomerType;
    branchId?: string;
    primaryPhone?: string;
    email?: string;
    preferredLanguage?: string;
    locationSummary?: string;
    source?: SalesSource;
    assignedMembershipId?: string;
  },
): Promise<string> {
  const { data, error } = await supabase.rpc("create_customer", {
    p_org_id: input.orgId,
    p_display_name: input.displayName,
    ...(input.customerType ? { p_customer_type: input.customerType } : {}),
    ...(input.branchId ? { p_branch_id: input.branchId } : {}),
    ...(input.primaryPhone ? { p_primary_phone: input.primaryPhone } : {}),
    ...(input.email ? { p_email: input.email } : {}),
    ...(input.preferredLanguage ? { p_preferred_language: input.preferredLanguage } : {}),
    ...(input.locationSummary ? { p_location_summary: input.locationSummary } : {}),
    ...(input.source ? { p_source: input.source } : {}),
    ...(input.assignedMembershipId ? { p_assigned_membership_id: input.assignedMembershipId } : {}),
  });
  if (error) throw error;
  return requireUuid(data, "create_customer");
}

export async function updateCustomer(
  supabase: Client,
  customerId: string,
  patch: {
    /** Optimistic precondition: the exact `updated_at` the caller last saw. */
    expectedUpdatedAt?: string;
    displayName?: string;
    primaryPhone?: string;
    email?: string;
    preferredLanguage?: string;
    locationSummary?: string;
    source?: SalesSource;
    archive?: boolean;
    /** Explicit clear-to-NULL flags (blank submission, not "leave unchanged"). */
    clearPhone?: boolean;
    clearEmail?: boolean;
    clearLocation?: boolean;
  },
): Promise<void> {
  const { error } = await supabase.rpc("update_customer", {
    p_customer_id: customerId,
    ...(patch.expectedUpdatedAt !== undefined ? { p_expected_updated_at: patch.expectedUpdatedAt } : {}),
    ...(patch.displayName !== undefined ? { p_display_name: patch.displayName } : {}),
    ...(patch.primaryPhone !== undefined ? { p_primary_phone: patch.primaryPhone } : {}),
    ...(patch.email !== undefined ? { p_email: patch.email } : {}),
    ...(patch.preferredLanguage !== undefined ? { p_preferred_language: patch.preferredLanguage } : {}),
    ...(patch.locationSummary !== undefined ? { p_location_summary: patch.locationSummary } : {}),
    ...(patch.source !== undefined ? { p_source: patch.source } : {}),
    ...(patch.archive !== undefined ? { p_archive: patch.archive } : {}),
    ...(patch.clearPhone ? { p_clear_phone: true } : {}),
    ...(patch.clearEmail ? { p_clear_email: true } : {}),
    ...(patch.clearLocation ? { p_clear_location: true } : {}),
  });
  if (error) throw error;
}

// ---- Leads -----------------------------------------------------------------
export async function createLead(
  supabase: Client,
  input: {
    orgId: string;
    title: string;
    branchId?: string;
    customerId?: string;
    source?: SalesSource;
    priority?: SalesPriority;
    assignedMembershipId?: string;
    nextFollowUpAt?: string;
  },
): Promise<string> {
  const { data, error } = await supabase.rpc("create_lead", {
    p_org_id: input.orgId,
    p_title: input.title,
    ...(input.branchId ? { p_branch_id: input.branchId } : {}),
    ...(input.customerId ? { p_customer_id: input.customerId } : {}),
    ...(input.source ? { p_source: input.source } : {}),
    ...(input.priority ? { p_priority: input.priority } : {}),
    ...(input.assignedMembershipId ? { p_assigned_membership_id: input.assignedMembershipId } : {}),
    ...(input.nextFollowUpAt ? { p_next_follow_up_at: input.nextFollowUpAt } : {}),
  });
  if (error) throw error;
  return requireUuid(data, "create_lead");
}

/** Returns the new optimistic-concurrency version. */
export async function updateLeadDetails(
  supabase: Client,
  leadId: string,
  expectedVersion: number,
  patch: {
    title?: string;
    priority?: SalesPriority;
    nextFollowUpAt?: string;
    customerId?: string;
    clearNextFollowUp?: boolean;
  },
): Promise<number> {
  const { data, error } = await supabase.rpc("update_lead_details", {
    p_lead_id: leadId,
    p_expected_version: expectedVersion,
    ...(patch.title !== undefined ? { p_title: patch.title } : {}),
    ...(patch.priority !== undefined ? { p_priority: patch.priority } : {}),
    ...(patch.nextFollowUpAt !== undefined ? { p_next_follow_up_at: patch.nextFollowUpAt } : {}),
    ...(patch.customerId !== undefined ? { p_customer_id: patch.customerId } : {}),
    ...(patch.clearNextFollowUp ? { p_clear_next_follow_up: true } : {}),
  });
  if (error) throw error;
  return requireVersion(data, "update_lead_details");
}

export async function assignLead(
  supabase: Client,
  leadId: string,
  assigneeMembershipId: string,
  expectedVersion: number,
): Promise<number> {
  const { data, error } = await supabase.rpc("assign_lead", {
    p_lead_id: leadId,
    p_assignee_membership_id: assigneeMembershipId,
    p_expected_version: expectedVersion,
  });
  if (error) throw error;
  return requireVersion(data, "assign_lead");
}

export async function transitionLead(
  supabase: Client,
  leadId: string,
  expectedVersion: number,
  target: { stage?: LeadStage; status?: LeadStatus; lostReason?: string },
): Promise<number> {
  const { data, error } = await supabase.rpc("transition_lead", {
    p_lead_id: leadId,
    p_expected_version: expectedVersion,
    ...(target.stage ? { p_new_stage: target.stage } : {}),
    ...(target.status ? { p_new_status: target.status } : {}),
    ...(target.lostReason !== undefined ? { p_lost_reason: target.lostReason } : {}),
  });
  if (error) throw error;
  return requireVersion(data, "transition_lead");
}

// ---- Activities ------------------------------------------------------------
export async function addSalesActivity(
  supabase: Client,
  input: {
    orgId: string;
    activityType: SalesActivityType;
    summary: string;
    leadId?: string;
    customerId?: string;
    occurredAt?: string;
    metadata?: Database["public"]["Tables"]["sales_activities"]["Row"]["metadata"];
  },
): Promise<string> {
  const { data, error } = await supabase.rpc("add_sales_activity", {
    p_org_id: input.orgId,
    p_activity_type: input.activityType,
    p_summary: input.summary,
    ...(input.leadId ? { p_lead_id: input.leadId } : {}),
    ...(input.customerId ? { p_customer_id: input.customerId } : {}),
    ...(input.occurredAt ? { p_occurred_at: input.occurredAt } : {}),
    ...(input.metadata !== undefined ? { p_metadata: input.metadata } : {}),
  });
  if (error) throw error;
  return requireUuid(data, "add_sales_activity");
}

// ---- Follow-up tasks -------------------------------------------------------
export async function createFollowUp(
  supabase: Client,
  input: {
    orgId: string;
    title: string;
    assigneeMembershipId: string;
    leadId?: string;
    customerId?: string;
    dueAt?: string;
    priority?: SalesPriority;
    description?: string;
  },
): Promise<string> {
  const { data, error } = await supabase.rpc("create_follow_up", {
    p_org_id: input.orgId,
    p_title: input.title,
    p_assignee_membership_id: input.assigneeMembershipId,
    ...(input.leadId ? { p_lead_id: input.leadId } : {}),
    ...(input.customerId ? { p_customer_id: input.customerId } : {}),
    ...(input.dueAt ? { p_due_at: input.dueAt } : {}),
    ...(input.priority ? { p_priority: input.priority } : {}),
    ...(input.description ? { p_description: input.description } : {}),
  });
  if (error) throw error;
  return requireUuid(data, "create_follow_up");
}

export async function updateFollowUp(
  supabase: Client,
  followUpId: string,
  patch: {
    /** Optimistic precondition: the version the caller last saw. */
    expectedVersion?: number;
    title?: string;
    description?: string;
    dueAt?: string;
    priority?: SalesPriority;
    clearDue?: boolean;
    clearDescription?: boolean;
  },
): Promise<void> {
  const { error } = await supabase.rpc("update_follow_up", {
    p_follow_up_id: followUpId,
    ...(patch.expectedVersion !== undefined ? { p_expected_version: patch.expectedVersion } : {}),
    ...(patch.title !== undefined ? { p_title: patch.title } : {}),
    ...(patch.description !== undefined ? { p_description: patch.description } : {}),
    ...(patch.dueAt !== undefined ? { p_due_at: patch.dueAt } : {}),
    ...(patch.priority !== undefined ? { p_priority: patch.priority } : {}),
    ...(patch.clearDue ? { p_clear_due: true } : {}),
    ...(patch.clearDescription ? { p_clear_description: true } : {}),
  });
  if (error) throw error;
}

export async function completeFollowUp(supabase: Client, followUpId: string): Promise<void> {
  const { error } = await supabase.rpc("complete_follow_up", { p_follow_up_id: followUpId });
  if (error) throw error;
}

export async function reopenFollowUp(supabase: Client, followUpId: string): Promise<void> {
  const { error } = await supabase.rpc("reopen_follow_up", { p_follow_up_id: followUpId });
  if (error) throw error;
}

export async function cancelFollowUp(supabase: Client, followUpId: string): Promise<void> {
  const { error } = await supabase.rpc("cancel_follow_up", { p_follow_up_id: followUpId });
  if (error) throw error;
}

export async function reassignFollowUp(
  supabase: Client,
  followUpId: string,
  assigneeMembershipId: string,
  expectedVersion?: number,
): Promise<void> {
  const { error } = await supabase.rpc("reassign_follow_up", {
    p_follow_up_id: followUpId,
    p_assignee_membership_id: assigneeMembershipId,
    ...(expectedVersion !== undefined ? { p_expected_version: expectedVersion } : {}),
  });
  if (error) throw error;
}
