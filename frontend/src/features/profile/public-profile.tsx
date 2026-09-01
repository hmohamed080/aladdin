import { Badge, Card } from "@/components/ui/primitives";
import type { PublicProfile } from "@/server/queries/professional-profile";
import type { TranslateFn } from "@/lib/i18n/translate";
import type { Locale } from "@/lib/i18n/locales";
import { languageLabel } from "@/lib/i18n/language-label";
import { tradeLabel, specializationLabel } from "@/lib/i18n/trade-label";
import { AvailabilityBadge, AvailabilityAge } from "@/features/profile/availability-status";

/**
 * A professional's public page — everything a stranger may see, and nothing else.
 *
 * WHAT IS HERE IS EXACTLY WHAT THE PROJECTION EXPOSES: name, persona, headline,
 * summary, languages, and — since `20260831090002` — the self-declared practice:
 * specialization, core services, years of experience, service areas — since
 * `20260831090004`, the self-declared availability flag with the age of the
 * claim — and, since `20260901090001`, the canonical trades (§4.6), which are
 * now the STRUCTURED specialty signal this page leads with.
 * `profile_public_directory` returns those and no more, and this component
 * reads nothing else: not the private side of `individual_onboarding`
 * (`prof_availability`, the one-off LEAD TIME, which is a different fact from the
 * live flag; travel radius; base address; the secondary service list; every
 * consumer answer), not the verification row, not contacts.
 *
 * AVAILABILITY IS SHOWN WITH ITS AGE AND NO VERDICT. The visitor is usually
 * deciding whether to contact this person, and "available, set eight months ago"
 * is a different fact from "available, set this morning". The page gives them
 * both and stops there — no staleness threshold, no dimming, no hiding of an
 * unavailable professional (O3).
 *
 * EVERY PRACTICE FIELD IS INDEPENDENTLY OPTIONAL, and that is not defensive
 * coding — the projection LEFT JOINs the onboarding row, and every listed
 * professional in the Pilot seed has none. A profile with an empty practice is
 * the COMMON case today, so each block renders only when it has something to say
 * and the page stays coherent with all four absent.
 *
 * The absences are deliberate and worth naming, because the reference pack shows
 * all of them: no rating, no completed-job count, no points, no distance, no call
 * or message button. Each is either a later increment or unapproved, and a public
 * page that invents them would be lying to the one audience that cannot check.
 *
 * Server component: no interactivity, so a signed-out visitor is served plain
 * rendered HTML.
 */
