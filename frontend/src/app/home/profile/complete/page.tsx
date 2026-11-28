import { redirect } from "next/navigation";
import { requireEngineer } from "@/server/queries/engineer";
import { loadMyIdentity, loadMyProfileCompletion } from "@/server/queries/profile-identity";
import { getIndividualOnboardingData } from "@/server/queries/onboarding";
import { loadMyServiceAreas } from "@/server/queries/service-areas";
import { loadPortfolioCards } from "@/server/queries/portfolio-cards";
import { IdentityCard } from "@/features/settings/identity-card";
import { ProfessionalProfileEditor } from "@/features/profile/professional-profile-editor";
import { EngineerAvailability } from "@/features/engineer/availability";
import { loadUnavailablePeriods } from "@/server/actions/unavailable-periods";
import { PortfolioManager } from "@/features/portfolio/portfolio-manager";
import { EngineerProfileCompletion } from "@/features/engineer/profile-completion";
import { EngineerProfileHero } from "@/features/engineer/profile-hero";

export const dynamic = "force-dynamic";

export default async function CompleteEngineerProfilePage({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  const step = Number((await searchParams).step ?? 0);
  const initialStep = Number.isInteger(step) && step >= 0 && step < 4 ? step : 0;
  const { account } = await requireEngineer();
  const [identity, completion, individual, windows, portfolio, serviceAreas] = await Promise.all([
    loadMyIdentity(), loadMyProfileCompletion(), getIndividualOnboardingData(),
    loadUnavailablePeriods(), loadPortfolioCards(), loadMyServiceAreas(),
  ]);
  if (!identity || !individual) redirect("/auth/sign-in");

  const cards = portfolio;
  return <EngineerProfileCompletion initialStep={initialStep} name={identity.displayName} avatar={identity.avatarUrl} completion={completion} panels={[
    <div key="identity" className="space-y-md">
      <IdentityCard identity={identity} showSaveBar header={<EngineerProfileHero identity={identity} />} />

    </div>,
    <div key="expertise" className="space-y-lg">
      <ProfessionalProfileEditor answers={individual.professional} concreteType="engineer" otherGovernorates={serviceAreas.others.map(area => area.governorateKey)} embedded />
    </div>,
    <EngineerAvailability key="availability" availability={account.availability} periods={windows} />,
    <PortfolioManager key="portfolio" items={cards} embedded />,
  ]} />;
}
