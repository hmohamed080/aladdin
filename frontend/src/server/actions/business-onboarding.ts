"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getServerSupabase } from "@/lib/supabase/server";
import { BUSINESS_ORG_TYPES } from "@/lib/onboarding/account-types";
import type { Database } from "@/types/database.types";

/**
 * Business / organization onboarding writers (Sprint 8). Thin, shape-only
 * validators over the trusted security-definer RPCs — all authorization (verified
 * caller, business-track gate), the required-field check on submit, and the
 * transactional org + owner-membership + primary-branch creation live in the
 * database (`business_save` / `business_submit` → app.organization_create_owned).
 * `save` persists the accumulated draft and returns a result so the client can
 * advance; `submit` creates the organization and redirects into the workspace.
 * State lives in the DB (hydrated on load) — there is no client store.
 */
export type BusinessActionState = { ok: boolean; code?: string };

const OK: BusinessActionState = { ok: true };
type AccountType = Database["public"]["Enums"]["account_type"];

const businessSchema = z.object({
  legalName: z.string().trim().max(120).nullish(),
  displayName: z.string().trim().max(120).nullish(),
  orgType: z.enum(BUSINESS_ORG_TYPES).nullish(),
  description: z.string().trim().max(1000).nullish(),
  governorate: z.string().trim().max(80).nullish(),
  city: z.string().trim().max(80).nullish(),
  primaryBranchName: z.string().trim().max(120).nullish(),
  ownerConfirmed: z.boolean().optional(),
});
export type BusinessInput = z.input<typeof businessSchema>;

/** Persist the (accumulated) business draft. No org is created; no redirect. */
export async function saveBusiness(input: BusinessInput): Promise<BusinessActionState> {
  const parsed = businessSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "onboarding.error.saveFailed" };
  const v = parsed.data;

  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("business_save", {
    p_legal_name: v.legalName ?? undefined,
    p_display_name: v.displayName ?? undefined,
    p_org_type: (v.orgType as AccountType) ?? undefined,
    p_description: v.description ?? undefined,
    p_governorate: v.governorate ?? undefined,
    p_city: v.city ?? undefined,
    p_primary_branch_name: v.primaryBranchName ?? undefined,
    p_owner_confirmed: v.ownerConfirmed ?? false,
  });
  if (error) return { ok: false, code: "onboarding.error.saveFailed" };
  return OK;
}

/**
 * Persist the final draft, then create the organization. The RPC validates the
 * required fields, creates the org (pending_verification), the owner's active
 * membership, the owner capabilities, and the primary branch, then hands the owner
 * to the B2B workspace (their now-active membership resolves to active_personal).
 * On a required-field failure the caller is bounced back to complete the wizard.
 */
export async function submitBusiness(input: BusinessInput): Promise<BusinessActionState> {
  const saved = await saveBusiness(input);
  if (!saved.ok) return saved;

  const supabase = await getServerSupabase();
  const { error } = await supabase.rpc("business_submit");
  if (error) {
    // A required-field violation means the wizard is not actually complete.
    redirect("/onboarding/business");
  }
  redirect("/b2b");
}
