import "server-only";

import { redirect } from "next/navigation";
import type { InstallerOpportunityVM } from "@/features/installer-dashboard-preview/view-model";
import { toOpportunityVMs } from "@/features/home/installer-dashboard-data";
import { parseProfile } from "@/lib/admin/view-as/craftsman-data";
import { viewAsMediaHref } from "@/lib/admin/view-as/registry";
import { installerLocationLabel } from "@/lib/installer/opportunity-location";
import type { Locale } from "@/lib/i18n/locales";
import { createTranslator } from "@/lib/i18n/translate";
import { getServerSupabase } from "@/lib/supabase/server";
import { listJobOpportunities } from "@/server/queries/job-opportunities";
import { loadMyIdentity } from "@/server/queries/profile-identity";
import { loadPersonalHome } from "@/server/queries/personal-home";
import { readOnlySupabase } from "./read-only-client";

/**
 * AccountReader: the ONE seam between the account's real UI and its data (docs/admin/ADMIN_VIEW_AS_EXACT_PARITY_PLAN.md §3.2).
 *
 * The shell and (from Phase 2) every page body are written once against this interface. `selfReader` serves the signed-in
 * owner through the EXISTING loaders (behavior unchanged); `viewAsReader(subjectId)` serves an Admin viewing one subject,
 * calling ONLY `admin_view_*` functions through the default-deny read-only client. There is no generic client in a reader.
 *
 * DRIFT GUARD: both implementations are annotated `: AccountReader`. A loader added to a real page must be added to this
 * interface, and then BOTH implementations stop compiling until the view-as one exists; `account-reader.test.ts` also pins
 * the two key sets and carries a `@ts-expect-error` proving an incomplete reader is a compile error.
 */
export type ShellData = {
  displayName: string;
  /** Short-lived signed URL (self) or the view media door URL (view-as); null shows the initial. */
  avatarUrl: string | null;
  location: string | null;
  /** The topbar search overlay's jobs. Empty in a view: it is a record-search of the owner's market, not the subject's data. */
  searchJobs: readonly InstallerOpportunityVM[];
};

export interface AccountReader {
  shell(): Promise<ShellData>;
}

/** Bounded read backing the topbar's search overlay (unchanged from the Craftsman layout). */
const SEARCH_OPPORTUNITIES_LIMIT = 8;

export function selfReader(locale: Locale): AccountReader {
  return {
    async shell() {
      const home = await loadPersonalHome();
      const supabase = await getServerSupabase();
      const searchOpportunities = await listJobOpportunities(supabase, { limit: SEARCH_OPPORTUNITIES_LIMIT });
      const identity = await loadMyIdentity().catch(() => null);
      return {
        displayName: home?.displayName ?? "",
        avatarUrl: identity?.avatarUrl ?? null,
        // Stored values are catalogue keys ("new-cairo"); show the place's name.
        location: home ? installerLocationLabel(home.professional, locale) : null,
        searchJobs: toOpportunityVMs(searchOpportunities, createTranslator(locale), locale),
      };
    },
  };
}

export function viewAsReader(subjectId: string, locale: Locale): AccountReader {
  return {
    async shell() {
      // Default-deny client: always the read-only wrapper here, whatever the request context says.
      const supabase = readOnlySupabase(await getServerSupabase());
      const { data, error } = await supabase.rpc("admin_view_craftsman_profile", { p_subject: subjectId });
      if (error) {
        if (error.code === "42501") redirect(`/admin/users/${subjectId}`);
        throw new Error("view-as read failed");
      }
      const profile = parseProfile(data);
      const area = profile.serviceAreas.find((a) => a.isPrimary) ?? profile.serviceAreas[0] ?? null;
      return {
        displayName: profile.displayName ?? "",
        avatarUrl: profile.avatarId ? viewAsMediaHref(subjectId, "avatar", profile.avatarId) : null,
        location: area ? installerLocationLabel({ governorate: area.governorate, city: area.city }, locale) : null,
        searchJobs: [],
      };
    },
  };
}
