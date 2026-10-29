import type { Bilingual } from "./marketplace-types";

/**
 * SAMPLE delivery price list of the first seller (BestTrade). In the real product each showroom writes
 * its delivery price per area while uploading its products; checkout then adds the price of the area
 * the buyer chose (docs/marketplace/MARKETPLACE.md, delivery pricing). An area with no price means the
 * seller does not deliver there — it is not offered, never silently priced at zero.
 *
 * Resolution: area price, else the governorate's default price, else not available.
 */
export type DeliveryArea = { key: string; name: Bilingual; feeEgp?: number };
export type DeliveryGovernorate = { key: string; name: Bilingual; feeEgp?: number; areas: DeliveryArea[] };

const n = (ar: string, en: string): Bilingual => ({ ar, en });

export const sampleDeliveryRates: DeliveryGovernorate[] = [
  {
    key: "cairo", name: n("القاهرة", "Cairo"), feeEgp: 80,
    areas: [
      { key: "nasr_city", name: n("مدينة نصر", "Nasr City") },
      { key: "heliopolis", name: n("مصر الجديدة", "Heliopolis") },
      { key: "maadi", name: n("المعادي", "Maadi"), feeEgp: 90 },
      { key: "new_cairo", name: n("القاهرة الجديدة", "New Cairo"), feeEgp: 100 },
      { key: "shubra", name: n("شبرا", "Shubra"), feeEgp: 85 },
    ],
  },
  {
    key: "giza", name: n("الجيزة", "Giza"), feeEgp: 90,
    areas: [
      { key: "dokki", name: n("الدقي", "Dokki") },
      { key: "haram", name: n("الهرم", "Haram"), feeEgp: 100 },
      { key: "sheikh_zayed", name: n("الشيخ زايد", "Sheikh Zayed"), feeEgp: 120 },
      { key: "october", name: n("6 أكتوبر", "6th of October"), feeEgp: 130 },
    ],
  },
  {
    key: "alexandria", name: n("الإسكندرية", "Alexandria"), feeEgp: 150,
    areas: [
      { key: "smouha", name: n("سموحة", "Smouha") },
      { key: "mandara", name: n("المندرة", "Mandara"), feeEgp: 160 },
    ],
  },
];

/** Price of delivering to a governorate / area, or null when the seller does not deliver there. */
export function deliveryFee(governorateKey: string, areaKey: string): number | null {
  const gov = sampleDeliveryRates.find((g) => g.key === governorateKey);
  if (!gov) return null;
  const area = gov.areas.find((a) => a.key === areaKey);
  const fee = area?.feeEgp ?? gov.feeEgp;
  return typeof fee === "number" ? fee : null;
}
