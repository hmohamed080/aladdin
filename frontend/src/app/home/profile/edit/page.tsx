import { redirect } from "next/navigation";
import { getRegistrationState, hasAppAccess } from "@/server/queries/registration";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadWorkspaces } from "@/server/queries/workspace";
import { personalEntry } from "@/lib/workspace/model";
import { loadPersonalHome } from "@/server/queries/personal-home";
import { getIndividualOnboardingData } from "@/server/queries/onboarding";
import { loadTradeCatalog, loadMyTrades } from "@/server/queries/trades";
import { TradeSelector } from "@/features/profile/trade-selector";
import { ProfessionalProfileEditor } from "@/features/profile/professional-profile-editor";
import { NoProfessionalProfile } from "@/features/profile/no-professional-profile";
import { ActivitySelector } from "@/features/profile/activity-selector";
import { loadMyActivities, loadPersonaActivityCatalog } from "@/server/queries/activities";
import { setMyActivitiesAction } from "@/server/actions/activities";
import type { Database } from "@/types/database.types";

type PersonaType = Database["public"]["Enums"]["persona_type"];
const PERSONAS: readonly PersonaType[] = [
  "end_consumer",
  "engineer",
  "interior_designer",
  "installer_technician",
  "contractor",
  "sales",
  "trainer",
  "trainee",
];
function asPersona(value: string | null | undefined): PersonaType | null {
  return value && (PERSONAS as readonly string[]).includes(value) ? (value as PersonaType) : null;
}

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
  if (!hasAppAccess(state)) redirect("/onboarding");

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

  // Two reads, one round trip each, both scoped to the caller — neither takes a
  // user id, because neither could act on one.
  // Persona-scoped subtypes (Engineer: finishing · Sales: rep/manager).
  // Tradespeople use the trade taxonomy above instead and have no persona
  // activities, so their catalog is empty and the selector renders nothing.
  const persona = asPersona(concreteType);
  const [catalog, mine, activityCatalog, myActivities] = await Promise.all([
    loadTradeCatalog(),
    loadMyTrades(),
    persona ? loadPersonaActivityCatalog(persona) : Promise.resolve([] as string[]),
    loadMyActivities(),
  ]);

  return (
    <div className="flex flex-col gap-xl">
      {/* TRADES SAVE THEMSELVES, ABOVE THE FORM RATHER THAN INSIDE IT. They are a
          different table with a different atomic authority (`user_trades_set`),
          and one button driving two RPCs would be two transactions that can
          disagree — leaving the page to explain a half-saved profile. Placed
          first because the canonical trade is now the profile's category, and the
          free-text fields below it are description. */}
      <TradeSelector catalog={catalog} mine={mine} />
      <ActivitySelector catalog={activityCatalog} selected={myActivities} action={setMyActivitiesAction} />
      <ProfessionalProfileEditor answers={individual.professional} concreteType={concreteType} />
    </div>
  );
}
