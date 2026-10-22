import { redirect } from "next/navigation";
import { getRegistrationState, hasAppAccess } from "@/server/queries/registration";
import { getServerSupabase } from "@/lib/supabase/server";
import { loadWorkspaces } from "@/server/queries/workspace";
import { personalEntry } from "@/lib/workspace/model";
import { loadPersonalHome } from "@/server/queries/personal-home";
import { getIndividualOnboardingData } from "@/server/queries/onboarding";
import { loadTradeCatalog, loadMyTrades, loadSpecialtyCatalog, loadMySpecialtyIds } from "@/server/queries/trades";
import { TradeSelector } from "@/features/profile/trade-selector";
import { ServiceAreasEditor } from "@/features/profile/service-areas-editor";
import { loadMyServiceAreas } from "@/server/queries/service-areas";
import { ProfessionalProfileEditor } from "@/features/profile/professional-profile-editor";
import { NoProfessionalProfile } from "@/features/profile/no-professional-profile";
import { ActivitySelector } from "@/features/profile/activity-selector";
import { loadMyActivities, loadPersonaActivityCatalog } from "@/server/queries/activities";
import { setMyActivitiesAction } from "@/server/actions/activities";
import type { Database } from "@/types/database.types";
import { cookies } from "next/headers";
import Link from "next/link";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { loadMyIdentity, loadMyProfileCompletion } from "@/server/queries/profile-identity";
import { loadMyAvailabilityWindows } from "@/server/queries/service-areas";
import { loadProfessionalAssetSummary } from "@/server/queries/portfolio";
import { AvailabilityWindows } from "@/features/profile/availability-windows";
import { InstallerProfileHero } from "@/features/installer-account/installer-profile-hero";
import { PortfolioProjects } from "@/features/installer-account/portfolio-projects";
import { loadMyPortfolioProjects, PORTFOLIO_MAX_PROJECT_MEDIA, PORTFOLIO_MAX_PROJECTS } from "@/server/queries/portfolio-projects";
import { videoEnabled } from "@/server/video/playback";
import { ProfileProgressRail, ProfileSection } from "@/features/installer-account/installer-profile-layout";

