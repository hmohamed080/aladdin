"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";

/**
 * Writers for Network referrals. Thin, shape-only validators over the trusted
 * security-definer RPCs — the persona gate, the idempotent duplicate-abuse
 * guard, the platform-authority check on approval, and the Points award all
 * live in the database. The actor is NEVER a parameter: every RPC derives it
 * from `auth.uid()`.
 */

const uuid = z.string().uuid();

/** Refer an organization already on Aladdin. Resolves to joined immediately. */
export async function createExistingReferral(formData: FormData): Promise<void> {
  const organizationId = uuid.safeParse(formData.get("organizationId"));
  if (!organizationId.success) redirect("/home/network/refer?error=1");

  const noteRaw = formData.get("note");
  const note = typeof noteRaw === "string" && noteRaw.trim() !== "" ? noteRaw.trim().slice(0, 500) : undefined;

  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("network_referral_create_existing", {
    p_organization_id: organizationId.data,
    p_note: note,
  });
  if (error) redirect("/home/network/refer?error=1");

  revalidatePath("/home/network");
  redirect("/home/network?referred=joined");
}

const newShowroomSchema = z.object({
  displayName: z.string().trim().min(2).max(120),
  governorate: z.string().trim().min(1).max(80),
  city: z.string().trim().min(1).max(80),
  phone: z.string().trim().max(32).nullish(),
  note: z.string().trim().max(500).nullish(),
});

/** Refer a showroom not yet on Aladdin. Pure referral data, pending review. */
export async function createNewReferral(formData: FormData): Promise<void> {
  const read = (k: string) => {
    const v = formData.get(k);
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  };
  const parsed = newShowroomSchema.safeParse({
    displayName: read("displayName") ?? "",
    governorate: read("governorate") ?? "",
    city: read("city") ?? "",
    phone: read("phone"),
    note: read("note"),
  });
  if (!parsed.success) redirect("/home/network/refer?error=required");
  const v = parsed.data;

  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("network_referral_create_new", {
    p_display_name: v.displayName,
    p_governorate: v.governorate,
    p_city: v.city,
    p_phone: v.phone ?? undefined,
    p_note: v.note ?? undefined,
  });
  if (error) redirect("/home/network/refer?error=1");

  revalidatePath("/home/network");
  redirect("/home/network?referred=pending");
}

/** Withdraw one's own pending referral. */
export async function cancelNetworkReferral(formData: FormData): Promise<void> {
  const id = uuid.safeParse(formData.get("referralId"));
  if (id.success) {
    const supabase = await getServerSupabase();
    await supabase.rpc("network_referral_cancel", { p_referral_id: id.data });
  }
  revalidatePath("/home/network");
  redirect("/home/network");
}
