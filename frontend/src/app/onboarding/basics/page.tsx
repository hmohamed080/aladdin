import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getRegistrationState, hasAppAccess } from "@/server/queries/registration";
import { activeLandingPath } from "@/server/queries/landing";
import { hasMissingBasics, loadAccountBasics, missingBasics } from "@/server/queries/account-basics";
import { loadTradeCatalog } from "@/server/queries/trades";
import { sanitizeNext } from "@/server/auth/next";
import { AccountBasicsForm } from "@/features/onboarding/account-basics-form";

export const dynamic = "force-dynamic";

/**
 * "Complete your account" (ADR-0026): phone, governorate + town and
 * specialties, asked once for every account type. Only what is still missing
 * is shown; an account that already holds all three goes straight on.
 */
export default async function AccountBasicsPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (!hasAppAccess(state)) redirect("/onboarding");

  const supabase = await getServerSupabase();
  const basics = await loadAccountBasics(supabase).catch(() => null);
  if (!basics) redirect(await activeLandingPath());
  const missing = missingBasics(basics);
  if (!hasMissingBasics(missing)) redirect(await activeLandingPath());

  const { next } = await searchParams;
  const trades = missing.specialties ? await loadTradeCatalog() : [];
  return <AccountBasicsForm missing={missing} tradeKeys={trades.map((t) => t.key)} next={sanitizeNext(next)} />;
}
