import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getRegistrationState } from "@/server/queries/registration";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadWorkspaces } from "@/server/queries/workspace";
import { personalEntry } from "@/lib/workspace/model";
import { searchShowrooms, showroomBranches } from "@/server/queries/affiliation";
import { createTranslator } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { ShowroomSearch } from "@/features/accounts/showroom-search";
import { ShowroomNotAvailable } from "@/features/accounts/showroom-not-available";
import { loadIsSalesPersona } from "@/server/queries/sales-persona";

export const dynamic = "force-dynamic";

/**
 * "Connect your showroom" — a Salesperson's route to the Sales tools of the
 * business they work for.
 *
 * The page is for SALES accounts, and reaching it grants nothing: every result
 * comes from the public business-directory projection, and asking to join creates
 * a request that an Owner/Manager of that showroom must approve.
 *
 * A non-Sales personal account gets the unavailable state instead of the form.
 * `app.is_sales_persona` already refuses these writes in the database, so the gate
 * here is honesty, not authority: without it an Installer/Technician who typed the
 * URL would fill in a search, pick a showroom, submit, and be met with a bare
 * failure for a flow that was never theirs.
 *
 * It is deliberately NOT "Add Business". A salesperson connecting to their employer
 * does not become its Owner, which is why the fallback for "my showroom isn't here"
 * is the referral flow and not the owner creation wizard.
 */
export default async function ConnectShowroomPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; org?: string; error?: string }>;
}) {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (state !== "active_personal") redirect("/onboarding");

  const supabase = await getServerSupabase();
  const { entries } = await loadWorkspaces(supabase);
  // A caller with no personal workspace has no personal Sales setup to do.
  if (!personalEntry(entries)) redirect("/");
  if (!(await loadIsSalesPersona())) return <ShowroomNotAvailable />;

  const { q, org, error } = await searchParams;
  const query = (q ?? "").trim();
  const results = query.length >= 2 ? await searchShowrooms(query) : [];

  // A chosen showroom's branches, so the salesperson can say where they work.
  const selected = org ? results.find((r) => r.id === org) : undefined;
  const branches = selected ? await showroomBranches(selected.id) : [];

  const store = await cookies();
  const t = createTranslator(resolveLocale(store.get(LOCALE_COOKIE)?.value));

  return (
    <ShowroomSearch
      query={query}
      results={results}
      selected={selected}
      branches={branches}
      error={error}
      t={t}
    />
  );
}