type PersonaType = Database["public"]["Enums"]["persona_type"];
const PERSONAS: readonly PersonaType[] = [
  "end_consumer",
  "engineer",
  "installer_technician",
  "contractor",
  "sales",
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
  const [catalog, mine, activityCatalog, myActivities, specialties, mySpecialtyIds, serviceAreas] = await Promise.all([
    loadTradeCatalog(),
    loadMyTrades(),
    persona ? loadPersonaActivityCatalog(persona) : Promise.resolve([] as string[]),
    loadMyActivities(),
    loadSpecialtyCatalog(),
    loadMySpecialtyIds(),
    loadMyServiceAreas(),
  ]);

  // An Installer gets the approved "Complete your profile" design (`/preview/installer-account`): the real cover and
  // photo editor in the hero, the real editors inside the approved numbered sections, and a progress rail computed
  // from the database. Nothing here is a mock: every control saves through its own RPC.
  if (home.accountType === "installer_technician") {
    const store = await cookies();
    const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value);
    const ar = locale === "ar";
    const [identity, completion, windows, assets, projects] = await Promise.all([
      loadMyIdentity(),
      loadMyProfileCompletion(),
      loadMyAvailabilityWindows(),
      loadProfessionalAssetSummary(),
      loadMyPortfolioProjects(),
    ]);
    const missing = new Set(completion?.missing ?? []);
    const steps = [
      { id: "basic", label: ar ? "المعلومات الأساسية" : "Basic information", done: !["display_name", "headline", "years_experience", "bio", "avatar"].some((k) => missing.has(k as never)) && mine.keys.length > 0 },
      { id: "availability", label: ar ? "إتاحة العمل" : "Availability", done: windows.length > 0 },
      { id: "portfolio", label: ar ? "سابقة الأعمال" : "Portfolio", done: assets.portfolioPublished > 0 || projects.some((p) => p.isPublic && p.media.length > 0) },
      { id: "coverage", label: ar ? "نطاق العمل" : "Work area", done: serviceAreas.primaryGovernorate !== null },
    ];
    return (
      <div className="flex w-full min-w-0 flex-col gap-md" data-installer-profile-edit>
        <InstallerProfileHero
          displayName={identity?.displayName ?? ""}
          avatarUrl={identity?.avatarUrl ?? null}
          coverUrl={identity?.coverUrl ?? null}
          title={ar ? "كمّل ملفك الشخصي" : "Complete your profile"}
          subtitle={ar ? "خلّي شغلك يوصل للناس المناسبة" : "Help your work reach the right people"}
        />
        <div className="grid min-w-0 gap-md desktop:grid-cols-5">
          <ProfileProgressRail
            locale={locale}
            percent={completion?.percent ?? 0}
            steps={steps}
            tips={ar
              ? ["أضف صورًا حقيقية لأعمالك المنجزة.", "حدّد المدن التي تعمل بها بدقة.", "اكتب نبذة قصيرة وواضحة عن خبرتك."]
              : ["Add real photos of finished work.", "Set the cities you work in accurately.", "Write a short, clear summary of your experience."]}
          />
          <div className="order-2 min-w-0 space-y-md desktop:order-1 desktop:col-span-4">
            <ProfileSection id="basic" step={1} title={ar ? "المعلومات الأساسية" : "Basic information"} description={ar ? "أضف بياناتك المهنية الأساسية ليمكن للعملاء التعرف عليك." : "Add your core professional details so clients can get to know you."}>
              <div className="flex flex-col gap-lg">
                <TradeSelector catalog={catalog} mine={mine} specialties={specialties} mySpecialtyIds={mySpecialtyIds} />
                <ProfessionalProfileEditor answers={individual.professional} concreteType={concreteType} />
              </div>
            </ProfileSection>
            <ProfileSection id="availability" step={2} title={ar ? "إتاحة العمل" : "Availability"} description={ar ? "متى يمكنك بدء العمل؟" : "When can you start work?"}>
              <AvailabilityWindows windows={windows} />
            </ProfileSection>
            <ProfileSection id="portfolio" step={3} title={ar ? "سابقة الأعمال" : "Work history"} description={ar ? "أضف مشاريعك السابقة ليتمكن العملاء من التعرّف على خبرتك وأعمالك." : "Add past projects so clients can understand your experience."}>
              <PortfolioProjects projects={projects} maxProjects={PORTFOLIO_MAX_PROJECTS} maxMedia={PORTFOLIO_MAX_PROJECT_MEDIA} videoEnabled={videoEnabled()} />
              {assets.portfolioTotal > projects.reduce((n, p) => n + p.media.filter((m) => m.kind === "image" && m.state === "ready").length, 0) ? (
                <p className="mt-sm text-label text-fg-secondary">
                  {ar ? "لديك أعمال سابقة خارج المشاريع. " : "You also have work outside projects. "}
                  <Link href="/home/profile/portfolio" className="font-medium text-accent underline-offset-2 hover:underline">{ar ? "إدارتها" : "Manage it"}</Link>
                </p>
              ) : null}
            </ProfileSection>
            <ProfileSection id="coverage" step={4} title={ar ? "نطاق العمل" : "Work area"} description={ar ? "حدّد المحافظة والمدن التي تعمل بها." : "Set the governorate and cities you work in."}>
              <ServiceAreasEditor value={serviceAreas} />
            </ProfileSection>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-xl">
      {/* TRADES SAVE THEMSELVES, ABOVE THE FORM RATHER THAN INSIDE IT. They are a
          different table with a different atomic authority (`user_trades_set`),
          and one button driving two RPCs would be two transactions that can
          disagree — leaving the page to explain a half-saved profile. Placed
          first because the canonical trade is now the profile's category, and the
          free-text fields below it are description. */}
      <TradeSelector catalog={catalog} mine={mine} specialties={specialties} mySpecialtyIds={mySpecialtyIds} />
      {/* WHERE YOU WORK: the canonical service areas (primary governorate, cities, other governorates). They feed Near me
          and the location part of the Overall Match; they never limit which jobs a person can open or apply to. */}
      <ServiceAreasEditor value={serviceAreas} />
      <ActivitySelector catalog={activityCatalog} selected={myActivities} action={setMyActivitiesAction} />
      <ProfessionalProfileEditor answers={individual.professional} concreteType={concreteType} />
    </div>
  );
}
