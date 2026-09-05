import { ButtonLink } from "@/components/ui/controls";
import { StorefrontAddIcon } from "./storefront-add-icon";
import type { TranslateFn } from "@/lib/i18n/translate";

/**
 * The Add Showroom / Referral hero — a real visual hero, not an information
 * Card wearing a small glyph (revisit §3).
 *
 * ONE supporting sentence, not a three-item checklist: completed-work
 * relationships are automatic, and a new showroom can also be referred. The
 * +100 Points rule is a small secondary note under it, not a peer of equal
 * weight — reusing `network.rail.howBody`'s copy so the one real fact about
 * how Points are earned exists in exactly one place in this file tree.
 *
 * Deliberately UNWRAPPED (no own `Card`/border/shadow): the revisit brief
 * (§4) wants the hero and the search bar composed as one bounded panel, so
 * the page itself owns the single outer surface and this renders only its
 * content.
 */
export function ReferralHero({ t }: { t: TranslateFn }) {
  return (
    <div className="flex flex-wrap items-center gap-lg" data-testid="referral-hero">
      <StorefrontAddIcon className="h-20 w-20 tablet:h-24 tablet:w-24" />
      <div className="min-w-0 flex-1">
        <h2 className="text-title text-fg">{t("network.hero.title")}</h2>
        <p className="mt-1 max-w-prose text-body text-fg-secondary">{t("network.hero.body")}</p>
        <p className="mt-1 text-label text-fg-muted">{t("network.rail.howBody")}</p>
        <ButtonLink href="/home/network/refer" variant="accent" className="mt-sm">
          {t("network.hero.cta")}
        </ButtonLink>
      </div>
    </div>
  );
}
