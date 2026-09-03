"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { mapPortfolioError } from "@/server/actions/error-mapping";
import {
  createAssetReadUrl,
  createAssetUploadTicket,
  deleteProfessionalAsset,
} from "@/server/actions/professional-assets";
import {
  ASSET_POLICY,
  validateAssetFile,
  type AssetErrorCode,
} from "@/lib/storage/professional-assets";

/**
 * Portfolio and Certificates, written the only way two systems that share no
 * transaction can be written safely.
 *
 * THE TWO SEQUENCES, and why they are ordered the way they are:
 *
 *   ADD     row(pending) -> upload bytes -> row(ready)
 *           The row is created FIRST because it is the product authority (S3):
 *           the object identity is decided and recorded before any bytes exist,
 *           so a lost response is recoverable rather than ambiguous. A pending
 *           row is invisible to the public, cannot be published (the table
 *           refuses it), and shows the owner an "unfinished" card they can
 *           discard. Bytes with no row are unreachable by every policy.
 *
 *   REMOVE  row(deleted) -> remove object -> purge row
 *           Visibility stops FIRST, atomically, in Postgres — the owner's own RLS
 *           policy excludes `deleted`, so the item leaves their list and the
 *           public projection in the same instant, before Storage has been asked
 *           anything. If either later step fails, the row sits invisible and the
 *           SAME sequence run again completes it.
 *
 * Neither pretends the two systems commit together, and neither needs a
 * scheduler: every partial state is safe, invisible and convergent on retry.
 */

export type UploadTicket =
  | {
      readonly ok: true;
      readonly itemId: string;
      readonly bucket: string;
      /** Opaque for portfolio; the owner's own path for a certificate. */
      readonly objectPath: string;
      readonly token: string;
    }
  | { readonly ok: false; readonly code: AssetErrorCode | string };

export type ActionState = { ok: boolean; code?: string };

async function rpc(fn: string, args: Record<string, unknown>) {
  const supabase = await getServerSupabase();
  return supabase.rpc(fn as never, args as never);
}

function refreshOwnerSurfaces(area: "portfolio" | "certificates") {
  revalidatePath(`/home/profile/${area}`);
  revalidatePath("/home/profile");
}

// ---------------------------------------------------------------------------
// Portfolio — adding
// ---------------------------------------------------------------------------

/**
 * Step one of two. Creates the private, pending row and returns the single-use
 * authorization to upload its bytes.
 *
 * The type/size check here is a fast, specific refusal, not the boundary: the
 * bucket enforces both again from its own row, before Postgres is consulted, and
 * `portfolio_item_create` refuses an unsupported type outright. A caller that
 * skipped this would simply get a less specific error later.
 */
export async function startPortfolioUpload(input: {
  title: string;
  description: string | null;
  contentType: string;
  size: number;
}): Promise<UploadTicket> {
  const valid = validateAssetFile("portfolio", { type: input.contentType, size: input.size });
  if (!valid.ok) return { ok: false, code: valid.code };
  if (!input.title.trim()) return { ok: false, code: "portfolio.errors.titleRequired" };

  const { data, error } = await rpc("portfolio_item_create", {
    p_title: input.title,
    p_description: input.description,
    p_content_type: input.contentType,
  });
  if (error) return { ok: false, code: mapPortfolioError(error) };

  const row = (data as Array<{ item_id: string; object_key: string }> | null)?.[0];
  if (!row) return { ok: false, code: "states.genericRetry" };

  const ticket = await createAssetUploadTicket("portfolio", row.object_key);
  if (!ticket.ok) {
    // The row exists but nothing can be uploaded to it. Leaving it would show the
    // owner an unfinished card for an upload that never began, so it is removed
    // here — there are no bytes yet, which makes this the one safe early exit.
    await rpc("portfolio_item_delete", { p_item_id: row.item_id });
    await rpc("portfolio_item_purge", { p_item_id: row.item_id });
    return { ok: false, code: ticket.code };
  }

  return {
    ok: true,
    itemId: row.item_id,
    bucket: ASSET_POLICY.portfolio.bucket,
    objectPath: row.object_key,
    token: ticket.token,
  };
}

/**
 * Step two. Idempotent in the database, so a client that lost the response simply
 * calls again — which is also the recovery path for "upload succeeded but
 * finalization failed".
 */
