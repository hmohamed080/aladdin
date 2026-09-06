import { HomeHeader, HomeSection } from "@/features/home/parts";
import { Card, Field } from "@/components/ui/primitives";
import { ButtonLink, SubmitButton } from "@/components/ui/controls";
import { LanguageSwitch, ThemeSwitch } from "@/components/layout/switchers";
import { AvailabilityControl } from "@/features/profile/availability-control";
import { signOut } from "@/server/actions/auth";
import type { PersonalHomeData } from "@/server/queries/personal-home";
import type { TranslateFn } from "@/lib/i18n/translate";

/**
 * `/home/settings` — the personal surface's Settings (D7 / Increment 14).
 *
 * A COMPOSITION component, not a new domain. Every section reuses an
 * authority that already exists and already has its own owner elsewhere:
 * profile editing is `/home/profile/edit`, availability is the same
 * `AvailabilityControl` the Profile Hub renders, locale/theme are the same
 * `setLocale`/`setTheme` cookies the account menu already writes, and
 * sign-out is the same `signOut` action. This component's only job is to
 * give a professional ONE place that groups them, the same way
 * `/b2b/settings` groups a business's.
 *
 * NOTHING INVENTED. No notification preferences (no preference model exists
 * anywhere in the repo), no password/2FA controls (Aladdin is passwordless —
 * see `signInBody` below), no privacy toggles with nothing behind them.
 *
 * REACHABLE BY BOTH VARIANTS. Locale, appearance, sign-in identity and
 * sign-out are not a professional-only need — only the Profile/Availability
 * sections, which have nothing to compose for a consumer, are gated on
 * `variant`.
 */
export function PersonalSettings({
  home,
  signInEmail,
  theme,
  t,
}: {
  home: PersonalHomeData;
  /** Already masked (or null when the auth read failed) — never the raw address. */
  signInEmail: string | null;
  theme: "light" | "dark";
  t: TranslateFn;
}) {
  const isProfessional = home.variant === "professional";

  return (
    <div className="flex flex-col gap-xl" data-testid="personal-settings">
      <HomeHeader
        eyebrow={t("personalNav.settings")}
        title={t("personalSettings.title")}
        lead={t("personalSettings.subtitle")}
      />

      {isProfessional ? (
        <HomeSection title={t("personalSettings.profile.title")}>
          <Card className="flex flex-col gap-sm">
            <div className="flex flex-wrap items-center justify-between gap-sm">
              <div className="min-w-0">
                <p className="truncate text-body-lg font-medium text-fg">{home.displayName}</p>
                <p className="text-label text-fg-muted">{t(`accountType.${home.accountType}`)}</p>
              </div>
              <ButtonLink href="/home/profile/edit" variant="outline" size="sm" className="shrink-0">
                {t("personalSettings.profile.edit")}
              </ButtonLink>
            </div>
            <p className="border-t pt-sm text-label text-fg-muted">{t("personalSettings.profile.note")}</p>
          </Card>
        </HomeSection>
      ) : null}

      {isProfessional ? (
        <HomeSection title={t("personalSettings.availability.title")}>
          <AvailabilityControl availability={home.availability} />
        </HomeSection>
      ) : null}

      <HomeSection title={t("personalSettings.preferences.title")}>
        <Card className="flex flex-col gap-md">
          <div className="flex flex-wrap items-center justify-between gap-sm">
            <div className="min-w-0">
              <p className="text-body-lg text-fg">{t("nav.language")}</p>
              <p className="text-label text-fg-muted">{t("personalSettings.preferences.languageHint")}</p>
            </div>
            <LanguageSwitch />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-sm border-t pt-md">
            <div className="min-w-0">
              <p className="text-body-lg text-fg">{t("nav.theme")}</p>
              <p className="text-label text-fg-muted">{t("personalSettings.preferences.themeHint")}</p>
            </div>
            <ThemeSwitch current={theme} />
          </div>
        </Card>
      </HomeSection>

      <HomeSection title={t("personalSettings.account.title")}>
        <Card className="flex flex-col gap-sm">
          {signInEmail ? (
            <Field label={t("personalSettings.account.signInContact")}>
              <span dir="ltr">{signInEmail}</span>
            </Field>
          ) : null}
          {/* No password row, no "change password", no 2FA toggle: Aladdin is
              passwordless, and offering controls for a credential that does
              not exist would misstate the security model. */}
          <p className="text-body text-fg-secondary">{t("personalSettings.account.signInBody")}</p>
          {isProfessional ? (
            <p className="text-label text-fg-muted">{t("personalSettings.account.signInContactHint")}</p>
          ) : null}
          <form action={signOut} className="border-t pt-sm">
            <SubmitButton variant="outline" pendingLabel={t("common.saving")}>
              {t("personalSettings.account.signOut")}
            </SubmitButton>
          </form>
        </Card>
      </HomeSection>
    </div>
  );
}
