"use server";

import { getServerSupabase } from "@/lib/supabase/server";
import { isCanonicalCategoryCode } from "@/features/commerce/constants";
import { mapRequestError } from "@/features/purchase-requests/error-map";
import {
  REQUEST_LIMITS,
  isUuid,
  parseRequestItem,
  parseResponseLine,
  toItemPayload,
  toResponseLinePayload,
  type RequestItemError,
} from "@/features/purchase-requests/model";
import { countChars } from "@/lib/text/count-chars";
import {
  REQUEST_IMAGE_MAX_BYTES,
  isRequestImageContentType,
  isRequestImageKey,
} from "@/lib/storage/request-images";
import type { UploadGrant } from "@/lib/storage/provider-types";
import { authorizeMediaUpload, removeMedia, verifyPendingMedia } from "@/server/storage/media";

/**
 * Server Actions for shared Purchase Requests. Every one forwards the CALLER's JWT to a security-definer
 * RPC that re-derives the actor from auth.uid(), decides ownership / audience / capability and validates
 * again; these functions only translate form data, give friendly early answers and map refusals to
 * translation keys. There is no service-role client: a bug here cannot widen access.
 */
export type RequestFormState = {
  ok: boolean;
  code?: string;
  id?: string;
  fieldErrors?: Record<string, string>;
  /** Item index -> which field of that item is wrong. */
  itemErrors?: Record<number, RequestItemError>;
};

