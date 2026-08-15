"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { mapCommerceError } from "@/server/actions/error-mapping";

/**
 * Server Actions for the organization's product shortlist.
 *
 * Both forward the CALLER's JWT to a security-definer RPC that re-derives the
 * actor from auth.uid() and enforces organization membership. Nothing is decided
 * here: passing an organization the caller does not belong to fails in the
 * database, not in TypeScript.
 */
export type SaveState = { ok: boolean; code?: string };

export async function toggleSavedProductAction(
  _prev: SaveState,
  fd: FormData,
): Promise<SaveState> {
  const orgId = fd.get("orgId");
  const productId = fd.get("productId");
  const saved = fd.get("saved") === "1";
  if (typeof orgId !== "string" || typeof productId !== "string") {
    return { ok: false, code: "states.genericRetry" };
  }

  const supabase = await getServerSupabase();
  const { error } = saved
    ? await supabase.rpc("unsave_product", {
        p_organization_id: orgId,
        p_product_id: productId,
      })
    : await supabase.rpc("save_product", {
        p_organization_id: orgId,
        p_product_id: productId,
      });

  if (error) return { ok: false, code: mapCommerceError(error) };

  // Both surfaces that show save state must reflect the change immediately.
  revalidatePath("/b2b/saved");
  revalidatePath("/b2b/catalog");
  revalidatePath(`/b2b/catalog/${productId}`);
  return { ok: true };
}
