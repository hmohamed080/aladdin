import { Card, StatePanel } from "@/components/ui/primitives";
import { SearchIcon, ActivityIcon, UsersIcon } from "@/components/ui/icons";
import type { PersonalHomeData } from "@/server/queries/personal-home";
import type { TranslateFn } from "@/lib/i18n/translate";
import { CompletenessCard, DetailCard, ChipList, HomeHeader, NextActions } from "./parts";

/**
 * The CONSUMER variant of the personal surface. Consumer-focused copy, the
 * caller's own setup read back, and the discovery/project areas the Pilot does
 * not serve yet marked honestly as coming soon (never as a broken feature).
 */
export function ConsumerHome({ data, t }: { data: PersonalHomeData; t: TranslateFn }) {
  const { consumer, completeness } = data;
  const name = data.displayName || t("personalHome.consumer.friend");

  const interests = consumer.interests.map((k) => t(`onboarding.consumer.interests.${k}`));
  const location = [
    consumer.governorate ? t(`onboarding.consumer.governorates.${consumer.governorate}`) : null,
    consumer.city ? t(`onboarding.consumer.cities.${consumer.city}`) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const rows = [
    {
      label: t("onboarding.consumer.step.intent"),
      value: consumer.intent ? t(`onboarding.consumer.intents.${consumer.intent}`) : null,
    },
    { label: t("onboarding.consumer.step.location"), value: location || null },
    {
      label: t("onboarding.consumer.step.budget"),
      value: consumer.budget ? t(`onboarding.consumer.budgets.${consumer.budget}`) : null,
    },
  ];

  const upcoming: { Icon: typeof ActivityIcon; key: "projects" | "discover" | "advice" }[] = [
    { Icon: ActivityIcon, key: "projects" },
    { Icon: SearchIcon, key: "discover" },
    { Icon: UsersIcon, key: "advice" },
  ];

  return (
    <div className="flex flex-col gap-xl">
      <HomeHeader
        eyebrow={t("personalHome.consumer.eyebrow")}
        title={t("personalHome.greeting", { name })}
        lead={t("personalHome.consumer.subtitle")}
      />

      <section className="grid gap-md tablet:grid-cols-2">
        <CompletenessCard completeness={completeness} t={t} />
        <Card className="flex flex-col gap-sm">
          <h2 className="text-body font-semibold text-fg">{t("personalHome.consumer.interests")}</h2>
          <ChipList items={interests} empty={t("personalHome.consumer.noInterests")} />
        </Card>
      </section>

      <section className="grid gap-md tablet:grid-cols-2">
        <DetailCard title={t("personalHome.consumer.setup")} rows={rows} t={t} />
        <NextActions
          title={t("personalHome.nextActions")}
          actions={[
            {
              href: "/onboarding/consumer",
              label: t("personalHome.consumer.action.editSetup"),
              body: t("personalHome.consumer.action.editSetupBody"),
            },
          ]}
        />
      </section>

      <section className="flex flex-col gap-md">
        <h2 className="text-body font-semibold text-fg">{t("personalHome.consumer.comingUp")}</h2>
        <div className="grid gap-md tablet:grid-cols-3">
          {upcoming.map(({ Icon, key }) => (
            <Card key={key} className="flex flex-col gap-sm">
              <span className="flex size-9 items-center justify-center rounded-md bg-surface-2 text-accent">
                <Icon size={20} />
              </span>
              <h3 className="text-body font-semibold text-fg">{t(`personalHome.consumer.${key}.title`)}</h3>
              <p className="text-label text-fg-secondary">{t(`personalHome.consumer.${key}.body`)}</p>
              <span className="mt-auto pt-sm text-label font-medium text-fg-muted">
                {t("personalHome.comingSoon")}
              </span>
            </Card>
          ))}
        </div>
      </section>

      <StatePanel title={t("personalHome.pilot.title")} body={t("personalHome.consumer.pilotBody")} />
    </div>
  );
}
