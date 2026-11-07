import { redirect } from "next/navigation";
import { getRegistrationState, hasAppAccess } from "@/server/queries/registration";
import { getBusinessOnboardingData } from "@/server/queries/onboarding";
import { BusinessFlow } from "@/features/onboarding/business-flow";
import { businessOrgTypeFromAccountType } from "@/lib/onboarding/account-types";
import { loadMandatoryBusinessSetup } from "@/server/queries/business-setup";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadAccountBasics, missingBasics } from "@/server/queries/account-basics";
import { loadSpecialtySource } from "@/server/queries/specialty-source";
import type { BusinessBasics } from "@/features/onboarding/business-flow";

export const dynamic = "force-dynamic";

/**
 * Business setup. Someone who chose a concrete business type ("Showroom") arrives here to create it; the type they
 * already picked is carried in, so the wizard never asks a second time.
 *
 * For a BUSINESS REGISTRATION this is MANDATORY, and it is where they land after verifying their email, signing in, or
 * typing /home or /b2b: while their first business does not exist, `resolveActiveLanding` and the /home and /b2b layouts
 * all route here (`loadMandatoryBusinessSetup`; no schema change - it is derived from the persisted registration intent
 * and their memberships). The registration type is the one the business is created as: it is locked here and enforced
 * again by the draft writers, so it cannot silently change. Closing the browser loses nothing: the draft is resumed.
 *
 * (`my_registration_state()` still returns access_ready for them - Increment 7 removed organization setup from that RPC
 * on purpose; the gate lives one layer up, in the routing that decides where an access_ready person belongs.)
 *
 * Creating the business makes them its owner (`app.organization_create_owned`), selects it as the active workspace, and
 * lands them in /b2b. Anyone else who reaches this page (an existing owner adding a business) gets the same flow, as at
 * /business/new. An invited employee never lands here: they join an existing organization via their invitation link.
 *
 * A business registration also answers its account basics here (ADR-0026, owner decision 2026-10-29), never on a
 * separate page: the business location counts as theirs once the business exists, and a step asks only the owner's
 * phone and specialties (from their business type's list) still missing.
 */
export default async function BusinessOnboardingPage() {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (!hasAppAccess(state)) redirect("/onboarding");

  const data = await getBusinessOnboardingData();
  if (!data || data.selectedTrack !== "business") redirect("/onboarding");

  // While the first business is outstanding the registered type IS the type (never the draft's, never the picker's).
  const mandatory = await loadMandatoryBusinessSetup();
  const presetOrgType = mandatory.required ? mandatory.orgType : businessOrgTypeFromAccountType(data.selectedAccountType);
  const answers = mandatory.required ? { ...data.business, orgType: mandatory.orgType } : data.business;

  const basics = mandatory.required ? await loadOwnerBasics() : null;

  return <BusinessFlow answers={answers} presetOrgType={presetOrgType} draftId={data.draftId} basics={basics} />;
}

/** The owner's missing phone and specialties, or null when nothing is owed (or the read fails: never a lock-out). */
async function loadOwnerBasics(): Promise<BusinessBasics | null> {
  const basics = await loadAccountBasics(await getServerSupabase()).catch(() => null);
  if (!basics) return null;
  const missing = missingBasics(basics);
  if (!missing.phone && !missing.specialties) return null;
  const source = missing.specialties ? await loadSpecialtySource(basics.specialtyKind) : null;
  return { phone: missing.phone, specialties: missing.specialties && source !== null, source };
}