const E = (s: string) => `purchaseRequests.errors.${s}`;
const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
};
const flag = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "1" || fd.get(k) === "true";
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function readJson(fd: FormData, key: string): unknown[] | null {
  const raw = fd.get(key);
  if (typeof raw !== "string" || raw.trim() === "") return [];
  try {
    const data = JSON.parse(raw) as unknown;
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Requester: draft, publish, close, cancel
// ---------------------------------------------------------------------------
export async function savePurchaseRequestAction(_prev: RequestFormState, fd: FormData): Promise<RequestFormState> {
  const orgId = str(fd, "orgId");
  const requestId = str(fd, "requestId");
  const versionRaw = str(fd, "expectedVersion");
  const version = versionRaw === undefined ? null : Number(versionRaw);
  if ((orgId && !isUuid(orgId)) || (requestId && !isUuid(requestId)) || (requestId && !Number.isInteger(version))) {
    return { ok: false, code: "states.genericRetry" };
  }

  const title = (str(fd, "title") ?? "").replace(/\s+/g, " ");
  const notes = str(fd, "notes") ?? "";
  const neededBy = str(fd, "neededBy") ?? "";
  const fieldErrors: Record<string, string> = {};
  if (countChars(title) < REQUEST_LIMITS.titleMin || countChars(title) > REQUEST_LIMITS.titleMax) fieldErrors.title = E("titleInvalid");
  if (countChars(notes) > REQUEST_LIMITS.notesMax) fieldErrors.notes = E("notesTooLong");
  if (neededBy && !DATE.test(neededBy)) fieldErrors.neededBy = E("neededByPast");

  const rawItems = readJson(fd, "items");
  const itemErrors: Record<number, RequestItemError> = {};
  const payload: ReturnType<typeof toItemPayload>[] = [];
  if (rawItems === null) fieldErrors.items = E("itemInvalid");
  else if (rawItems.length > REQUEST_LIMITS.itemsMax) fieldErrors.items = E("tooManyItems");
  else {
    rawItems.forEach((raw, index) => {
      const parsed = parseRequestItem(raw, isCanonicalCategoryCode);
      if (parsed.ok) payload.push(toItemPayload(parsed.value));
      else itemErrors[index] = parsed.error;
    });
  }
  if (Object.keys(fieldErrors).length || Object.keys(itemErrors).length) {
    return { ok: false, fieldErrors, ...(Object.keys(itemErrors).length ? { itemErrors } : {}) };
  }

  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("purchase_request_save", {
    p_org_id: (orgId ?? null) as string,
    p_request_id: (requestId ?? null) as string,
    p_expected_version: (version ?? null) as number,
    p_title: title,
    p_notes: notes,
    p_needed_by: (neededBy || null) as string,
    p_share_with_showrooms: flag(fd, "shareWithShowrooms"),
    p_items: payload,
  });
  if (error || typeof data !== "string" || !isUuid(data)) return { ok: false, code: mapRequestError(error ?? new Error("invalid save result")) };
  return { ok: true, id: data };
}

const LIFECYCLE = ["publish", "close", "cancel"] as const;
type Lifecycle = (typeof LIFECYCLE)[number];
const isLifecycle = (v: unknown): v is Lifecycle => typeof v === "string" && (LIFECYCLE as readonly string[]).includes(v);

/** Publish / close / cancel - one action, the database picks the rule. Closing or cancelling never creates an order. */
export async function purchaseRequestLifecycleAction(_prev: RequestFormState, fd: FormData): Promise<RequestFormState> {
  const requestId = str(fd, "requestId");
  const version = Number(str(fd, "expectedVersion"));
  const action = str(fd, "action");
  if (!requestId || !isUuid(requestId) || !Number.isInteger(version) || !isLifecycle(action)) return { ok: false, code: "states.genericRetry" };
  const supabase = await getServerSupabase();
  const fn = action === "publish" ? "purchase_request_publish" : action === "close" ? "purchase_request_close" : "purchase_request_cancel";
  const { error } = await supabase.rpc(fn, { p_request_id: requestId, p_expected_version: version });
  if (error) return { ok: false, code: mapRequestError(error) };
  return { ok: true, id: requestId };
}

// ---------------------------------------------------------------------------
// Reference images (draft only, at most 2 per item)
// ---------------------------------------------------------------------------
export type RequestImageTicket = { ok: true; key: string; grant: UploadGrant } | { ok: false; code: string };
export type RequestImageResult = { ok: true } | { ok: false; code: string };
export type RequestImageConfirm = { ok: true; id: string } | { ok: false; code: string };

/**
 * Photo bytes go to private storage through the central media system (R2 once routing is on): the RPC
 * reserves the pending row and key, `authorizeMediaUpload` re-authorizes the caller and issues the grant.
 * A failing storage provider fails this action; it never falls back to another store.
 */
export async function requestRequestImageUploadAction(itemId: string, contentType: string, expectedBytes?: number): Promise<RequestImageTicket> {
  if (!isUuid(itemId) || !isRequestImageContentType(contentType)) return { ok: false, code: E("imageType") };
  if (expectedBytes !== undefined && (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0 || expectedBytes > REQUEST_IMAGE_MAX_BYTES)) {
    return { ok: false, code: E("imageSize") };
  }
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("purchase_request_image_request_upload", { p_item_id: itemId, p_content_type: contentType });
  if (error || !isRequestImageKey(data)) return { ok: false, code: mapRequestError(error ?? new Error("invalid upload ticket")) };
  try { return { ok: true, key: data, grant: await authorizeMediaUpload(supabase, "request", data, expectedBytes) }; }
  catch { return { ok: false, code: "states.genericRetry" }; }
}

/** Confirm only after the trusted, bounded byte verification: SQL refuses pending-to-ready without its receipt. */
export async function confirmRequestImageUploadAction(key: string): Promise<RequestImageConfirm> {
  if (!isRequestImageKey(key)) return { ok: false, code: "states.genericRetry" };
  const supabase = await getServerSupabase();
  try { await verifyPendingMedia(supabase, "request", key); }
  catch { return { ok: false, code: "states.genericRetry" }; }
  const { data, error } = await supabase.rpc("purchase_request_image_confirm_upload", { p_object_key: key });
  if (error || typeof data !== "string" || !isUuid(data)) return { ok: false, code: mapRequestError(error ?? new Error("invalid confirm result")) };
  return { ok: true, id: data };
}

export async function removeRequestImageAction(imageId: string): Promise<RequestImageResult> {
  if (!isUuid(imageId)) return { ok: false, code: "states.genericRetry" };
  const supabase = await getServerSupabase();
  const { data: key, error } = await supabase.rpc("purchase_request_image_remove", { p_image_id: imageId });
  if (error) return { ok: false, code: mapRequestError(error) };
  // The record is already retired (unreadable). A failed byte delete is reported so the user can retry;
  // the cleanup worker also finds it.
  if (isRequestImageKey(key)) {
    try { await removeMedia(supabase, "request", key); }
    catch { return { ok: false, code: "states.genericRetry" }; }
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Responses (Option A: independent, non-binding)
// ---------------------------------------------------------------------------
/**
 * Submit (or revise) the active workspace's response. Quantity, unit and money are re-validated by the
 * database: 0 < offered <= requested, the requested unit, price in EGP with at most two decimals.
 */
export async function saveRequestResponseAction(_prev: RequestFormState, fd: FormData): Promise<RequestFormState> {
  const orgId = str(fd, "orgId");
  const requestId = str(fd, "requestId");
  if (!orgId || !isUuid(orgId) || !requestId || !isUuid(requestId)) return { ok: false, code: "states.genericRetry" };
  const note = str(fd, "note") ?? "";
  const validUntil = str(fd, "validUntil") ?? "";
  const fieldErrors: Record<string, string> = {};
  if (countChars(note) > REQUEST_LIMITS.responseNoteMax) fieldErrors.note = E("noteTooLong");
  if (validUntil && !DATE.test(validUntil)) fieldErrors.validUntil = E("validityPast");

  const rawLines = readJson(fd, "lines");
  const lineErrors: Record<number, string> = {};
  const lines: ReturnType<typeof toResponseLinePayload>[] = [];
  if (rawLines === null || rawLines.length === 0) fieldErrors.lines = E("responseNeedsItem");
  else {
    rawLines.forEach((raw, index) => {
      const parsed = parseResponseLine(raw);
      if (parsed.ok) lines.push(toResponseLinePayload(parsed.value));
      else lineErrors[index] = parsed.error;
    });
    if (Object.keys(lineErrors).length) fieldErrors.lines = E("responseItemInvalid");
  }
  if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors };

  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("purchase_request_response_save", {
    p_org_id: orgId,
    p_request_id: requestId,
    p_note: note,
    p_valid_until: (validUntil || null) as string,
    p_items: lines,
  });
  if (error || typeof data !== "string" || !isUuid(data)) return { ok: false, code: mapRequestError(error ?? new Error("invalid response result")) };
  return { ok: true, id: data };
}

export async function withdrawRequestResponseAction(responseId: string): Promise<RequestFormState> {
  if (!isUuid(responseId)) return { ok: false, code: "states.genericRetry" };
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("purchase_request_response_withdraw", { p_response_id: responseId });
  return error ? { ok: false, code: mapRequestError(error) } : { ok: true, id: responseId };
}

/**
 * Shortlist (or un-shortlist) a response. This is a non-binding mark: it creates no order, allocates
 * nothing and does not close the request - several responses can be shortlisted at once.
 */
export async function shortlistRequestResponseAction(responseId: string, shortlisted: boolean): Promise<RequestFormState> {
  if (!isUuid(responseId) || typeof shortlisted !== "boolean") return { ok: false, code: "states.genericRetry" };
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("purchase_request_response_shortlist", { p_response_id: responseId, p_shortlisted: shortlisted });
  return error ? { ok: false, code: mapRequestError(error) } : { ok: true, id: responseId };
}
