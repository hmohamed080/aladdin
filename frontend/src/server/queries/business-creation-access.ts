import "server-only";

import { getWorkspaces, personalEntry } from "@/server/queries/workspace";
import { getBusinessOnboardingData, type BusinessOnboardingData } from "@/server/queries/onboarding";
import { businessOrgTypeFromAccountType } from "@/lib/onboarding/account-types";
import { decideBusinessCreation } from "@/lib/workspace/entitlements";

/**
 * Server-side answer to "may this caller start or continue a business?" — shared
 * by `/business/new` (the page) and the draft writers (`saveBusiness` /
 * `submitBusiness`), so the rule cannot be bypassed by posting to the action
 * directly or by typing the URL.
 *
 * It reads only what the server already trusts: the caller's derived workspaces
 * (`my_workspaces()`), and their own onboarding progress and open draft. It adds
 * an application-layer entitlement; it does not alter RLS or membership authority.
 */
export async function loadBusinessCreationAccess(): Promise<{
  allowed: boolean;
  data: BusinessOnboardingData | null;
}> {
  const [data, { entries }] = await Promise.all([getBusinessOnboardingData(), getWorkspaces()]);
  if (!data) return { allowed: false, data: null };

  const decision = decideBusinessCreation({
    persona: personalEntry(entries)?.persona ?? null,
    entries,
    openDraftId: data.draftId,
    registrationBusinessIntent:
      data.selectedTrack === "business" && businessOrgTypeFromAccountType(data.selectedAccountType) !== null,
  });
  return { allowed: decision.allowed, data };
}
