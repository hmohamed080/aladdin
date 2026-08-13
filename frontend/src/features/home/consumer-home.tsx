import { Card } from "@/components/ui/primitives";
import { ClipboardIcon, UserIcon, BuildingIcon } from "@/components/ui/icons";
import type { PersonalHomeData } from "@/server/queries/personal-home";
import type { TranslateFn } from "@/lib/i18n/translate";
import {
  AccountStrip,
  ActionCard,
  ActionGrid,
  ChipList,
  DetailCard,
  Footnote,
  HomeHeader,
  HomeSection,
  VerificationBadge,
} from "./parts";

/**
 * The CONSUMER variant of the personal surface.
 *
 * Product-first, and honest about it: every card here is a route that exists and
 * an action this account can take right now. The Pilot does not yet serve
 * discovery or project execution for consumers, so those are ONE quiet footnote —
 * not three prominent cards that look like features and behave like signs.
 *
 * What leads the page is the consumer's own brief: what they are working on, where,
 * and at what budget. That is real product context, owned by this account, and it
 * is the thing a consultation-first platform actually needs from them. Profile
 * completeness and verification sit below it as secondary account widgets.
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

  const briefRows = [
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

  // The brief is where a consumer's next missing field almost always lives, so it
  // is the emphasised action while anything is outstanding.
  const briefIncomplete = completeness.missing.some((k) =>
    (["intent", "interests", "location", "budget"] as string[]).includes(k),
  );

  return (
    <div className="flex flex-col gap-xl">
      <HomeHeader
        eyebrow={t("personalHome.consumer.eyebrow")}
        title={t("personalHome.greeting", { name })}
        name={data.displayName}
        lead={t("personalHome.consumer.subtitle")}
        meta={<VerificationBadge state={data.verification.state} t={t} />}
      />

      <HomeSection title={t("personalHome.consumer.doNext")} description={t("personalHome.consumer.doNextBody")}>
        <ActionGrid>
          <ActionCard
            href="/onboarding/consumer"
            icon={<ClipboardIcon size={20} />}
            label={t("personalHome.consumer.action.brief")}
            body={t("personalHome.consumer.action.briefBody")}
            emphasis={briefIncomplete}
          />
          <ActionCard
            href="/onboarding/profile"
            icon={<UserIcon size={20} />}
            label={t("personalHome.action.profile")}
            body={t("personalHome.action.profileBody")}
          />
          {/* A consumer may own a business without becoming a second user. */}
          <ActionCard
            href="/business/new"
            icon={<BuildingIcon size={20} />}
            label={t("personalHome.action.addBusiness")}
            body={t("personalHome.action.addBusinessBody")}
          />
        </ActionGrid>
      </HomeSection>

      <HomeSection title={t("personalHome.consumer.brief")} description={t("personalHome.consumer.briefDesc")}>
        <div className="grid gap-md desktop:grid-cols-[3fr_2fr]">
          <DetailCard title={t("personalHome.consumer.setup")} rows={briefRows} t={t} />
          <Card className="flex flex-col gap-md">
            <h3 className="text-title text-fg">{t("personalHome.consumer.interests")}</h3>
            <ChipList items={interests} empty={t("personalHome.consumer.noInterests")} />
          </Card>
        </div>
      </HomeSection>

      <HomeSection title={t("personalHome.accountSection")} description={t("personalHome.accountSectionBody")}>
        <AccountStrip
          completeness={completeness}
          verification={data.verification}
          continueHref="/onboarding/consumer"
          t={t}
        />
        <Footnote>{t("personalHome.consumer.pilotNote")}</Footnote>
      </HomeSection>
    </div>
  );
}
