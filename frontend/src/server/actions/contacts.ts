"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { mapCommerceError } from "@/server/actions/error-mapping";
import { toE164 } from "@/lib/contact/phone";
import { SHOWROOM_ROOT } from "@/features/showroom-shell/navigation";

/**
 * Owner-controlled contact visibility. Thin validators over the trusted RPCs: who may write
 * (org.manage / the profile owner), that a field can only be exposed while it has a value, and
 * who may read an exposed field are all decided in the database. Every flag defaults to hidden.
 */
export type ContactState = { ok: boolean; code?: string };

const uuid = z.string().uuid();
const flag = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "1";
const text = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
};
const email = z.string().max(254).email();

export async function saveOrganizationContactAction(_prev: ContactState, fd: FormData): Promise<ContactState> {
  const orgId = uuid.safeParse(fd.get("orgId"));
  if (!orgId.success) return { ok: false, code: "states.genericRetry" };

  const phoneRaw = text(fd, "phone");
  const waRaw = text(fd, "whatsapp");
  const mailRaw = text(fd, "email");
  const phone = phoneRaw ? toE164(phoneRaw) : null;
  const whatsapp = waRaw ? toE164(waRaw) : null;
  if ((phoneRaw && !phone) || (waRaw && !whatsapp)) return { ok: false, code: "onboarding.error.showroomPhoneRequired" };
  if (mailRaw && !email.safeParse(mailRaw).success) return { ok: false, code: "onboarding.error.contactInvalid" };

  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("organization_contact_set", {
    p_org_id: orgId.data,
    p_phone_e164: phone ?? "",
    p_whatsapp_e164: whatsapp ?? "",
    p_contact_email: mailRaw ?? "",
    p_show_phone: flag(fd, "showPhone"),
    p_show_whatsapp: flag(fd, "showWhatsapp"),
    p_show_email: flag(fd, "showEmail"),
  });
  if (error) {
    // 22023 here is the database refusing the number itself (a showroom must keep a valid business phone), or the e-mail shape.
    if (error.code === "22023") return { ok: false, code: /e-?mail/i.test(error.message ?? "") ? "onboarding.error.contactInvalid" : "onboarding.error.showroomPhoneRequired" };
    return { ok: false, code: mapCommerceError(error) };
  }
  // The business phone and e-mail are the same values the Admin Dashboard and the business profile read.
  for (const path of [`${SHOWROOM_ROOT}/settings`, "/b2b/settings"]) revalidatePath(path);
  return { ok: true };
}

export async function saveProfileContactVisibilityAction(_prev: ContactState, fd: FormData): Promise<ContactState> {
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("profile_contact_visibility_set", {
    p_show_phone: flag(fd, "showPhone"),
    p_show_whatsapp: flag(fd, "showWhatsapp"),
    p_show_email: flag(fd, "showEmail"),
  });
  if (error) return { ok: false, code: mapCommerceError(error) };
  return { ok: true };
}
