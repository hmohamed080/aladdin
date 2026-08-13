"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { BUSINESS_ORG_TYPES } from "@/lib/onboarding/account-types";
import { ORG_COOKIE, BRANCH_COOKIE } from "@/lib/workspace/model";
import type { Database } from "@/types/database.types";

/**
 * Business creation writers. Thin, shape-only validators over the trusted
 * security-definer RPCs — the verified-caller gate, the required-field check, the
 * transactional organization + owner-membership + primary-branch creation, and the
 * idempotency guarantee all live in the database (`business_draft_save` /
 * `business_draft_submit` → app.organization_create_owned).
 *
 * The DRAFT ID is the thread that makes this safe. It is the resume handle and the
 * idempotency key: submitting the same draft twice returns the same organization,
 * while a new draft is a new business. The client therefore always round-trips the
 * id it was given rather than relying on the business name, which is neither
 * unique nor stable.
 *
 * The same writers serve both entry points — registration and "add a business"
 * from an existing account — because there is one persistence model behind both.
 */
export type BusinessActionState = { ok: boolean; code?: string; draftId?: string };

type AccountType = Database["public"]["Enums"]["account_type"];
const ONE_YEAR = 60 * 60 * 24 * 365;

const businessSchema = z.object({
  draftId: z.string().uuid().nullish(),
  legalName: z.string().trim().max(120).nullish(),
  displayName: z.string().trim().max(120).nullish(),
  orgType: z.enum(BUSINESS_ORG_TYPES).nullish(),
  description: z.string().trim().max(1000).nullish(),
  governorate: z.string().trim().max(80).nullish(),
  city: z.string().trim().max(80).nullish(),
  primaryBranchName: z.string().trim().max(120).nullish(),
});
export type BusinessInput = z.input<typeof businessSchema>;

/**
 * Persist the (accumulated) business draft. No organization is created and no
 * redirect happens. Returns the draft id so a client that started without one can
 * keep working against a stable key for the rest of the wizard.
 */
export async function saveBusiness(input: BusinessInput): Promise<BusinessActionState> {
  const parsed = businessSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "onboarding.error.saveFailed" };
  const v = parsed.data;

  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("business_draft_save", {
    p_draft_id: v.draftId ?? undefined,
    p_legal_name: v.legalName ?? undefined,
    p_display_name: v.displayName ?? undefined,
    p_org_type: (v.orgType as AccountType) ?? undefined,
    p_description: v.description ?? undefined,
    p_governorate: v.governorate ?? undefined,
    p_city: v.city ?? undefined,
    p_primary_branch_name: v.primaryBranchName ?? undefined,
  });
  if (error) return { ok: false, code: "onboarding.error.saveFailed" };
  return { ok: true, draftId: data ?? undefined };
}

/**
 * Persist the final draft, then create the business. The creator becomes Owner
 * automatically — no "are you the owner or the manager?" question, because owning
 * is what creating produces.
 *
 * Retry safety is the point: the RPC short-circuits on the draft's recorded
 * organization, so a network retry or a double-clicked button returns the FIRST
 * organization instead of making a second one. On success the new business is made
 * the active work context and the owner lands in it.
 */
export async function submitBusiness(input: BusinessInput): Promise<BusinessActionState> {
  const saved = await saveBusiness(input);
  if (!saved.ok) return saved;

  const supabase = await getServerSupabase();
  const { data: orgId, error } = await supabase.rpc("business_draft_submit", {
    p_draft_id: input.draftId ?? saved.draftId ?? undefined,
  });
  if (error) {
    // A required-field violation means the wizard is not actually complete.
    return { ok: false, code: "onboarding.error.saveFailed", draftId: saved.draftId };
  }

  // Land the owner IN the business they just created, not in whatever context they
  // happened to have selected before.
  if (orgId) {
    const store = await cookies();
    store.set(ORG_COOKIE, orgId, { path: "/", maxAge: ONE_YEAR, sameSite: "lax" });
    store.delete(BRANCH_COOKIE);
  }
  revalidatePath("/", "layout");
  redirect("/b2b");
}
