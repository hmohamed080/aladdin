import Image from "next/image";
import type { ReactNode } from "react";
import Link from "next/link";
import { Brand } from "@/components/layout/brand";
import type { TranslateFn } from "@/lib/i18n/translate";
import { CRAFTSMAN_AUTH_ASSETS } from "./assets";
import { BellIcon, BriefcaseIcon, ChartIcon, HardHatIcon, UsersIcon } from "./icons";

type Variant = "signUp" | "signIn";

const FEATURES: Record<Variant, { icon: ReactNode; title: string; body: string }[]> = {
  signUp: [
    { icon: <BriefcaseIcon />, title: "realJobsTitle", body: "realJobsBody" },
    { icon: <UsersIcon />, title: "networkTitle", body: "networkBody" },
    { icon: <ChartIcon />, title: "skillsTitle", body: "skillsBody" },
  ],
  signIn: [
    { icon: <BriefcaseIcon />, title: "followJobsTitle", body: "followJobsBody" },
    { icon: <BellIcon />, title: "updatesTitle", body: "updatesBody" },
    { icon: <UsersIcon />, title: "connectTitle", body: "connectBody" },
  ],
};

/**
 * Full-screen shell for the TEMPORARY craftsman auth pages — no navbar, no
 * footer. Three compositions, per the approved designs:
 *
 *   * desktop (≥1024): worksite background, headline + three benefits at the
 *     inline END (left in RTL), the craftsman photo between them and the white
 *     card, navy / lapis / lumen diagonal bands behind the card;
 *   * tablet (768–1023): the same background and bands with the card centred;
 *     the headline and benefits step aside;
 *   * mobile (<768): a clean single column — illustration, heading, form — with
 *     none of the desktop decoration (not a shrunken desktop).
 *
 * Every missing approved image renders a token-only placeholder from
 * `assets.ts`, so a real asset is a one-line swap.
 */