export function PublicProfileView({
  profile,
  t,
  locale,
}: {
  profile: PublicProfile;
  t: TranslateFn;
  locale: Locale;
}) {
  const name = profile.displayName?.trim() || t("profile.publicPage.unnamed");
  const persona = profile.persona ? t(`accountType.${profile.persona}`) : null;
  /**
   * ONE SPECIALTY SIGNAL, NOT TWO. `specialization` (free text) and `tradeKeys`
   * (canonical) are the same claim in two vocabularies — "Marble and granite
   * fixing" and `marble_granite` — and printing both would show a visitor the
   * same specialty twice with nothing to say which one the platform means. The
   * canonical taxonomy is authority (§4.1), so it wins; the free text is shown
   * only where there is no trade to show instead, which is every profile that
   * has not been edited since Increment 5.
   *
   * The fallback goes through `specializationLabel` rather than the catalog
   * directly. That column holds a vocabulary key in some rows and a sentence in
   * every seeded and staging one, and a raw catalog lookup rendered the message
   * PATH for the second kind — on a public page, to a stranger who cannot tell
   * whether the profile is broken or the platform is.
   */
  const legacySpecialization =
    profile.tradeKeys.length === 0 && profile.specialization
      ? specializationLabel(t, profile.specialization)
      : null;

  const hasPractice =
    profile.tradeKeys.length > 0 ||
    Boolean(legacySpecialization) ||
    profile.yearsExperience !== null ||
    profile.services.length > 0 ||
    profile.serviceAreas.length > 0;

  return (
    <article className="flex flex-col gap-lg" data-testid="public-profile">
      <header className="flex flex-col gap-md">
        <div className="flex flex-wrap items-start gap-md">
          <span
            aria-hidden="true"
            className="grid size-16 shrink-0 place-items-center rounded-md bg-accent-solid/15 text-headline text-accent"
          >
            {initials(name)}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {persona ? (
              <p className="text-label font-semibold uppercase tracking-wide text-fg-muted">{persona}</p>
            ) : null}
            <h1 className="text-headline text-fg">{name}</h1>
            {profile.headline ? (
              <p className="max-w-prose text-body-lg text-fg-secondary">{profile.headline}</p>
            ) : null}
            {/* Directly under the name, because it is the first thing a visitor
                deciding whether to make contact needs — and paired with its age,
                which is the only thing that makes the claim weighable. */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <AvailabilityBadge available={profile.availableForWork} t={t} />
              <AvailabilityAge updatedAt={profile.availabilityUpdatedAt} locale={locale} t={t} />
            </div>
          </div>
        </div>
      </header>

      {hasPractice ? (
        <Card className="flex flex-col gap-md">
          <h2 className="text-title text-fg">{t("profile.publicPage.practice")}</h2>

          {/* THE CANONICAL TRADES LEAD. This is the structured category a visitor
              is scanning for and the field a future job match reads; it belongs
              above years of experience and well above the service list. The
              primary is stated on its own and the rest follow as chips, so the
              one distinction the model actually carries survives the rendering.

              Inactive trades never reach here — the projection filters them —
              so a retired trade disappears from every published profile at once
              rather than lingering on the old ones. */}
          {profile.tradeKeys.length > 0 ? (
            <div className="flex flex-col gap-sm" data-testid="public-trades">
              <h3 className="text-label text-fg-muted">
                {t(profile.primaryTradeKey ? "profile.trades.mainLabel" : "profile.trades.alsoLabel")}
              </h3>
              {profile.primaryTradeKey ? (
                <p className="break-words text-body-lg text-fg">
                  {tradeLabel(t, profile.primaryTradeKey)}
                </p>
              ) : null}
              {profile.tradeKeys.filter((k) => k !== profile.primaryTradeKey).length > 0 ? (
                <ul className="flex flex-wrap gap-1.5">
                  {profile.tradeKeys
                    .filter((k) => k !== profile.primaryTradeKey)
                    .map((key) => (
                      <li key={key}>
                        <Badge tone="neutral">{tradeLabel(t, key)}</Badge>
                      </li>
                    ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {/* The two single facts read as a definition list, matching the paired
              label/value rhythm the workspace uses everywhere else. */}
          {legacySpecialization || profile.yearsExperience !== null ? (
            <dl className="grid gap-md tablet:grid-cols-2">
              {legacySpecialization ? (
                <div className="flex min-w-0 flex-col gap-0.5">
                  <dt className="text-label text-fg-muted">
                    {t("onboarding.professional.identity.specializationLabel")}
                  </dt>
                  <dd className="break-words text-body-lg text-fg">{legacySpecialization}</dd>
                </div>
              ) : null}
              {profile.yearsExperience !== null ? (
                <div className="flex min-w-0 flex-col gap-0.5">
                  <dt className="text-label text-fg-muted">
                    {t("onboarding.professional.identity.yearsLabel")}
                  </dt>
                  <dd className="text-body-lg text-fg">
                    {t("personalHome.professional.years", { n: profile.yearsExperience })}
                  </dd>
                </div>
              ) : null}
            </dl>
          ) : null}

          {profile.services.length > 0 ? (
            <div className="flex flex-col gap-sm">
              <h3 className="text-label font-medium text-fg-secondary">
                {t("onboarding.professional.services.coreLabel")}
              </h3>
              <ul className="flex flex-wrap gap-1.5">
                {profile.services.map((key) => (
                  <li key={key}>
                    <Badge tone="neutral">{t(`onboarding.professional.serviceItems.${key}`)}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {profile.serviceAreas.length > 0 ? (
            <div className="flex flex-col gap-sm">
              <h3 className="text-label font-medium text-fg-secondary">
                {t("onboarding.professional.location.areasLabel")}
              </h3>
              <ul className="flex flex-wrap gap-1.5">
                {profile.serviceAreas.map((key) => (
                  <li key={key}>
                    {/* Named areas only. The reference shows a distance in km and a
                        radius filter beside these; no geo model exists, so neither
                        is rendered rather than approximated. */}
                    <Badge tone="neutral">{t(`onboarding.consumer.cities.${key}`)}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      ) : null}

      {profile.bio ? (
        <Card className="flex flex-col gap-sm">
          <h2 className="text-title text-fg">{t("profile.publicPage.about")}</h2>
          <p className="max-w-prose whitespace-pre-line text-body text-fg-secondary">{profile.bio}</p>
        </Card>
      ) : null}

      {profile.languages.length > 0 ? (
        <Card className="flex flex-col gap-sm">
          <h2 className="text-title text-fg">{t("onboarding.professional.services.languagesLabel")}</h2>
          <ul className="flex flex-wrap gap-1.5">
            {profile.languages.map((code) => (
              <li key={code}>
                <Badge tone="neutral">{languageLabel(t, code)}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <p className="text-label text-fg-muted">{t("profile.publicPage.footnote")}</p>
    </article>
  );
}

/** Up to two initials, matching the monogram the workspace uses elsewhere. */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}
