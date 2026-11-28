import "server-only";

import { getWorkspaces, personalEntry } from "@/server/queries/workspace";
import { getBusinessOnboardingData, type BusinessOnboardingData } from "@/server/queries/onboarding";
import { loadOrganizationApplications } from "@/server/queries/organization-applications";
import { businessOrgTypeFromAccountType } from "@/lib/onboarding/account-types";
import { decideBusinessCreation } from "@/lib/workspace/entitlements";
import { slotAllowsNewApplication, type ApplicationSlot } from "@/lib/workspace/applications";

/**
 * Server-side answer to "may this caller start or continue a business?" - shared
 * by `/business/new` (the page) and the draft writers (`saveBusiness` /
 * `submitBusiness`), so the rule cannot be bypassed by posting to the action
 * directly or by typing the URL.
 *
 * It reads only what the server already trusts: the caller's derived workspaces
 * (`my_workspaces()`), their own onboarding progress and open draft, and the one-open-application
 * verdict (`my_organization_application_slot()`). It adds an application-layer entitlement; the
 * database re-checks every rule on every write, so this never grants authority.
 */
export async function loadBusinessCreationAccess(): Promise<{
  allowed: boolean;
  /** The persona/workspace entitlement alone, before the application slot is considered. */
  entitled: boolean;
  data: BusinessOnboardingData | null;
  persona: string | null;
  /** The one-open-application rule's verdict. */
  slot: ApplicationSlot;
  /** True when a new application may be opened, or the caller is finishing the draft they hold. */
  slotOpen: boolean;
}> {
  const [data, { entries }, { slot }] = await Promise.all([
    getBusinessOnboardingData(),
    getWorkspaces(),
    loadOrganizationApplications(),
  ]);
  const persona = personalEntry(entries)?.persona ?? null;
  if (!data) return { allowed: false, entitled: false, data: null, persona, slot, slotOpen: false };

  const decision = decideBusinessCreation({
    persona,
    entries,
    openDraftId: data.draftId,
    registrationBusinessIntent:
      data.selectedTrack === "business" && businessOrgTypeFromAccountType(data.selectedAccountType) !== null,
  });
  // An otherwise-entitled caller is still refused while the slot is taken, unless they are
  // finishing the draft they already hold.
  const slotOpen = slotAllowsNewApplication(slot) || data.draftId !== null;
  return { allowed: decision.allowed && slotOpen, entitled: decision.allowed, data, persona, slot, slotOpen };
}
