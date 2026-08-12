import { Badge, Card } from "@/components/ui/primitives";
import type { PersonalHomeData } from "@/server/queries/personal-home";
import type { CompletenessItemKey } from "@/lib/profile/completeness";
import type { TranslateFn } from "@/lib/i18n/translate";
import {
  ChipList,
  CompletenessCard,
  DetailCard,
  HomeHeader,
  NextActions,
  VerificationCard,
} from "./parts";

/**
 * The PROFESSIONAL variant of the personal surface, for an Engineer, Interior
 * Designer, Installer/Technician, Contractor, or a Salesperson with NO
 * organization membership (a salesperson who joins an organization belongs in the
 * /b2b workspace instead, and the landing resolver sends them there).
 *
 * It carries no consumer copy: the persona, the professional profile, its
 * completeness, the independent verification state, services, and service
 * location — plus next actions the account can take right now, none of which wait
 * on a platform decision.
 */

/** Which onboarding step fixes each outstanding profile item. */
const STEP_FOR_ITEM: Record<CompletenessItemKey, string> = {
  displayName: "/onboarding/profile",
  phone: "/onboarding/contact",
  intent: "/onboarding/consumer",
  interests: "/onboarding/consumer",
  budget: "/onboarding/consumer",
  professionalType: "/onboarding/professional",
  headline: "/onboarding/professional",
  experience: "/onboarding/professional",
  specialization: "/onboarding/professional",
  services: "/onboarding/professional",
  bio: "/onboarding/professional",
  languages: "/onboarding/professional",
  availability: "/onboarding/professional",
  serviceArea: "/onboarding/professional",
  location: "/onboarding/professional",
  travelRadius: "/onboarding/professional",
};

export function ProfessionalHome({ data, t }: { data: PersonalHomeData; t: TranslateFn }) {
  const { professional: p, completeness, verification } = data;
  const name = data.displayName || t("personalHome.professional.friend");
  const persona = t(`accountType.${data.accountType}`);

  const location = [
    p.governorate ? t(`onboarding.consumer.governorates.${p.governorate}`) : null,
    p.city ? t(`onboarding.consumer.cities.${p.city}`) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const profileRows = [
    {
      label: t("onboarding.professional.identity.specializationLabel"),
      value: p.specialization ? t(`onboarding.professional.specializations.${p.specialization}`) : null,
    },
    {
      label: t("onboarding.professional.identity.yearsLabel"),
      value: p.yearsExperience === null ? null : t("personalHome.professional.years", { n: p.yearsExperience }),
    },
    {
      label: t("onboarding.professional.services.availabilityLabel"),
      value: p.availability ? t(`onboarding.professional.availabilities.${p.availability}`) : null,
    },
    {
      label: t("onboarding.professional.services.languagesLabel"),
      value: p.languages.map((k) => t(`onboarding.professional.languages.${k}`)).join(" · ") || null,
    },
    { label: t("onboarding.professional.identity.bioLabel"), value: p.bio },
  ];

  const locationRows = [
    { label: t("personalHome.professional.baseLocation"), value: location || null },
    {
      label: t("onboarding.professional.location.areasLabel"),
      value: p.serviceAreas.map((k) => t(`onboarding.consumer.cities.${k}`)).join(" · ") || null,
    },
    {
      label: t("personalHome.professional.travel"),
      value: p.maxTravelKm === null ? null : t("personalHome.professional.travelValue", { n: p.maxTravelKm }),
    },
    {
      label: t("onboarding.professional.location.remoteLabel"),
      value: t(p.offersRemote ? "personalHome.yes" : "personalHome.no"),
    },
  ];

  // Only real, currently-supported actions. The first entry points at whichever
  // step actually holds the next missing field.
  const actions = [
    ...(completeness.missing.length > 0
      ? [
          {
            href: STEP_FOR_ITEM[completeness.missing[0]!],
            label: t("personalHome.professional.action.complete"),
            body: t("personalHome.professional.action.completeBody", {
              item: t(`personalHome.item.${completeness.missing[0]!}`),
            }),
          },
        ]
      : []),
    {
      href: "/onboarding/professional",
      label: t("personalHome.professional.action.editProfile"),
      body: t("personalHome.professional.action.editProfileBody"),
    },
    {
      href: "/onboarding/professional/review",
      label: t("personalHome.professional.action.review"),
      body: t("personalHome.professional.action.reviewBody"),
    },
  ];

  return (
    <div className="flex flex-col gap-xl">
      <HomeHeader
        eyebrow={persona}
        title={t("personalHome.greeting", { name })}
        lead={p.headline ?? t("personalHome.professional.noHeadline")}
        aside={<Badge tone="accent">{persona}</Badge>}
      />

      <section className="grid gap-md tablet:grid-cols-2">
        <CompletenessCard completeness={completeness} t={t} />
        <VerificationCard state={verification.state} reason={verification.reason} t={t} />
      </section>

      <section className="grid gap-md tablet:grid-cols-2">
        <DetailCard title={t("personalHome.professional.profile")} rows={profileRows} t={t} />
        <div className="flex flex-col gap-md">
          <Card className="flex flex-col gap-sm">
            <h2 className="text-body font-semibold text-fg">
              {t("onboarding.professional.services.coreLabel")}
            </h2>
            <ChipList
              items={p.services.map((k) => t(`onboarding.professional.serviceItems.${k}`))}
              empty={t("personalHome.professional.noServices")}
            />
            {p.additionalServices.length > 0 ? (
              <>
                <h3 className="pt-sm text-label font-medium text-fg-muted">
                  {t("onboarding.professional.services.additionalLabel")}
                </h3>
                <ChipList
                  items={p.additionalServices.map((k) => t(`onboarding.professional.serviceItems.${k}`))}
                  empty={t("personalHome.professional.noServices")}
                />
              </>
            ) : null}
          </Card>
          <NextActions title={t("personalHome.nextActions")} actions={actions} />
        </div>
      </section>

      <DetailCard title={t("personalHome.professional.serviceLocation")} rows={locationRows} t={t} />
    </div>
  );
}
