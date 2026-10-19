import "server-only";

import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { readSessionIdentity } from "@/server/auth/session";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadIsAdminStaff } from "@/server/queries/platform";
import { loadWorkspaces } from "@/server/queries/workspace";
import { businessEntries, personalEntry } from "@/lib/workspace/model";
import { decideMandatoryBusinessSetup, type MandatoryBusinessSetup } from "@/lib/onboarding/mandatory-business-setup";

/**
 * Is the caller's FIRST business still outstanding? (Registered as Showroom / Supplier / Manufacturer / Importer, and has
 * not yet created it.) The rule itself - and why it needs no schema change - is `decideMandatoryBusinessSetup`.
 *
 * Everything is read from the database on every request, under the caller's own RLS:
 *   - `onboarding_progress`: the persisted registration intent (track + business type);
 *   - `my_workspaces()`: personal workspace and organization memberships;
 *   - `business_creation_drafts`: whether a business was ever completed;
 *   - `platform_role_grants`: platform staff are exempt.
 * So it is authoritative and resumable: closing the browser, signing out and in, or typing /home changes nothing.
 *
 * Cheap for everyone else: the first read answers "not a business registration" (installer, sales, consumer, engineer,
 * invited employee, ...) and nothing more is queried.
 *
 * Not a security control: it decides which screen a signed-in person is routed to. Who may CREATE a business is still
 * decided by the database (`app.can_create_or_complete_business`), and the registered type is locked there too
 * (`app.mandatory_registration_business_type`, which mirrors this rule); every read re-checks membership and RLS.
 */
export async function computeMandatoryBusinessSetup(supabase: SupabaseClient<Database>): Promise<MandatoryBusinessSetup> {
  const user = await readSessionIdentity(supabase);
  if (!user) return { required: false, orgType: null };

  const { data: progress } = await supabase
    .from("onboarding_progress")
    .select("selected_track, selected_org_type")
    .eq("user_id", user.id)
    .maybeSingle();
  if (progress?.selected_track !== "business") return { required: false, orgType: null };

  const [{ entries }, completed, isPlatformStaff] = await Promise.all([
    loadWorkspaces(supabase),
    supabase
      .from("business_creation_drafts")
      .select("id", { head: true, count: "exact" })
      .eq("user_id", user.id)
      .not("completed_at", "is", null),
    loadIsAdminStaff(supabase),
  ]);

  return decideMandatoryBusinessSetup({
    track: progress.selected_track,
    selectedOrgType: progress.selected_org_type,
    hasPersonalWorkspace: Boolean(personalEntry(entries)),
    businessMembershipCount: businessEntries(entries).length,
    hasCompletedBusinessDraft: (completed.count ?? 0) > 0,
    isPlatformStaff,
  });
}

/** For layouts and pages: the same answer, computed once per server render. */
export const loadMandatoryBusinessSetup = cache(async function loadMandatoryBusinessSetup(): Promise<MandatoryBusinessSetup> {
  return computeMandatoryBusinessSetup(await getServerSupabase());
});
