"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import * as execution from "@/server/actions/execution";
import { mapExecutionError, isStaleVersion } from "@/server/actions/error-mapping";

/**
 * Server Actions the execution (order/project) forms bind to. They translate
 * FormData → the typed server-only execution helpers (which forward the caller
 * JWT to the RPCs). No authorization decision is made here — the database decides
 * and we map its outcome to a translation KEY. Errors are never swallowed.
 */

export type FormState = {
  ok: boolean;
  code?: string;
  fieldErrors?: Record<string, string>;
};

function str(fd: FormData, key: string): string | undefined {
  const v = fd.get(key);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}

// ===========================================================================
// Orders
// ===========================================================================
export async function createOrderAction(_p: FormState, fd: FormData): Promise<FormState> {
  const quotationId = str(fd, "quotationId");
  if (!quotationId) return { ok: false, code: "states.genericRetry" };
  const supabase = await getServerSupabase();
  let orderId: string;
  try {
    orderId = await execution.createOrderFromQuotation(supabase, quotationId);
  } catch (e) {
    return { ok: false, code: mapExecutionError(e) };
  }
  revalidatePath("/b2b/orders");
  redirect(`/b2b/orders/${orderId}?created=1`);
}

export async function startOrderAction(_p: FormState, fd: FormData): Promise<FormState> {
  const orderId = str(fd, "orderId");
  const version = Number(str(fd, "expectedVersion"));
  if (!orderId || !Number.isInteger(version)) return { ok: false, code: "states.genericRetry" };
  const supabase = await getServerSupabase();
  try {
    await execution.startOrder(supabase, orderId, version);
  } catch (e) {
    if (isStaleVersion(e)) return { ok: false, code: "execution.errors.conflict" };
    return { ok: false, code: mapExecutionError(e) };
  }
  revalidatePath(`/b2b/orders/${orderId}`);
  revalidatePath("/b2b/orders");
  return { ok: true, code: "execution.flash.orderStarted" };
}

export async function cancelOrderAction(_p: FormState, fd: FormData): Promise<FormState> {
  const orderId = str(fd, "orderId");
  if (!orderId) return { ok: false, code: "states.genericRetry" };
  const supabase = await getServerSupabase();
  try {
    await execution.cancelOrder(supabase, orderId);
  } catch (e) {
    return { ok: false, code: mapExecutionError(e) };
  }
  revalidatePath(`/b2b/orders/${orderId}`);
  revalidatePath("/b2b/orders");
  return { ok: true, code: "execution.flash.orderCancelled" };
}

// ===========================================================================
// Projects
// ===========================================================================
export async function createProjectAction(_p: FormState, fd: FormData): Promise<FormState> {
  const orderId = str(fd, "orderId");
  const title = str(fd, "title");
  if (!orderId) return { ok: false, code: "states.genericRetry" };
  if (!title) return { ok: false, fieldErrors: { title: "execution.validation.titleRequired" } };
  const start = str(fd, "startDate");
  const target = str(fd, "targetDate");
  if (start && target && target < start) {
    return { ok: false, fieldErrors: { targetDate: "execution.validation.targetAfterStart" } };
  }

  const supabase = await getServerSupabase();
  let projectId: string;
  try {
    projectId = await execution.createProjectFromOrder(supabase, {
      orderId,
      title,
      location: str(fd, "location"),
      description: str(fd, "description"),
      startDate: start,
      targetDate: target,
    });
  } catch (e) {
    return { ok: false, code: mapExecutionError(e) };
  }
  revalidatePath("/b2b/projects");
  revalidatePath(`/b2b/orders/${orderId}`);
  redirect(`/b2b/projects/${projectId}?created=1`);
}

export async function activateProjectAction(_p: FormState, fd: FormData): Promise<FormState> {
  const projectId = str(fd, "projectId");
  const version = Number(str(fd, "expectedVersion"));
  if (!projectId || !Number.isInteger(version)) return { ok: false, code: "states.genericRetry" };
  const supabase = await getServerSupabase();
  try {
    await execution.activateProject(supabase, projectId, version);
  } catch (e) {
    if (isStaleVersion(e)) return { ok: false, code: "execution.errors.conflict" };
    return { ok: false, code: mapExecutionError(e) };
  }
  revalidatePath(`/b2b/projects/${projectId}`);
  revalidatePath("/b2b/projects");
  return { ok: true, code: "execution.flash.projectActivated" };
}

export async function completeProjectAction(_p: FormState, fd: FormData): Promise<FormState> {
  const projectId = str(fd, "projectId");
  const version = Number(str(fd, "expectedVersion"));
  if (!projectId || !Number.isInteger(version)) return { ok: false, code: "states.genericRetry" };
  const supabase = await getServerSupabase();
  try {
    await execution.completeProject(supabase, projectId, version);
  } catch (e) {
    if (isStaleVersion(e)) return { ok: false, code: "execution.errors.conflict" };
    return { ok: false, code: mapExecutionError(e) };
  }
  revalidatePath(`/b2b/projects/${projectId}`);
  revalidatePath("/b2b/projects");
  return { ok: true, code: "execution.flash.projectCompleted" };
}
