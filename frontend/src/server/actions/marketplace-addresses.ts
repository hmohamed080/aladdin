"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ISSUE_FIELD, addressDraftSchema, type SavedAddress } from "@/features/marketplace-addresses/address-model";
import { getServerSupabase } from "@/lib/supabase/server";

/**
 * Buyer address writes (Marketplace PR 10). Every write is one RPC bound to the signed-in user in the database
 * (`marketplace_buyer_address_*`); this file validates the input, translates the answer into a message key and never echoes or logs an
 * address or a phone number. The recipient mobile is stored as given; whether it is VERIFIED is decided by the database from the
 * phone verification authority's proof, never by anything sent from here.
 */

export type AddressActionResult<T = undefined> = ({ ok: true } & (T extends undefined ? object : { value: T })) | { ok: false; code: string; field?: string };

const ERROR_PREFIX = "buyerAddresses.error.";

function codeFor(error: { code?: string } | null): string {
  switch (error?.code) {
    case "42501": return `${ERROR_PREFIX}auth`;
    case "54000": return `${ERROR_PREFIX}limit`;
    case "22023": return `${ERROR_PREFIX}invalid`;
    default: return `${ERROR_PREFIX}failed`;
  }
}

const claimSchema = z.object({ countryIso2: z.string().regex(/^[A-Z]{2}$/), national: z.string().trim().min(3).max(32), e164: z.string().regex(/^\+[1-9]\d{1,14}$/) });

/**
 * Saves (creates or updates) one address. `claimAccountPhone` is only honoured while the account has NO phone yet: it stores the
 * recipient number as the account's own phone through the one existing write path (`profile_set_phone`), after which the existing
 * verification authority can prove it. It never replaces a phone the account already has.
 */
export async function saveBuyerAddressAction(
  draft: unknown,
  claimAccountPhone?: unknown,
): Promise<AddressActionResult<SavedAddress>> {
  const parsed = addressDraftSchema.safeParse(draft);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, code: `${ERROR_PREFIX}invalid`, field: ISSUE_FIELD[issue?.message ?? ""] ?? "characters" };
  }
  const supabase = await getServerSupabase();

  if (claimAccountPhone) {
    const claim = claimSchema.safeParse(claimAccountPhone);
    if (!claim.success || claim.data.e164 !== parsed.data.recipient_phone_e164) return { ok: false, code: `${ERROR_PREFIX}invalid`, field: "phone" };
    const status = await supabase.rpc("marketplace_buyer_phone_status");
    const current = (status.data as { phone_e164?: string | null } | null)?.phone_e164 ?? null;
    if (status.error) return { ok: false, code: codeFor(status.error) };
    if (current === null) {
      const set = await supabase.rpc("profile_set_phone", { p_country_iso2: claim.data.countryIso2, p_national: claim.data.national, p_e164: claim.data.e164 });
      if (set.error) {
        // 23505 is the RPC's own generic "phone number is unavailable": it never says another account holds the number.
        return { ok: false, code: set.error.code === "23505" ? `${ERROR_PREFIX}phoneUnavailable` : `${ERROR_PREFIX}failed`, field: "phone" };
      }
    }
  }

  const { data, error } = await supabase.rpc("marketplace_buyer_address_save", { p_address: parsed.data });
  if (error || !data) return { ok: false, code: codeFor(error) };
  revalidatePath("/settings/addresses");
  return { ok: true, value: data as unknown as SavedAddress };
}

export async function deleteBuyerAddressAction(id: string): Promise<AddressActionResult> {
  if (!z.string().uuid().safeParse(id).success) return { ok: false, code: `${ERROR_PREFIX}invalid` };
  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("marketplace_buyer_address_delete", { p_id: id });
  if (error) return { ok: false, code: codeFor(error) };
  revalidatePath("/settings/addresses");
  return { ok: true };
}

export async function setDefaultBuyerAddressAction(id: string): Promise<AddressActionResult> {
  if (!z.string().uuid().safeParse(id).success) return { ok: false, code: `${ERROR_PREFIX}invalid` };
  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("marketplace_buyer_address_set_default", { p_id: id });
  if (error || data !== true) return { ok: false, code: codeFor(error) };
  revalidatePath("/settings/addresses");
  return { ok: true };
}
