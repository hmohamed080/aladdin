"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import {
  COMPLAINT_DECISIONS, COMPLAINT_REASONS, complaintErrorCode, noteIsValid,
  type ComplaintDecision, type ComplaintReason,
} from "@/features/marketplace-admin-complaints/model";

/**
 * Payment-complaint writers. Each runs under the caller's OWN session and calls a SECURITY DEFINER RPC that re-checks who the
 * caller is (the admin permission marketplace_payment_complaints.review, or the buyer / showroom order manager of the order): the
 * UI is never the gate. No service credential is used here.
 */
export type ComplaintResult<T = object> = ({ ok: true } & T) | { ok: false; code: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const QUEUE = "/admin/marketplace/payment-complaints";

export async function takeComplaintAction(complaintId: string): Promise<ComplaintResult> {
  if (!UUID.test(complaintId)) return { ok: false, code: "not_found" };
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("admin_marketplace_payment_complaint_take", { p_complaint_id: complaintId });
  if (error) return { ok: false, code: complaintErrorCode(error) };
  revalidatePath(QUEUE);
  revalidatePath(`${QUEUE}/${complaintId}`);
  return { ok: true };
}

export async function decideComplaintAction(complaintId: string, decision: ComplaintDecision, note: string): Promise<ComplaintResult> {
  if (!UUID.test(complaintId)) return { ok: false, code: "not_found" };
  if (!COMPLAINT_DECISIONS.includes(decision)) return { ok: false, code: "invalid_payload" };
  if (!noteIsValid(note)) return { ok: false, code: "reason_required" };
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("admin_marketplace_payment_complaint_decide", {
    p_complaint_id: complaintId, p_decision: decision, p_note: note.trim(),
  });
  if (error) return { ok: false, code: complaintErrorCode(error) };
  revalidatePath(QUEUE);
  revalidatePath(`${QUEUE}/${complaintId}`);
  return { ok: true };
}

/** Buyer or showroom: report a disputed receipt to the admins. The slot for PR 13's order pages (`file_complaint` action). */
export async function fileComplaintAction(orderId: string, reason: ComplaintReason, note: string): Promise<ComplaintResult<{ complaintId: string }>> {
  if (!UUID.test(orderId)) return { ok: false, code: "not_found" };
  if (!COMPLAINT_REASONS.includes(reason)) return { ok: false, code: "invalid_payload" };
  const trimmed = note.trim();
  if (reason === "other" && !noteIsValid(trimmed)) return { ok: false, code: "reason_required" };
  if (trimmed && !noteIsValid(trimmed)) return { ok: false, code: "invalid_payload" };
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_payment_complaint_file", {
    p_order_id: orderId, p_reason: reason, p_note: trimmed || (null as unknown as string),
  });
  if (error) return { ok: false, code: complaintErrorCode(error) };
  revalidatePath(`/market/orders/${orderId}`);
  revalidatePath(`/showroom/marketplace/orders/${orderId}`);
  return { ok: true, complaintId: String((data as { complaint_id?: string } | null)?.complaint_id ?? "") };
}