export async function finishPortfolioUpload(itemId: string): Promise<ActionState> {
  const { error } = await rpc("portfolio_item_finalize", { p_item_id: itemId });
  if (error) return { ok: false, code: mapPortfolioError(error) };
  refreshOwnerSurfaces("portfolio");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Portfolio — managing
// ---------------------------------------------------------------------------
export async function updatePortfolioItemAction(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const title = String(fd.get("title") ?? "").trim();
  if (!title) return { ok: false, code: "portfolio.errors.titleRequired" };

  const { error } = await rpc("portfolio_item_update", {
    p_item_id: String(fd.get("itemId") ?? ""),
    p_title: title,
    p_description: String(fd.get("description") ?? ""),
  });
  if (error) return { ok: false, code: mapPortfolioError(error) };
  refreshOwnerSurfaces("portfolio");
  return { ok: true };
}

/**
 * Publish and unpublish, both through one action, because they are one decision
 * with two values. The form posts the value it wants rather than a toggle
 * instruction, so two clicks that race converge on a state instead of swapping it
 * twice — the same reasoning as the availability control.
 */
export async function setPortfolioVisibilityAction(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const { error } = await rpc("portfolio_item_set_visibility", {
    p_item_id: String(fd.get("itemId") ?? ""),
    p_public: fd.get("public") === "1",
  });
  if (error) return { ok: false, code: mapPortfolioError(error) };
  refreshOwnerSurfaces("portfolio");
  return { ok: true };
}

export async function movePortfolioItemAction(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const { error } = await rpc("portfolio_item_move", {
    p_item_id: String(fd.get("itemId") ?? ""),
    p_direction: String(fd.get("direction") ?? ""),
  });
  if (error) return { ok: false, code: mapPortfolioError(error) };
  refreshOwnerSurfaces("portfolio");
  return { ok: true };
}

/**
 * The convergent removal (S3, §8), and the ONLY place the three steps appear.
 *
 * Step 1 is the one that has to succeed, and it is the one that stops visibility.
 * If Storage is unreachable the row stays `deleted` — invisible to the owner and
 * to the public — and running this again finishes the job. The object delete is
 * idempotent and the purge is silent, so a retry can never make things worse.
 */
export async function deletePortfolioItemAction(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const itemId = String(fd.get("itemId") ?? "");
  const objectKey = String(fd.get("objectKey") ?? "");

  const { error } = await rpc("portfolio_item_delete", { p_item_id: itemId });
  if (error) return { ok: false, code: mapPortfolioError(error) };

  // From here the item is already gone as far as every reader is concerned. What
  // follows is cleanup, and its failure must not be reported as a failed delete:
  // saying "could not delete" about an item the person can no longer see would be
  // the one genuinely confusing outcome.
  const removed = await deleteProfessionalAsset("portfolio", objectKey);
  if (removed.ok) await rpc("portfolio_item_purge", { p_item_id: itemId });

  refreshOwnerSurfaces("portfolio");
  return { ok: true };
}

/** Discarding an upload that never finished. Same sequence, same guarantees. */
export async function discardPortfolioItemAction(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  return deletePortfolioItemAction(_prev, fd);
}

// ---------------------------------------------------------------------------
// Certificates
// ---------------------------------------------------------------------------
export async function startCertificateUpload(input: {
  title: string;
  issuer: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
  contentType: string;
  size: number;
  originalFilename: string | null;
}): Promise<UploadTicket> {
  const valid = validateAssetFile("certificate", { type: input.contentType, size: input.size });
  if (!valid.ok) return { ok: false, code: valid.code };
  if (!input.title.trim()) return { ok: false, code: "certificates.errors.titleRequired" };

  const { data, error } = await rpc("certificate_create", {
    p_title: input.title,
    p_issuer: input.issuer,
    p_issued_on: input.issuedOn,
    p_expires_on: input.expiresOn,
    p_content_type: input.contentType,
    p_original_filename: input.originalFilename,
  });
  if (error) return { ok: false, code: mapPortfolioError(error) };

  const row = (data as Array<{ item_id: string; object_path: string }> | null)?.[0];
  if (!row) return { ok: false, code: "states.genericRetry" };

  const ticket = await createAssetUploadTicket("certificate", row.object_path);
  if (!ticket.ok) {
    await rpc("certificate_delete", { p_item_id: row.item_id });
    await rpc("certificate_purge", { p_item_id: row.item_id });
    return { ok: false, code: ticket.code };
  }

  return {
    ok: true,
    itemId: row.item_id,
    bucket: ASSET_POLICY.certificate.bucket,
    objectPath: row.object_path,
    token: ticket.token,
  };
}

export async function finishCertificateUpload(itemId: string): Promise<ActionState> {
  const { error } = await rpc("certificate_finalize", { p_item_id: itemId });
  if (error) return { ok: false, code: mapPortfolioError(error) };
  refreshOwnerSurfaces("certificates");
  return { ok: true };
}

export async function updateCertificateAction(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const title = String(fd.get("title") ?? "").trim();
  if (!title) return { ok: false, code: "certificates.errors.titleRequired" };

  const read = (name: string) => {
    const v = String(fd.get(name) ?? "").trim();
    return v === "" ? null : v;
  };

  const { error } = await rpc("certificate_update", {
    p_item_id: String(fd.get("itemId") ?? ""),
    p_title: title,
    p_issuer: read("issuer"),
    p_issued_on: read("issuedOn"),
    p_expires_on: read("expiresOn"),
  });
  if (error) return { ok: false, code: mapPortfolioError(error) };
  refreshOwnerSurfaces("certificates");
  return { ok: true };
}

export async function deleteCertificateAction(
  _prev: ActionState,
  fd: FormData,
): Promise<ActionState> {
  const itemId = String(fd.get("itemId") ?? "");
  const objectPath = String(fd.get("objectPath") ?? "");

  const { error } = await rpc("certificate_delete", { p_item_id: itemId });
  if (error) return { ok: false, code: mapPortfolioError(error) };

  const removed = await deleteProfessionalAsset("certificate", objectPath);
  if (removed.ok) await rpc("certificate_purge", { p_item_id: itemId });

  refreshOwnerSurfaces("certificates");
  return { ok: true };
}

/**
 * The owner's short-lived look at their own certificate (§10).
 *
 * Minted on demand rather than embedded in the page, because a certificate URL in
 * server-rendered HTML would sit in the document, in the browser cache and in any
 * copy of the page for as long as it lives — for a document nobody but its owner
 * should ever see. A portfolio preview is different and IS rendered inline: the
 * owner chose those images to be looked at.
 */
export async function certificateViewUrlAction(
  objectPath: string,
): Promise<{ ok: true; url: string } | { ok: false; code: string }> {
  const result = await createAssetReadUrl("certificate", objectPath);
  return result.ok ? { ok: true, url: result.url } : { ok: false, code: result.code };
}
