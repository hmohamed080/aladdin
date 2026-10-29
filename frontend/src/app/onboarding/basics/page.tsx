import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase/server";
import { getRegistrationState, hasAppAccess } from "@/server/queries/registration";
import { activeLandingPath } from "@/server/queries/landing";
import { hasMissingBasics, loadAccountBasics, missingBasics } from "@/server/queries/account-basics";
import { loadSpecialtySource } from "@/server/queries/specialty-source";
import { loadMandatoryBusinessSetup } from "@/server/queries/business-setup";
import { MANDATORY_BUSINESS_SETUP_PATH } from "@/lib/onboarding/mandatory-business-setup";
import { sanitizeNext } from "@/server/auth/next";
import { AccountBasicsForm } from "@/features/onboarding/account-basics-form";

export const dynamic = "force-dynamic";

/**
 * Onboarding steps for phone, governorate + town and specialties (ADR-0026),
 * one per step, only the ones still missing. A business registration answers
 * them inside its business setup instead, so it is sent there.
 */
export default async function AccountBasicsPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (!hasAppAccess(state)) redirect("/onboarding");
  if ((await loadMandatoryBusinessSetup()).required) redirect(MANDATORY_BUSINESS_SETUP_PATH);

  const supabase = await getServerSupabase();
  const basics = await loadAccountBasics(supabase).catch(() => null);
  if (!basics) redirect(await activeLandingPath());
  const missing = missingBasics(basics);
  if (!hasMissingBasics(missing)) redirect(await activeLandingPath());

  const { next } = await searchParams;
  const source = missing.specialties ? await loadSpecialtySource(basics.specialtyKind) : null;
  return <AccountBasicsForm missing={missing} source={source} next={sanitizeNext(next)} />;
}
