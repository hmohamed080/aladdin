import type { Locale } from "@/lib/i18n/locales";
import { pick, TRADE_OPTIONS, type PreviewOpportunity } from "./preview-data";
import type { JobCardVM, TradeOption } from "./view-model";

/**
 * THE PREVIEW SIDE OF THE DATA-ADAPTER BOUNDARY.
 *
 * Fixture -> `JobCardVM`. Only the preview wrapper imports this file (and so only
 * the preview wrapper reaches `preview-data.ts`); production builds the same shape
 * from real rows in `features/home/installer-jobs-data.ts`.
 */
export function toPreviewCardVM(o: PreviewOpportunity, locale: Locale): JobCardVM {
  return {
    id: o.id,
    title: pick(locale, o.title),
    org: pick(locale, o.company),
    place: pick(locale, o.location),
    tradeKey: o.trade,
    tradeLabel: pick(locale, o.tradeLabel),
    durationDays: o.durationDays,
    amount: o.budget,
    postedLabel: pick(locale, o.postedLabel),
    image: o.image,
    hasApplied: false,
    href: "#",
    distanceKm: o.distanceKm,
    matchPercent: o.matchPercent,
  };
}

export function previewTradeOptions(locale: Locale): TradeOption[] {
  return TRADE_OPTIONS.map((option) => ({ key: option.key, label: pick(locale, option.label) }));
}
