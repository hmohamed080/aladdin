import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { requireEngineer } from "@/server/queries/engineer";
import { loadMyIdentity, loadMyProfileCompletion } from "@/server/queries/profile-identity";
import { getIndividualOnboardingData } from "@/server/queries/onboarding";
import { loadMyAvailabilityWindows } from "@/server/queries/service-areas";
import { loadMyActivities, loadPersonaActivityCatalog } from "@/server/queries/activities";
import { listMyPortfolio } from "@/server/queries/portfolio";
import { createAssetReadUrl } from "@/server/actions/professional-assets";
import { setMyActivitiesAction } from "@/server/actions/activities";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { IdentityCard } from "@/features/settings/identity-card";
import { ProfessionalProfileEditor } from "@/features/profile/professional-profile-editor";
import { ActivitySelector } from "@/features/profile/activity-selector";
import { AvailabilityControl } from "@/features/profile/availability-control";
import { AvailabilityWindows } from "@/features/profile/availability-windows";
import { PortfolioManager } from "@/features/portfolio/portfolio-manager";
import { EngineerProfileCompletion } from "@/features/engineer/profile-completion";
import { ButtonLink } from "@/components/ui/controls";

export const dynamic = "force-dynamic";

export default async function CompleteEngineerProfilePage() {
  const { account } = await requireEngineer();
  const [identity, completion, individual, windows, catalog, activities, portfolio, store] = await Promise.all([
    loadMyIdentity(), loadMyProfileCompletion(), getIndividualOnboardingData(),
    loadMyAvailabilityWindows(), loadPersonaActivityCatalog("engineer"), loadMyActivities(), listMyPortfolio(), cookies(),
  ]);
  if (!identity || !individual) redirect("/auth/sign-in");
  const ar = resolveLocale(store.get(LOCALE_COOKIE)?.value) === "ar";
  const cards = await Promise.all(portfolio.map(async (item) => {
    const url = item.pending ? null : await createAssetReadUrl("portfolio", item.objectKey);
    return { ...item, previewUrl: url?.ok ? url.url : null };
  }));
  return <EngineerProfileCompletion name={identity.displayName} avatar={identity.avatarUrl} completion={completion} panels={[
    <div key="identity" className="space-y-md">
      <IdentityCard identity={identity} />
      <div className="flex flex-wrap items-center justify-between gap-md rounded-md border bg-surface p-lg">
        <div><h3 className="font-semibold">{ar ? "اسم المستخدم ورابط ملفك" : "Username & profile link"}</h3><p className="mt-1 text-label text-fg-secondary">{identity.username || (ar ? "اختر اسمًا يسهل مشاركته مع العملاء." : "Choose a name that is easy to share with clients.")}</p></div>
        <ButtonLink href="/home/settings">{ar ? "تعديل اسم المستخدم" : "Edit username"}</ButtonLink>
      </div>
    </div>,
    <div key="expertise" className="space-y-lg">
      <ActivitySelector catalog={catalog} selected={activities} action={setMyActivitiesAction} />
      <ProfessionalProfileEditor answers={individual.professional} concreteType="engineer" embedded />
    </div>,
    <div key="availability" className="space-y-lg"><AvailabilityControl availability={account.availability} /><AvailabilityWindows windows={windows} /></div>,
    <PortfolioManager key="portfolio" items={cards} />,
  ]} />;
}
