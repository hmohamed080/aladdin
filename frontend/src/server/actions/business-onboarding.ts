"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { businessActivityError, businessDetailsSchema, showroomIdentityError, validBusinessPhone } from "@/lib/onboarding/business-details";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadBusinessCreationAccess } from "@/server/queries/business-creation-access";
import { loadMandatoryBusinessSetup } from "@/server/queries/business-setup";
import { APPLICATION_ORG_TYPES } from "@/lib/onboarding/account-types";
import { validateBusinessLocation } from "@/lib/location/business-location";
import { slotErrorCode } from "@/lib/workspace/applications";
import { isWithinDescriptionLimit } from "@/lib/text/description-limit";
import type { Database } from "@/types/database.types";

/**
 * Business creation writers. Thin, shape-only validators over the trusted
 * security-definer RPCs — the verified-caller gate, the required-field check, the
 * transactional organization + owner-membership + primary-branch creation, and the
 * idempotency guarantee all live in the database (`business_draft_save_v2` /
 * `business_draft_submit_v2` → app.organization_create_owned).
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

type OrgType = Database["public"]["Enums"]["organization_type"];

const businessSchema = businessDetailsSchema.extend({
  step: z.enum(["identity", "location"]).optional(),
  draftId: z.string().uuid().nullish(),
  legalName: z.string().trim().max(120).nullish(),
  displayName: z.string().trim().max(120).nullish(),
  orgType: z.enum(APPLICATION_ORG_TYPES).nullish(),
  description: z.string().trim().max(250).nullish(),
  governorate: z.string().trim().max(80).nullish(),
  city: z.string().trim().max(80).nullish(),
  /** The city typed through "Other"; mutually exclusive with `city`. */
  cityCustomName: z.string().trim().max(120).nullish(),
  primaryBranchName: z.string().trim().max(120).nullish(),
});
export type BusinessInput = z.input<typeof businessSchema>;

function validationError(error: z.ZodError): string {
 const field = error.issues[0]?.path[0];
 return field === "description" ? "onboarding.error.descriptionTooLong" : field === "detailedAddress" ? "onboarding.error.addressTooLong" : field === "contactEmail" ? "onboarding.error.contactInvalid" : "onboarding.error.saveFailed";
}

function notEntitled(error: { code?: string }): boolean {
  return error.code === "42501";
}

const LEGAL_NAME_MIN = 2;
const LEGAL_NAME_MAX = 120;

/** The legal / registered name is required to COMPLETE a business (a draft may still be incomplete). */
function legalNameMissing(legalName: string | null | undefined): boolean {
  const n = (legalName ?? "").trim();
  return n.length < LEGAL_NAME_MIN || n.length > LEGAL_NAME_MAX;
}

/**
 * 42501 is either "not entitled to add a business" or the one-open-application rule; the
 * database says which through the error hint (`first_pending`, `first_rejected`,
 * `additional_pending`), so the person sees the real reason rather than a generic refusal.
 */
function failureCode(error: { code?: string; hint?: string | null; message?: string }): string {
  if (error.code === "22023" && /description/i.test(error.message ?? "")) return "onboarding.error.descriptionTooLong";
  if (!notEntitled(error)) return "onboarding.error.saveFailed";
  return error.hint ? slotErrorCode(error.hint) : "onboarding.error.businessNotAllowed";
}

/**
 * Persist the (accumulated) business draft. No organization is created and no
 * redirect happens. Returns the draft id so a client that started without one can
 * keep working against a stable key for the rest of the wizard.
 */
