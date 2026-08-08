import { redirect } from "next/navigation";
import { getRegistrationState } from "@/server/queries/registration";
import { getOnboardingData } from "@/server/queries/onboarding";
import { AccountTypeStep } from "@/features/onboarding/account-type-step";
import { ACCOUNT_TYPE_CHOICES } from "@/lib/onboarding/account-types";

export const dynamic = "force-dynamic";

/** Step 3 route. Requires the earlier steps; pre-selects a prior choice if any. */
export default async function OnboardingAccountTypePage() {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (state === "active_personal") redirect("/b2b");
  if (state === "consent_pending" || state === "invitation_pending" || state === "manually_blocked") {
    redirect("/onboarding");
  }
  if (state === "profile_pending") redirect("/onboarding/profile");
  if (state === "contact_pending") redirect("/onboarding/contact");

  const data = await getOnboardingData();
  // Recover the previously-chosen key from the stored track + concrete type so the
  // selection survives a refresh / Back (account type is never silently lost).
  const priorKey =
    ACCOUNT_TYPE_CHOICES.find(
      (c) => c.track === data?.selectedTrack && c.accountType === (data?.selectedAccountType ?? null),
    )?.key ?? null;
  return <AccountTypeStep selectedKey={priorKey} />;
}
