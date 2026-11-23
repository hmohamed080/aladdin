import type { Locale } from "../marketplace-types";
import { fmtEgp, fmtNum } from "./live-copy";
import { deliveryCopy } from "./live-delivery-copy";
import type { BuyerPlace, CardDelivery, DeliveryTerms } from "./public-contract";

/**
 * Presentation rules of the delivery estimate. The numbers come from the database (`marketplace_public_delivery`,
 * `marketplace_public_browse`); nothing here computes a promise, it only words one.
 */

const KEY = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** The buyer's place from URL parameters; both keys are validated, an area needs a governorate. */
export function placeFromParams(gov: string | undefined, area: string | undefined): BuyerPlace | null {
  if (!gov || !KEY.test(gov)) return null;
  return { gov, area: area && KEY.test(area) ? area : "" };
}

/** "3–4 days" / "3 days" / "tomorrow"-style wording for a day count range (counted from today). */
export function daysRangeText(min: number, max: number, locale: Locale): string {
  const t = deliveryCopy[locale];
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  if (hi === 0) return t.today;
  if (lo === hi) return t.days(lo, fmtNum(lo, locale));
  return t.daysRange(fmtNum(lo, locale), hi, fmtNum(hi, locale));
}

/** The one-line estimate of a card or of the product page header, or null when there is nothing honest to say. */
export function estimateText(d: Pick<CardDelivery, "min_days" | "max_days" | "status" | "configured" | "pickup_available"> | null | undefined, locale: Locale): string | null {
  if (!d || d.status === "not_available") return null;
  if (d.configured && d.min_days !== null && d.max_days !== null) {
    return d.max_days === 0 ? deliveryCopy[locale].arrivesToday : deliveryCopy[locale].arrivesIn(daysRangeText(d.min_days, d.max_days, locale));
  }
  return null;
}

/** "Sun, 24 Nov" in the shown language, from a YYYY-MM-DD calendar day (no time zone shift). */
export function dateText(day: string, locale: Locale): string {
  const d = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return day;
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(d);
}

/** "Sun 24 Nov" or "Sun 24 Nov – Mon 25 Nov". */
export function dateRangeText(earliest: string, latest: string | null, locale: Locale): string {
  const a = dateText(earliest, locale);
  if (!latest || latest === earliest) return a;
  return `${a} – ${dateText(latest, locale)}`;
}

/** The delivery fee line for the chosen place: «Free», the fee, or null while no place is chosen. */
export function feeText(terms: DeliveryTerms, locale: Locale): string | null {
  const t = deliveryCopy[locale];
  if (terms.free_shipping && terms.status === "available") return t.free;
  if (terms.status === "available" && terms.fee_egp !== null) return fmtEgp(Number(terms.fee_egp), locale);
  return null;
}

/** "Free shipping" reason sentence for the product page. */
export function freeReasonText(terms: DeliveryTerms, locale: Locale): string | null {
  const t = deliveryCopy[locale];
  if (!terms.free_shipping) {
    return terms.free_min_egp !== null ? t.freeOver(fmtEgp(Number(terms.free_min_egp), locale)) : null;
  }
  if (terms.free_reason === "threshold" && terms.free_min_egp !== null) return t.freeOver(fmtEgp(Number(terms.free_min_egp), locale));
  return t.freeShipping;
}