export async function saveBusiness(input: BusinessInput): Promise<BusinessActionState> {
  const parsed = businessSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: validationError(parsed.error) };
  const v = parsed.data;
  if (v.contactPhone && !validBusinessPhone(v.contactPhone)) return { ok: false, code: "onboarding.error.showroomPhoneRequired" };

  // The same entitlement the page applies — a direct post to this action must not
  // be a way around it. (No RLS change: the database rules are untouched.)
  if (!(await loadBusinessCreationAccess()).allowed) return { ok: false, code: "onboarding.error.businessNotAllowed" };

  // While the caller's FIRST business is outstanding (a business registration), the type they registered with is the type
  // the business is created as. The wizard never offers a picker in that case; this makes a direct post unable to change it
  // either. Everyone else (an owner adding another business) chooses freely, as before.
  const mandatory = await loadMandatoryBusinessSetup();
  const orgType = mandatory.required ? mandatory.orgType : v.orgType;
  if (v.step === "identity" && (v.displayName?.trim().length ?? 0) < 2) return { ok: false, code: "onboarding.error.businessNameRequired" };
  if (v.step === "identity" && legalNameMissing(v.legalName)) return { ok: false, code: "onboarding.error.legalNameRequired" };
  if (orgType === "showroom_dealer" && v.step === "identity") { const error = showroomIdentityError(v); if (error) return { ok: false, code: error }; }
  // Another business type's activity is never stored for this one.
  if (v.activityType && businessActivityError(orgType, v.activityType)) return { ok: false, code: "onboarding.error.activityRequired" };
  if (v.step === "location" && (!v.governorate || !(v.city || v.cityCustomName))) return { ok: false, code: "onboarding.error.locationRequired" };

  // Governorate / city / custom city must be canonical (catalogue governorate, a city of THAT governorate, or a custom city).
  // A draft may leave the location unset or stop at a governorate; submit requires the city (see `submitBusiness`).
  const location = validateBusinessLocation(v, { complete: false });
  if (!location.ok) return { ok: false, code: "onboarding.error.locationInvalid" };

  const supabase = await getServerSupabase();
  const { data, error } = await supabase.rpc("business_draft_save_v2", {
    p_contact_phone: v.contactPhone ?? undefined,
    p_contact_email: input.contactEmail == null ? undefined : v.contactEmail ?? "",
    p_activity_type: v.activityType ?? undefined,
    p_detailed_address: v.detailedAddress ?? undefined,
    p_draft_id: v.draftId ?? undefined,
    p_legal_name: v.legalName ?? undefined,
    p_display_name: v.displayName ?? undefined,
    p_org_type: (orgType as OrgType) ?? undefined,
    p_description: v.description ?? undefined,
    p_governorate: location.value.governorate ?? undefined,
    p_city: location.value.city ?? undefined,
    p_city_custom_name: location.value.cityCustomName ?? undefined,
    p_primary_branch_name: v.primaryBranchName ?? undefined,
  });
  // The database is the final authority on who may open a business (42501 = not
  // entitled, `20260928090001_business_creation_entitlement.sql`); say so plainly.
  if (error) return { ok: false, code: failureCode(error) };
  return { ok: true, draftId: data ?? undefined };
}

/**
 * Persist the final draft, create the PROVISIONAL organization and submit it for Admin review.
 *
 * The creator becomes Owner automatically, but the organization is an APPLICATION until an Admin
 * approves it: it has no audience and no commercial authority, so it is NOT made the active
 * workspace and the owner is sent to the application status page instead of the B2B cockpit.
 *
 * Retry safety: the RPCs short-circuit on the draft's recorded organization and on an
 * already-open application, so a network retry or a double click yields ONE organization and ONE
 * application.
 */
export async function submitBusiness(input: BusinessInput): Promise<BusinessActionState> {
  // Both names are required to COMPLETE a business (the database enforces the same; this is the early, specific message).
  const parsed = businessSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: validationError(parsed.error) };
  // Not entitled: say so before talking about missing fields.
  if (!(await loadBusinessCreationAccess()).allowed) return { ok: false, code: "onboarding.error.businessNotAllowed" };
  if (!(parsed.data.displayName ?? "").trim()) return { ok: false, code: "onboarding.error.businessNameRequired" };
  if (legalNameMissing(parsed.data.legalName)) return { ok: false, code: "onboarding.error.legalNameRequired" };
  const mandatory = await loadMandatoryBusinessSetup();
  const orgType = mandatory.required ? mandatory.orgType : parsed.data.orgType;
  if (orgType === "showroom_dealer") { const error = showroomIdentityError(parsed.data); if (error) return { ok: false, code: error }; }
  if (!parsed.data.governorate || !(parsed.data.city || parsed.data.cityCustomName)) return { ok: false, code: "onboarding.error.locationRequired" };
  const complete = validateBusinessLocation(parsed.data, { complete: true });
  if (!complete.ok) {
    return { ok: false, code: complete.code === "cityRequired" ? "onboarding.error.cityRequired" : "onboarding.error.locationInvalid" };
  }

  const saved = await saveBusiness(input);
  if (!saved.ok) return saved;

  const supabase = await getServerSupabase();
  // The FIRST application of a person has no approved workspace to stay in, so they land in the limited (pending) workspace of the
  // business they just created. A later, additional application leaves them in their approved workspace and shows its status.
  const slot = await supabase.rpc("my_organization_application_slot");
  const landing = slot.data === "first_available" ? "/b2b" : "/business/applications";
  const { data: orgId, error } = await supabase.rpc("business_draft_submit_v2", {
    p_draft_id: input.draftId ?? saved.draftId ?? undefined,
  });
  if (error) {
    // A required-field violation means the wizard is not actually complete; 42501 is the database refusing a caller
    // who is not entitled (or whose organization slot is taken) - failureCode maps the slot hint. The legal-name and
    // location messages are the registration rules from main and stay specific.
    const message = error.message ?? "";
    const code = /legal business name/i.test(message)
      ? "onboarding.error.legalNameRequired"
      : /city is required/i.test(message)
        ? "onboarding.error.cityRequired"
        : /governorate|city|other is not/i.test(message)
          ? "onboarding.error.locationInvalid"
          : failureCode(error);
    return { ok: false, code, draftId: saved.draftId };
  }

  if (orgId) {
    const submitted = await supabase.rpc("organization_application_submit", { p_org_id: orgId });
    // The organization exists; a failed submission leaves it a draft the owner can submit from the
    // status page, so this is reported without losing anything.
    if (submitted.error) {
      revalidatePath("/", "layout");
      redirect("/business/applications");
    }
  }
  revalidatePath("/", "layout");
  redirect(landing);
}