export function CraftsmanAuthShell({
  variant,
  t,
  title,
  subtitle,
  footer,
  children,
}: {
  variant: Variant;
  t: TranslateFn;
  title: string;
  subtitle: string;
  footer: { prompt: string; linkLabel: string; href: string };
  children: ReactNode;
}) {
  const hero = variant === "signUp"
    ? { lead: "signUpTitleLead", accent: "signUpTitleAccent", body: "signUpBody" }
    : { lead: "signInTitleLead", accent: "signInTitleAccent", body: "signInBody" };
  const { worksiteBackground, craftsmanPhoto, craftsmanIllustration } = CRAFTSMAN_AUTH_ASSETS;

  return (
    <div dir="rtl" lang="ar" className="relative min-h-dvh overflow-x-hidden bg-canvas text-fg">
      {/* Background slot + decorative bands — tablet and up only. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 hidden overflow-hidden tablet:block">
        {worksiteBackground ? (
          <Image src={worksiteBackground.src} alt="" fill priority sizes="100vw" className="object-cover" />
        ) : (
          <div data-asset-slot="worksite-background" className="absolute inset-0 bg-gradient-to-b from-brand-lapis/15 via-canvas to-surface-2" />
        )}
        <div className="absolute -top-24 start-1/3 h-96 w-24 rotate-45 bg-brand-lapis/80" />
        <div className="absolute -top-24 start-1/3 ms-28 h-96 w-12 rotate-45 bg-shell/90" />
        <div className="absolute -bottom-24 end-1/2 h-96 w-24 rotate-45 bg-brand-lumen/90" />
        <div className="absolute -bottom-24 end-1/2 me-28 h-80 w-12 rotate-45 bg-brand-lapis/70" />
      </div>

      <main className="relative mx-auto grid min-h-dvh w-full max-w-6xl items-center gap-xl px-md py-lg tablet:px-lg tablet:py-xl desktop:grid-cols-2">
        {/* The card — first in DOM order (the form is the page's purpose), at the inline start (right in RTL). */}
        <section
          aria-labelledby="craftsman-auth-title"
          className="mx-auto flex w-full max-w-md flex-col gap-lg tablet:rounded-lg tablet:border tablet:bg-surface tablet:p-xl tablet:shadow-lg desktop:mx-0 desktop:justify-self-start"
        >
          {/* Mobile header: brand + illustration slot. */}
          <div className="flex flex-col items-center gap-md tablet:hidden">
            <Brand name={t("common.appName")} size="sm" />
            {craftsmanIllustration ? (
              <Image
                src={craftsmanIllustration.src}
                alt=""
                width={craftsmanIllustration.width}
                height={craftsmanIllustration.height}
                className="h-40 w-auto"
                priority
              />
            ) : (
              <div
                data-asset-slot="craftsman-illustration"
                aria-hidden="true"
                className="flex h-32 w-32 items-center justify-center rounded-pill bg-brand-lapis/10 text-brand-lapis dark:text-brand-lapis-bright"
              >
                <HardHatIcon width={56} height={56} />
              </div>
            )}
          </div>

          <header className="flex flex-col gap-1.5 text-center">
            <h1 id="craftsman-auth-title" className="font-display-ar text-headline text-fg">
              {title}
            </h1>
            <p className="text-body text-fg-secondary">{subtitle}</p>
          </header>

          {children}

          <p className="text-center text-body text-fg-secondary">
            {footer.prompt}{" "}
            <Link href={footer.href} className="font-medium text-brand-lapis underline hover:opacity-80 dark:text-brand-lapis-bright">
              {footer.linkLabel}
            </Link>
          </p>
        </section>

        {/* Hero — desktop only, at the inline end (left in RTL). */}
        <aside className="relative hidden h-full min-h-96 grid-cols-5 items-center gap-lg desktop:grid">
          <div className="relative col-span-2 flex h-full items-end justify-center">
            {craftsmanPhoto ? (
              <Image
                src={craftsmanPhoto.src}
                alt=""
                width={craftsmanPhoto.width}
                height={craftsmanPhoto.height}
                className="h-auto max-h-full w-full object-contain object-bottom"
                priority
              />
            ) : (
              <div
                data-asset-slot="craftsman-photo"
                aria-hidden="true"
                className="flex aspect-[3/4] w-full max-w-xs items-center justify-center rounded-lg border border-dashed border-strong bg-surface/60 text-fg-muted"
              >
                <div className="flex flex-col items-center gap-sm">
                  <HardHatIcon width={64} height={64} />
                  <span className="text-label">{t("temporaryCraftsman.hero.imageSlot")}</span>
                </div>
              </div>
            )}
          </div>

          <div className="col-span-3 flex flex-col gap-lg">
            <Brand name={t("common.appName")} size="md" />
            <div className="flex flex-col gap-md">
              <h2 className="font-display-ar text-display-ar">
                <span className="block text-shell">{t(`temporaryCraftsman.hero.${hero.lead}`)}</span>
                <span className="block text-brand-lapis dark:text-brand-lapis-bright">{t(`temporaryCraftsman.hero.${hero.accent}`)}</span>
              </h2>
              <p className="text-body-lg text-fg-secondary">{t(`temporaryCraftsman.hero.${hero.body}`)}</p>
              <span aria-hidden="true" className="h-1 w-12 rounded-pill bg-brand-lumen" />
            </div>
            <ul className="flex flex-col gap-md">
              {FEATURES[variant].map((feature) => (
                <li key={feature.title} className="flex items-center gap-md">
                  <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-surface text-shell shadow-sm">
                    {feature.icon}
                  </span>
                  <span className="flex flex-col">
                    <span className="text-body font-semibold text-brand-lapis dark:text-brand-lapis-bright">
                      {t(`temporaryCraftsman.features.${feature.title}`)}
                    </span>
                    <span className="text-label text-fg-secondary">{t(`temporaryCraftsman.features.${feature.body}`)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </main>
    </div>
  );
}
