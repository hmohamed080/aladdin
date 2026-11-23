"use client";

import { usePathname, useRouter } from "next/navigation";
import { TruckIcon } from "@/components/ui/icons";
import type { Locale } from "../marketplace-types";
import { dateRangeText, dateText, daysRangeText, feeText, freeReasonText } from "./delivery-model";
import { fmtEgp } from "./live-copy";
import { deliveryCopy } from "./live-delivery-copy";
import { PlacePicker } from "./place-picker";
import type { BuyerPlace, DeliveryTerms } from "./public-contract";
import styles from "../marketplace-v2.module.css";

/** Terms as the buyer sees them for the chosen variant: a unit that reaches the free-shipping threshold ships free. */
export function termsForPrice(terms: DeliveryTerms, unitPrice: number | null): DeliveryTerms {
  if (terms.free_shipping || terms.free_min_egp === null || unitPrice === null || unitPrice < Number(terms.free_min_egp)) return terms;
  return { ...terms, free_shipping: true, free_reason: "threshold" };
}

/**
 * Delivery details of the product page (browse-only: it informs, it does not sell). The buyer's place lives in the URL
 * (`?gov=&area=`), so the server answers with the estimate for that place; no place = the showroom's range.
 */
export function DeliveryBlock({ locale, terms, place, unitPrice }: { locale: Locale; terms: DeliveryTerms | null; place: BuyerPlace | null; unitPrice: number | null }) {
  const t = deliveryCopy[locale];
  const router = useRouter();
  const pathname = usePathname();
  const choose = (next: BuyerPlace | null) => {
    const sp = new URLSearchParams();
    if (next) {
      sp.set("gov", next.gov);
      if (next.area) sp.set("area", next.area);
    }
    const q = sp.toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  };
  if (!terms) return null;
  const v = termsForPrice(terms, unitPrice);
  const hasEstimate = terms.configured && terms.min_days !== null && terms.max_days !== null;
  const fee = feeText(v, locale);
  const freeNote = freeReasonText(v, locale);

  return (
    <section className={styles.delivery} aria-label={t.deliveryTitle}>
      <h2 className={styles.deliveryTitle} data-plain>
        <TruckIcon size={18} aria-hidden="true" />
        {t.deliveryTitle}
      </h2>
      <PlacePicker locale={locale} place={place} onChange={choose} idPrefix="pd-place" />

      {v.status === "not_available" ? <p className={styles.deliveryWarn} role="status">{t.notDelivered}</p> : null}
      {v.status === "needs_area" || v.status === "pickup_only" || v.status === "none" ? <p className={styles.deliveryMuted}>{t.pickPlace}</p> : null}

      {v.status === "available" && hasEstimate && terms.earliest ? (
        <p className={styles.deliveryLine}>
          <span className={styles.deliveryStrong}>{t.getBy(dateRangeText(terms.earliest, terms.latest, locale))}</span>
        </p>
      ) : null}
      {v.status === "needs_area" && hasEstimate ? (
        <p className={styles.deliveryLine}>{t.rangeAll(daysRangeText(terms.min_days ?? 0, terms.max_days ?? 0, locale))}</p>
      ) : null}
      {!terms.configured && v.status !== "not_available" ? <p className={styles.deliveryMuted}>{t.unconfigured}</p> : null}

      {fee ? (
        <p className={styles.deliveryLine}>
          {t.fee}: <span className={styles.deliveryStrong}>{fee}</span>
        </p>
      ) : v.status === "needs_area" && v.fee_min_egp !== null && v.fee_max_egp !== null ? (
        <p className={styles.deliveryLine}>
          {t.fee}: <span className={styles.deliveryStrong}>{v.fee_min_egp === v.fee_max_egp ? fmtEgp(Number(v.fee_min_egp), locale) : t.feeRange(fmtEgp(Number(v.fee_min_egp), locale), fmtEgp(Number(v.fee_max_egp), locale))}</span>
        </p>
      ) : null}
      {freeNote ? <p className={styles.deliveryMuted}>{freeNote}</p> : null}

      {terms.next_day ? (
        <details className={styles.faster}>
          <summary>{t.fasterTitle}</summary>
          <p>{t.nextDay(dateText(terms.next_day.arrival, locale), fmtEgp(Number(terms.next_day.fee_egp), locale))}</p>
          <p className={styles.deliveryMuted}>{t.nextDayNote}</p>
        </details>
      ) : null}

      {terms.pickup_available ? (
        <div className={styles.faster}>
          <p className={styles.deliveryStrong}>{t.pickupHeading}</p>
          {terms.pickup_instructions ? <p className={styles.deliveryMuted}>{terms.pickup_instructions}</p> : <p className={styles.deliveryMuted}>{t.pickup}</p>}
        </div>
      ) : null}
    </section>
  );
}
