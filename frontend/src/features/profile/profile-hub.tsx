import Link from "next/link";
import { Card, StatePanel } from "@/components/ui/primitives";
import { Button } from "@/components/ui/controls";
import { UserIcon, GlobeIcon, TargetIcon, MapPinIcon } from "@/components/ui/icons";
import type { PersonalHomeData } from "@/server/queries/personal-home";
import type { ProfilePublication } from "@/server/queries/professional-profile";
import type { TranslateFn } from "@/lib/i18n/translate";
import { languageLabel } from "@/lib/i18n/language-label";
import { ChipList, DetailCard, HomeHeader, HomeSection, VerificationBadge } from "@/features/home/parts";

/**
 * The profile hub.
 *
 * COMPOSITION follows the reference account overview — an identity header, then a
 * grid of grouped cards, then a quiet strip at the end. CONTENT does not: the
 * reference's stat rail (ratings, completed jobs, points), its learning and
 * rewards cards, and its network card are each either a later increment or an
 * unapproved element, and a card that leads nowhere is worse than an absent one.
 * So the grid holds what the model actually knows about this professional.
 *
 * THE ONE THING THIS PAGE ADDS to what `/home` already shows is the PUBLICATION
 * boundary — what of this profile is public, and what is not. It is stated as a
 * fact with no control beside it, because `public_profile_status` is written only
 * by the approved upgrade workflow: rendering a toggle a person cannot operate
 * would be a lie about who decides.
 */
export function ProfileHub({
  data,
  publication,
  t,
}: {
  data: PersonalHomeData;
  publication: ProfilePublication;
  t: TranslateFn;
}) {
  const { professional: p, verification } = data;
  const persona = t(`accountType.${data.accountType}`);
  const name = data.displayName || t("personalHome.professional.friend");

  const location = [
    p.governorate ? t(`onboarding.consumer.governorates.${p.governorate}`) : null,
    p.city ? t(`onboarding.consumer.cities.${p.city}`) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const practiceRows = [
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
    <div className="flex flex-col gap-xl" data-testid="profile-hub">
      <HomeHeader
        eyebrow={persona}
        title={name}
        name={data.displayName}
        lead={p.headline ?? t("personalHome.professional.noHeadline")}
        meta={<VerificationBadge state={verification.state} t={t} />}
      />

      <HomeSection
        title={t("profile.hub.title")}
        description={t("profile.hub.body")}
        action={
          <Link href="/home/profile/edit">
            <Button type="button" variant="primary">
              {t("profile.hub.edit")}
            </Button>
          </Link>
        }
      >
        <div className="grid gap-md desktop:grid-cols-2">
          <DetailCard title={t("personalHome.professional.profile")} rows={practiceRows} t={t} />
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

      <HomeSection title={t("profile.public.title")} description={t("profile.public.body")}>
        <PublicProfileCard publication={publication} t={t} />
      </HomeSection>
    </div>
  );
}

/**
 * What the public can see, and whether they can see it yet.
 *
 * Two states, and neither is an error. LISTED offers the real link, so a
 * professional can read their own public page exactly as a stranger would.
 * NOT LISTED explains that listing follows verification — the same separation the
 * dashboard draws between trust and access — and offers no control, because there
 * is none to offer.
 */
function PublicProfileCard({
  publication,
  t,
}: {
  publication: ProfilePublication;
  t: TranslateFn;
}) {
  if (!publication.listed || !publication.profileId) {
    return (
      <StatePanel
        icon={<GlobeIcon size={22} />}
        title={t("profile.public.hiddenTitle")}
        body={t("profile.public.hiddenBody")}
      />
    );
  }

  return (
    <Card className="flex flex-wrap items-center justify-between gap-md">
      <div className="flex min-w-0 items-center gap-3">
        <span aria-hidden="true" className="shrink-0 text-fg-secondary">
          <MapPinIcon size={20} />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="font-medium text-fg">{t("profile.public.listedTitle")}</p>
          <p className="text-label text-fg-secondary">{t("profile.public.listedBody")}</p>
        </div>
      </div>
      <Link href={`/p/${publication.profileId}`} className="shrink-0">
        <Button type="button" variant="outline">
          <span className="flex items-center gap-2">
            <UserIcon size={16} />
            {t("profile.public.view")}
          </span>
        </Button>
      </Link>
    </Card>
  );
}
