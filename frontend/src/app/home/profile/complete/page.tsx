import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { requireEngineer } from "@/server/queries/engineer";
import { loadMyIdentity, loadMyProfileCompletion } from "@/server/queries/profile-identity";
import { getIndividualOnboardingData } from "@/server/queries/onboarding";
import { loadMyAvailabilityWindows, loadMyServiceAreas } from "@/server/queries/service-areas";
import { listMyPortfolio } from "@/server/queries/portfolio";
import { createAssetReadUrl } from "@/server/actions/professional-assets";
import { resolveLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { IdentityCard } from "@/features/settings/identity-card";
import { ProfessionalProfileEditor } from "@/features/profile/professional-profile-editor";
import { AvailabilityControl } from "@/features/profile/availability-control";
import { AvailabilityWindows } from "@/features/profile/availability-windows";
import { PortfolioManager } from "@/features/portfolio/portfolio-manager";
import { EngineerProfileCompletion } from "@/features/engineer/profile-completion";
import { ButtonLink } from "@/components/ui/controls";

export const dynamic = "force-dynamic";

export default async function CompleteEngineerProfilePage({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  const step = Number((await searchParams).step ?? 0);
  const initialStep = Number.isInteger(step) && step >= 0 && step < 4 ? step : 0;
  const { account } = await requireEngineer();
  const [identity, completion, individual, windows, portfolio, store, serviceAreas] = await Promise.all([
    loadMyIdentity(), loadMyProfileCompletion(), getIndividualOnboardingData(),
    loadMyAvailabilityWindows(), listMyPortfolio(), cookies(), loadMyServiceAreas(),
  ]);
  if (!identity || !individual) redirect("/auth/sign-in");
  const ar = resolveLocale(store.get(LOCALE_COOKIE)?.value) === "ar";
  const cards = await Promise.all(portfolio.map(async (item) => {
    const url = item.pending ? null : await createAssetReadUrl("portfolio", item.objectKey);
    return { ...item, previewUrl: url?.ok ? url.url : null };
  }));
  return <EngineerProfileCompletion initialStep={initialStep} name={identity.displayName} avatar={identity.avatarUrl} completion={completion} panels={[
    <div key="identity" className="space-y-md">
      <IdentityCard identity={identity} showSaveBar />
      <div className="engineer-edit-username flex flex-wrap items-center justify-between gap-md rounded-md border bg-surface p-lg">
        <div><h3 className="font-semibold">{ar ? "اسم المستخدم ورابط ملفك" : "Username & profile link"}</h3><p className="mt-1 text-label text-fg-secondary">{identity.username || (ar ? "اختر اسمًا يسهل مشاركته مع العملاء." : "Choose a name that is easy to share with clients.")}</p></div>
        <ButtonLink href="/home/settings">{ar ? "تعديل اسم المستخدم" : "Edit username"}</ButtonLink>
      </div>
    </div>,
    <div key="expertise" className="space-y-lg">
      <ProfessionalProfileEditor answers={individual.professional} concreteType="engineer" otherGovernorates={serviceAreas.others.map(area => area.governorateKey)} embedded />
    </div>,
    <div key="availability" className="space-y-lg"><AvailabilityControl availability={account.availability} /><AvailabilityWindows windows={windows} /></div>,
    <PortfolioManager key="portfolio" items={cards} />,
  ]} />;
}
