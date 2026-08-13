import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getRegistrationState } from "@/server/queries/registration";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadWorkspaces } from "@/server/queries/workspace";
import { personalEntry } from "@/lib/workspace/model";
import { getOpenReferral } from "@/server/queries/affiliation";
import { createTranslator } from "@/lib/i18n/translate";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { ShowroomReferralForm } from "@/features/accounts/showroom-referral-form";

export const dynamic = "force-dynamic";

/**
 * "Add showroom" — refer the business you work for, when it is not on Aladdin yet.
 *
 * This is the narrow referral path, NOT the owner "Add Business" flow. Submitting
 * creates no organization and grants no access; it records a candidate the platform
 * reviews, attributed to the referring salesperson, who ends up as a Sales member
 * and never as Owner.
 *
 * The form hydrates from the caller's open referral, so a half-filled candidate
 * survives a closed tab, and a re-submission is the same referral rather than a
 * second business.
 */
export default async function ReferShowroomPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (state !== "active_personal") redirect("/onboarding");

  const supabase = await getServerSupabase();
  const { entries } = await loadWorkspaces(supabase);
  if (!personalEntry(entries)) redirect("/");

  const [{ error }, referral] = await Promise.all([searchParams, getOpenReferral()]);

  const store = await cookies();
  const t = createTranslator(resolveLocale(store.get(LOCALE_COOKIE)?.value));

  return <ShowroomReferralForm referral={referral} error={error} t={t} />;
}
