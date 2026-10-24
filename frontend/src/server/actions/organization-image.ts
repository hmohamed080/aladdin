"use server";

import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { ORGANIZATION_IMAGE_MAX_BYTES } from "@/lib/storage/organization-image-assets";
import { authorizeMediaUpload, verifyPendingMedia, removeMedia } from "@/server/storage/media";
import type { UploadGrant } from "@/lib/storage/provider-types";

/**
 * The Showroom's BUSINESS profile image (never the owner's personal avatar). Each step is one RPC that decides
 * authorization itself (org.manage on that organization, re-checked live); this file only translates the call
 * into a result the client component can render, as `profile-identity.ts` does for the personal avatar.
 */
export type OrganizationImageTicket = { ok: true; key: string; grant: UploadGrant } | { ok: false; code: string };
export type OrganizationImageResult = { ok: true } | { ok: false; code: string };

const SETTINGS_PATHS = ["/showroom/settings", "/b2b/settings"] as const;
const refresh = () => SETTINGS_PATHS.forEach((path) => revalidatePath(path));

/** Step 1 - the pending metadata row and the server-generated key the browser must upload to. */
export async function requestOrganizationImageUploadAction(orgId: string, contentType: string, expectedBytes?: number): Promise<OrganizationImageTicket> {
  if (expectedBytes !== undefined && (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0 || expectedBytes > ORGANIZATION_IMAGE_MAX_BYTES)) {
    return { ok: false, code: "showroomSettings.image.errorSize" };
  }
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("organization_image_request_upload", { p_org_id: orgId, p_content_type: contentType });
  if (error || !data) return { ok: false, code: "showroomSettings.image.errorUpload" };
  try { return { ok: true, key: data, grant: await authorizeMediaUpload(supabase, "organization", data, expectedBytes) }; }
  catch { return { ok: false, code: "showroomSettings.image.errorUpload" }; }
}

/** Verify bytes, make the image current, then clean the retired key after current caller authorization. */
export async function confirmOrganizationImageUploadAction(objectKey: string): Promise<OrganizationImageResult> {
  const supabase = await getServerSupabase();
  try { await verifyPendingMedia(supabase, "organization", objectKey); }
  catch { return { ok: false, code: "showroomSettings.image.errorUpload" }; }
  const { data: previousKey, error } = await supabase.rpc("organization_image_confirm_upload", { p_object_key: objectKey });
  if (error) return { ok: false, code: "showroomSettings.image.errorUpload" };
  refresh();
  try { if (previousKey) await removeMedia(supabase, "organization", previousKey); }
  catch { return { ok: false, code: "showroomSettings.image.errorUpload" }; }
  return { ok: true };
}

export async function removeOrganizationImageAction(orgId: string): Promise<OrganizationImageResult> {
  const supabase = await getServerSupabase();
  const { data: previousKey, error } = await supabase.rpc("organization_image_remove", { p_org_id: orgId });
  if (error) return { ok: false, code: "showroomSettings.image.errorRemove" };
  refresh();
  try { if (previousKey) await removeMedia(supabase, "organization", previousKey); }
  catch { return { ok: false, code: "showroomSettings.image.errorRemove" }; }
  return { ok: true };
}
