import { Card } from "@/components/ui/primitives";
import { BadgeCheckIcon, BuildingIcon, TargetIcon, UserIcon } from "@/components/ui/icons";
import type { PersonalHomeData } from "@/server/queries/personal-home";
import type { CompletenessItemKey } from "@/lib/profile/completeness";
import type { TranslateFn } from "@/lib/i18n/translate";
import { languageLabel } from "@/lib/i18n/language-label";
import {
  AccountStrip,
  ActionCard,
  ActionGrid,
  ChipList,
  DetailCard,
  HomeHeader,
  HomeSection,
  VerificationBadge,
} from "./parts";
import { SalesAffiliationPanel } from "./sales-affiliation";
import { AvailabilityBadge } from "@/features/profile/availability-status";

/**
 * The PROFESSIONAL variant of the personal surface — ONE structure for every
 * individual professional persona (Engineer, Interior Designer, Installer /
 * Technician, Contractor, Salesperson), with persona-aware content rather than
 * five unrelated page architectures.
 *
 * The persona changes the labels, the specialisation taxonomy and — for a
 * Salesperson — adds the showroom-affiliation panel. It does not change the shape
 * of the page, because the thing being presented is the same in every case: a
 * professional identity, what it offers, where it works, and the actions its owner
 * can take right now.
 *
 * What this page is NOT is a profile-review screen. Pilot UAT reported the previous
 * version as "waiting to be approved", because completeness and verification led
 * the page. Here the professional profile and its actions lead; the two account
 * signals are a compact strip at the end, separate from each other, and the copy
 * says plainly that verification affects trust and discoverability, not access.
 */

/**
 * Where each outstanding item is fixed.
 *
 * Every professional field now points at the EDITOR rather than back into the
 * onboarding wizard. Re-entering a six-step flow to fill in one missing field was
 * the only route available before `/home/profile/edit` existed, and it is the
 * reason Pilot UAT read this page as a review queue. The three items the editor
 * does not own — display name, phone, and the consumer answers — still resolve to
 * the steps that do own them.
 */
const STEP_FOR_ITEM: Record<CompletenessItemKey, string> = {
  displayName: "/onboarding/profile",
  phone: "/onboarding/contact",
  intent: "/onboarding/consumer",
  interests: "/onboarding/consumer",
  budget: "/onboarding/consumer",
  professionalType: "/home/profile/edit",
  headline: "/home/profile/edit",
  experience: "/home/profile/edit",
  specialization: "/home/profile/edit",
  services: "/home/profile/edit",
  bio: "/home/profile/edit",
  languages: "/home/profile/edit",
  availability: "/home/profile/edit",
  serviceArea: "/home/profile/edit",
  location: "/home/profile/edit",
  travelRadius: "/home/profile/edit",
};

