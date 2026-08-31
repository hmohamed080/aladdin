import { redirect } from "next/navigation";
import { getRegistrationState } from "@/server/queries/registration";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadWorkspaces } from "@/server/queries/workspace";
import { personalEntry } from "@/lib/workspace/model";
import { loadPersonalHome } from "@/server/queries/personal-home";
import { getIndividualOnboardingData } from "@/server/queries/onboarding";
import { ProfessionalProfileEditor } from "@/features/profile/professional-profile-editor";
import { NoProfessionalProfile } from "@/features/profile/no-professional-profile";

export const dynamic = "force-dynamic";

/**
 * The standalone profile editor.
 *
 * Hydrated from `getIndividualOnboardingData()` — the SAME read the wizard uses,
 * so the two surfaces cannot show different values for the same profile. State
 * lives in the database, never in a client store, which is what lets a person edit
 * from one device and see it from another.
 *
 * ONE GUARD, NOT TWO. The page admits any professional variant and the database
 * admits any professional identity — canonical or declared (`20260831090003`).
 * There is deliberately no second, narrower frontend condition: the editor briefly
 * carried one, derived from the onboarding track, and it locked out every seeded
 * and Admin-upgraded professional in the Pilot. A frontend gate stricter than the
 * write path is not caution, it is a second rule to keep in step.
 */
export default async function EditProfilePage() {
  const state = await getRegistrationState();
  if (state === "unverified") redirect("/auth/sign-in");
  if (state !== "active_personal") redirect("/onboarding");

  const supabase = await getServerSupabase();
  const { entries } = await loadWorkspaces(supabase);
  if (!personalEntry(entries)) redirect("/");

  const home = await loadPersonalHome();
  if (!home) redirect("/auth/sign-in");
  if (home.variant !== "professional") return <NoProfessionalProfile />;

  const individual = await getIndividualOnboardingData();
  if (!individual) redirect("/auth/sign-in");

  // The persona to write back. `loadPersonalHome` already resolved declared-then-
  // canonical, so this is the same answer the hub labels the profile with.
  const concreteType = individual.professional.concreteType ?? home.accountType;

  return (
    <ProfessionalProfileEditor answers={individual.professional} concreteType={concreteType} />
  );
}
