"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import * as sales from "@/server/actions/sales";
import { mapSalesError } from "@/server/actions/error-mapping";
import type { Database } from "@/types/database.types";

/**
 * Server Actions the B2B forms bind to. They translate FormData -> the typed
 * server-only sales helpers (which forward the caller JWT to the RPCs). No
 * authorization decision is made here — the database decides and we map its
 * outcome to a translation KEY. Errors are never swallowed.
 */

export type FormState = {
  ok: boolean;
  /** translation key for an error/success message */
  code?: string;
  /** per-field translation keys */
  fieldErrors?: Record<string, string>;
};

type CustomerType = Database["public"]["Enums"]["customer_type"];
type SalesSource = Database["public"]["Enums"]["sales_source"];
type SalesPriority = Database["public"]["Enums"]["sales_priority"];
type LeadStage = Database["public"]["Enums"]["lead_stage"];
type LeadStatus = Database["public"]["Enums"]["lead_status"];
type ActivityType = Database["public"]["Enums"]["sales_activity_type"];

function str(fd: FormData, key: string): string | undefined {
  const v = fd.get(key);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

// ---- Customers -------------------------------------------------------------
export async function createCustomerAction(_p: FormState, fd: FormData): Promise<FormState> {
  const orgId = str(fd, "orgId");
  const displayName = str(fd, "displayName");
  if (!orgId) return { ok: false, code: "states.genericRetry" };
  if (!displayName) return { ok: false, fieldErrors: { displayName: "validation.nameLength" } };

  const supabase = await getServerSupabase();
  let newId: string;
  try {
    newId = await sales.createCustomer(supabase, {
      orgId,
      displayName,
      customerType: (str(fd, "customerType") as CustomerType) ?? "individual",
      branchId: str(fd, "branchId"),
      primaryPhone: str(fd, "primaryPhone"),
      email: str(fd, "email"),
      preferredLanguage: str(fd, "preferredLanguage"),
      locationSummary: str(fd, "locationSummary"),
      source: str(fd, "source") as SalesSource | undefined,
      assignedMembershipId: str(fd, "assignedMembershipId"),
    });
  } catch (e) {
    return { ok: false, code: mapSalesError(e) };
  }
  revalidatePath("/b2b/customers");
  redirect(`/b2b/customers/${newId}?created=1`);
}

export async function archiveCustomerAction(fd: FormData): Promise<void> {
  const id = str(fd, "customerId");
  if (!id) return;
  const supabase = await getServerSupabase();
  await sales.updateCustomer(supabase, id, { archive: true });
  revalidatePath(`/b2b/customers/${id}`);
  revalidatePath("/b2b/customers");
}

// ---- Leads -----------------------------------------------------------------
export async function createLeadAction(_p: FormState, fd: FormData): Promise<FormState> {
  const orgId = str(fd, "orgId");
  const title = str(fd, "title");
  if (!orgId) return { ok: false, code: "states.genericRetry" };
  if (!title) return { ok: false, fieldErrors: { title: "validation.titleLength" } };

  const supabase = await getServerSupabase();
  let newId: string;
  try {
    newId = await sales.createLead(supabase, {
      orgId,
      title,
      branchId: str(fd, "branchId"),
      customerId: str(fd, "customerId"),
      source: str(fd, "source") as SalesSource | undefined,
      priority: (str(fd, "priority") as SalesPriority) ?? "normal",
      assignedMembershipId: str(fd, "assignedMembershipId"),
    });
  } catch (e) {
    return { ok: false, code: mapSalesError(e) };
  }
  const summary = str(fd, "intent");
  if (summary) {
    try {
      await sales.addSalesActivity(supabase, {
        orgId,
        activityType: "note",
        summary,
        leadId: newId,
      });
    } catch {
      // Non-fatal: the lead exists; the note is best-effort.
    }
  }
  revalidatePath("/b2b/leads");
  redirect(`/b2b/leads/${newId}?created=1`);
}

const transitionSchema = z.object({
  leadId: z.string().uuid(),
  version: z.coerce.number().int(),
});

export async function transitionLeadAction(_p: FormState, fd: FormData): Promise<FormState> {
  const parsed = transitionSchema.safeParse({ leadId: fd.get("leadId"), version: fd.get("version") });
  if (!parsed.success) return { ok: false, code: "states.genericRetry" };
  const stage = str(fd, "stage") as LeadStage | undefined;
  const status = str(fd, "status") as LeadStatus | undefined;
  const lostReason = str(fd, "lostReason");
  if (status === "lost" && !lostReason) {
    return { ok: false, fieldErrors: { lostReason: "leads.lostReasonRequired" } };
  }

  const supabase = await getServerSupabase();
  try {
    await sales.transitionLead(supabase, parsed.data.leadId, parsed.data.version, {
      stage,
      status,
      lostReason,
    });
  } catch (e) {
    return { ok: false, code: mapSalesError(e) };
  }
  revalidatePath(`/b2b/leads/${parsed.data.leadId}`);
  revalidatePath("/b2b/leads");
  revalidatePath("/b2b");
  const msg =
    status === "won" ? "leads.won" : status === "lost" ? "leads.lost" : status === "active" && stage === undefined ? "leads.reopened" : "leads.stageChanged";
  return { ok: true, code: msg };
}

export async function assignLeadAction(_p: FormState, fd: FormData): Promise<FormState> {
  const leadId = str(fd, "leadId");
  const version = Number(fd.get("version"));
  const assignee = str(fd, "assigneeMembershipId");
  if (!leadId || !assignee || !Number.isInteger(version)) {
    return { ok: false, code: "states.genericRetry" };
  }
  const supabase = await getServerSupabase();
  try {
    await sales.assignLead(supabase, leadId, assignee, version);
  } catch (e) {
    return { ok: false, code: mapSalesError(e) };
  }
  revalidatePath(`/b2b/leads/${leadId}`);
  revalidatePath("/b2b/leads");
  return { ok: true, code: "leads.assigned" };
}

// ---- Activities ------------------------------------------------------------
export async function addActivityAction(_p: FormState, fd: FormData): Promise<FormState> {
  const orgId = str(fd, "orgId");
  const leadId = str(fd, "leadId");
  const customerId = str(fd, "customerId");
  const summary = str(fd, "summary");
  const type = (str(fd, "activityType") as ActivityType) ?? "note";
  if (!orgId || !summary) return { ok: false, code: "states.genericRetry" };

  const supabase = await getServerSupabase();
  try {
    await sales.addSalesActivity(supabase, {
      orgId,
      activityType: type,
      summary,
      leadId,
      customerId,
    });
  } catch (e) {
    return { ok: false, code: mapSalesError(e) };
  }
  if (leadId) revalidatePath(`/b2b/leads/${leadId}`);
  if (customerId) revalidatePath(`/b2b/customers/${customerId}`);
  return { ok: true, code: "activities.added" };
}

// ---- Follow-ups ------------------------------------------------------------
export async function createFollowUpAction(_p: FormState, fd: FormData): Promise<FormState> {
  const orgId = str(fd, "orgId");
  const title = str(fd, "title");
  const assignee = str(fd, "assigneeMembershipId");
  const leadId = str(fd, "leadId");
  const customerId = str(fd, "customerId");
  if (!orgId || !assignee) return { ok: false, code: "states.genericRetry" };
  if (!title) return { ok: false, fieldErrors: { title: "validation.titleLength" } };

  const supabase = await getServerSupabase();
  try {
    await sales.createFollowUp(supabase, {
      orgId,
      title,
      assigneeMembershipId: assignee,
      leadId,
      customerId,
      dueAt: str(fd, "dueAt"),
      priority: (str(fd, "priority") as SalesPriority) ?? "normal",
      description: str(fd, "description"),
    });
  } catch (e) {
    return { ok: false, code: mapSalesError(e) };
  }
  if (leadId) revalidatePath(`/b2b/leads/${leadId}`);
  if (customerId) revalidatePath(`/b2b/customers/${customerId}`);
  revalidatePath("/b2b/follow-ups");
  revalidatePath("/b2b");
  return { ok: true, code: "followUps.created" };
}

async function followUpLifecycle(
  fd: FormData,
  op: "complete" | "reopen" | "cancel",
): Promise<void> {
  const id = str(fd, "followUpId");
  if (!id) return;
  const supabase = await getServerSupabase();
  if (op === "complete") await sales.completeFollowUp(supabase, id);
  else if (op === "reopen") await sales.reopenFollowUp(supabase, id);
  else await sales.cancelFollowUp(supabase, id);
  revalidatePath("/b2b/follow-ups");
  revalidatePath("/b2b");
  const leadId = str(fd, "leadId");
  if (leadId) revalidatePath(`/b2b/leads/${leadId}`);
}

export async function completeFollowUpAction(fd: FormData): Promise<void> {
  await followUpLifecycle(fd, "complete");
}
export async function reopenFollowUpAction(fd: FormData): Promise<void> {
  await followUpLifecycle(fd, "reopen");
}
export async function cancelFollowUpAction(fd: FormData): Promise<void> {
  await followUpLifecycle(fd, "cancel");
}

export async function reassignFollowUpAction(_p: FormState, fd: FormData): Promise<FormState> {
  const id = str(fd, "followUpId");
  const assignee = str(fd, "assigneeMembershipId");
  if (!id || !assignee) return { ok: false, code: "states.genericRetry" };
  const supabase = await getServerSupabase();
  try {
    await sales.reassignFollowUp(supabase, id, assignee);
  } catch (e) {
    return { ok: false, code: mapSalesError(e) };
  }
  revalidatePath("/b2b/follow-ups");
  return { ok: true, code: "followUps.created" };
}