export function ProfessionalHome({ data, t }: { data: PersonalHomeData; t: TranslateFn }) {
  const { professional: p, completeness, verification } = data;
  const name = data.displayName || t("personalHome.professional.friend");
  const persona = t(`accountType.${data.accountType}`);
  const nextStep = completeness.missing[0] ? STEP_FOR_ITEM[completeness.missing[0]] : "/home/profile/edit";

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
      /* DELIBERATELY NOT "Availability" — the same disambiguation `profile-hub`
         already carries, and this is the page that actually needed it. This row
         is the one-off LEAD TIME picked during onboarding (within a week /
         within a month / flexible), and Increment 4 put the LIVE availability
         badge in this page's own header. Two things called "Availability" a few
         hundred pixels apart, one of them changeable and one of them not, makes
         both unreadable. The onboarding label is left alone: in that flow, in
         context, there is nothing for it to collide with. */
      label: t("profile.hub.leadTime"),
      value: p.availability ? t(`onboarding.professional.availabilities.${p.availability}`) : null,
    },
    {
      label: t("onboarding.professional.services.languagesLabel"),
      /* STORED values, so they go through the normalizer. `profiles.languages`
         holds two conventions — `arabic`/`english` written by the onboarding
         flow, and ISO `ar`/`en` in every seeded row — and the onboarding catalog
         only has keys for the first. This line used to print
         `onboarding.professional.languages.ar` verbatim to the account's owner.
         The two remaining catalog call sites (the onboarding flow and the
         profile editor) are CORRECT as written: they label selectable choice
         chips whose keys come from the catalog itself and always resolve. */
      value: p.languages.map((k) => languageLabel(t, k)).join(" · ") || null,
    },
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

  return (
    <div className="flex flex-col gap-xl">
      <HomeHeader
        eyebrow={persona}
        title={t("personalHome.greeting", { name })}
        name={data.displayName}
        lead={p.headline ?? t("personalHome.professional.noHeadline")}
        meta={
          <>
            <VerificationBadge state={verification.state} t={t} />
            {/* The STATE only — the control and the "last updated" line live on
                the profile hub. The dashboard answers "where do I stand"; two
                copies of the same control would raise the question of which one
                is authoritative, and the age matters at the moment you decide
                whether to change it, which happens there. */}
            <AvailabilityBadge available={data.availability.available} t={t} />
          </>
        }
      />

      {/* A salesperson's Sales setup is the first thing that matters to them, so it
          leads — as a connection to make, never as an account problem. */}
      {data.sales ? <SalesAffiliationPanel sales={data.sales} t={t} /> : null}

      <HomeSection
        title={t("personalHome.professional.doNext")}
        description={t("personalHome.professional.doNextBody")}
      >
        <ActionGrid>
          <ActionCard
            href="/home/profile"
            icon={<UserIcon size={20} />}
            label={t("personalHome.professional.action.editProfile")}
            body={t("personalHome.professional.action.editProfileBody")}
            emphasis={completeness.missing.length > 0}
          />
          <ActionCard
            href="/onboarding/professional/review"
            icon={<BadgeCheckIcon size={20} />}
            label={t("personalHome.professional.action.review")}
            body={t("personalHome.professional.action.reviewBody")}
          />
          <ActionCard
            href="/business/new"
            icon={<BuildingIcon size={20} />}
            label={t("personalHome.action.addBusiness")}
            body={t("personalHome.action.addBusinessBody")}
          />
        </ActionGrid>
      </HomeSection>

      <HomeSection
        title={t("personalHome.professional.practice")}
        description={t("personalHome.professional.practiceDesc")}
      >
        <div className="grid gap-md desktop:grid-cols-2">
          <DetailCard title={t("personalHome.professional.profile")} rows={profileRows} t={t} />
          <DetailCard title={t("personalHome.professional.serviceLocation")} rows={locationRows} t={t} />
        </div>
        <Card className="flex flex-col gap-md">
          <div className="flex items-center gap-2">
            <TargetIcon size={18} className="shrink-0 text-fg-secondary" />
            <h3 className="text-title text-fg">{t("onboarding.professional.services.coreLabel")}</h3>
          </div>
          <ChipList
            items={p.services.map((k) => t(`onboarding.professional.serviceItems.${k}`))}
            empty={t("personalHome.professional.noServices")}
          />
          {p.additionalServices.length > 0 ? (
            <>
              <h4 className="text-label font-medium text-fg-muted">
                {t("onboarding.professional.services.additionalLabel")}
              </h4>
              <ChipList
                items={p.additionalServices.map((k) => t(`onboarding.professional.serviceItems.${k}`))}
                empty={t("personalHome.professional.noServices")}
              />
            </>
          ) : null}
          {p.bio ? <p className="max-w-prose text-body text-fg-secondary">{p.bio}</p> : null}
        </Card>
      </HomeSection>

      <HomeSection title={t("personalHome.accountSection")} description={t("personalHome.accountSectionBody")}>
        <AccountStrip
          completeness={completeness}
          verification={verification}
          continueHref={nextStep}
          t={t}
        />
      </HomeSection>
    </div>
  );
}
