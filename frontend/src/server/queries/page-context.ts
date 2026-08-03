import "server-only";

import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadWorkspaceContext, type OrgContext } from "@/server/queries/context";
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n/config";
import type { Locale } from "@/lib/i18n/locales";
import type { Database } from "@/types/database.types";

export type PageContext = {
  supabase: SupabaseClient<Database>;
  org: OrgContext;
  locale: Locale;
};

/**
 * Loads the caller-scoped client + active org context for a B2B page. Returns
 * null when the caller has no active org (the layout renders the notice, but a
 * nested page must also guard). RLS still governs every subsequent query.
 */
export async function getPageContext(): Promise<PageContext | null> {
  const supabase = await getServerSupabase();
  const workspace = await loadWorkspaceContext(supabase);
  if (!workspace.active) return null;
  const store = await cookies();
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
  return { supabase, org: workspace.active, locale };
}
