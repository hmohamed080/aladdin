import "server-only";

import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

type DB = SupabaseClient<Database>;

export type OrgBilingualNames = {
  orgNameAr: string | null;
  orgNameEn: string | null;
  orgTimezone: string | null;
  branchNameAr: string | null;
  branchNameEn: string | null;
  branchAddressAr: string | null;
  branchAddressEn: string | null;
  branchTimezone: string | null;
};

const EMPTY: OrgBilingualNames = {
  orgNameAr: null,
  orgNameEn: null,
  orgTimezone: null,
  branchNameAr: null,
  branchNameEn: null,
  branchAddressAr: null,
  branchAddressEn: null,
  branchTimezone: null,
};

/**
 * The Arabic/English trading-name overrides for the header's org/branch
 * chips — see `lib/i18n/bilingual.ts` for the display-fallback rule these
 * feed. A deliberately narrow, single-purpose read rather than threading
 * `name_ar`/`name_en` through `WorkspaceContext`/`WorkspaceEntry`: those
 * types back every workspace surface, and only the Showroom Owner header
 * needs the translated pair today.
 *
 * A SECOND surface now needs it — the shared `WorkspaceShell` header, not
 * just the Showroom dashboard's own greeting line — which is exactly the
 * signal this file's own history called out as "promote to the shared
 * context loader." `cache()`d here instead: the two callers (`b2b/layout.tsx`
 * for the header, `showroom-dashboard.tsx` for the greeting/timezone) share
 * one Supabase round trip per render rather than issuing it twice, without
 * yet committing every workspace surface to carrying these columns through
 * `WorkspaceContext`. Promote further only if a THIRD surface needs it.
 */
export const orgBilingualNames = cache(async function orgBilingualNames(
  supabase: DB,
  orgId: string,
  branchId: string | null,
): Promise<OrgBilingualNames> {
  const [org, branch] = await Promise.all([
    supabase.from("organizations").select("name_ar, name_en, timezone").eq("id", orgId).maybeSingle(),
    branchId
      ? supabase
          .from("branches")
          .select("name_ar, name_en, address_ar, address_en, timezone")
          .eq("id", branchId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (org.error) throw org.error;
  if (branch.error) throw branch.error;

  return {
    orgNameAr: org.data?.name_ar ?? null,
    orgNameEn: org.data?.name_en ?? null,
    orgTimezone: org.data?.timezone ?? null,
    branchNameAr: branch.data?.name_ar ?? null,
    branchNameEn: branch.data?.name_en ?? null,
    branchAddressAr: branch.data?.address_ar ?? null,
    branchAddressEn: branch.data?.address_en ?? null,
    branchTimezone: branch.data?.timezone ?? null,
  };
});

export { EMPTY as EMPTY_BILINGUAL_NAMES };
